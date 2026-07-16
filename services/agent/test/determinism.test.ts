import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { ReplayFeed } from "../src/feed/replay";
import { MatchStateStore } from "../src/state/match";
import { OddsStateStore } from "../src/state/odds";
import { ModelStore, StrategyContext, buildViews } from "../src/strategy/context";
import { runEngine } from "../src/strategy/engine";
import { AllocationEngine } from "../src/intelligence/allocation";
import { CalibrationTracker } from "../src/intelligence/calibration";
import { SuspensionMonitor } from "../src/intelligence/sprt";
import { DEFAULT_LIMITS, initialRiskState } from "../src/risk/limits";
import { synthesizeMatch, writeJournals } from "../tools/synthesize";
import { StrategyId } from "../src/strategy/types";

const STRATEGIES: StrategyId[] = ["S1_COHERENCE", "S2_REACTION", "S3_CONVERGENCE"];

/**
 * The non-negotiable: same input → same decisions, bit for bit.
 * Runs the full pipeline (replay → state → model → strategies → risk →
 * hashes) twice over the same synthetic journals and compares hashes.
 */
async function runPipeline(replayDir: string): Promise<string[]> {
  const feed = new ReplayFeed(replayDir, 0);
  const matchStore = new MatchStateStore();
  const oddsStore = new OddsStateStore();
  const modelStore = new ModelStore();
  const riskState = initialRiskState(2000);
  const deps = {
    calibration: new CalibrationTracker(),
    allocation: new AllocationEngine(STRATEGIES),
    suspension: new SuspensionMonitor(STRATEGIES),
    riskState,
    limits: DEFAULT_LIMITS,
    mode: "paper" as const,
  };
  const open = new Set<string>();
  const hashes: string[] = [];

  for await (const event of feed.events()) {
    if (event.kind === "odds") {
      oddsStore.apply(event.record);
      const odds = oddsStore.get(event.record.fixtureId)!;
      const match = matchStore.get(event.record.fixtureId);
      const views = buildViews(odds);
      const model = modelStore.maybeRefit(event.record.fixtureId, views, match, event.record.ts);
      if (!model) continue;
      const ctx: StrategyContext = {
        nowTs: event.record.ts,
        trigger: { type: "odds", record: event.record },
        match,
        odds,
        model,
        views,
      };
      const out = runEngine(
        ctx,
        { ...deps, hasOpenSameOutcome: (f, m, o) => open.has(`${f}|${m}|${o}`) },
        event.recvTs,
      );
      for (const d of out.decisions) {
        open.add(`${d.fixtureId}|${d.marketKey}|${d.outcomeIndex}`);
        hashes.push(d.hash);
      }
    } else if (event.kind === "score") {
      const delta = matchStore.apply(event.record);
      if (!delta.goalScored && !delta.redCardShown) continue;
      const odds = oddsStore.get(event.record.fixtureId);
      if (!odds) continue;
      const views = buildViews(odds);
      const model = modelStore.maybeRefit(
        event.record.fixtureId,
        views,
        delta.state,
        event.record.ts,
      );
      if (!model) continue;
      const ctx: StrategyContext = {
        nowTs: event.record.ts,
        trigger: {
          type: "score",
          record: event.record,
          goal: delta.goalScored,
          red: delta.redCardShown,
        },
        match: delta.state,
        odds,
        model,
        views,
      };
      const out = runEngine(
        ctx,
        { ...deps, hasOpenSameOutcome: (f, m, o) => open.has(`${f}|${m}|${o}`) },
        event.recvTs,
      );
      for (const d of out.decisions) {
        open.add(`${d.fixtureId}|${d.marketKey}|${d.outcomeIndex}`);
        hashes.push(d.hash);
      }
    }
  }
  return hashes;
}

test("determinism: identical journals produce identical decision hashes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sharpe-determinism-"));
  try {
    writeJournals(dir, synthesizeMatch(42));
    const first = await runPipeline(dir);
    const second = await runPipeline(dir);
    assert.ok(first.length > 0, "pipeline should produce at least one decision");
    assert.deepEqual(first, second);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("determinism: different seeds produce different matches (sanity)", () => {
  const a = synthesizeMatch(42);
  const b = synthesizeMatch(1337);
  assert.notDeepEqual(
    a.scores.map((l) => l.data),
    b.scores.map((l) => l.data),
  );
});
