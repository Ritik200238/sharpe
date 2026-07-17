import * as crypto from "node:crypto";
import { MarketFamily } from "../model/fair";

export type StrategyId = "S1_COHERENCE" | "S2_REACTION" | "S3_CONVERGENCE";

/** What a strategy proposes before risk sizing. */
export interface DecisionIntent {
  strategy: StrategyId;
  fixtureId: number;
  marketKey: string;
  family: MarketFamily;
  line?: number;
  /** Index into the market's outcome vector we want to back. */
  outcomeIndex: number;
  outcomeName: string;
  modelProb: number;
  marketProb: number;
  /** modelProb − marketProb, always for the backed outcome. */
  edge: number;
  /** Strategy-specific quote-age tolerance for the risk gate. S2's entire
   * signal is quotes that lag an event, so it declares a wider window than
   * the default liquidity guard. Omitted → limits.staleDataMs applies. */
  maxQuoteAgeMs?: number;
  /** Human-readable, self-contained explanation. */
  reason: string;
  /** Inputs that produced this intent — replayable provenance. */
  inputs: {
    scoreSeq?: number;
    scoreTs?: number;
    oddsMessageId: string;
    oddsTs: number;
    lambdaHome: number;
    lambdaAway: number;
  };
}

/** A sized, accepted decision — the unit of the public track record. */
export interface DecisionRecord {
  /** sha256 of the canonical decision content (excluding this field). */
  hash: string;
  decidedAtTs: number;
  mode: "paper" | "chain";
  strategy: StrategyId;
  fixtureId: number;
  marketKey: string;
  family: MarketFamily;
  line?: number;
  outcomeIndex: number;
  outcomeName: string;
  modelProb: number;
  marketProb: number;
  edge: number;
  stakeUsdc: number;
  /** Decimal odds we recorded the position at (1/marketProb). */
  priceDecimal: number;
  reason: string;
  sizing: {
    kellyFraction: number;
    calibrationFactor: number;
    allocationWeight: number;
    bankrollUsdc: number;
  };
  inputs: DecisionIntent["inputs"];
  /** Set once the on-chain commitment lands. */
  commitTxSig?: string;
}

export interface SettlementRecord {
  decisionHash: string;
  settledAtTs: number;
  fixtureId: number;
  won: boolean;
  pnlUsdc: number;
  finalP1Goals: number;
  finalP2Goals: number;
  /** On-chain verification evidence. */
  verification?: {
    method: "validateStatV2";
    verified: boolean;
    statKeys: number[];
    seq: number;
    txSigOrView: string;
  };
  commitTxSig?: string;
}

/** Canonical JSON: sorted keys, no whitespace — stable across runs. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(",")}}`;
}

export function hashDecision(decision: Omit<DecisionRecord, "hash" | "commitTxSig">): string {
  return crypto.createHash("sha256").update(canonicalJson(decision)).digest("hex");
}
