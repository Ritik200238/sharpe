import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { synthesizeMatch, writeJournals } from "../tools/synthesize";

// The market maker is SHARPE's job, so it must be a first-class part of the
// LIVE loop — not just a backtest. These tests drive a full synthetic match
// through the Agent (replay/paper) and prove the maker actually quotes, fills,
// and defends inside the running agent; that it's deterministic through the
// live loop; and that it never perturbs the directional path it rides beside.
//
// SHARPE_TRACK_DIR must be set before any src module loads config.

async function runAgent(opts: { mm: boolean; seed?: number }) {
  const trackDir = fs.mkdtempSync(path.join(os.tmpdir(), "sharpe-mm-track-"));
  const replayDir = fs.mkdtempSync(path.join(os.tmpdir(), "sharpe-mm-replay-"));
  process.env.SHARPE_TRACK_DIR = trackDir;
  writeJournals(replayDir, synthesizeMatch(opts.seed ?? 42));

  const { Agent } = await import("../src/agent");
  const { ReplayFeed } = await import("../src/feed/replay");
  const { loadAgentConfig } = await import("../src/platform/config");
  const { brainStream } = await import("../src/api/stream");

  const cfg = {
    ...loadAgentConfig(["--network", "devnet", "--mode", "replay", "--exec", "paper"]),
    replayDir,
    replaySpeed: 0,
    bankrollUsdc: 2000,
    mmEnabled: opts.mm,
  };

  const events: Array<{ type: string }> = [];
  const unsub = brainStream.subscribe((e) => {
    if (e.type === "mm_fill" || e.type === "mm_book") events.push({ type: e.type });
  });

  const agent = new Agent(cfg, new ReplayFeed(replayDir, 0), null, null, () => {});
  await agent.run();
  unsub();

  return { agent, trackDir, replayDir, events };
}

test("live maker: the running agent quotes, fills, and defends", async () => {
  const { agent, trackDir, replayDir, events } = await runAgent({ mm: true });
  try {
    const summary = agent.status().mm;
    assert.ok(summary && summary.enabled, "status().mm must be present and enabled");

    const mm = agent.mmStatus();
    assert.ok(mm.enabled, "/mm must report enabled");
    assert.ok(mm.snapshot, "snapshot must exist");
    const { totals, stats } = mm.snapshot!;

    // It actually made markets and traded flow.
    assert.ok(stats.quotesPosted > 0, "maker must have posted quotes in-play");
    assert.ok(totals.fills > 0, "maker must have filled noise flow");
    assert.ok(totals.volumeShares > 0, "maker must have traded volume");

    // The adverse-selection defence engaged around the synthetic goals: the
    // informed flow that fires at each goal instant is deflected while quotes
    // are pulled (or, once, filled if it lands outside the pull window).
    assert.ok(
      stats.informedDeflected + stats.informedFilled > 0,
      "goals must generate informed flow the defence has to handle",
    );

    // The book decomposes into the two market-making forces.
    assert.equal(
      typeof totals.spreadCapturedUsdc,
      "number",
      "book must decompose spread captured",
    );
    assert.equal(typeof totals.adverseUsdc, "number", "book must decompose adverse selection");

    // The live loop streamed the maker's activity, and journalled every fill.
    assert.ok(
      events.some((e) => e.type === "mm_fill"),
      "the loop must stream mm_fill events",
    );
    assert.ok(
      events.some((e) => e.type === "mm_book"),
      "the loop must stream mm_book events",
    );
    assert.ok(
      fs.existsSync(path.join(trackDir, "devnet", "replay", "maker-fills.ndjson")),
      "every fill must be journalled to the audit ledger",
    );

    // The book snapshot was committed (locally in paper mode) for audit.
    assert.ok(mm.bookCommits.length > 0, "the quote book must be snapshotted for on-chain commit");
    assert.ok(
      mm.bookCommits.every((c) => /^[0-9a-f]{64}$/.test(c.hash)),
      "each commit carries a sha256 book hash",
    );
  } finally {
    fs.rmSync(trackDir, { recursive: true, force: true });
    fs.rmSync(replayDir, { recursive: true, force: true });
  }
});

test("live maker: deterministic through the loop — same match, same book", async () => {
  const a = await runAgent({ mm: true, seed: 7 });
  const b = await runAgent({ mm: true, seed: 7 });
  try {
    const ta = a.agent.mmStatus().snapshot!.totals;
    const tb = b.agent.mmStatus().snapshot!.totals;
    assert.deepEqual(tb, ta, "identical match must produce an identical book, bit-for-bit");
    assert.deepEqual(
      b.agent.mmStatus().snapshot!.stats,
      a.agent.mmStatus().snapshot!.stats,
      "maker stats must be identical across runs",
    );
  } finally {
    for (const r of [a, b]) {
      fs.rmSync(r.trackDir, { recursive: true, force: true });
      fs.rmSync(r.replayDir, { recursive: true, force: true });
    }
  }
});

test("live maker: never perturbs the directional path it rides beside", async () => {
  const on = await runAgent({ mm: true, seed: 99 });
  const off = await runAgent({ mm: false, seed: 99 });
  try {
    // The maker owns isolated stores, so the directional track record must be
    // byte-identical whether the maker runs or not.
    assert.deepEqual(
      off.agent.status().aggregates,
      on.agent.status().aggregates,
      "directional aggregates must be unaffected by the maker",
    );
    assert.equal(
      off.agent.status().equityUsdc,
      on.agent.status().equityUsdc,
      "directional equity must be unaffected by the maker",
    );
    assert.equal(off.agent.status().mm, null, "maker off → no mm block");
  } finally {
    for (const r of [on, off]) {
      fs.rmSync(r.trackDir, { recursive: true, force: true });
      fs.rmSync(r.replayDir, { recursive: true, force: true });
    }
  }
});
