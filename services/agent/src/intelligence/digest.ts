import * as crypto from "node:crypto";
import { canonicalJson, type StrategyId } from "../strategy/types";
import type { TrackStore } from "../track/store";

/**
 * Season-so-far digest — HARDENING item 3.
 *
 * Pure, deterministic function of the track record: a windowed per-strategy
 * scorecard plus overall totals and per-day buckets for trend rendering.
 * The window is defined by the decision's decidedAtTs; settlements join via
 * decisionHash and inherit their decision's window membership. Inactivity
 * flags are observational ONLY — they never gate the engine.
 *
 * The body is hashed with the same canonicalJson idiom as MatchReview so a
 * digest can be committed on-chain like any other record.
 */

const STRATEGIES: readonly StrategyId[] = ["S1_COHERENCE", "S2_REACTION", "S3_CONVERGENCE"];

const DAY_MS = 86_400_000;
// "In the last N days" mirrors window inclusivity: a decision exactly N days
// old still counts as inside the last N days, so the flag needs strict >.
const QUIET_AFTER_MS = 7 * DAY_MS;
const STALE_AFTER_MS = 21 * DAY_MS;

export type StrategyActivity = "active" | "quiet" | "stale";

export interface StrategyDigest {
  strategy: StrategyId;
  /** Settled decisions inside the window. */
  n: number;
  wins: number;
  /** wins / n, 0 when nothing settled in the window. */
  hitRate: number;
  /** Stake behind the settled-in-window decisions (realized ROI basis). */
  stakedUsdc: number;
  pnlUsdc: number;
  /** pnlUsdc / stakedUsdc, 0 when stakedUsdc = 0. */
  roi: number;
  /** Mean (modelProb − won)² over settled-in-window; null when n = 0. */
  brier: number | null;
  /** Mean decision edge over ALL in-window decisions (settled or not); null when none. */
  meanEdge: number | null;
  /** All-time, independent of the window; null if never. */
  lastDecisionTs: number | null;
  lastSettlementTs: number | null;
  /** Observational only — never gates the engine. */
  activity: StrategyActivity;
}

export interface DigestOverall {
  /** Decisions decided inside the window, settled or not. */
  decisions: number;
  settled: number;
  wins: number;
  stakedUsdc: number;
  pnlUsdc: number;
  roi: number;
  hitRate: number;
}

export interface DigestDay {
  /** UTC calendar day of decidedAtTs, "YYYY-MM-DD". */
  day: string;
  decisions: number;
  /** How many of that day's decisions have settled (P&L booked to this day). */
  settled: number;
  pnlUsdc: number;
}

export interface Digest {
  /** sha256 of the canonical digest body (excluding this field). */
  hash: string;
  generatedAtTs: number;
  windowDays: number;
  windowStartTs: number;
  strategies: StrategyDigest[];
  overall: DigestOverall;
  days: DigestDay[];
}

