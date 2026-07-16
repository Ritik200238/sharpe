import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, test } from "node:test";
import type { DecisionRecord, SettlementRecord } from "../src/strategy/types";

// HARDENING item 3 acceptance: windowed digest math verified against
// hand-computed values, window exclusion, hash determinism (including across
// separate TrackStore loads of the same ledger), and inactivity flags.
//
// SHARPE_TRACK_DIR must be set before any src module loads config, so all
// runtime src imports here are dynamic (type-only imports are erased).

const trackDir = fs.mkdtempSync(path.join(os.tmpdir(), "sharpe-digest-track-"));
process.env.SHARPE_TRACK_DIR = trackDir;

after(() => fs.rmSync(trackDir, { recursive: true, force: true }));

const B = 1_766_000_000_000; // 2025-12-17T19:33:20Z
const DAY = 86_400_000;
const HOUR = 3_600_000;

function decision(overrides: Partial<DecisionRecord> & { hash: string }): DecisionRecord {
  return {
    decidedAtTs: B,
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
    inputs: { oddsMessageId: "x", oddsTs: B, lambdaHome: 1, lambdaAway: 1 },
    ...overrides,
  };
}

function settlement(overrides: Partial<SettlementRecord> & { decisionHash: string }): SettlementRecord {
  return {
    settledAtTs: B,
    fixtureId: 1,
    won: true,
    pnlUsdc: 0,
    finalP1Goals: 1,
    finalP2Goals: 0,
    ...overrides,
  };
}

/**
 * Hand-crafted history (all timestamps relative to B = nowTs):
 *   S1_COHERENCE: d1 @ B−1d stake 10 mp .60 edge .10 → WON  +12
 *                 d2 @ B−2d stake 20 mp .50 edge .05 → LOST −20
 *                 d3 @ B−3d stake  5 mp .52 edge .02 → unsettled
 *   S2_REACTION:  d4 @ B−10d stake 15 mp .40 edge .05 → WON +25
 *   S3_CONVERGE.: d5 @ B−25d stake  8 mp .70 edge .08 → unsettled
 * addDecision/addSettlement are idempotent by hash, so repopulating the same
 * store dir from another test is a no-op.
 */
async function mainStore() {
  const { TrackStore } = await import("../src/track/store");
  const track = new TrackStore("devnet", "digest-main");
  track.addDecision(decision({ hash: "d1", strategy: "S1_COHERENCE", fixtureId: 101, decidedAtTs: B - 1 * DAY, stakeUsdc: 10, modelProb: 0.6, marketProb: 0.5, edge: 0.1 }));
  track.addSettlement(settlement({ decisionHash: "d1", fixtureId: 101, settledAtTs: B - 1 * DAY + HOUR, won: true, pnlUsdc: 12 }));
  track.addDecision(decision({ hash: "d2", strategy: "S1_COHERENCE", fixtureId: 102, decidedAtTs: B - 2 * DAY, stakeUsdc: 20, modelProb: 0.5, marketProb: 0.45, edge: 0.05 }));
  track.addSettlement(settlement({ decisionHash: "d2", fixtureId: 102, settledAtTs: B - 2 * DAY + HOUR, won: false, pnlUsdc: -20 }));
  track.addDecision(decision({ hash: "d3", strategy: "S1_COHERENCE", fixtureId: 103, decidedAtTs: B - 3 * DAY, stakeUsdc: 5, modelProb: 0.52, marketProb: 0.5, edge: 0.02 }));
  track.addDecision(decision({ hash: "d4", strategy: "S2_REACTION", fixtureId: 104, decidedAtTs: B - 10 * DAY, stakeUsdc: 15, modelProb: 0.4, marketProb: 0.35, edge: 0.05 }));
  track.addSettlement(settlement({ decisionHash: "d4", fixtureId: 104, settledAtTs: B - 10 * DAY + 2 * HOUR, won: true, pnlUsdc: 25 }));
  track.addDecision(decision({ hash: "d5", strategy: "S3_CONVERGENCE", fixtureId: 105, decidedAtTs: B - 25 * DAY, stakeUsdc: 8, modelProb: 0.7, marketProb: 0.62, edge: 0.08 }));
  return track;
}

