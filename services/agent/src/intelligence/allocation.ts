import { StrategyId } from "../strategy/types";

/**
 * Meta-allocation — deterministic UCB over realized strategy performance.
 *
 * Each strategy is an arm; its reward is per-settlement ROI (pnl/stake,
 * clamped to [−1, +1]). UCB1 keeps exploring underused arms while shifting
 * bankroll toward what is provably working. Floors keep every strategy
 * alive enough to keep generating evidence. Same history → same weights.
 */

const EXPLORATION = 0.35;
const FLOOR = 0.1;

export interface ArmStats {
  settlements: number;
  meanRoi: number;
}

export class AllocationEngine {
  private arms = new Map<StrategyId, ArmStats>();

  constructor(strategies: StrategyId[]) {
    for (const id of strategies) this.arms.set(id, { settlements: 0, meanRoi: 0 });
  }

  recordSettlement(strategy: StrategyId, pnlUsdc: number, stakeUsdc: number): void {
    const arm = this.arms.get(strategy);
    if (!arm || stakeUsdc <= 0) return;
    const roi = Math.max(-1, Math.min(1, pnlUsdc / stakeUsdc));
    arm.settlements += 1;
    arm.meanRoi += (roi - arm.meanRoi) / arm.settlements;
  }

  weights(): Map<StrategyId, number> {
    const totalPulls = [...this.arms.values()].reduce((s, a) => s + a.settlements, 0);
    const scores = new Map<StrategyId, number>();

    for (const [id, arm] of this.arms) {
      if (arm.settlements === 0) {
        scores.set(id, 1); // unexplored arms get full optimism
      } else {
        const bonus = EXPLORATION * Math.sqrt(Math.log(Math.max(2, totalPulls)) / arm.settlements);
        // meanRoi ∈ [−1,1] → shift to [0,2] so scores stay positive.
        scores.set(id, arm.meanRoi + 1 + bonus);
      }
    }

    const totalScore = [...scores.values()].reduce((s, v) => s + v, 0);
    const weights = new Map<StrategyId, number>();
    for (const [id, score] of scores) {
      weights.set(id, Math.max(FLOOR, score / totalScore));
    }
    // Renormalize after flooring.
    const sum = [...weights.values()].reduce((s, v) => s + v, 0);
    for (const [id, w] of weights) weights.set(id, w / sum);
    return weights;
  }

  stats(): Record<string, ArmStats> {
    return Object.fromEntries(this.arms);
  }
}
