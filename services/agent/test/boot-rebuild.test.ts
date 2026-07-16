import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { synthesizeMatch, writeJournals } from "../tools/synthesize";

// HARDENING item 0 acceptance: after a run settles decisions, a freshly
// constructed Agent over the same track dir (no new events) must report
// identical intelligence state — calibration, allocations, suspensions.
//
// SHARPE_TRACK_DIR must be set before any src module loads config, so all
// src imports here are dynamic.

const trackDir = fs.mkdtempSync(path.join(os.tmpdir(), "sharpe-boot-track-"));
process.env.SHARPE_TRACK_DIR = trackDir;

test("boot rebuild: intelligence state survives a restart exactly", async () => {
  const replayDir = fs.mkdtempSync(path.join(os.tmpdir(), "sharpe-boot-replay-"));
  try {
    writeJournals(replayDir, synthesizeMatch(42));

    const { Agent } = await import("../src/agent");
    const { ReplayFeed } = await import("../src/feed/replay");
    const { loadAgentConfig } = await import("../src/platform/config");

    const cfg = {
      ...loadAgentConfig(["--network", "devnet", "--mode", "replay", "--exec", "paper"]),
      replayDir,
      replaySpeed: 0,
      bankrollUsdc: 2000,
    };

    const first = new Agent(cfg, new ReplayFeed(replayDir, 0), null, null, () => {});
    await first.run();
    const before = first.status();
    assert.ok(before.aggregates.settled > 0, "run must settle at least one decision");

    // "kill -9": a brand-new process over the same persisted ledger.
    const dummyFeed = { events: async function* () {}, stop() {} } as any;
    const reborn = new Agent(cfg, dummyFeed, null, null, () => {});
    const after = reborn.status();

    assert.deepEqual(after.allocations, before.allocations, "UCB allocations must survive");
    assert.deepEqual(after.calibration, before.calibration, "calibration must survive");
    assert.deepEqual(after.suspensions, before.suspensions, "SPRT state must survive");
    assert.deepEqual(after.aggregates, before.aggregates, "ledger aggregates must survive");
    assert.equal(after.equityUsdc, before.equityUsdc, "equity must survive");
  } finally {
    fs.rmSync(trackDir, { recursive: true, force: true });
  }
});
