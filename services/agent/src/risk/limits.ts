import { DecisionIntent, DecisionRecord } from "../strategy/types";

/** Hard risk limits — deterministic gates evaluated before any position. */
export interface RiskLimits {
  maxStakeUsdc: number;
  maxExposurePerMarketUsdc: number;
  maxExposurePerFixtureUsdc: number;
  maxDailyStakeUsdc: number;
  /** Halt all new entries when equity draws down this much from peak. */
  drawdownHaltFraction: number;
  /** No entries when the freshest feed data is older than this. */
  staleDataMs: number;
  /** Minimum stake worth booking at all. */
  minStakeUsdc: number;
}

export const DEFAULT_LIMITS: RiskLimits = {
  maxStakeUsdc: 50,
  maxExposurePerMarketUsdc: 100,
  maxExposurePerFixtureUsdc: 250,
  maxDailyStakeUsdc: 1000,
  drawdownHaltFraction: 0.2,
  staleDataMs: 120_000,
  minStakeUsdc: 1,
};

export interface RiskState {
  openByMarket: Map<string, number>; // marketKey → open stake
  openByFixture: Map<number, number>; // fixtureId → open stake
  stakedToday: number;
  dayKey: string; // UTC date the counter belongs to
  /** Cash on hand (bankroll + realized P&L − open stakes in escrow). */
  equityUsdc: number;
  /** Account value at cost: bankroll + realized P&L. Escrowing a stake does
   * NOT reduce this — only settled losses do. Drives Kelly sizing and the
   * drawdown breaker so deploying capital never trips the halt by itself. */
  realizedUsdc: number;
  peakRealizedUsdc: number;
}

export function initialRiskState(bankrollUsdc: number): RiskState {
  return {
    openByMarket: new Map(),
    openByFixture: new Map(),
    stakedToday: 0,
    dayKey: "", // set from the first gated event's timestamp — deterministic
    equityUsdc: bankrollUsdc,
    realizedUsdc: bankrollUsdc,
    peakRealizedUsdc: bankrollUsdc,
  };
}

export interface GateResult {
  allowed: boolean;
  vetoReason?: string;
  /** Stake cap remaining after exposure limits (may shrink the position). */
  stakeCapUsdc: number;
}

export function gate(
  intent: DecisionIntent,
  state: RiskState,
  limits: RiskLimits,
  nowTs: number,
): GateResult {
  const dayKey = new Date(nowTs).toISOString().slice(0, 10);
  if (dayKey !== state.dayKey) {
    state.dayKey = dayKey;
    state.stakedToday = 0;
  }

  // Quote freshness: the intent's own odds timestamp vs the trigger moment.
  // Both are feed-source timestamps — deterministic under replay. S2 trades
  // quotes that LAG an event, but a quote older than staleDataMs is not
  // real liquidity and must not be priced at all.
  const quoteAge = nowTs - intent.inputs.oddsTs;
  if (quoteAge > limits.staleDataMs) {
    return {
      allowed: false,
      vetoReason: `quote stale (${Math.round(quoteAge / 1000)}s old)`,
      stakeCapUsdc: 0,
    };
  }

  const drawdown = 1 - state.realizedUsdc / state.peakRealizedUsdc;
  if (drawdown >= limits.drawdownHaltFraction) {
    return {
      allowed: false,
      vetoReason: `drawdown circuit breaker (${(drawdown * 100).toFixed(1)}% from peak)`,
      stakeCapUsdc: 0,
    };
  }

  const marketOpen = state.openByMarket.get(intent.marketKey + intent.fixtureId) ?? 0;
  const fixtureOpen = state.openByFixture.get(intent.fixtureId) ?? 0;
  const capFromMarket = limits.maxExposurePerMarketUsdc - marketOpen;
  const capFromFixture = limits.maxExposurePerFixtureUsdc - fixtureOpen;
  const capFromDay = limits.maxDailyStakeUsdc - state.stakedToday;
  const stakeCapUsdc = Math.min(limits.maxStakeUsdc, capFromMarket, capFromFixture, capFromDay);

  if (stakeCapUsdc < limits.minStakeUsdc) {
    return { allowed: false, vetoReason: "exposure limits exhausted", stakeCapUsdc: 0 };
  }
  return { allowed: true, stakeCapUsdc };
}

export function registerOpen(decision: DecisionRecord, state: RiskState): void {
  const marketId = decision.marketKey + decision.fixtureId;
  state.openByMarket.set(marketId, (state.openByMarket.get(marketId) ?? 0) + decision.stakeUsdc);
  state.openByFixture.set(
    decision.fixtureId,
    (state.openByFixture.get(decision.fixtureId) ?? 0) + decision.stakeUsdc,
  );
  state.stakedToday += decision.stakeUsdc;
  state.equityUsdc -= decision.stakeUsdc; // stake moves into escrow
}

export function registerSettlement(
  decision: DecisionRecord,
  won: boolean,
  state: RiskState,
): number {
  const marketId = decision.marketKey + decision.fixtureId;
  state.openByMarket.set(
    marketId,
    Math.max(0, (state.openByMarket.get(marketId) ?? 0) - decision.stakeUsdc),
  );
  state.openByFixture.set(
    decision.fixtureId,
    Math.max(0, (state.openByFixture.get(decision.fixtureId) ?? 0) - decision.stakeUsdc),
  );

  const payout = won ? decision.stakeUsdc * decision.priceDecimal : 0;
  const pnl = payout - decision.stakeUsdc;
  state.equityUsdc += payout;
  state.realizedUsdc += pnl;
  state.peakRealizedUsdc = Math.max(state.peakRealizedUsdc, state.realizedUsdc);
  return pnl;
}

/**
 * Rebuild the full risk state from the persisted ledger — called on boot so
 * a restart resumes with exact equity, exposure maps, day counter, and
 * high-water mark instead of a fresh bankroll.
 */
export function rebuildRiskState(
  bankrollUsdc: number,
  openDecisions: DecisionRecord[],
  settledPnlUsdc: number,
  peakRealizedUsdc: number,
  nowTs: number,
): RiskState {
  const state = initialRiskState(bankrollUsdc);
  state.realizedUsdc = bankrollUsdc + settledPnlUsdc;
  state.peakRealizedUsdc = Math.max(state.realizedUsdc, peakRealizedUsdc, bankrollUsdc);
  state.equityUsdc = state.realizedUsdc;
  state.dayKey = new Date(nowTs).toISOString().slice(0, 10);

  for (const decision of openDecisions) {
    if (decision.stakeUsdc <= 0) continue;
    registerOpen(decision, state);
    // registerOpen adds to stakedToday — only keep today's decisions there.
    if (new Date(decision.decidedAtTs).toISOString().slice(0, 10) !== state.dayKey) {
      state.stakedToday -= decision.stakeUsdc;
    }
  }
  return state;
}
