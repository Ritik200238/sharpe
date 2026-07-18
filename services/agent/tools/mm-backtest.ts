/**
 * Market-maker backtest over the real recorded corpus.
 *
 * Runs the quoting engine across every recorded World Cup match and reports
 * the maker's P&L decomposed into spread captured vs adverse selection — the
 * two forces of market-making. Then re-runs with the adverse-selection
 * protection DISABLED to measure, in dollars, exactly what the defence is
 * worth. Deterministic: same corpus, same numbers, every run.
 *
 * NOTE ON RUNTIME: real journals are large (tens of MB each), so a full-corpus
 * run takes MINUTES, and each match logs its progress as it completes. For a
 * fast (~2s) reproduction of the headline numbers, use `mm-validate` instead —
 * it runs a synthetic match. Bound this run with `--matches N`.
 *
 *   npm run mm-backtest --workspace services/agent                 # full corpus (slow)
 *   npm run mm-backtest --workspace services/agent -- --matches 3  # first 3 matches
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { ReplayFeed } from "../src/feed/replay";
import { DEFAULT_MM_CONFIG, MarketMakerEngine } from "../src/mm/engine";

const RECORDINGS = path.resolve(__dirname, "..", "..", "..", "data", "recordings", "devnet");

interface MatchRow {
  fixtureId: number;
  startTime: number;
  cashUsdc: number;
  spreadUsdc: number;
  adverseUsdc: number;
  fills: number;
}

function discoverMatches(): Array<{ dir: string; fixtureId: number; startTime: number }> {
  if (!fs.existsSync(RECORDINGS)) return [];
  const out: Array<{ dir: string; fixtureId: number; startTime: number }> = [];
  for (const name of fs.readdirSync(RECORDINGS)) {
    if (!name.startsWith("backfill-")) continue;
    const dir = path.join(RECORDINGS, name);
    const scores = path.join(dir, "scores.ndjson");
    if (!fs.existsSync(scores) || fs.statSync(scores).size === 0) continue;
    const first = fs.readFileSync(scores, "utf8").split("\n").find((l) => l.trim());
    let fixtureId = Number(name.replace("backfill-", ""));
    let startTime = 0;
    try {
      const rec = JSON.parse(JSON.parse(first!).data);
      fixtureId = rec.fixtureId ?? rec.FixtureId ?? fixtureId;
      startTime = rec.startTime ?? rec.StartTime ?? 0;
    } catch {
      /* fall back to dir name */
    }
    out.push({ dir, fixtureId, startTime });
  }
  return out.sort((a, b) => a.startTime - b.startTime || a.fixtureId - b.fixtureId);
}

/** Optional `--matches N` cap so the slow full-corpus run can be bounded. */
function matchLimit(): number {
  const i = process.argv.indexOf("--matches");
  if (i !== -1) {
    const n = Number(process.argv[i + 1]);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return Infinity;
}

async function runCorpus(
  protectionEnabled: boolean,
  progress: boolean,
): Promise<{ rows: MatchRow[]; engine: MarketMakerEngine }> {
  const engine = new MarketMakerEngine({ ...DEFAULT_MM_CONFIG, protectionEnabled });
  const rows: MatchRow[] = [];
  const matches = discoverMatches().slice(0, matchLimit());
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const t0 = process.hrtime.bigint();
    const before = engine.book.totals();
    const feed = new ReplayFeed(match.dir, 0);
    for await (const event of feed.events()) {
      if (event.kind === "odds") engine.processOdds(event.record);
      else if (event.kind === "score") engine.processScore(event.record);
    }
    const after = engine.book.totals();
    rows.push({
      fixtureId: match.fixtureId,
      startTime: match.startTime,
      cashUsdc: round2(after.cashUsdc - before.cashUsdc),
      spreadUsdc: round2(after.spreadCapturedUsdc - before.spreadCapturedUsdc),
      adverseUsdc: round2(after.adverseUsdc - before.adverseUsdc),
      fills: after.fills - before.fills,
    });
    if (progress) {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      console.log(
        `  [${String(i + 1).padStart(2)}/${matches.length}] fixture ${match.fixtureId} done ` +
          `(${(ms / 1000).toFixed(1)}s, net ${round2(after.cashUsdc - before.cashUsdc).toFixed(2)})`,
      );
    }
  }
  return { rows, engine };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

async function main(): Promise<void> {
  const total = discoverMatches().length;
  const limit = matchLimit();
  const running = Math.min(total, limit);
  console.log(`[mm-backtest] corpus: ${total} real matches under ${RECORDINGS}`);
  if (limit !== Infinity && limit < total) {
    console.log(`[mm-backtest] --matches ${limit}: running the first ${running} of ${total} (rest skipped)`);
  }
  console.log(
    `[mm-backtest] real journals are large — this runs each match twice (protection on/off) and ` +
      `takes MINUTES. For a fast check use \`npm run mm-validate\`.\n`,
  );

  console.log("[mm-backtest] pass 1/2 — protection ON:");
  const on = await runCorpus(true, true);
  console.log("  #    fixture       fills    spread$   adverse$      net$");
  console.log("-------------------------------------------------------------");
  on.rows.forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(3)}   ${String(r.fixtureId).padStart(9)}   ${String(r.fills).padStart(6)}   ` +
        `${r.spreadUsdc.toFixed(2).padStart(8)}   ${r.adverseUsdc.toFixed(2).padStart(8)}   ${r.cashUsdc.toFixed(2).padStart(8)}`,
    );
  });
  const t = on.engine.book.totals();
  const s = on.engine.stats;
  console.log("-------------------------------------------------------------");
  console.log(
    `[protection ON ] net P&L ${t.cashUsdc.toFixed(2)} USDC · spread captured ${t.spreadCapturedUsdc.toFixed(2)} · ` +
      `adverse ${t.adverseUsdc.toFixed(2)} · fills ${t.fills} · volume ${t.volumeShares} shares`,
  );
  console.log(
    `[protection ON ] quotes ${s.quotesPosted} · pulled ${s.pulled} · widened ${s.widened} · ` +
      `toxic flow deflected ${s.informedDeflected} / filled ${s.informedFilled}`,
  );

  console.log("\n[mm-backtest] pass 2/2 — protection OFF (to measure the defence):");
  const off = await runCorpus(false, true);
  const t2 = off.engine.book.totals();
  const s2 = off.engine.stats;
  console.log(
    `[protection OFF] net P&L ${t2.cashUsdc.toFixed(2)} USDC · adverse ${t2.adverseUsdc.toFixed(2)} · ` +
      `toxic flow filled ${s2.informedFilled}`,
  );
  console.log(
    `\n[value of protection] ${(t.cashUsdc - t2.cashUsdc).toFixed(2)} USDC — the adverse-selection ` +
      `defence turned ${t2.cashUsdc.toFixed(2)} into ${t.cashUsdc.toFixed(2)}.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
