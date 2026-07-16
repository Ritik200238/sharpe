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
  equityUsdc: number;
  peakEquityUsdc: number;
}

export function initialRiskState(bankrollUsdc: number): RiskState {
  return {
    openByMarket: new Map(),
    openByFixture: new Map(),
    stakedToday: 0,
    dayKey: new Date().toISOString().slice(0, 10),
    equityUsdc: bankrollUsdc,
    peakEquityUsdc: bankrollUsdc,
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
  freshestFeedTs: number,
): GateResult {
  const dayKey = new Date(nowTs).toISOString().slice(0, 10);
  if (dayKey !== state.dayKey) {
    state.dayKey = dayKey;
    state.stakedToday = 0;
  }

  if (nowTs - freshestFeedTs > limits.staleDataMs) {
    return {
      allowed: false,
      vetoReason: `data stale (${Math.round((nowTs - freshestFeedTs) / 1000)}s old)`,
      stakeCapUsdc: 0,
    };
  }

  const drawdown = 1 - state.equityUsdc / state.peakEquityUsdc;
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
  state.equityUsdc += payout;
  state.peakEquityUsdc = Math.max(state.peakEquityUsdc, state.equityUsdc);
  return payout - decision.stakeUsdc; // pnl
}
