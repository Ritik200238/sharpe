/**
 * Hand-written contract types for the SHARPE read-only API.
 *
 * Source of truth: SHARPEFRONTEND.md §15 and the agent's own TypeScript types
 * (services/agent/src/strategy/types.ts, src/agent.ts, src/intelligence/*).
 * The contract is versionless and additive — every consumer of these types
 * must tolerate unknown extra fields silently.
 */

export type StrategyId = "S1_COHERENCE" | "S2_REACTION" | "S3_CONVERGENCE";

export type MarketFamily = "WIN_DRAW_WIN" | "TOTAL_GOALS" | "BOTH_TEAMS_SCORE";

/** GET /health */
export interface Health {
  ok: boolean;
  phase: string;
  uptimeSec: number;
  /** ISO string, UTC. */
  now: string;
}

export interface CalibrationReport {
  samples: number;
  modelBrier: number | null;
  marketBrier: number | null;
  advantage: number | null;
  factor: number;
}

export interface SuspensionState {
  llr: number;
  suspended: boolean;
  shadowWins: number;
  suspensions: number;
}

export interface TrackAggregates {
  decisions: number;
  settled: number;
  wins: number;
  stakedUsdc: number;
  pnlUsdc: number;
  openPositions: number;
}

export interface VetoRecord {
  reason: string;
  strategy: string;
  marketKey: string;
  ts: number;
}

/** GET /status (once the agent is constructed; earlier it returns only { phase }). */
export interface AgentStatus {
  startedAtTs: number;
  network: string;
  feedMode: string;
  execMode: string;
  eventsSeen: { score: number; odds: number; heartbeat: number };
  lastEventTs: number | null;
  lastEventRecvTs: number | null;
  liveFixtures: number;
  trackedMarkets: number;
  equityUsdc: number;
  realizedUsdc: number;
  peakRealizedUsdc: number;
  allocations: Record<string, number>;
  calibration: CalibrationReport;
  suspensions: Record<string, SuspensionState>;
  aggregates: TrackAggregates;
  recentVetoes: VetoRecord[];
  /** Appended by the API layer on /status. */
  digestSummary?: string;
}

/** GET /decisions · /positions — the atomic unit of the public track record. */
export interface DecisionRecord {
  /** sha256 of the canonical decision content (64 hex). */
  hash: string;
  decidedAtTs: number;
  mode: "paper" | "chain";
  strategy: StrategyId;
  fixtureId: number;
  marketKey: string;
  family: MarketFamily;
  /** Present only for TOTAL_GOALS. */
  line?: number;
  outcomeIndex: number;
  outcomeName: string;
  modelProb: number;
  marketProb: number;
  /** modelProb − marketProb for the backed outcome (fraction). */
  edge: number;
  stakeUsdc: number;
  priceDecimal: number;
  /** Plain-English explanation written by the agent at decision time. */
  reason: string;
  sizing: {
    kellyFraction: number;
    calibrationFactor: number;
    allocationWeight: number;
    bankrollUsdc: number;
  };
  inputs: {
    scoreSeq?: number;
    scoreTs?: number;
    oddsMessageId: string;
    oddsTs: number;
    lambdaHome: number;
    lambdaAway: number;
  };
  /** Set once the on-chain commitment lands (records upgrade in place). */
  commitTxSig?: string;
}

export interface SettlementVerification {
  method: "validateStatV2";
  verified: boolean;
  statKeys: number[];
  seq: number;
  txSigOrView: string;
}

/** GET /settlements — one per settled decision; join via decisionHash. */
export interface SettlementRecord {
  decisionHash: string;
  settledAtTs: number;
  fixtureId: number;
  won: boolean;
  pnlUsdc: number;
  finalP1Goals: number;
  finalP2Goals: number;
  /** Absent entirely on paper-mode settles without a validator. */
  verification?: SettlementVerification;
  commitTxSig?: string;
}

