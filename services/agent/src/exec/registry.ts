/**
 * Client for SHARPE's on-chain commitment `registry` program.
 *
 * The registry (deployed on devnet, `programs/registry/`) is the typed successor
 * to the Memo commitment path: it records a commitment `(kind, 32-byte hash)` in
 * a PDA seeded by the hash and refuses to overwrite an existing one. This module
 * builds the instruction the agent sends to commit a decision / settlement /
 * quote-book hash into that program. Pure + deterministic (the PDA and
 * instruction are a function of the program id + hash), so it's unit-testable
 * without a network.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { CommitKind } from "./commit";

/** The deployed registry program on devnet (`programs/registry/`). */
export const DEVNET_REGISTRY_PROGRAM_ID = "6T8ec9WXJ9LLX7XRwrF1Q1u3tQxfXxX7X3zaLd3mm9sT";

/** PDA seed prefix — must match `COMMIT_SEED` in the on-chain program. */
export const COMMIT_SEED = Buffer.from("commit");

/** Map a commit kind to the program's 1-byte tag (stored in the PDA). */
export const REGISTRY_KIND: Record<CommitKind, number> = {
  decision: 1,
  settlement: 2,
  review: 3,
  digest: 4,
  quote_book: 7,
};

/** The commitment PDA for a hash: `[COMMIT_SEED, hash]` under the program. */
export function commitPda(programId: PublicKey, hashHex: string): [PublicKey, number] {
  const hash = Buffer.from(hashHex, "hex");
  return PublicKey.findProgramAddressSync([COMMIT_SEED, hash], programId);
}

/**
 * Build the `commit` instruction: instruction data is `kind (1) || hash (32)`;
 * accounts are `[authority (signer, payer), commit_pda (writable), system]` —
 * exactly what `programs/registry/src/lib.rs` expects.
 */
export function buildRegistryCommitIx(
  programId: PublicKey,
  authority: PublicKey,
  kind: CommitKind,
  hashHex: string,
): TransactionInstruction {
  const hash = Buffer.from(hashHex, "hex");
  if (hash.length !== 32) throw new Error(`registry commit hash must be 32 bytes, got ${hash.length}`);
  const [pda] = commitPda(programId, hashHex);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([REGISTRY_KIND[kind]]), hash]),
  });
}

/**
 * Send a commitment to the registry. Returns the tx signature, or `"exists"` if
 * the commitment is already on-chain (the program rejects a duplicate hash with
 * `AccountAlreadyInitialized` — which is success for us: the record is present).
 */
export async function commitToRegistry(
  connection: Connection,
  wallet: Keypair,
  programId: PublicKey,
  kind: CommitKind,
  hashHex: string,
): Promise<string> {
  const ix = buildRegistryCommitIx(programId, wallet.publicKey, kind, hashHex);
  try {
    return await sendAndConfirmTransaction(connection, new Transaction().add(ix), [wallet], {
      commitment: "confirmed",
    });
  } catch (error: any) {
    const logs: string = (error?.logs ?? []).join(" ") + (error?.message ?? "");
    if (/already in use|AccountAlreadyInitialized|custom program error: 0x0/.test(logs)) {
      return "exists"; // idempotent — the commitment is already recorded
    }
    throw error;
  }
}
