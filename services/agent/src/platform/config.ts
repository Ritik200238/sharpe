import * as path from "node:path";

export type Network = "devnet" | "mainnet";
export type FeedMode = "live" | "replay";
export type ExecMode = "paper" | "chain";

export interface NetworkConfig {
  network: Network;
  apiBaseUrl: string; // ends with /api
  jwtUrl: string;
  rpcUrl: string;
  txlMint: string;
}

const NETWORKS: Record<Network, NetworkConfig> = {
  devnet: {
    network: "devnet",
    apiBaseUrl: "https://txline-dev.txodds.com/api",
    jwtUrl: "https://txline-dev.txodds.com/auth/guest/start",
    rpcUrl: process.env.RPC_URL ?? "https://api.devnet.solana.com",
    txlMint: "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG",
  },
  mainnet: {
    network: "mainnet",
    apiBaseUrl: "https://txline.txodds.com/api",
    jwtUrl: "https://txline.txodds.com/auth/guest/start",
    rpcUrl: process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com",
    txlMint: process.env.TXL_MINT ?? "Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL",
  },
};

export interface AgentConfig {
  network: NetworkConfig;
  feedMode: FeedMode;
  execMode: ExecMode;
  /** Directory of recorded journals for replay mode. */
  replayDir?: string;
  /** Replay pacing: 0 = as fast as possible, 1 = realtime, 10 = 10x. */
  replaySpeed: number;
  /** HTTP port for the status API + dashboard. */
  apiPort: number;
  /** Starting paper bankroll in USDC. */
  bankrollUsdc: number;
}

export function loadAgentConfig(argv: string[] = process.argv.slice(2)): AgentConfig {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) args.set(argv[i].slice(2), argv[i + 1] ?? "");
  }

  const networkName = (args.get("network") ?? process.env.TX_NETWORK ?? "devnet") as Network;
  if (!NETWORKS[networkName]) throw new Error(`Unknown network "${networkName}"`);

  const feedMode = (args.get("mode") ?? process.env.FEED_MODE ?? "live") as FeedMode;
  if (feedMode !== "live" && feedMode !== "replay") throw new Error(`Bad mode "${feedMode}"`);

  const execMode = (args.get("exec") ?? process.env.EXEC_MODE ?? "paper") as ExecMode;
  if (execMode !== "paper" && execMode !== "chain") throw new Error(`Bad exec "${execMode}"`);

  return {
    network: NETWORKS[networkName],
    feedMode,
    execMode,
    replayDir: args.get("replay-dir") ?? process.env.REPLAY_DIR,
    replaySpeed: Number(args.get("speed") ?? process.env.REPLAY_SPEED ?? 0),
    apiPort: Number(args.get("port") ?? process.env.API_PORT ?? 8787),
    bankrollUsdc: Number(args.get("bankroll") ?? process.env.BANKROLL_USDC ?? 2000),
  };
}

export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
export const KEYS_DIR = path.join(REPO_ROOT, "_keys");
export const RECORDINGS_DIR = path.join(REPO_ROOT, "data", "recordings");
export const TRACK_DIR = path.join(REPO_ROOT, "data", "track");
