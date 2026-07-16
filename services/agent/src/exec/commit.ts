import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { KEYS_DIR, Network, NetworkConfig } from "../platform/config";

/**
 * On-chain decision commitments.
 *
 * Every decision hash is written to Solana via the Memo program BEFORE the
 * outcome is known — a timestamped, wallet-signed, immutable commitment.
 * Anyone can recompute the hash from the published DecisionRecord and find
 * it on-chain: the track record cannot be forged, backdated, or pruned.
 * (The Anchor registry program in `programs/` supersedes this with typed
 * accounts; the Memo path keeps commitments live on any cluster today.)
 */
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export type CommitKind = "decision" | "settlement" | "review";

export class ChainCommitter {
  private connection: Connection;
  private queue: Array<{ kind: CommitKind; hash: string; resolve: (sig: string | null) => void }> =
    [];
  private draining = false;

  constructor(
    private readonly cfg: NetworkConfig,
    private readonly wallet: Keypair,
    private readonly onLog: (message: string) => void,
  ) {
    this.connection = new Connection(cfg.rpcUrl, "confirmed");
  }

  /** Queue a commitment; resolves with the tx signature (or null on failure). */
  commit(kind: CommitKind, hash: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.queue.push({ kind, hash, resolve });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!;
        const signature = await this.send(item.kind, item.hash);
        item.resolve(signature);
      }
    } finally {
      this.draining = false;
    }
  }

  private async send(kind: CommitKind, hash: string): Promise<string | null> {
    const memo = `sharpe:v1:${kind}:${hash}`;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const instruction = new TransactionInstruction({
          keys: [{ pubkey: this.wallet.publicKey, isSigner: true, isWritable: false }],
          programId: MEMO_PROGRAM_ID,
          data: Buffer.from(memo, "utf8"),
        });
        const tx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 5_000 }),
          instruction,
        );
        const latest = await this.connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = latest.blockhash;
        tx.feePayer = this.wallet.publicKey;
        tx.sign(this.wallet);
        const signature = await this.connection.sendRawTransaction(tx.serialize());
        await this.connection.confirmTransaction({ signature, ...latest }, "confirmed");
        this.onLog(`committed ${kind} ${hash.slice(0, 12)}… → ${signature.slice(0, 12)}…`);
        return signature;
      } catch (error: any) {
        this.onLog(`commit attempt ${attempt} failed: ${error?.message ?? error}`);
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }
    return null;
  }
}

export function loadAgentWallet(network: Network): Keypair {
  const file = path.join(KEYS_DIR, `agent-${network}.json`);
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8")));
  return Keypair.fromSecretKey(secret);
}