test("30-day window: per-strategy and overall math match hand-computed values", async () => {
  const { buildDigest } = await import("../src/intelligence/digest");
  const track = await mainStore();

  const digest = buildDigest(track, B, 30);
  assert.equal(digest.generatedAtTs, B);
  assert.equal(digest.windowDays, 30);
  assert.equal(digest.windowStartTs, B - 30 * DAY);

  assert.deepEqual(digest.strategies, [
    {
      strategy: "S1_COHERENCE",
      n: 2,
      wins: 1,
      hitRate: 0.5, // 1/2
      stakedUsdc: 30, // 10 + 20
      pnlUsdc: -8, // 12 − 20
      roi: -0.2667, // −8/30
      brier: 0.205, // ((0.6−1)² + (0.5−0)²)/2 = (0.16 + 0.25)/2
      meanEdge: 0.0567, // (0.10 + 0.05 + 0.02)/3 — includes unsettled d3
      lastDecisionTs: B - 1 * DAY,
      lastSettlementTs: B - 1 * DAY + HOUR,
      activity: "active", // last decision 1 day ago
    },
    {
      strategy: "S2_REACTION",
      n: 1,
      wins: 1,
      hitRate: 1,
      stakedUsdc: 15,
      pnlUsdc: 25,
      roi: 1.6667, // 25/15
      brier: 0.36, // (0.4−1)²
      meanEdge: 0.05,
      lastDecisionTs: B - 10 * DAY,
      lastSettlementTs: B - 10 * DAY + 2 * HOUR,
      activity: "quiet", // 10 days silent — past 7, short of 21
    },
    {
      strategy: "S3_CONVERGENCE",
      n: 0,
      wins: 0,
      hitRate: 0,
      stakedUsdc: 0,
      pnlUsdc: 0,
      roi: 0, // staked = 0 → 0, never NaN
      brier: null, // nothing settled
      meanEdge: 0.08, // in-window unsettled decision still counts
      lastDecisionTs: B - 25 * DAY,
      lastSettlementTs: null,
      activity: "stale", // 25 days silent
    },
  ]);

  assert.deepEqual(digest.overall, {
    decisions: 5,
    settled: 3,
    wins: 2,
    stakedUsdc: 45, // 10 + 20 + 15 (settled decisions only)
    pnlUsdc: 17, // 12 − 20 + 25
    roi: 0.3778, // 17/45
    hitRate: 0.6667, // 2/3
  });

  // Buckets keyed by the DECISION's UTC day; settlement P&L books to that day.
  assert.deepEqual(digest.days, [
    { day: "2025-11-22", decisions: 1, settled: 0, pnlUsdc: 0 }, // d5
    { day: "2025-12-07", decisions: 1, settled: 1, pnlUsdc: 25 }, // d4
    { day: "2025-12-14", decisions: 1, settled: 0, pnlUsdc: 0 }, // d3
    { day: "2025-12-15", decisions: 1, settled: 1, pnlUsdc: -20 }, // d2
    { day: "2025-12-16", decisions: 1, settled: 1, pnlUsdc: 12 }, // d1
  ]);
});

test("7-day window excludes older records; all-time fields survive", async () => {
  const { buildDigest } = await import("../src/intelligence/digest");
  const track = await mainStore();

  const digest = buildDigest(track, B, 7);
  assert.equal(digest.windowStartTs, B - 7 * DAY);

  // d4 (10d) and d5 (25d) fall out of the window; only S1's d1/d2/d3 remain.
  const [s1, s2, s3] = digest.strategies;
  assert.equal(s1.n, 2);
  assert.equal(s1.stakedUsdc, 30);
  assert.equal(s1.pnlUsdc, -8);
  assert.equal(s1.brier, 0.205);
  assert.equal(s1.meanEdge, 0.0567);

  assert.deepEqual(s2, {
    strategy: "S2_REACTION",
    n: 0,
    wins: 0,
    hitRate: 0,
    stakedUsdc: 0,
    pnlUsdc: 0,
    roi: 0,
    brier: null,
    meanEdge: null, // no in-window decisions at all
    lastDecisionTs: B - 10 * DAY, // all-time bookkeeping unaffected by window
    lastSettlementTs: B - 10 * DAY + 2 * HOUR,
    activity: "quiet",
  });
  assert.equal(s3.meanEdge, null);
  assert.equal(s3.lastDecisionTs, B - 25 * DAY);
  assert.equal(s3.activity, "stale");

  assert.deepEqual(digest.overall, {
    decisions: 3,
    settled: 2,
    wins: 1,
    stakedUsdc: 30,
    pnlUsdc: -8,
    roi: -0.2667,
    hitRate: 0.5,
  });
  assert.deepEqual(
    digest.days.map((d) => d.day),
    ["2025-12-14", "2025-12-15", "2025-12-16"],
  );
});

test("determinism: identical inputs → identical hash, across calls and store reloads", async () => {
  const { TrackStore } = await import("../src/track/store");
  const { buildDigest } = await import("../src/intelligence/digest");
  const track = await mainStore();

  const first = buildDigest(track, B, 30);
  const second = buildDigest(track, B, 30);
  assert.match(first.hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(second, first);

  // A brand-new TrackStore over the same persisted ledger — "kill -9" view.
  const reloaded = new TrackStore("devnet", "digest-main");
  const third = buildDigest(reloaded, B, 30);
  assert.deepEqual(third, first);

  // The hash is windowed: a different window is a different digest.
  assert.notEqual(buildDigest(track, B, 7).hash, first.hash);
});

test("activity flags: recent → active, silent 8d → quiet, never decided → stale", async () => {
  const { TrackStore } = await import("../src/track/store");
  const { buildDigest } = await import("../src/intelligence/digest");
  const track = new TrackStore("devnet", "digest-activity");
  track.addDecision(decision({ hash: "a1", strategy: "S1_COHERENCE", decidedAtTs: B - 2 * HOUR }));
  track.addDecision(decision({ hash: "a2", strategy: "S2_REACTION", decidedAtTs: B - 8 * DAY }));
  // S3_CONVERGENCE: no decisions ever.

  const digest = buildDigest(track, B, 30);
  const [s1, s2, s3] = digest.strategies;
  assert.equal(s1.activity, "active");
  assert.equal(s2.activity, "quiet");
  assert.equal(s3.activity, "stale");
  assert.equal(s3.lastDecisionTs, null);
  assert.equal(s3.lastSettlementTs, null);
});