/** GET /reviews — the agent's post-match self-assessments. */
export interface MatchReview {
  hash: string;
  fixtureId: number;
  generatedAtTs: number;
  decisions: number;
  wins: number;
  losses: number;
  stakedUsdc: number;
  pnlUsdc: number;
  meanModelProb: number;
  realizedHitRate: number;
  calibrationAfter?: CalibrationReport;
  perStrategy?: Record<string, { n: number; wins: number; pnlUsdc: number }>;
  notes: string[];
}

export type StrategyActivity = "active" | "quiet" | "stale";

export interface StrategyDigest {
  strategy: StrategyId;
  /** Settled decisions inside the window. */
  n: number;
  wins: number;
  hitRate: number;
  stakedUsdc: number;
  pnlUsdc: number;
  roi: number;
  brier: number | null;
  meanEdge: number | null;
  lastDecisionTs: number | null;
  lastSettlementTs: number | null;
  activity: StrategyActivity;
}

export interface DigestOverall {
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
  settled: number;
  pnlUsdc: number;
}

/** GET /digest?days=N */
export interface Digest {
  hash: string;
  generatedAtTs: number;
  windowDays: number;
  windowStartTs: number;
  strategies: StrategyDigest[];
  overall: DigestOverall;
  days: DigestDay[];
}

/** GET /track-record — the auditor's export. */
export interface TrackRecord {
  aggregates: TrackAggregates | null;
  decisions: DecisionRecord[];
  settlements: SettlementRecord[];
  reviews: MatchReview[];
}

// ---------- market maker (GET /mm) ----------

/** One live two-sided quote on a binary outcome. */
export interface MmQuoteLine {
  fixtureId: number;
  marketKey: string;
  outcomeIndex: number;
  outcomeName: string;
  /** Price the maker BUYS the share at (fraction). */
  bidProb: number;
  /** Price the maker SELLS the share at (fraction). */
  askProb: number;
  fairProb: number;
  halfSpread: number;
  /** Inventory skew applied to the mid (signed fraction). */
  skew: number;
  /** True while the quote is widened by the adverse-selection defence. */
  widened: boolean;
  /** Signed shares held; + = long the outcome. */
  inventory: number;
  ts: number;
}

export interface MmTotals {
  cashUsdc: number;
  fills: number;
  volumeShares: number;
  spreadCapturedUsdc: number;
  adverseUsdc: number;
  openInventoryAbs: number;
}

export interface MmStats {
  ticks: number;
  quotesPosted: number;
  pulled: number;
  widened: number;
  informedDeflected: number;
  informedFilled: number;
}

export interface MmSnapshot {
  totals: MmTotals;
  stats: MmStats;
  quotes: MmQuoteLine[];
}

/** A single trade the maker filled. */
export interface MmFill {
  fixtureId: number;
  marketKey: string;
  outcomeIndex: number;
  outcomeName: string;
  side: "buy" | "sell";
  shares: number;
  priceProb: number;
  fairProb: number;
  informed: boolean;
  ts: number;
}

/** An on-chain quote-book commitment (sig present once the tx confirms). */
export interface MmBookCommit {
  ts: number;
  hash: string;
  sig?: string;
}

/** GET /mm */
export interface MmStatus {
  enabled: boolean;
  snapshot: MmSnapshot | null;
  recentFills: MmFill[];
  bookCommits: MmBookCommit[];
}

/** SSE /stream event types. */
export type StreamEventType =
  | "decision"
  | "settlement"
  | "review"
  | "status"
  | "mm_fill"
  | "mm_book";

/** SSE payload envelope: data: { type, ts, data }. */
export interface StreamEnvelope {
  type: StreamEventType;
  ts: number;
  data: unknown;
}

/** Payload of a "status" stream event (feed connect/disconnect notices). */
export interface FeedStatusEvent {
  stream?: string;
  message?: string;
}
