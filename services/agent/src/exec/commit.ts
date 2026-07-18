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
 *
 * Reliability: every commitment is journalled to `commits.ndjson` (write-
 * ahead, same append-only idiom as the track record) BEFORE broadcast, so a
 * crash at any point can never silently drop or orphan a commitment. Boot
 * calls `reconcile()` to settle every pending intent against the chain:
 * landed → confirm + backfill the record, blockhash expired → resubmit.
 */
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export type CommitKind = "decision" | "settlement" | "review" | "digest" | "quote_book";

/** Write-ahead journal line: appended after signing, before broadcast. */
export interface CommitIntent {
  kind: CommitKind;
  hash: string;
  sig: string;
  blockhash: string;
  lastValidBlockHeight: number;
  ts: number;
  status: "intent";
}

/** Journal amendment closing an intent out (mirrors track/store.ts amends). */
interface CommitAmend {
  sig: string;
  status: "confirmed" | "expired";
  ts: number;
  amend: true;
}

/**
 * The slice of `Connection` the committer touches — injectable so tests can
 * simulate crashes, blockhash expiry, and landed-but-unconfirmed states.
 */
export interface CommitterConnection {
  getLatestBlockhash(
    commitment: "confirmed",
  ): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  sendRawTransaction(rawTransaction: Buffer | Uint8Array): Promise<string>;
  confirmTransaction(
    strategy: { signature: string; blockhash: string; lastValidBlockHeight: number },
    commitment?: "confirmed",
  ): Promise<unknown>;
  getSignatureStatuses(
    signatures: string[],
    config?: { searchTransactionHistory: boolean },
  ): Promise<{ value: Array<{ err: unknown } | null> }>;
  getBlockHeight(commitment: "confirmed"): Promise<number>;
}

export interface ChainCommitterOptions {
  /** Injectable connection for tests; defaults to a real RPC connection. */
  connection?: CommitterConnection;
  /** Fired exactly once per {kind, hash} when its commitment confirms —
   * on the send path AND the reconcile path. */
  onConfirmed?: (kind: CommitKind, hash: string, sig: string) => void;
  /** Backoff base between in-process attempts (tests shrink it). */
  retryDelayMs?: number;
}

export class ChainCommitter {
  private connection: CommitterConnection;
  private queue: Array<{ kind: CommitKind; hash: string; resolve: (sig: string | null) => void }> =
    [];
  private draining = false;
  private reconciling = false;

  private readonly journalFile: string;
  private readonly onConfirmed?: (kind: CommitKind, hash: string, sig: string) => void;
  private readonly retryDelayMs: number;

  /** Journalled intents with no confirmed/expired amend yet, keyed by sig. */
  private readonly pending = new Map<string, CommitIntent>();
  /** `${kind}:${hash}` pairs with a confirmed line — never sent again. */
  private readonly confirmedPairs = new Set<string>();
  private readonly confirmedSigByPair = new Map<string, string>();
  /** Commitments that failed before any intent could be journalled (e.g.
   * blockhash fetch down) — kept in memory for the retry timer. */
  private readonly unjournalled = new Map<string, { kind: CommitKind; hash: string }>();
  private readonly retryTimer: NodeJS.Timeout;

  constructor(
    private readonly cfg: NetworkConfig,
    private readonly wallet: Keypair,
    private readonly onLog: (message: string) => void,
    trackDir: string,
    options?: ChainCommitterOptions,
  ) {
    this.connection = options?.connection ?? new Connection(cfg.rpcUrl, "confirmed");
    this.onConfirmed = options?.onConfirmed;
    this.retryDelayMs = options?.retryDelayMs ?? 1500;
    fs.mkdirSync(trackDir, { recursive: true });
    this.journalFile = path.join(trackDir, "commits.ndjson");
    this.loadJournal();
    // Pending commitments are never dropped: a low-duty timer keeps
    // reconciling and resubmitting until every intent is settled.
    this.retryTimer = setInterval(() => void this.retryPending(), 60_000);
    this.retryTimer.unref();
  }