export function buildDigest(track: TrackStore, nowTs: number, windowDays: number): Digest {
  const windowStartTs = nowTs - windowDays * DAY_MS;

  interface Acc {
    n: number;
    wins: number;
    staked: number;
    pnl: number;
    brierSum: number;
    edgeSum: number;
    edgeN: number;
    lastDecisionTs: number | null;
    lastSettlementTs: number | null;
  }
  const accs = new Map<StrategyId, Acc>();
  for (const strategy of STRATEGIES) {
    accs.set(strategy, {
      n: 0,
      wins: 0,
      staked: 0,
      pnl: 0,
      brierSum: 0,
      edgeSum: 0,
      edgeN: 0,
      lastDecisionTs: null,
      lastSettlementTs: null,
    });
  }

  // Deterministic accumulation order regardless of Map insertion order —
  // floating-point sums must see records in the same sequence every time.
  const ordered = [...track.decisions.values()].sort(
    (a, b) => a.decidedAtTs - b.decidedAtTs || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0),
  );

  const dayBuckets = new Map<string, { decisions: number; settled: number; pnl: number }>();
  const overall = { decisions: 0, settled: 0, wins: 0, staked: 0, pnl: 0 };

  for (const decision of ordered) {
    const acc = accs.get(decision.strategy);
    if (!acc) continue;

    // All-time bookkeeping — independent of the window.
    if (acc.lastDecisionTs === null || decision.decidedAtTs > acc.lastDecisionTs) {
      acc.lastDecisionTs = decision.decidedAtTs;
    }
    const settlement = track.settlements.get(decision.hash);
    if (settlement && (acc.lastSettlementTs === null || settlement.settledAtTs > acc.lastSettlementTs)) {
      acc.lastSettlementTs = settlement.settledAtTs;
    }

    // Window membership is decided by the decision's timestamp alone.
    if (decision.decidedAtTs < windowStartTs) continue;

    overall.decisions += 1;
    acc.edgeSum += decision.edge;
    acc.edgeN += 1;

    const day = utcDay(decision.decidedAtTs);
    let bucket = dayBuckets.get(day);
    if (!bucket) {
      bucket = { decisions: 0, settled: 0, pnl: 0 };
      dayBuckets.set(day, bucket);
    }
    bucket.decisions += 1;

    if (settlement) {
      acc.n += 1;
      acc.staked += decision.stakeUsdc;
      acc.pnl += settlement.pnlUsdc;
      acc.brierSum += (decision.modelProb - (settlement.won ? 1 : 0)) ** 2;
      if (settlement.won) {
        acc.wins += 1;
        overall.wins += 1;
      }
      overall.settled += 1;
      overall.staked += decision.stakeUsdc;
      overall.pnl += settlement.pnlUsdc;
      bucket.settled += 1;
      bucket.pnl += settlement.pnlUsdc;
    }
  }

  const strategies: StrategyDigest[] = STRATEGIES.map((strategy) => {
    const acc = accs.get(strategy)!;
    return {
      strategy,
      n: acc.n,
      wins: acc.wins,
      hitRate: round4(acc.n > 0 ? acc.wins / acc.n : 0),
      stakedUsdc: round2(acc.staked),
      pnlUsdc: round2(acc.pnl),
      roi: round4(acc.staked > 0 ? acc.pnl / acc.staked : 0),
      brier: acc.n > 0 ? round4(acc.brierSum / acc.n) : null,
      meanEdge: acc.edgeN > 0 ? round4(acc.edgeSum / acc.edgeN) : null,
      lastDecisionTs: acc.lastDecisionTs,
      lastSettlementTs: acc.lastSettlementTs,
      activity: classifyActivity(acc.lastDecisionTs, nowTs),
    };
  });

  const days: DigestDay[] = [...dayBuckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, bucket]) => ({
      day,
      decisions: bucket.decisions,
      settled: bucket.settled,
      pnlUsdc: round2(bucket.pnl),
    }));

  const body = {
    generatedAtTs: nowTs,
    windowDays,
    windowStartTs,
    strategies,
    overall: {
      decisions: overall.decisions,
      settled: overall.settled,
      wins: overall.wins,
      stakedUsdc: round2(overall.staked),
      pnlUsdc: round2(overall.pnl),
      roi: round4(overall.staked > 0 ? overall.pnl / overall.staked : 0),
      hitRate: round4(overall.settled > 0 ? overall.wins / overall.settled : 0),
    },
    days,
  };
  return { hash: crypto.createHash("sha256").update(canonicalJson(body)).digest("hex"), ...body };
}

function classifyActivity(lastDecisionTs: number | null, nowTs: number): StrategyActivity {
  if (lastDecisionTs === null || nowTs - lastDecisionTs > STALE_AFTER_MS) return "stale";
  if (nowTs - lastDecisionTs > QUIET_AFTER_MS) return "quiet";
  return "active";
}

function utcDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
