import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AllocationEngine } from "../src/intelligence/allocation";
import { CalibrationTracker } from "../src/intelligence/calibration";
import { SuspensionMonitor } from "../src/intelligence/sprt";
import { planActualOutcome } from "../src/settle/proofs";

test("calibration: factor drops when model loses to market", () => {
  const tracker = new CalibrationTracker();
  // Model consistently overconfident and wrong; market said 50/50.
  for (let i = 0; i < 30; i++) {
    tracker.add({ modelProb: 0.8, marketProb: 0.5, won: i % 2 === 0 });
  }
  const report = tracker.report();
  assert.ok(report.modelBrier! > report.marketBrier!);
  assert.ok(report.factor < 1);
});

test("calibration: factor rises when model beats market", () => {
  const tracker = new CalibrationTracker();
  for (let i = 0; i < 30; i++) {
    tracker.add({ modelProb: 0.75, marketProb: 0.5, won: i % 4 !== 0 }); // 75% hits
  }
  const report = tracker.report();
  assert.ok(report.factor > 1);
});

test("allocation: weights shift toward the winning strategy and floor holds", () => {
  const engine = new AllocationEngine(["S1_COHERENCE", "S2_REACTION", "S3_CONVERGENCE"]);
  for (let i = 0; i < 20; i++) {
    engine.recordSettlement("S2_REACTION", 10, 10); // +100% ROI
    engine.recordSettlement("S1_COHERENCE", -6, 10); // −60% ROI
  }
  const weights = engine.weights();
  assert.ok(weights.get("S2_REACTION")! > weights.get("S1_COHERENCE")!);
  for (const w of weights.values()) assert.ok(w >= 0.1 - 1e-9); // floor
  const sum = [...weights.values()].reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test("sprt: suspends a strategy that keeps missing its promises", () => {
  const monitor = new SuspensionMonitor(["S1_COHERENCE"]);
  // Model promises 60% wins; delivers ~10%.
  for (let i = 0; i < 40 && !monitor.isSuspended("S1_COHERENCE"); i++) {
    monitor.recordSettlement("S1_COHERENCE", 0.6, i % 10 === 0);
  }
  assert.ok(monitor.isSuspended("S1_COHERENCE"));
});

test("sprt: healthy strategy is never suspended", () => {
  const monitor = new SuspensionMonitor(["S2_REACTION"]);
  for (let i = 0; i < 200; i++) {
    monitor.recordSettlement("S2_REACTION", 0.6, i % 10 < 6); // exactly 60%
  }
  assert.equal(monitor.isSuspended("S2_REACTION"), false);
});

test("proof plans: every family maps to correct predicates", () => {
  const wdw = planActualOutcome("WIN_DRAW_WIN", ["1", "x", "2"], 2, 1)!;
  assert.equal(wdw.actualOutcomeIndex, 0);
  assert.deepEqual(wdw.statKeys, [1, 2]);
  assert.ok(wdw.predicates[0].binary?.op && "subtract" in wdw.predicates[0].binary.op);

  const draw = planActualOutcome("WIN_DRAW_WIN", ["1", "x", "2"], 1, 1)!;
  assert.equal(draw.actualOutcomeIndex, 1);
  assert.ok("equalTo" in draw.predicates[0].binary!.predicate.comparison);

  const over = planActualOutcome("TOTAL_GOALS", ["over", "under"], 2, 1, 2.5)!;
  assert.equal(over.actualOutcomeIndex, 0);
  assert.ok("add" in over.predicates[0].binary!.op);
  assert.equal(over.predicates[0].binary!.predicate.threshold, 2); // >2 ⟺ ≥3

  const under = planActualOutcome("TOTAL_GOALS", ["over", "under"], 1, 0, 2.5)!;
  assert.equal(under.actualOutcomeIndex, 1);
  assert.equal(under.predicates[0].binary!.predicate.threshold, 3); // <3

  const bttsYes = planActualOutcome("BOTH_TEAMS_SCORE", ["yes", "no"], 1, 2)!;
  assert.equal(bttsYes.actualOutcomeIndex, 0);
  assert.equal(bttsYes.predicates.length, 2);

  const bttsNo = planActualOutcome("BOTH_TEAMS_SCORE", ["yes", "no"], 0, 3)!;
  assert.equal(bttsNo.actualOutcomeIndex, 1);
  assert.deepEqual(bttsNo.statKeys, [1]); // proves P1 scored 0
});
