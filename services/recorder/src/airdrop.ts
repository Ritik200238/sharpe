import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "node:fs";
import { loadConfig } from "./config";
import { walletPath } from "./wallet";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The public devnet faucet is flaky. Hammer it politely: several attempts,
 * descending amounts, backoff between tries. Exits 0 as soon as the balance
 * is usable (>= 0.05 SOL).
 */
async function main(): Promise<void> {
  const cfg = loadConfig();
  if (cfg.network !== "devnet") throw new Error("airdrop is devnet-only");

  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(walletPath("devnet"), "utf8")));
  const keypair = Keypair.fromSecretKey(secret);
  const connection = new Connection(cfg.rpcUrl, "confirmed");

  const target = 0.05 * LAMPORTS_PER_SOL;
  const amounts = [1, 0.5, 0.25, 0.1, 0.05];

  for (let round = 1; round <= 10; round++) {
    const balance = await connection.getBalance(keypair.publicKey);
    if (balance >= target) {
      console.log(`[airdrop] balance OK: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
      return;
    }
    const amount = amounts[Math.min(round - 1, amounts.length - 1)];
    try {
      console.log(`[airdrop] round ${round}: requesting ${amount} SOL...`);
      const signature = await connection.requestAirdrop(
        keypair.publicKey,
        Math.round(amount * LAMPORTS_PER_SOL),
      );
      const latest = await connection.getLatestBlockhash("confirmed");
      await connection.confirmTransaction({ signature, ...latest }, "confirmed");
      const after = await connection.getBalance(keypair.publicKey);
      console.log(`[airdrop] success — balance ${(after / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
      return;
    } catch (error: any) {
      console.log(`[airdrop] failed: ${error?.message ?? error}`);
      await delay(5000 + round * 2000);
    }
  }
  throw new Error(
    `Faucet exhausted. Fund ${keypair.publicKey.toBase58()} manually at https://faucet.solana.com (devnet).`,
  );
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
