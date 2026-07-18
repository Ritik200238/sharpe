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
import { OddsRecord, ScoreRecord, SoccerPhase } from "../feed/types";
import { MarketView, classifyMarket, modelProbs } from "../model/fair";
import { MatchState, MatchStateStore, goals, remainingFraction } from "../state/match";
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
}

export const DEFAULT_MM_CONFIG: MmConfig = {
  quote: DEFAULT_QUOTE_PARAMS,
  adverse: DEFAULT_ADVERSE_PARAMS,
  flow: DEFAULT_FLOW_PARAMS,
  protectionEnabled: true,
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

const buildViews = (odds: ReturnType<OddsStateStore["get"]>): Map<string, MarketView> => {
  const views = new Map<string, MarketView>();
  if (!odds) return views;
  for (const [key, quote] of odds.markets) {
    const view = classifyMarket(quote.latest);
    if (view) views.set(key, view);
  }
  return views;
};

/** A NotStarted pseudo-state so we can price a fixture before its first
 * score record arrives (identical pattern to the strategy layer). */
function pseudoState(fixtureId: number, nowTs: number): MatchState {
  return {
    fixtureId,
    lastSeq: 0,
    lastTs: nowTs,
    phase: SoccerPhase.NotStarted,
    phaseChangedAtTs: nowTs,
    stats: {},
    finalised: false,
  };
}

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
  private lastFair = new Map<string, number>();
  private tickCount = new Map<string, number>();
  private meta = new Map<string, OutcomeMeta>();
  private quotes = new Map<string, QuoteSnapshot>();
  private settled = new Set<number>();

  constructor(private readonly cfg: MmConfig = DEFAULT_MM_CONFIG) {}

  liveQuotes(): QuoteSnapshot[] {
    return [...this.quotes.values()];
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

  /** Feed an odds record: refresh quotes and fill any noise flow. */
  processOdds(record: OddsRecord): void {
    this.oddsStore.apply(record);
    const fixtureId = record.fixtureId;
    const odds = this.oddsStore.get(fixtureId);
    if (!odds) return;
    const matchOpt = this.matchStore.get(fixtureId);
    const views = buildViews(odds);
    if (views.size === 0) return;
    const nowTs = record.ts;
    const model = this.modelStore.maybeRefit(fixtureId, views, matchOpt, nowTs);
    if (!model) return;
    const match = matchOpt ?? pseudoState(fixtureId, nowTs);
    if (match.finalised) return;

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
        if (taker) this.fill(key, quote, fair, taker);
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
        this.fill(key, staleQuote, newFair, taker);
        this.lastFair.set(key, newFair);
      }
    }
  }

  private fill(key: string, quote: Quote, fair: number, taker: Taker): void {
    if (taker.side === "buy") {
      this.book.fillBuy(key, quote.askProb, fair, taker.shares, taker.informed);
    } else {
      this.book.fillSell(key, quote.bidProb, fair, taker.shares, taker.informed);
    }
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
