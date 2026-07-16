/**
 * Normalized feed types. Raw TxLINE payloads are preserved on each record
 * (`raw`) so nothing is lost; the normalized fields are what the engine uses.
 * Field casing differs across endpoints (seq/Seq, fixtureId/FixtureId) — the
 * parsers in parse.ts absorb that here, once, for the whole system.
 */

/** Soccer game phases (statusSoccerId), per the soccer feed spec. */
export enum SoccerPhase {
  NotStarted = 1,
  FirstHalf = 2,
  Halftime = 3,
  SecondHalf = 4,
  Finished = 5,
  WaitingExtraTime = 6,
  ExtraTimeFirstHalf = 7,
  ExtraTimeHalftime = 8,
  ExtraTimeSecondHalf = 9,
  FinishedAfterExtraTime = 10,
  WaitingPenalties = 11,
  PenaltyShootout = 12,
  FinishedAfterPenalties = 13,
  Interrupted = 14,
  Abandoned = 15,
  Cancelled = 16,
  CoverageCancelled = 17,
  CoverageSuspended = 18,
  Postponed = 19,
  /** action=game_finalised marker: statusId=100, period=100. */
  Finalised = 100,
}

export const TERMINAL_PHASES: ReadonlySet<number> = new Set([
  SoccerPhase.Finished,
  SoccerPhase.FinishedAfterExtraTime,
  SoccerPhase.FinishedAfterPenalties,
  SoccerPhase.Abandoned,
  SoccerPhase.Cancelled,
  SoccerPhase.Finalised,
]);

/** Stat base keys (full-game period prefix 0). */
export enum StatKey {
  P1Goals = 1,
  P2Goals = 2,
  P1Yellows = 3,
  P2Yellows = 4,
  P1Reds = 5,
  P2Reds = 6,
  P1Corners = 7,
  P2Corners = 8,
}

export interface ScoreRecord {
  fixtureId: number;
  seq: number;
  ts: number;
  action: string;
  gameState?: string;
  phase?: number; // statusSoccerId (or statusId=100 for game_finalised)
  period?: number;
  competitionId?: number;
  participant1Id?: number;
  participant2Id?: number;
  participant1IsHome?: boolean;
  startTime?: number;
  /** Stat-key map exactly as encoded for on-chain proofs (key → value). */
  stats?: Record<number, number>;
  confirmed?: boolean;
  raw: unknown;
}

export interface OddsRecord {
  fixtureId: number;
  messageId: string;
  ts: number;
  bookmaker: string;
  bookmakerId?: number;
  superOddsType: string;
  inRunning: boolean;
  gameState?: string;
  marketParameters?: string;
  marketPeriod?: string;
  priceNames: string[];
  prices: number[];
  /** De-margined consensus probabilities (fraction 0..1); null where "NA". */
  pct: Array<number | null>;
  raw: unknown;
}

export type FeedEvent =
  | { kind: "score"; recvTs: number; record: ScoreRecord }
  | { kind: "odds"; recvTs: number; record: OddsRecord }
  | { kind: "heartbeat"; recvTs: number; stream: "scores" | "odds" }
  | { kind: "status"; recvTs: number; stream: "scores" | "odds"; message: string };

/** A feed source is just an async stream of normalized events. */
export interface FeedSource {
  events(): AsyncGenerator<FeedEvent>;
  stop(): void;
}
