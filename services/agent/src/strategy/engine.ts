import { AllocationEngine } from "../intelligence/allocation";
import { CalibrationTracker } from "../intelligence/calibration";
import { SuspensionMonitor } from "../intelligence/sprt";
import { GateResult, RiskLimits, RiskState, gate, registerOpen } from "../risk/limits";
import { sizePosition } from "../risk/kelly";
import { StrategyContext } from "./context";
import { ALL_STRATEGIES } from "./strategies";
import { DecisionIntent, DecisionRecord, StrategyId, hashDecision } from "./types";

export interface EngineDeps {
  calibration: CalibrationTracker;
  allocation: AllocationEngine;
  suspension: SuspensionMonitor;
  riskState: RiskState;
  limits: RiskLimits;
  mode: "paper" | "chain";
  /** Open (fixtureId|marketKey) exposures to avoid stacking. */
  hasOpenPosition: (fixtureId: number, marketKey: string) => boolean;
}

export interface EngineOutput {
  decisions: DecisionRecord[];
  /** Intents that were generated but vetoed, with the reason — the agent's
   * restraint is part of its glass-box story. */
  vetoes: Array<{ intent: DecisionIntent; reason: string }>;
}

/**
 * The decision engine: strategies propose, intelligence scales, risk
 * disposes. Pure given its inputs — same context and state always produce
 * the same decisions (and the same hashes).
 */
export function runEngine(ctx: StrategyContext, deps: EngineDeps, freshestFeedTs: number): EngineOutput {
  const decisions: DecisionRecord[] = [];
  const vetoes: EngineOutput["vetoes"] = [];
  const weights = deps.allocation.weights();
  const calibrationReport = deps.calibration.report();

  for (const strategyId of Object.keys(ALL_STRATEGIES) as StrategyId[]) {
    const intents = ALL_STRATEGIES[strategyId](ctx);

    for (const intent of intents) {
      if (deps.hasOpenPosition(intent.fixtureId, intent.marketKey)) {
        vetoes.push({ intent, reason: "position already open on this market" });
        continue;
      }

      const suspended = deps.suspension.isSuspended(strategyId);
      const gateResult: GateResult = gate(
        intent,
        deps.riskState,
        deps.limits,
        ctx.nowTs,
        freshestFeedTs,
      );
      if (!gateResult.allowed && !suspended) {
        vetoes.push({ intent, reason: gateResult.vetoReason ?? "risk gate" });
        continue;
      }

      const priceDecimal = 1 / intent.marketProb;
      const sizing = sizePosition({
        modelProb: intent.modelProb,
        priceDecimal,
        bankrollUsdc: deps.riskState.equityUsdc,
        calibrationFactor: calibrationReport.factor,
        allocationWeight: weights.get(strategyId) ?? 0,
        maxStakeUsdc: gateResult.stakeCapUsdc,
      });

      // Suspended strategies trade at zero stake (shadow mode) so the SPRT
      // keeps collecting evidence for an autonomous re-enable.
      const stakeUsdc = suspended ? 0 : sizing.stakeUsdc;
      if (!suspended && stakeUsdc < deps.limits.minStakeUsdc) {
        vetoes.push({ intent, reason: "stake below minimum after sizing" });
        continue;
      }

      const body = {
        decidedAtTs: ctx.nowTs,
        mode: deps.mode,
        strategy: strategyId,
        fixtureId: intent.fixtureId,
        marketKey: intent.marketKey,
        family: intent.family,
        line: intent.line,
        outcomeIndex: intent.outcomeIndex,
        outcomeName: intent.outcomeName,
        modelProb: round4(intent.modelProb),
        marketProb: round4(intent.marketProb),
        edge: round4(intent.edge),
        stakeUsdc,
        priceDecimal: round4(priceDecimal),
        reason: suspended ? `[SHADOW — strategy suspended by SPRT] ${intent.reason}` : intent.reason,
        sizing: {
          kellyFraction: round4(sizing.kellyFraction),
          calibrationFactor: round4(calibrationReport.factor),
          allocationWeight: round4(weights.get(strategyId) ?? 0),
          bankrollUsdc: round2(deps.riskState.equityUsdc),
        },
        inputs: intent.inputs,
      };
      const decision: DecisionRecord = { hash: hashDecision(body), ...body };

      if (!suspended) registerOpen(decision, deps.riskState);
      decisions.push(decision);
    }
  }

  return { decisions, vetoes };
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
