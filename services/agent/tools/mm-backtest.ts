/**
 * Market-maker backtest over the real 20-match corpus.
 *
 * Runs the quoting engine across every recorded World Cup match and reports
 * the maker's P&L decomposed into spread captured vs adverse selection — the
 * two forces of market-making. Then re-runs with the adverse-selection
 * protection DISABLED to measure, in dollars, exactly what the defence is
 * worth. Deterministic: same corpus, same numbers, every run.
 *
 *   npm run mm-backtest --workspace services/agent
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

async function runCorpus(
  protectionEnabled: boolean,
): Promise<{ rows: MatchRow[]; engine: MarketMakerEngine }> {
  const engine = new MarketMakerEngine({ ...DEFAULT_MM_CONFIG, protectionEnabled });
  const rows: MatchRow[] = [];
  for (const match of discoverMatches()) {
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
  }
  return { rows, engine };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

async function main(): Promise<void> {
  const matches = discoverMatches();
  console.log(`[mm-backtest] corpus: ${matches.length} real matches under ${RECORDINGS}`);
  console.log("[mm-backtest] maker starts flat; quotes two-sided, earns the spread, defends goals\n");

  const on = await runCorpus(true);
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

  const off = await runCorpus(false);
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
