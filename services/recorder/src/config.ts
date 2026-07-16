import * as path from "node:path";

export type Network = "devnet" | "mainnet";

export interface NetworkConfig {
  network: Network;
  apiBaseUrl: string; // ends with /api
  jwtUrl: string;
  rpcUrl: string;
  txlMint: string;
  serviceLevelId: number;
  weeks: number; // must be a multiple of 4
  leagues: number[]; // empty = free-tier default bundle
}

const DEVNET: NetworkConfig = {
  network: "devnet",
  apiBaseUrl: "https://txline-dev.txodds.com/api",
  jwtUrl: "https://txline-dev.txodds.com/auth/guest/start",
  rpcUrl: process.env.RPC_URL ?? "https://api.devnet.solana.com",
  txlMint: "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG",
  serviceLevelId: Number(process.env.SERVICE_LEVEL_ID ?? 1),
  weeks: Number(process.env.SUBSCRIBE_WEEKS ?? 4),
  leagues: [],
};

const MAINNET: NetworkConfig = {
  network: "mainnet",
  apiBaseUrl: "https://txline.txodds.com/api",
  jwtUrl: "https://txline.txodds.com/auth/guest/start",
  rpcUrl: process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com",
  txlMint: process.env.TXL_MINT ?? "Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL",
  serviceLevelId: Number(process.env.SERVICE_LEVEL_ID ?? 1),
  weeks: Number(process.env.SUBSCRIBE_WEEKS ?? 4),
  leagues: [],
};

export function loadConfig(): NetworkConfig {
  const net = process.env.TX_NETWORK ?? "devnet";
  if (net !== "devnet" && net !== "mainnet") {
    throw new Error(`TX_NETWORK must be "devnet" or "mainnet", got "${net}"`);
  }
  return net === "devnet" ? DEVNET : MAINNET;
}

export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
export const KEYS_DIR = path.join(REPO_ROOT, "_keys");
export const RECORDINGS_DIR = path.join(REPO_ROOT, "data", "recordings");
