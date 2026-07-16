import { CalibrationReport } from "./calibration";
import { DecisionRecord, SettlementRecord, StrategyId, canonicalJson } from "../strategy/types";
import * as crypto from "node:crypto";

/**
 * Post-match self-review — the agent writes its own report card.
 * Deterministic function of the match's settled decisions; the review hash
 * is committed on-chain alongside decisions, so even the agent's
 * self-criticism is part of the tamper-proof record.
 */
export interface MatchReview {
  hash: string;
  fixtureId: number;
  generatedAtTs: number;
  decisions: number;
  wins: number;
  losses: number;
  stakedUsdc: number;
  pnlUsdc: number;
  /** Mean model probability of backed outcomes vs realized hit rate. */
  meanModelProb: number;
  realizedHitRate: number;
  calibrationAfter: CalibrationReport;
  perStrategy: Record<string, { n: number; wins: number; pnlUsdc: number }>;
  notes: string[];
}

export function buildMatchReview(
  fixtureId: number,
  settledPairs: Array<{ decision: DecisionRecord; settlement: SettlementRecord }>,
  calibrationAfter: CalibrationReport,
  generatedAtTs: number,
): MatchReview {
  const perStrategy: Record<string, { n: number; wins: number; pnlUsdc: number }> = {};
  let wins = 0;
  let staked = 0;
  let pnl = 0;
  let probSum = 0;

  for (const { decision, settlement } of settledPairs) {
    const bucket = (perStrategy[decision.strategy] ??= { n: 0, wins: 0, pnlUsdc: 0 });
    bucket.n += 1;
    if (settlement.won) {
      bucket.wins += 1;
      wins += 1;
    }
    bucket.pnlUsdc = round2(bucket.pnlUsdc + settlement.pnlUsdc);
    staked += decision.stakeUsdc;
    pnl += settlement.pnlUsdc;
    probSum += decision.modelProb;
  }

  const n = settledPairs.length;
  const meanModelProb = n ? probSum / n : 0;
  const realizedHitRate = n ? wins / n : 0;

  const notes: string[] = [];
  if (n > 0) {
    const gap = realizedHitRate - meanModelProb;
    if (Math.abs(gap) > 0.15) {
      notes.push(
        `Hit rate ${(realizedHitRate * 100).toFixed(0)}% vs promised ${(meanModelProb * 100).toFixed(0)}% — ` +
          `${gap < 0 ? "overconfident" : "underconfident"} this match; calibration factor now ${calibrationAfter.factor.toFixed(2)}.`,
      );
    } else {
      notes.push("Predictions and outcomes consistent this match.");
    }
    for (const [strategy, s] of Object.entries(perStrategy)) {
      if (s.n >= 2 && s.pnlUsdc < 0) {
        notes.push(`${strategy}: ${s.n} decisions, ${s.wins} wins, ${s.pnlUsdc} USDC — under SPRT watch.`);
      }
    }
  } else {
    notes.push("No settleable edges found this match — thresholds held, no forced trades.");
  }

  const body = {
    fixtureId,
    generatedAtTs,
    decisions: n,
    wins,
    losses: n - wins,
    stakedUsdc: round2(staked),
    pnlUsdc: round2(pnl),
    meanModelProb: round4(meanModelProb),
    realizedHitRate: round4(realizedHitRate),
    calibrationAfter,
    perStrategy,
    notes,
  };
  return { hash: crypto.createHash("sha256").update(canonicalJson(body)).digest("hex"), ...body };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

export type { StrategyId };