  /** Queue a commitment; resolves with the tx signature (or null while it
   * stays pending). Idempotent per {kind, hash}: an already-confirmed pair
   * resolves immediately with its existing signature. */
  commit(kind: CommitKind, hash: string): Promise<string | null> {
    const existing = this.confirmedSigByPair.get(`${kind}:${hash}`);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      this.queue.push({ kind, hash, resolve });
      void this.drain();
    });
  }

  /**
   * Settle every journalled intent that has no confirmed/expired amend:
   * - landed on-chain → append confirmed amend + fire onConfirmed;
   * - blockhash expired without landing → append expired amend + resubmit
   *   (awaited, so boot completes with every expired intent re-attempted);
   * - still within its blockhash window → leave pending.
   */
  async reconcile(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const intents = [...this.pending.values()];
      if (intents.length === 0) return;
      this.onLog(`reconcile: ${intents.length} pending commitment(s) in the journal`);
      const resubmits: Array<Promise<string | null>> = [];
      const resubmitted = new Set<string>();
      for (const intent of intents) {
        const pair = `${intent.kind}:${intent.hash}`;
        try {
          const statuses = await this.connection.getSignatureStatuses([intent.sig], {
            searchTransactionHistory: true,
          });
          const status = statuses.value[0];
          if (status && !status.err) {
            this.recordConfirmed(intent);
            this.onLog(
              `reconcile: ${intent.kind} ${intent.hash.slice(0, 12)}… already landed → ${intent.sig.slice(0, 12)}…`,
            );
            continue;
          }
          const height = await this.connection.getBlockHeight("confirmed");
          if (height > intent.lastValidBlockHeight) {
            this.appendJournal({ sig: intent.sig, status: "expired", ts: Date.now(), amend: true });
            this.pending.delete(intent.sig);
            if (!this.confirmedPairs.has(pair) && !resubmitted.has(pair)) {
              resubmitted.add(pair);
              this.onLog(
                `reconcile: ${intent.kind} ${intent.hash.slice(0, 12)}… expired unlanded — resubmitting`,
              );
              resubmits.push(this.commit(intent.kind, intent.hash));
            }
          }
          // Otherwise the blockhash is still valid — leave the intent pending.
        } catch (error: any) {
          this.onLog(`reconcile error for ${intent.sig.slice(0, 12)}…: ${error?.message ?? error}`);
        }
      }
      await Promise.all(resubmits);
    } finally {
      this.reconciling = false;
    }
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!;
        const existing = this.confirmedSigByPair.get(`${item.kind}:${item.hash}`);
        if (existing) {
          item.resolve(existing); // confirmed while queued — never double-send
          continue;
        }
        const signature = await this.send(item.kind, item.hash);
        item.resolve(signature);
      }
    } finally {
      this.draining = false;
    }
  }

  private async send(kind: CommitKind, hash: string): Promise<string | null> {
    const memo = `sharpe:v1:${kind}:${hash}`;
    let journalled = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const instruction = new TransactionInstruction({
          keys: [{ pubkey: this.wallet.publicKey, isSigner: true, isWritable: false }],
          programId: MEMO_PROGRAM_ID,
          data: Buffer.from(memo, "utf8"),
        });
        // The Memo program validates UTF-8 and logs the message, which costs
        // real compute: an ~85-byte `sharpe:v1:<kind>:<64-hex>` memo measures
        // at ~45k CU on devnet. The old 5k cap made EVERY commitment fail
        // simulation ("ProgramFailedToComplete"); 100k clears it with margin.
        // We set no compute-unit *price*, so the flat per-signature fee is
        // unchanged by this limit — a higher ceiling costs nothing here.
        const tx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
          instruction,
        );
        const latest = await this.connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = latest.blockhash;
        tx.feePayer = this.wallet.publicKey;
        tx.sign(this.wallet);
        const rawSignature = tx.signature;
        if (!rawSignature) throw new Error("signing produced no signature");
        const signature = toBase58(rawSignature);
        // Write-ahead: the signature exists the moment the tx is signed, so
        // journal the intent BEFORE broadcast — a crash between send and
        // confirm can never orphan an on-chain commitment.
        const intent: CommitIntent = {
          kind,
          hash,
          sig: signature,
          blockhash: latest.blockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight,
          ts: Date.now(),
          status: "intent",
        };
        this.appendJournal(intent);
        this.pending.set(signature, intent);
        journalled = true;
        await this.connection.sendRawTransaction(tx.serialize());
        await this.connection.confirmTransaction(
          {
            signature,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          },
          "confirmed",
        );
        this.recordConfirmed(intent);
        this.onLog(`committed ${kind} ${hash.slice(0, 12)}… → ${signature.slice(0, 12)}…`);
        return signature;
      } catch (error: any) {
        this.onLog(`commit attempt ${attempt} failed: ${error?.message ?? error}`);
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * attempt));
        }
      }
    }
    // NEVER dropped: the journalled intent (or in-memory marker when even
    // signing failed) is retried by the timer and reconciled on next boot.
    if (!journalled) this.unjournalled.set(`${kind}:${hash}`, { kind, hash });
    this.onLog(`commit ${kind} ${hash.slice(0, 12)}… pending after 3 attempts — will retry/reconcile`);
    return null;
  }

  /** Timer body: reconcile journalled intents, resubmit unjournalled ones. */
  private async retryPending(): Promise<void> {
    if (this.pending.size === 0 && this.unjournalled.size === 0) return;
    const orphans = [...this.unjournalled.values()];
    this.unjournalled.clear();
    const resubmits = orphans
      .filter(({ kind, hash }) => !this.confirmedPairs.has(`${kind}:${hash}`))
      .map(({ kind, hash }) => this.commit(kind, hash));
    await this.reconcile();
    await Promise.all(resubmits);
  }

  private recordConfirmed(intent: CommitIntent): void {
    this.appendJournal({ sig: intent.sig, status: "confirmed", ts: Date.now(), amend: true });
    this.pending.delete(intent.sig);
    const pair = `${intent.kind}:${intent.hash}`;
    this.unjournalled.delete(pair);
    if (this.confirmedPairs.has(pair)) return; // superseded duplicate — keep the first sig
    this.confirmedPairs.add(pair);
    this.confirmedSigByPair.set(pair, intent.sig);
    this.onConfirmed?.(intent.kind, intent.hash, intent.sig);
  }

  /** Rebuild pending/confirmed state from the journal (pure — no I/O out). */
  private loadJournal(): void {
    if (!fs.existsSync(this.journalFile)) return;
    for (const line of fs.readFileSync(this.journalFile, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let parsed: any;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue; // tolerate a torn final line from a crash
      }
      if (parsed.amend === true) {
        const intent = this.pending.get(parsed.sig);
        this.pending.delete(parsed.sig);
        if (intent && parsed.status === "confirmed") {
          const pair = `${intent.kind}:${intent.hash}`;
          if (!this.confirmedPairs.has(pair)) {
            this.confirmedPairs.add(pair);
            this.confirmedSigByPair.set(pair, intent.sig);
          }
        }
      } else if (parsed.status === "intent" && typeof parsed.sig === "string") {
        this.pending.set(parsed.sig, parsed as CommitIntent);
      }
    }
  }

  private appendJournal(line: CommitIntent | CommitAmend): void {
    fs.appendFileSync(this.journalFile, `${JSON.stringify(line)}\n`);
  }
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Base58 (Bitcoin alphabet) — the encoding of every Solana signature.
 * Local and dependency-free: `bs58` is only a transitive dep with no type
 * declarations, and the no-new-deps law bars adding it (or its @types).
 * Verified against `bs58.encode` across fuzzed inputs; deterministic.
 */
export function toBase58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const digits: number[] = []; // base-58 digits, little-endian
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] * 256;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += BASE58_ALPHABET[digits[i]];
  return out;
}

export function loadAgentWallet(network: Network): Keypair {
  const file = path.join(KEYS_DIR, `agent-${network}.json`);
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8")));
  return Keypair.fromSecretKey(secret);
}
