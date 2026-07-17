import { modelProbs } from "../model/fair";
import { isLive } from "../state/match";
import { SoccerPhase } from "../feed/types";
import { StrategyContext } from "./context";
import { DecisionIntent, StrategyId } from "./types";

/** Entry thresholds (edge in probability points) per strategy.
 * S1's threshold was raised from 3pp after the 20-match real-data backtest:
 * small cross-market incoherences are usually the market knowing something
 * the two-market λ fit doesn't. */
export const THRESHOLDS: Record<StrategyId, number> = {
  S1_COHERENCE: 0.065,
  S2_REACTION: 0.04,
  S3_CONVERGENCE: 0.045,
};

/** S1 only trades when the λ solver reconciled its inputs this tightly. */
const S1_MAX_FIT_ERROR = 0.02;

/** S2's own quote-age tolerance — its signal IS the lagging quote. Real
 * feeds showed ~5-minute quote gaps around goals; beyond 10 minutes a quote
 * is treated as dead even for S2. */
const S2_MAX_QUOTE_AGE_MS = 10 * 60_000;

/** Only quotes fresher than this participate in steady-state strategies. */
const QUOTE_FRESH_MS = 5 * 60_000;
/** S2 acts on quotes that lag a match event by at least this much. */
const REACTION_MIN_LAG_MS = 2_000;
/** S3 drift lookback window. */
const DRIFT_WINDOW_MS = 10 * 60_000;
const DRIFT_MIN_MOVE = 0.02;

function fmtPct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

function makeIntent(
  strategy: StrategyId,
  ctx: StrategyContext,
  marketKey: string,
  outcomeIndex: number,
  model: number[],
  market: number[],
  reason: string,
): DecisionIntent | null {
  const view = ctx.views.get(marketKey);
  const quote = ctx.odds.markets.get(marketKey);
  const fixtureModel = ctx.model;
  if (!view || !quote || !fixtureModel) return null;

  return {
    strategy,
    fixtureId: ctx.odds.fixtureId,
    marketKey,
    family: view.family,
    line: view.line,
    outcomeIndex,
    outcomeName: view.outcomes[outcomeIndex],
    modelProb: model[outcomeIndex],
    marketProb: market[outcomeIndex],
    edge: model[outcomeIndex] - market[outcomeIndex],
    reason,
    inputs: {
      scoreSeq: ctx.match?.lastSeq,
      scoreTs: ctx.match?.lastTs,
      oddsMessageId: quote.latest.messageId,
      oddsTs: quote.latest.ts,
      lambdaHome: fixtureModel.lambdaHome,
      lambdaAway: fixtureModel.lambdaAway,
    },
  };
}

/**
 * S1 — COHERENCE. The λ model is fitted so that 1X2 and the main totals
 * line agree. Any other supported market (or a drifted copy of those) that
 * disagrees with the jointly-fitted model is the incoherent leg — trade it.
 * Runs pre-match and in stable live phases on odds updates.
 */
export function coherence(ctx: StrategyContext): DecisionIntent[] {
  if (!ctx.model) return [];
  if (ctx.model.fitError > S1_MAX_FIT_ERROR) return []; // loose fit → no trust
  if (ctx.trigger.type !== "odds") return [];
  const state = ctx.match;
  if (state && !(state.phase === SoccerPhase.NotStarted || isLive(state))) return [];

  const intents: DecisionIntent[] = [];
  for (const [key, view] of ctx.views) {
    if (ctx.nowTs - view.sourceTs > QUOTE_FRESH_MS) continue;
    const model = state
      ? modelProbs(ctx.model, state, view, ctx.nowTs)
      : modelProbsPreMatch(ctx, view);
    if (!model) continue;

    for (let i = 0; i < view.outcomes.length; i++) {
      const edge = model[i] - view.marketProbs[i];
      if (edge >= THRESHOLDS.S1_COHERENCE) {
        const intent = makeIntent(
          "S1_COHERENCE",
          ctx,
          key,
          i,
          model,
          view.marketProbs,
          `Cross-market fit (λh=${ctx.model.lambdaHome.toFixed(2)}, λa=${ctx.model.lambdaAway.toFixed(2)}) ` +
            `prices ${view.outcomes[i].toUpperCase()} at ${fmtPct(model[i])}; ` +
            `this quote implies ${fmtPct(view.marketProbs[i])}. ` +
            `Incoherent leg, edge +${fmtPct(edge)} ≥ ${fmtPct(THRESHOLDS.S1_COHERENCE)}.`,
        );
        if (intent) intents.push(intent);
        break; // one side per market at most
      }
    }
  }
  return intents;
}

