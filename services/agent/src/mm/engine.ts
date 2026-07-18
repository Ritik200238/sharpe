/**
 * The market-making engine — SHARPE's job.
 *
 * Feed events in; the engine keeps a live two-sided quote on every supported
 * outcome, fills the flow that trades against it, defends against toxic flow
 * around goals, and settles its inventory when the match ends. It never
 * predicts the winner — it earns the spread and manages inventory risk, the
 * way a real in-play desk does. Pure and deterministic given the event
 * sequence, so a replay reproduces every quote, fill, and P&L exactly.
 */
import { OddsRecord, ScoreRecord } from "../feed/types";
import { MarketView, classifyMarket, modelProbs } from "../model/fair";
import { MatchState, MatchStateStore, goals, isLive, remainingFraction } from "../state/match";
import { OddsStateStore } from "../state/odds";
import { ModelStore } from "../strategy/context";
import { planActualOutcome } from "../settle/proofs";
import { AdverseParams, DEFAULT_ADVERSE_PARAMS, protectionFor } from "./adverse";
import { MakerBook } from "./book";
import { DEFAULT_FLOW_PARAMS, FlowParams, informedTaker, sampleNoise, Taker } from "./flow";
import { DEFAULT_QUOTE_PARAMS, Quote, QuoteParams, makeQuote } from "./quote";

export interface MmConfig {
  quote: QuoteParams;
  adverse: AdverseParams;
  flow: FlowParams;
  /** When false, the maker quotes naively (no pull/widen) — used to measure
   * exactly how much the adverse-selection protection is worth. */
  protectionEnabled: boolean;
  /** Reprice cadence in match-clock ms. Real makers refresh quotes on an
   * interval (plus immediately on events), not on every raw tick — this is
   * both realistic and keeps the compute bounded. Deterministic: keyed off
   * the feed's own timestamps. */
  repriceIntervalMs: number;
}

export const DEFAULT_MM_CONFIG: MmConfig = {
  quote: DEFAULT_QUOTE_PARAMS,
  adverse: DEFAULT_ADVERSE_PARAMS,
  flow: DEFAULT_FLOW_PARAMS,
  protectionEnabled: true,
  repriceIntervalMs: 2_000,
};

export interface QuoteSnapshot {
  fixtureId: number;
  marketKey: string;
  outcomeIndex: number;
  outcomeName: string;
  quote: Quote;
  pulled: boolean;
  ts: number;
}

/** A single trade the maker filled — emitted live so the agent can journal it,
 * stream it, and rebuild the book after a restart. */
export interface MakerFill {
  fixtureId: number;
  marketKey: string;
  outcomeIndex: number;
  outcomeName: string;
  /** The taker's side: "buy" = it lifted our ask; "sell" = it hit our bid. */
  side: "buy" | "sell";
  shares: number;
  /** The probability the taker actually traded at (our ask or bid). */
  priceProb: number;
  fairProb: number;
  informed: boolean;
  ts: number;
}

/** Optional live hooks — undefined in the backtest/tests, so engine behaviour
 * is byte-identical there; the live agent supplies them to persist + stream. */
export interface MmHooks {
  onFill?: (fill: MakerFill) => void;
}

/** One live two-sided quote, flattened for the API + on-chain commit. */
export interface QuoteLine {
  fixtureId: number;
  marketKey: string;
  outcomeIndex: number;
  outcomeName: string;
  bidProb: number;
  askProb: number;
  fairProb: number;
  halfSpread: number;
  skew: number;
  widened: boolean;
  inventory: number;
  ts: number;
}

/** A deterministic snapshot of the maker's book + live quotes. Canonically
 * hashable → committed on-chain (kind "quote_book") as tamper-proof evidence
 * of exactly what the maker was quoting, and served to the dashboard. */
export interface MmSnapshot {
  totals: ReturnType<MakerBook["totals"]>;
  stats: MmStats;
  quotes: QuoteLine[];
}

interface OutcomeMeta {
  fixtureId: number;
  family: MarketView["family"];
  line?: number;
  outcomes: string[];
}

export interface MmStats {
  ticks: number;
  quotesPosted: number;
  pulled: number;
  widened: number;
  informedDeflected: number;
  informedFilled: number;
}

/** Pre-match model-fit cadence (match-clock ms) — coarse, since we only need
 * the λ model warm by kickoff, not a live quote. */
const PREMATCH_REFIT_MS = 20_000;

const buildViews = (odds: ReturnType<OddsStateStore["get"]>): Map<string, MarketView> => {
  const views = new Map<string, MarketView>();
  if (!odds) return views;
  for (const [key, quote] of odds.markets) {
    const view = classifyMarket(quote.latest);
    if (view) views.set(key, view);
  }
  return views;
};

