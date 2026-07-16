import { ScoreRecord, SoccerPhase, StatKey, TERMINAL_PHASES } from "../feed/types";

export interface MatchState {
  fixtureId: number;
  lastSeq: number;
  lastTs: number;
  phase: number;
  phaseChangedAtTs: number;
  startTime?: number;
  competitionId?: number;
  participant1Id?: number;
  participant2Id?: number;
  participant1IsHome?: boolean;
  /** Cumulative stat map exactly as the feed encodes it (statKey → value). */
  stats: Record<number, number>;
  finalised: boolean;
  finalisedSeq?: number;
  lastRecord?: ScoreRecord;
}

export interface MatchDelta {
  state: MatchState;
  phaseChanged: boolean;
  goalScored: boolean;
  redCardShown: boolean;
  becameFinal: boolean;
}

function emptyState(fixtureId: number, ts: number): MatchState {
  return {
    fixtureId,
    lastSeq: 0,
    lastTs: ts,
    phase: SoccerPhase.NotStarted,
    phaseChangedAtTs: ts,
    stats: {},
    finalised: false,
  };
}

/** Total goals from the full-game stat keys. */
export function goals(state: MatchState): { p1: number; p2: number } {
  return { p1: state.stats[StatKey.P1Goals] ?? 0, p2: state.stats[StatKey.P2Goals] ?? 0 };
}

export function redCards(state: MatchState): { p1: number; p2: number } {
  return { p1: state.stats[StatKey.P1Reds] ?? 0, p2: state.stats[StatKey.P2Reds] ?? 0 };
}

export function isLive(state: MatchState): boolean {
  return (
    state.phase === SoccerPhase.FirstHalf ||
    state.phase === SoccerPhase.SecondHalf ||
    state.phase === SoccerPhase.Halftime ||
    state.phase === SoccerPhase.ExtraTimeFirstHalf ||
    state.phase === SoccerPhase.ExtraTimeSecondHalf ||
    state.phase === SoccerPhase.ExtraTimeHalftime
  );
}

/**
 * Fraction of regulation match remaining (0..1), estimated from the phase
 * and wall-clock time inside the phase. Deterministic given (state, nowTs).
 */
export function remainingFraction(state: MatchState, nowTs: number): number {
  const minutesInPhase = Math.max(0, (nowTs - state.phaseChangedAtTs) / 60_000);
  switch (state.phase) {
    case SoccerPhase.NotStarted:
      return 1;
    case SoccerPhase.FirstHalf: {
      const played = Math.min(minutesInPhase, 45);
      return (90 - played) / 90;
    }
    case SoccerPhase.Halftime:
      return 0.5;
    case SoccerPhase.SecondHalf: {
      const played = 45 + Math.min(minutesInPhase, 45);
      return (90 - played) / 90;
    }
    default:
      return TERMINAL_PHASES.has(state.phase) ? 0 : 0.05; // ET/pens: tail value
  }
}

/** Event-sourced store of all match states, updated per score record. */
export class MatchStateStore {
  private states = new Map<number, MatchState>();

  get(fixtureId: number): MatchState | undefined {
    return this.states.get(fixtureId);
  }

  all(): MatchState[] {
    return [...this.states.values()];
  }

  apply(record: ScoreRecord): MatchDelta {
    const previous = this.states.get(record.fixtureId) ?? emptyState(record.fixtureId, record.ts);

    // Ignore stale/duplicate sequences — idempotent by construction.
    if (record.seq <= previous.lastSeq) {
      return {
        state: previous,
        phaseChanged: false,
        goalScored: false,
        redCardShown: false,
        becameFinal: false,
      };
    }

    const next: MatchState = {
      ...previous,
      lastSeq: record.seq,
      lastTs: record.ts,
      lastRecord: record,
      startTime: record.startTime ?? previous.startTime,
      competitionId: record.competitionId ?? previous.competitionId,
      participant1Id: record.participant1Id ?? previous.participant1Id,
      participant2Id: record.participant2Id ?? previous.participant2Id,
      participant1IsHome: record.participant1IsHome ?? previous.participant1IsHome,
      stats: record.stats ? { ...previous.stats, ...record.stats } : previous.stats,
    };

    let phaseChanged = false;
    if (record.phase !== undefined && record.phase !== previous.phase) {
      next.phase = record.phase;
      next.phaseChangedAtTs = record.ts;
      phaseChanged = true;
    }

    const wasFinal = previous.finalised;
    if (record.action === "game_finalised" || record.phase === SoccerPhase.Finalised) {
      next.finalised = true;
      next.finalisedSeq = record.seq;
    }

    const beforeGoals = goals(previous);
    const afterGoals = goals(next);
    const beforeReds = redCards(previous);
    const afterReds = redCards(next);

    this.states.set(record.fixtureId, next);
    return {
      state: next,
      phaseChanged,
      goalScored:
        afterGoals.p1 + afterGoals.p2 > beforeGoals.p1 + beforeGoals.p2,
      redCardShown: afterReds.p1 + afterReds.p2 > beforeReds.p1 + beforeReds.p2,
      becameFinal: next.finalised && !wasFinal,
    };
  }
}
