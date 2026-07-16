import { strict as assert } from "node:assert";
import { test } from "node:test";
import { classifyMarket } from "../src/model/fair";
import { sizePosition } from "../src/risk/kelly";
import {
  DEFAULT_LIMITS,
  gate,
  initialRiskState,
  rebuildRiskState,
  registerOpen,
} from "../src/risk/limits";
import { OddsRecord } from "../src/feed/types";
import { DecisionIntent, DecisionRecord } from "../src/strategy/types";

// Regression tests for the adversarial-review findings — each of these
// encodes a real bug that shipped once and must never ship again.

function decision(overrides: Partial<DecisionRecord>): DecisionRecord {
  return {
    hash: "h" + Math.abs(JSON.stringify(overrides).length),
    decidedAtTs: 1_766_000_000_000,
    mode: "paper",
    strategy: "S1_COHERENCE",
    fixtureId: 1,
    marketKey: "m",
    family: "WIN_DRAW_WIN",
    outcomeIndex: 0,
    outcomeName: "1",
    modelProb: 0.5,
    marketProb: 0.45,
    edge: 0.05,
    stakeUsdc: 10,
    priceDecimal: 2.2,
    reason: "test",
    sizing: { kellyFraction: 0.01, calibrationFactor: 1, allocationWeight: 0.33, bankrollUsdc: 2000 },
    inputs: { oddsMessageId: "x", oddsTs: 1_766_000_000_000, lambdaHome: 1, lambdaAway: 1 },
    ...overrides,
  };
}

function intent(overrides: Partial<DecisionIntent>): DecisionIntent {
  return {
    strategy: "S1_COHERENCE",
    fixtureId: 1,
    marketKey: "m",
    family: "WIN_DRAW_WIN",
    outcomeIndex: 0,
    outcomeName: "1",
    modelProb: 0.5,
    marketProb: 0.45,
    edge: 0.05,
    reason: "test",
    inputs: { oddsMessageId: "x", oddsTs: 1_766_000_000_000, lambdaHome: 1, lambdaAway: 1 },
    ...overrides,
  };
}

test("restart rebuild: realized P&L, exposure maps, and peak survive a reboot", () => {
  const open = [
    decision({ hash: "a", fixtureId: 7, marketKey: "1X2", stakeUsdc: 30, decidedAtTs: Date.parse("2026-07-16T09:00:00Z") }),
    decision({ hash: "b", fixtureId: 7, marketKey: "OU", stakeUsdc: 20, decidedAtTs: Date.parse("2026-07-10T09:00:00Z") }), // older day
  ];
  const state = rebuildRiskState(2000, open, 400, 2450, Date.parse("2026-07-16T12:00:00Z"));

  assert.equal(state.realizedUsdc, 2400); // bankroll + settled pnl — NOT wiped
  assert.equal(state.peakRealizedUsdc, 2450); // high-water mark preserved
  assert.equal(state.equityUsdc, 2400 - 50); // cash = realized − open stakes
  assert.equal(state.openByFixture.get(7), 50); // exposure maps rebuilt
  assert.equal(state.stakedToday, 30); // only today's decision counts
});

test("staleness gate: a quote older than staleDataMs is vetoed, fresh lag is allowed", () => {
  const state = initialRiskState(2000);
  const nowTs = 1_766_000_500_000;

  const fresh = gate(
    intent({ inputs: { oddsMessageId: "x", oddsTs: nowTs - 30_000, lambdaHome: 1, lambdaAway: 1 } }),
    state,
    DEFAULT_LIMITS,
    nowTs,
  );
  assert.equal(fresh.allowed, true);

  const stale = gate(
    intent({ inputs: { oddsMessageId: "x", oddsTs: nowTs - 10 * 60_000, lambdaHome: 1, lambdaAway: 1 } }),
    state,
    DEFAULT_LIMITS,
    nowTs,
  );
  assert.equal(stale.allowed, false);
  assert.match(stale.vetoReason ?? "", /stale/);
});

test("drawdown breaker: deploying capital does not trip it; realized losses do", () => {
  const limits = { ...DEFAULT_LIMITS, maxExposurePerFixtureUsdc: 10_000, maxDailyStakeUsdc: 10_000, maxExposurePerMarketUsdc: 10_000 };
  const state = initialRiskState(2000);
  const nowTs = 1_766_000_500_000;
  const freshIntent = () =>
    intent({ inputs: { oddsMessageId: "x", oddsTs: nowTs - 5_000, lambdaHome: 1, lambdaAway: 1 } });

  // Escrow 30% of bankroll — old code halted here; must stay open.
  registerOpen(decision({ hash: "c", stakeUsdc: 600 }), state);
  assert.equal(gate(freshIntent(), state, limits, nowTs).allowed, true);

  // Now a realized 25% loss — breaker must fire.
  state.realizedUsdc = 1500;
  const halted = gate(freshIntent(), state, limits, nowTs);
  assert.equal(halted.allowed, false);
  assert.match(halted.vetoReason ?? "", /drawdown/);
});

test("kelly: infinite or degenerate odds produce zero stake, never NaN", () => {
  const cases = [
    { modelProb: 0.5, priceDecimal: Infinity },
    { modelProb: 0.5, priceDecimal: NaN },
    { modelProb: 1, priceDecimal: 2 },
    { modelProb: 0.5, priceDecimal: 2, bankrollUsdc: NaN },
  ];
  for (const c of cases) {
    const result = sizePosition({
      bankrollUsdc: 2000,
      calibrationFactor: 1,
      allocationWeight: 1,
      maxStakeUsdc: 50,
      ...c,
    } as any);
    assert.equal(result.stakeUsdc, 0, JSON.stringify(c));
    assert.ok(Number.isFinite(result.stakeUsdc));
  }
});

function oddsRecord(overrides: Partial<OddsRecord>): OddsRecord {
  return {
    fixtureId: 1,
    messageId: "m1",
    ts: 1_766_000_000_000,
    bookmaker: "TXLineStablePriceDemargined",
    superOddsType: "1X2_PARTICIPANT_RESULT",
    inRunning: false,
    priceNames: ["part1", "draw", "part2"],
    prices: [],
    pct: [0.36, 0.31, 0.33],
    raw: {},
    ...overrides,
  };
}

test("classifyMarket: degenerate 0%/100% quotes are rejected", () => {
  assert.equal(classifyMarket(oddsRecord({ pct: [0, 0.5, 0.5] })), null);
  assert.equal(classifyMarket(oddsRecord({ pct: [1, 0, 0] })), null);
  assert.notEqual(classifyMarket(oddsRecord({})), null);
});

test("classifyMarket: totals need a keyed half-line", () => {
  const totals = (params?: string) =>
    classifyMarket(
      oddsRecord({
        superOddsType: "OVERUNDER_PARTICIPANT_GOALS",
        priceNames: ["over", "under"],
        pct: [0.55, 0.45],
        marketParameters: params,
      }),
    );
  assert.notEqual(totals("line=2.5"), null);
  assert.equal(totals("line=2.5")!.line, 2.5);
  assert.equal(totals("line=2"), null); // integer line → push risk → rejected
  assert.equal(totals("line=2.25"), null); // quarter line → rejected
  // "participant=2&line=2.5" must read the keyed value, not the first number
  assert.equal(totals("participant=2&line=2.5")!.line, 2.5);
  assert.equal(totals(undefined), null);
});