export class MarketMakerEngine {
  readonly book = new MakerBook();
  readonly stats: MmStats = {
    ticks: 0,
    quotesPosted: 0,
    pulled: 0,
    widened: 0,
    informedDeflected: 0,
    informedFilled: 0,
  };

  private matchStore = new MatchStateStore();
  private oddsStore = new OddsStateStore();
  private modelStore = new ModelStore();
  private lastEventTs = new Map<number, number>();
  private lastRepriceTs = new Map<number, number>();
  private lastFair = new Map<string, number>();
  private tickCount = new Map<string, number>();
  private meta = new Map<string, OutcomeMeta>();
  private quotes = new Map<string, QuoteSnapshot>();
  private settled = new Set<number>();

  constructor(
    private readonly cfg: MmConfig = DEFAULT_MM_CONFIG,
    private readonly hooks: MmHooks = {},
  ) {}

  liveQuotes(): QuoteSnapshot[] {
    return [...this.quotes.values()];
  }

  /** Deterministic snapshot of the book + live quotes (sorted), for the API
   * and the on-chain quote-book commitment. Pulled (withdrawn) quotes are
   * excluded — a quote that isn't live isn't part of the book. */
  snapshot(): MmSnapshot {
    const quotes: QuoteLine[] = [];
    for (const q of this.quotes.values()) {
      if (q.pulled) continue;
      quotes.push({
        fixtureId: q.fixtureId,
        marketKey: q.marketKey,
        outcomeIndex: q.outcomeIndex,
        outcomeName: q.outcomeName,
        bidProb: q.quote.bidProb,
        askProb: q.quote.askProb,
        fairProb: q.quote.fairProb,
        halfSpread: q.quote.halfSpread,
        skew: q.quote.skew,
        widened: q.quote.widened,
        inventory: this.book.inventoryOf(this.key(q.fixtureId, q.marketKey, q.outcomeIndex)),
        ts: q.ts,
      });
    }
    quotes.sort((a, b) =>
      a.fixtureId - b.fixtureId ||
      (a.marketKey < b.marketKey ? -1 : a.marketKey > b.marketKey ? 1 : 0) ||
      a.outcomeIndex - b.outcomeIndex,
    );
    return { totals: this.book.totals(), stats: { ...this.stats }, quotes };
  }

  private key(fixtureId: number, marketKey: string, i: number): string {
    return `${fixtureId}|${marketKey}|${i}`;
  }

  /** Feed a score record: update state, arm protection + informed flow on
   * events, settle on finalisation. */
  processScore(record: ScoreRecord): void {
    const delta = this.matchStore.apply(record);
    if (delta.goalScored || delta.redCardShown) {
      this.handleInformedFlow(record.fixtureId, record.ts);
      this.lastEventTs.set(record.fixtureId, record.ts);
    }
    if (delta.becameFinal) this.settleFixture(record.fixtureId, delta.state);
  }

  /** Feed an odds record: refresh quotes and fill any noise flow. This is an
   * IN-PLAY maker, so it only quotes once the match is live; pre-match it just
   * keeps the λ model fitted (on a coarse cadence). Repricing is throttled to
   * the configured cadence — the odds store still absorbs every tick, so
   * quotes always price off the freshest data. Deterministic (keyed on the
   * feed's timestamps). */
  processOdds(record: OddsRecord): void {
    this.oddsStore.apply(record);
    const fixtureId = record.fixtureId;
    const nowTs = record.ts;
    const matchOpt = this.matchStore.get(fixtureId);
    const live = matchOpt ? isLive(matchOpt) : false;

    // Quote actively in-play; pre-match only refit the model, and coarsely.
    const interval = live ? this.cfg.repriceIntervalMs : PREMATCH_REFIT_MS;
    const lastReprice = this.lastRepriceTs.get(fixtureId);
    if (lastReprice !== undefined && nowTs - lastReprice < interval) return;
    this.lastRepriceTs.set(fixtureId, nowTs);

    const odds = this.oddsStore.get(fixtureId);
    if (!odds) return;
    const views = buildViews(odds);
    if (views.size === 0) return;
    const model = this.modelStore.maybeRefit(fixtureId, views, matchOpt, nowTs);
    if (!model) return;
    if (!live) return; // pre-match: model kept warm, no quotes yet
    const match = matchOpt!;

    const protection = protectionFor(this.lastEventTs.get(fixtureId) ?? null, nowTs, this.cfg.adverse);
    const remaining = remainingFraction(match, nowTs);

    for (const [marketKey, view] of views) {
      const probs = modelProbs(model, match, view, nowTs);
      if (!probs) continue;
      for (let i = 0; i < view.outcomes.length; i++) {
        const key = this.key(fixtureId, marketKey, i);
        const fair = probs[i];
        this.lastFair.set(key, fair);
        this.meta.set(key, { fixtureId, family: view.family, line: view.line, outcomes: view.outcomes });
        this.stats.ticks += 1;

        const widen = this.cfg.protectionEnabled && protection.widen;
        const pull = this.cfg.protectionEnabled && protection.pull;
        const inventory = this.book.inventoryOf(key);
        const quote = makeQuote(fair, remaining, inventory, widen, this.cfg.quote);
        this.quotes.set(key, {
          fixtureId,
          marketKey,
          outcomeIndex: i,
          outcomeName: view.outcomes[i],
          quote,
          pulled: pull,
          ts: nowTs,
        });

        if (pull) {
          this.stats.pulled += 1;
          continue; // no quote can't be picked off
        }
        this.stats.quotesPosted += 1;
        if (widen) this.stats.widened += 1;

        const t = (this.tickCount.get(key) ?? 0) + 1;
        this.tickCount.set(key, t);
        const taker = sampleNoise(`${key}:${t}`, this.cfg.flow);
        if (taker)
          this.fill(key, quote, fair, taker, {
            fixtureId,
            marketKey,
            outcomeIndex: i,
            outcomeName: view.outcomes[i],
            ts: nowTs,
          });
      }
    }
  }

