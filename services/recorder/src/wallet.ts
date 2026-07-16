import * as fs from "node:fs";
import * as path from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { KEYS_DIR, Network } from "./config";

export function walletPath(network: Network): string {
  return path.join(KEYS_DIR, `agent-${network}.json`);
}

export function loadOrCreateWallet(network: Network): Keypair {
  const file = walletPath(network);
  if (fs.existsSync(file)) {
    const secret = Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8")));
    return Keypair.fromSecretKey(secret);
  }
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  const keypair = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify(Array.from(keypair.secretKey)));
  console.log(`[wallet] created ${network} keypair: ${keypair.publicKey.toBase58()}`);
  console.log(`[wallet] stored at ${file} — keep this file private`);
  return keypair;
}

/**
 * Ensure the wallet holds at least `minSol`. On devnet we self-fund via RPC
 * airdrop; on mainnet we stop and tell the operator what to fund.
 */
export async function ensureSol(
  connection: Connection,
  keypair: Keypair,
  network: Network,
  minSol = 0.05,
  airdropSol = 1,
): Promise<void> {
  const balance = await connection.getBalance(keypair.publicKey);
  console.log(
    `[wallet] ${keypair.publicKey.toBase58()} balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
  );
  if (balance >= minSol * LAMPORTS_PER_SOL) return;

  if (network !== "devnet") {
    throw new Error(
      `Insufficient SOL on ${network}. Send ~${minSol} SOL to ${keypair.publicKey.toBase58()} and retry.`,
    );
  }

  console.log(`[wallet] requesting ${airdropSol} SOL devnet airdrop...`);
  const signature = await connection.requestAirdrop(
    keypair.publicKey,
    Math.round(airdropSol * LAMPORTS_PER_SOL),
  );
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  const after = await connection.getBalance(keypair.publicKey);
  console.log(`[wallet] balance after airdrop: ${(after / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
}
