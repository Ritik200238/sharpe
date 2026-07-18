/**
 * Capture a full set of API-shaped fixtures for the frontend's self-contained
 * DEMO mode. Runs a match through the REAL agent pipeline and writes every
 * endpoint's response to `apps/web/public/demo/*.json`.
 *
 * The deployed GitHub Pages site (no backend configured) loads these fixtures,
 * so anyone opening the public URL sees the real product — market-making book,
 * ledger, performance digest, self-reviews — fully populated, with zero hosting.
 *
 * Two modes:
 *   npx tsx tools/capture-demo.ts <recording-dir>   REAL match: loads the live
 *       session + wallet so settlements carry a real validateStatV2 proof.
 *   npx tsx tools/capture-demo.ts                    synthetic match (session-
 *       less, recent kickoff) — a fallback when no real recording is available.
 *
 * Run with a throwaway track dir so it never touches real data:
 *   SHARPE_TRACK_DIR=<tmp> npx tsx tools/capture-demo.ts <dir>
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Agent } from "../src/agent";
import { ReplayFeed } from "../src/feed/replay";
import { loadAgentConfig } from "../src/platform/config";
import { AuthSession, loadCredentials } from "../src/platform/auth";
import { loadAgentWallet } from "../src/exec/commit";
import { synthesizeMatch, writeJournals } from "./synthesize";

const OUT = path.resolve(__dirname, "..", "..", "..", "apps", "web", "public", "demo");

function write(slug: string, value: unknown): void {
  fs.writeFileSync(path.join(OUT, `${slug}.json`), JSON.stringify(value, null, 2));
  console.log(`  demo/${slug}.json`);
}

async function main(): Promise<void> {
  const cfg = {
    ...loadAgentConfig(["--network", "devnet", "--mode", "replay", "--exec", "paper"]),
    replaySpeed: 0,
    bankrollUsdc: 2000,
    mmEnabled: true,
  };

  const arg = process.argv[2];
  let replayDir: string;
  let cleanup = (): void => {};
  let session: AuthSession | null = null;
  let wallet = null;

  if (arg) {
    // REAL match: use the live session + wallet so validateStatV2 runs and
    // settlements carry a real on-chain proof.
    replayDir = arg;
    const creds = loadCredentials(cfg.network.network);
    if (creds?.apiToken) session = new AuthSession(cfg.network, creds.jwt, creds.apiToken);
    try {
      wallet = loadAgentWallet(cfg.network.network);
    } catch {
      /* no wallet — validator still runs read-only if session present */
    }
    console.log(
      `[capture-demo] REAL match ${path.basename(replayDir)} · validator ${
        session ? "ON (validateStatV2)" : "OFF"
      }`,
    );
  } else {
    // Synthetic fallback: session-less so paper settlements book, recent
    // kickoff so relative times + digest windows stay sensible.
    replayDir = fs.mkdtempSync(path.join(os.tmpdir(), "sharpe-demo-replay-"));
    writeJournals(replayDir, synthesizeMatch(42, 90000001, Date.now() - 105 * 60_000));
    cleanup = () => fs.rmSync(replayDir, { recursive: true, force: true });
    console.log("[capture-demo] synthetic match (session-less)");
  }

  cfg.replayDir = replayDir;
  // Log decisions/settlements/reviews as they happen — a progress signal for
  // the (slow) full real-match replay.
  const log = (l: string): void => {
    if (/\[decide\]|\[settle\]|\[review\]/.test(l)) console.log(l);
  };
  const agent = new Agent(cfg, new ReplayFeed(replayDir, 0), session, wallet, log);
  await agent.run();

  fs.mkdirSync(OUT, { recursive: true });
  console.log("[capture-demo] writing fixtures:");

  const digest30 = agent.digest(30);
  const flagged = digest30.strategies
    .filter((s) => s.activity !== "active")
    .map((s) => `${s.strategy}:${s.activity}`);
  const status = agent.status();

  write("health", {
    ok: true,
    phase: "replay complete — demo fixtures",
    uptimeSec: 0,
    now: new Date(status.lastEventRecvTs ?? 0).toISOString(),
  });
  write("status", {
    ...status,
    digestSummary:
      `30d: ${digest30.overall.decisions} decisions, ${digest30.overall.settled} settled, ` +
      `${digest30.overall.wins}W/${digest30.overall.settled - digest30.overall.wins}L, ` +
      `pnl ${digest30.overall.pnlUsdc >= 0 ? "+" : ""}${digest30.overall.pnlUsdc} USDC` +
      (flagged.length ? ` | flags: ${flagged.join(", ")}` : ""),
  });
  write("mm", agent.mmStatus());
  write("decisions", agent.recentDecisions(200));
  write("settlements", agent.settlements());
  write("reviews", agent.reviews());
  write("digest-30", digest30);
  write("digest-7", agent.digest(7));
  write("track-record", {
    aggregates: agent.status().aggregates,
    decisions: agent.recentDecisions(500),
    settlements: agent.settlements(),
    reviews: agent.reviews(),
  });

  cleanup();
  const verified = agent.settlements().filter((s) => s.verification?.verified).length;
  console.log(
    `[capture-demo] done — ${status.aggregates.decisions} decisions, ${status.aggregates.settled} settled ` +
      `(${verified} on-chain-verified), mm net ${status.mm?.netUsdc} USDC`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