  /** Informed flow tries to trade a fair-value jump the instant it happens. */
  private handleInformedFlow(fixtureId: number, ts: number): void {
    const odds = this.oddsStore.get(fixtureId);
    const match = this.matchStore.get(fixtureId);
    if (!odds || !match) return;
    const model = this.modelStore.get(fixtureId);
    if (!model) return;
    const views = buildViews(odds);
    const remaining = remainingFraction(match, ts);
    // At the event instant protection is in its PULL phase (since = 0).
    const protection = protectionFor(ts, ts, this.cfg.adverse);

    for (const [marketKey, view] of views) {
      const probs = modelProbs(model, match, view, ts);
      if (!probs) continue;
      for (let i = 0; i < view.outcomes.length; i++) {
        const key = this.key(fixtureId, marketKey, i);
        const newFair = probs[i];
        const oldFair = this.lastFair.get(key);
        if (oldFair === undefined) continue;
        const taker = informedTaker(newFair - oldFair, this.cfg.flow);
        if (!taker) continue;

        if (this.cfg.protectionEnabled && protection.pull) {
          this.stats.informedDeflected += 1; // no quote to hit — toxic flow dodged
          continue;
        }
        // Unprotected: the informed taker hits the STALE quote (built around
        // the pre-event fair) while the true value is already newFair — the
        // book records the adverse-selection loss against newFair.
        const inventory = this.book.inventoryOf(key);
        const staleQuote = makeQuote(oldFair, remaining, inventory, false, this.cfg.quote);
        this.stats.informedFilled += 1;
        this.fill(key, staleQuote, newFair, taker, {
          fixtureId,
          marketKey,
          outcomeIndex: i,
          outcomeName: view.outcomes[i],
          ts,
        });
        this.lastFair.set(key, newFair);
      }
    }
  }

  private fill(
    key: string,
    quote: Quote,
    fair: number,
    taker: Taker,
    ctx: { fixtureId: number; marketKey: string; outcomeIndex: number; outcomeName: string; ts: number },
  ): void {
    const priceProb = taker.side === "buy" ? quote.askProb : quote.bidProb;
    if (taker.side === "buy") {
      this.book.fillBuy(key, quote.askProb, fair, taker.shares, taker.informed);
    } else {
      this.book.fillSell(key, quote.bidProb, fair, taker.shares, taker.informed);
    }
    this.hooks.onFill?.({
      fixtureId: ctx.fixtureId,
      marketKey: ctx.marketKey,
      outcomeIndex: ctx.outcomeIndex,
      outcomeName: ctx.outcomeName,
      side: taker.side,
      shares: taker.shares,
      priceProb,
      fairProb: fair,
      informed: taker.informed,
      ts: ctx.ts,
    });
  }

  private settleFixture(fixtureId: number, state: MatchState): void {
    if (this.settled.has(fixtureId)) return;
    this.settled.add(fixtureId);
    const finalGoals = goals(state);
    for (const [key, m] of this.meta) {
      if (m.fixtureId !== fixtureId) continue;
      const plan = planActualOutcome(m.family, m.outcomes, finalGoals.p1, finalGoals.p2, m.line);
      if (!plan) continue;
      const outcomeIndex = Number(key.split("|")[2]);
      this.book.settle(key, outcomeIndex === plan.actualOutcomeIndex);
    }
  }
}
