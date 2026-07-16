import * as fs from "node:fs";
import { Agent } from "./agent";
import { startApiServer } from "./api/server";
import { LiveFeed } from "./feed/live";
import { ReplayFeed } from "./feed/replay";
import { FeedSource } from "./feed/types";
import { loadAgentWallet } from "./exec/commit";
import { AuthSession, loadCredentials } from "./platform/auth";
import { AgentConfig, KEYS_DIR, loadAgentConfig } from "./platform/config";

const log = (line: string) =>
  console.log(`${new Date().toISOString()} ${line}`);

/**
 * Entry point. Deploy it and leave: the process starts its API instantly,
 * waits (forever if needed) for credentials to appear, then runs the agent
 * loop and never asks a human for anything again.
 */
async function main(): Promise<void> {
  const cfg = loadAgentConfig();
  let phase = "starting";
  let agent: Agent | null = null;

  startApiServer(() => agent, cfg.apiPort, () => phase, log);

  if (cfg.feedMode === "replay") {
    if (!cfg.replayDir || !fs.existsSync(cfg.replayDir)) {
      throw new Error(`replay mode needs --replay-dir pointing at recorded journals`);
    }
    phase = "replaying";
    const feed = new ReplayFeed(cfg.replayDir, cfg.replaySpeed);
    const wallet = tryLoadWallet(cfg);
    const session = trySession(cfg);
    agent = new Agent(cfg, feed, session, wallet, log);
    await agent.reconcileCommits();
    await agent.run();
    phase = "replay complete";
    log("[main] replay finished — api stays up for inspection");
    return; // server keeps the process alive
  }

  // Live mode: wait for credentials (bootstrap may still be acquiring them).
  phase = "waiting for TxLINE credentials";
  let session = trySession(cfg);
  while (!session) {
    log(`[main] no credentials for ${cfg.network.network} yet — checking again in 30s`);
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    session = trySession(cfg);
  }

  phase = "live";
  const feed: FeedSource = new LiveFeed(cfg.network, session);
  const wallet = tryLoadWallet(cfg);
  agent = new Agent(cfg, feed, session, wallet, log);
  await agent.reconcileCommits();
  await agent.run();
}

function trySession(cfg: AgentConfig): AuthSession | null {
  const credentials = loadCredentials(cfg.network.network);
  if (!credentials?.apiToken) return null;
  return new AuthSession(cfg.network, credentials.jwt, credentials.apiToken);
}

function tryLoadWallet(cfg: AgentConfig) {
  try {
    return loadAgentWallet(cfg.network.network);
  } catch {
    log(`[main] no wallet at ${KEYS_DIR} — on-chain features disabled until one exists`);
    return null;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
