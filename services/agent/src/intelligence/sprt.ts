import { StrategyId } from "../strategy/types";

/**
 * Self-suspension — Wald's Sequential Probability Ratio Test per strategy.
 *
 * H0: the strategy's real win rate equals what its model probabilities
 * promised. H1: it underperforms by DELTA. Every settlement updates the
 * log-likelihood ratio; crossing the lower bound suspends the strategy
 * (it keeps running in shadow mode, and re-arms after a clean shadow run).
 * The agent fires itself before a human would notice the slump.
 */

const ALPHA = 0.05; // false-suspension rate
const BETA = 0.1; // miss rate
const DELTA = 0.1; // underperformance treated as "broken"
const SHADOW_WINS_TO_RESUME = 5;

// LLR = log(L_H1 / L_H0): losses push it UP toward H1 (underperforming).
const SUSPEND_BOUND = Math.log((1 - BETA) / ALPHA); // accept H1 → suspend
const HEALTHY_BOUND = Math.log(BETA / (1 - ALPHA)); // accept H0 → reset

interface SprtState {
  llr: number;
  suspended: boolean;
  shadowWins: number;
  suspensions: number;
}

export class SuspensionMonitor {
  private states = new Map<StrategyId, SprtState>();

  constructor(strategies: StrategyId[]) {
    for (const id of strategies) {
      this.states.set(id, { llr: 0, suspended: false, shadowWins: 0, suspensions: 0 });
    }
  }

  isSuspended(strategy: StrategyId): boolean {
    return this.states.get(strategy)?.suspended ?? false;
  }

  /** Update with a settled decision; expectedProb = model's stated chance. */
  recordSettlement(strategy: StrategyId, expectedProb: number, won: boolean): void {
    const state = this.states.get(strategy);
    if (!state) return;
    const p0 = Math.min(0.99, Math.max(0.01, expectedProb));
    const p1 = Math.min(0.99, Math.max(0.01, expectedProb - DELTA));

    // LLR increment for outcome y under H1 vs H0.
    const inc = won ? Math.log(p1 / p0) : Math.log((1 - p1) / (1 - p0));
    state.llr += inc;

    if (state.suspended) {
      state.shadowWins = won ? state.shadowWins + 1 : 0;
      if (state.shadowWins >= SHADOW_WINS_TO_RESUME) {
        state.suspended = false;
        state.llr = 0;
        state.shadowWins = 0;
      }
      return;
    }

    if (state.llr <= HEALTHY_BOUND) {
      state.llr = 0; // strong evidence of health — reset the test
    } else if (state.llr >= SUSPEND_BOUND) {
      state.suspended = true;
      state.suspensions += 1;
      state.shadowWins = 0;
      state.llr = 0;
    }
  }

  snapshot(): Record<string, SprtState> {
    return Object.fromEntries(this.states);
  }
}
