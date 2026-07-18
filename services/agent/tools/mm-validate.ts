/** Quick single-match MM validation with timing — confirms the maker earns a
 * positive spread and that protection helps, before the full-corpus run. */
import * as path from "node:path";
import { ReplayFeed } from "../src/feed/replay";
import { DEFAULT_MM_CONFIG, MarketMakerEngine } from "../src/mm/engine";

const dir =
  process.argv[2] ??
  path.resolve(__dirname, "..", "..", "..", "data", "recordings", "devnet", "backfill-18241006");

async function run(protectionEnabled: boolean): Promise<void> {
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
  await run(true);
  await run(false);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
