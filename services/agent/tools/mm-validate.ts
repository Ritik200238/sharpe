/** Fast market-maker validation — the quick way to reproduce the headline
 * numbers. With no argument it runs a deterministic SYNTHETIC match (a 2-1
 * thriller with in-running quotes on four markets), which finishes in ~2s and
 * produces the figures cited in docs/MARKET-MAKING.md. Pass a recording dir to
 * validate a real match instead (slower — real journals are large).
 *
 *   npm run mm-validate --workspace services/agent            # synthetic, fast
 *   npx tsx tools/mm-validate.ts <recording-dir>              # a real match
 *
 * Runs the quoting engine with the adverse-selection protection ON, then OFF,
 * so the dollar value of the defence is measured directly. Deterministic.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ReplayFeed } from "../src/feed/replay";
import { DEFAULT_MM_CONFIG, MarketMakerEngine } from "../src/mm/engine";
import { synthesizeMatch, writeJournals } from "./synthesize";

/** Resolve the match dir: an explicit arg, or a freshly-synthesized match. */
function resolveDir(): { dir: string; label: string; cleanup: () => void } {
  const arg = process.argv[2];
  if (arg) return { dir: arg, label: `real recording ${path.basename(arg)}`, cleanup: () => {} };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sharpe-mm-validate-"));
  writeJournals(dir, synthesizeMatch(42));
  return { dir, label: "synthetic match (seed 42)", cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

async function run(dir: string, protectionEnabled: boolean): Promise<void> {
  const t0 = process.hrtime.bigint();
  const eng = new MarketMakerEngine({ ...DEFAULT_MM_CONFIG, protectionEnabled });
  const feed = new ReplayFeed(dir, 0);
  for await (const e of feed.events()) {
    if (e.kind === "odds") eng.processOdds(e.record);
    else if (e.kind === "score") eng.processScore(e.record);
  }
  const t = eng.book.totals();
  const s = eng.stats;
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(
    `protection=${protectionEnabled} | net ${t.cashUsdc} USDC · spread ${t.spreadCapturedUsdc} · ` +
      `adverse ${t.adverseUsdc} · fills ${t.fills} · vol ${t.volumeShares} · openInv ${t.openInventoryAbs} · ` +
      `quotes ${s.quotesPosted} · pulled ${s.pulled} · deflected ${s.informedDeflected} · infFilled ${s.informedFilled} · ` +
      `${ms.toFixed(0)}ms`,
  );
}

(async () => {
  const { dir, label, cleanup } = resolveDir();
  console.log(`[mm-validate] ${label}\n`);
  try {
    await run(dir, true);
    await run(dir, false);
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
