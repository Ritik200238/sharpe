import { StatKey } from "../feed/types";
import { MarketFamily } from "../model/fair";

/**
 * Proof planning — map a market outcome to the exact validateStatV2
 * strategy that proves what ACTUALLY happened.
 *
 * Settlement philosophy: the agent never proves "I won"; it proves the
 * final outcome itself (from the game_finalised record), then applies that
 * verified truth to every open position mechanically. One proof settles
 * every position on the market.
 */

export interface DiscretePredicate {
  single?: { index: number; predicate: Predicate };
  binary?: { indexA: number; indexB: number; op: BinaryOp; predicate: Predicate };
}
export type BinaryOp = { add: Record<string, never> } | { subtract: Record<string, never> };
export interface Predicate {
  threshold: number;
  comparison:
    | { greaterThan: Record<string, never> }
    | { lessThan: Record<string, never> }
    | { equalTo: Record<string, never> };
}

export interface ProofPlan {
  /** Requested statKeys, order matters — strategy indexes are positional. */
  statKeys: number[];
  predicates: DiscretePredicate[];
  /** Index (within the market's outcome vector) that actually occurred. */
  actualOutcomeIndex: number;
  description: string;
}

/**
 * Build the proof plan for a market family given the FINAL stats.
 * Returns null when the outcome cannot be proven with AND-predicates
 * (never the case for our supported families).
 */
export function planActualOutcome(
  family: MarketFamily,
  outcomes: string[],
  finalP1Goals: number,
  finalP2Goals: number,
  line?: number,
): ProofPlan | null {
  const gt = (threshold: number): Predicate => ({ threshold, comparison: { greaterThan: {} } });
  const lt = (threshold: number): Predicate => ({ threshold, comparison: { lessThan: {} } });
  const eq = (threshold: number): Predicate => ({ threshold, comparison: { equalTo: {} } });

  switch (family) {
    case "WIN_DRAW_WIN": {
      const diff = finalP1Goals - finalP2Goals;
      const predicate = diff > 0 ? gt(0) : diff < 0 ? lt(0) : eq(0);
      const actualOutcomeIndex = diff > 0 ? 0 : diff === 0 ? 1 : 2;
      return {
        statKeys: [StatKey.P1Goals, StatKey.P2Goals],
        predicates: [
          { binary: { indexA: 0, indexB: 1, op: { subtract: {} }, predicate } },
        ],
        actualOutcomeIndex,
        description: `goals(P1)−goals(P2) = ${diff} → ${outcomes[actualOutcomeIndex]?.toUpperCase()}`,
      };
    }

    case "TOTAL_GOALS": {
      if (line === undefined) return null;
      const total = finalP1Goals + finalP2Goals;
      const over = total > line;
      // Integer-goal totals: over 2.5 ⟺ total > 2; under 2.5 ⟺ total < 3.
      const predicate = over ? gt(Math.floor(line)) : lt(Math.ceil(line));
      const overIndex = outcomes.indexOf("over");
      const actualOutcomeIndex = over
        ? (overIndex === -1 ? 0 : overIndex)
        : (overIndex === -1 ? 1 : 1 - overIndex);
      return {
        statKeys: [StatKey.P1Goals, StatKey.P2Goals],
        predicates: [
          { binary: { indexA: 0, indexB: 1, op: { add: {} }, predicate } },
        ],
        actualOutcomeIndex,
        description: `total goals ${total} → ${over ? "OVER" : "UNDER"} ${line}`,
      };
    }

    case "BOTH_TEAMS_SCORE": {
      const both = finalP1Goals > 0 && finalP2Goals > 0;
      const yesIndex = outcomes.indexOf("yes");
      const actualOutcomeIndex = both
        ? (yesIndex === -1 ? 0 : yesIndex)
        : (yesIndex === -1 ? 1 : 1 - yesIndex);

      if (both) {
        return {
          statKeys: [StatKey.P1Goals, StatKey.P2Goals],
          predicates: [
            { single: { index: 0, predicate: gt(0) } },
            { single: { index: 1, predicate: gt(0) } },
          ],
          actualOutcomeIndex,
          description: `both scored (${finalP1Goals}-${finalP2Goals}) → YES`,
        };
      }
      // Prove the side that blanked (side-aware single predicate).
      const blankKey = finalP1Goals === 0 ? StatKey.P1Goals : StatKey.P2Goals;
      return {
        statKeys: [blankKey],
        predicates: [{ single: { index: 0, predicate: eq(0) } }],
        actualOutcomeIndex,
        description: `participant ${blankKey === StatKey.P1Goals ? 1 : 2} scored 0 → NO`,
      };
    }
  }
}