/** Pre-kickoff pricing uses the raw fitted λs with full time remaining. */
function modelProbsPreMatch(
  ctx: StrategyContext,
  view: { family: any; line?: number; outcomes: string[] },
): number[] | null {
  if (!ctx.model) return null;
  const pseudoState = {
    fixtureId: ctx.odds.fixtureId,
    lastSeq: 0,
    lastTs: ctx.nowTs,
    phase: SoccerPhase.NotStarted,
    phaseChangedAtTs: ctx.nowTs,
    stats: {},
    finalised: false,
  };
  return modelProbs(ctx.model, pseudoState, view, ctx.nowTs);
}

/**
 * S2 — REACTION. A goal or red card changes fair value instantly; quotes
 * lag. On each match event, reprice every supported market conditioned on
 * the NEW state and trade quotes that still reflect the old world.
 */
export function reaction(ctx: StrategyContext): DecisionIntent[] {
  if (!ctx.model || !ctx.match) return [];
  if (ctx.trigger.type !== "score") return [];
  if (!ctx.trigger.goal && !ctx.trigger.red) return [];
  if (!isLive(ctx.match)) return [];

  const eventTs = ctx.trigger.record.ts;
  const eventDescription = ctx.trigger.goal ? "Goal" : "Red card";

  const intents: DecisionIntent[] = [];
  for (const [key, view] of ctx.views) {
    const lag = eventTs - view.sourceTs;
    if (lag < REACTION_MIN_LAG_MS) continue; // quote already newer than event

    const model = modelProbs(ctx.model, ctx.match, view, ctx.nowTs);
    if (!model) continue;

    for (let i = 0; i < view.outcomes.length; i++) {
      const edge = model[i] - view.marketProbs[i];
      if (edge >= THRESHOLDS.S2_REACTION) {
        const intent = makeIntent(
          "S2_REACTION",
          ctx,
          key,
          i,
          model,
          view.marketProbs,
          `${eventDescription} at seq ${ctx.trigger.record.seq} repriced this match; ` +
            `quote is ${(lag / 1000).toFixed(0)}s older than the event. ` +
            `Model now ${fmtPct(model[i])} for ${view.outcomes[i].toUpperCase()}, ` +
            `stale quote implies ${fmtPct(view.marketProbs[i])}, edge +${fmtPct(edge)}.`,
        );
        if (intent) {
          intent.maxQuoteAgeMs = S2_MAX_QUOTE_AGE_MS;
          intents.push(intent);
        }
        break;
      }
    }
  }
  return intents;
}

/**
 * S3 — CONVERGENCE. During stable phases, when a quote has drifted away
 * from its own recent consensus AND away from the model, fade the drift
 * back toward fair value. Requires both conditions — never fights news
 * (news moves arrive via S2's event trigger instead).
 */
export function convergence(ctx: StrategyContext): DecisionIntent[] {
  if (!ctx.model) return [];
  if (ctx.trigger.type !== "odds") return [];
  const state = ctx.match;
  if (state && !(state.phase === SoccerPhase.NotStarted || isLive(state))) return [];

  const intents: DecisionIntent[] = [];
  for (const [key, view] of ctx.views) {
    const quote = ctx.odds.markets.get(key);
    if (!quote || quote.history.length < 3) continue;
    if (ctx.nowTs - view.sourceTs > QUOTE_FRESH_MS) continue;

    const model = state
      ? modelProbs(ctx.model, state, view, ctx.nowTs)
      : modelProbsPreMatch(ctx, view);
    if (!model) continue;

    // Trailing reference: median of history within the window (excl. latest).
    for (let i = 0; i < view.outcomes.length; i++) {
      const past = quote.history
        .slice(0, -1)
        .filter((h) => ctx.nowTs - h.ts <= DRIFT_WINDOW_MS)
        .map((h) => h.pct[i])
        .filter((p): p is number => p !== null && p !== undefined)
        .sort((a, b) => a - b);
      if (past.length < 2) continue;
      const median = past[Math.floor(past.length / 2)];

      const drift = view.marketProbs[i] - median; // how far the quote ran
      const edge = model[i] - view.marketProbs[i]; // model disagrees with run

      if (drift <= -DRIFT_MIN_MOVE && edge >= THRESHOLDS.S3_CONVERGENCE) {
        const intent = makeIntent(
          "S3_CONVERGENCE",
          ctx,
          key,
          i,
          model,
          view.marketProbs,
          `Quote drifted ${fmtPct(Math.abs(drift))} below its ${past.length}-tick median ` +
            `(${fmtPct(median)}) with no match event; model holds ${fmtPct(model[i])} for ` +
            `${view.outcomes[i].toUpperCase()}. Fading the drift, edge +${fmtPct(edge)}.`,
        );
        if (intent) intents.push(intent);
        break;
      }
    }
  }
  return intents;
}

export const ALL_STRATEGIES: Record<
  StrategyId,
  (ctx: StrategyContext) => DecisionIntent[]
> = {
  S1_COHERENCE: coherence,
  S2_REACTION: reaction,
  S3_CONVERGENCE: convergence,
};
