import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { Keypair } from "@solana/web3.js";
import type { CommitKind, CommitterConnection } from "../src/exec/commit";
import type { NetworkConfig } from "../src/platform/config";
import type { DecisionRecord, SettlementRecord } from "../src/strategy/types";

// HARDENING item 1 acceptance: the write-ahead commit journal makes kill -9
// safe at every point in the send flow — a commitment is never dropped and
// never double-sent, and reconcile() settles pending intents on boot.
//
// SHARPE_TRACK_DIR must be set before any src module loads config (the
// TrackStore test relies on it), so all src imports here are dynamic.

const trackDir = fs.mkdtempSync(path.join(os.tmpdir(), "sharpe-wal-track-"));
process.env.SHARPE_TRACK_DIR = trackDir;

const NET: NetworkConfig = {
  network: "devnet",
  apiBaseUrl: "http://unused.invalid/api",
  jwtUrl: "http://unused.invalid/jwt",
  rpcUrl: "http://unused.invalid:1", // tests always inject a mock connection
  txlMint: "unused",
};

interface JournalLine {
  kind?: CommitKind;
  hash?: string;
  sig: string;
  status: string;
  lastValidBlockHeight?: number;
  amend?: boolean;
}

function readJournal(dir: string): JournalLine[] {
  const file = path.join(dir, "commits.ndjson");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

/** Mock of the Connection slice; every method overridable, sends counted. */
function mockConnection(overrides: Partial<CommitterConnection> = {}) {
  const calls = { send: 0 };
  const conn: CommitterConnection = {
    getLatestBlockhash: async () => ({ blockhash: "", lastValidBlockHeight: 0 }),
    sendRawTransaction: async () => {
      calls.send += 1;
      return "unused-rpc-echo";
    },
    confirmTransaction: async () => ({}),
    getSignatureStatuses: async () => ({ value: [null] }),
    getBlockHeight: async () => 0,
    ...overrides,
  };
  return { conn, calls };
}

test("WAL: crash after intent-write → reconcile expires and resubmits exactly once", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sharpe-wal-1-"));
  try {
    const { ChainCommitter, toBase58 } = await import("../src/exec/commit");
    const wallet = Keypair.generate();
    const hash = "a".repeat(64);
    const bhA = toBase58(new Uint8Array(32).fill(7));
    const bhB = toBase58(new Uint8Array(32).fill(9));

    // Committer #1: broadcast always fails — intent journalled, nothing lands.
    const dead = mockConnection({
      getLatestBlockhash: async () => ({ blockhash: bhA, lastValidBlockHeight: 1000 }),
      sendRawTransaction: async () => {
        throw new Error("rpc down");
      },
    });
    const committer1 = new ChainCommitter(NET, wallet, () => {}, dir, {
      connection: dead.conn,
      retryDelayMs: 1,
    });
    assert.equal(await committer1.commit("decision", hash), null, "all attempts fail → null");

    const before = readJournal(dir);
    const intentSig = before[0].sig;
    assert.ok(before.length > 0, "intent must be journalled before broadcast");
    assert.ok(before.every((l) => l.status === "intent" && l.sig === intentSig && !l.amend));

    // Committer #2 ("restart"): the intent's blockhash has expired unlanded,
    // and the RPC works again.
    const confirmed: Array<[CommitKind, string, string]> = [];
    const alive = mockConnection({
      getLatestBlockhash: async () => ({ blockhash: bhB, lastValidBlockHeight: 2000 }),
      getSignatureStatuses: async () => ({ value: [null] }), // never landed
      getBlockHeight: async () => 5000, // > 1000 → expired
    });
    const committer2 = new ChainCommitter(NET, wallet, () => {}, dir, {
      connection: alive.conn,
      onConfirmed: (kind, h, sig) => confirmed.push([kind, h, sig]),
      retryDelayMs: 1,
    });
    await committer2.reconcile();

    assert.equal(alive.calls.send, 1, "expired intent resubmitted exactly once");
    const after = readJournal(dir);
    const expired = after.filter((l) => l.amend && l.status === "expired");
    assert.equal(expired.length, 1, "one expired amend");
    assert.equal(expired[0].sig, intentSig, "expired amend closes the original intent");
    const confirms = after.filter((l) => l.amend && l.status === "confirmed");
    assert.equal(confirms.length, 1, "one confirmed amend for the resubmission");
    assert.equal(confirmed.length, 1, "onConfirmed fired once");
    assert.equal(confirmed[0][0], "decision");
    assert.equal(confirmed[0][1], hash);
    assert.equal(confirmed[0][2], confirms[0].sig);
    assert.notEqual(confirms[0].sig, intentSig, "resubmission has a fresh signature");

    // Idempotency: the pair is confirmed — no second send, same sig back.
    assert.equal(await committer2.commit("decision", hash), confirms[0].sig);
    assert.equal(alive.calls.send, 1, "confirmed pair is never re-sent");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("WAL: crash after landed-but-before-confirm-write → reconcile backfills, no resubmit", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sharpe-wal-2-"));
  try {
    const { ChainCommitter } = await import("../src/exec/commit");
    const wallet = Keypair.generate();
    const hash = "b".repeat(64);
    const sig = "LandedButUnconfirmedSig11111111111111111111";

    // The exact on-disk state a crash between send and confirm leaves behind.
    fs.writeFileSync(
      path.join(dir, "commits.ndjson"),
      `${JSON.stringify({
        kind: "settlement",
        hash,
        sig,
        blockhash: "unused",
        lastValidBlockHeight: 1000,
        ts: 1,
        status: "intent",
      })}\n`,
    );

    const confirmed: Array<[CommitKind, string, string]> = [];
    const chain = mockConnection({
      getSignatureStatuses: async (sigs, config) => {
        assert.deepEqual(sigs, [sig]);
        assert.equal(config?.searchTransactionHistory, true);
        return { value: [{ err: null }] }; // it landed
      },
      getBlockHeight: async () => 5000,
    });
    const committer = new ChainCommitter(NET, wallet, () => {}, dir, {
      connection: chain.conn,
      onConfirmed: (kind, h, s) => confirmed.push([kind, h, s]),
    });
    await committer.reconcile();

    assert.equal(chain.calls.send, 0, "a landed commitment is never re-sent");
    const lines = readJournal(dir);
    const confirms = lines.filter((l) => l.amend && l.status === "confirmed");
    assert.equal(confirms.length, 1, "confirmed amend appended");
    assert.equal(confirms[0].sig, sig);
    assert.deepEqual(confirmed, [["settlement", hash, sig]], "onConfirmed fired with journal data");

    // Idempotency across the reconcile path too.
    assert.equal(await committer.commit("settlement", hash), sig);
    assert.equal(chain.calls.send, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("TrackStore: updateSettlementCommit persists via amend line and survives reload", async () => {
  try {
    const { TrackStore } = await import("../src/track/store");
    const decisionHash = "d".repeat(64);
    const decision: DecisionRecord = {
      hash: decisionHash,
      decidedAtTs: 1000,
      mode: "chain",
      strategy: "S1_COHERENCE",
      fixtureId: 7,
      marketKey: "match_odds",
      family: "WIN_DRAW_WIN",
      outcomeIndex: 0,
      outcomeName: "1",
      modelProb: 0.55,
      marketProb: 0.5,
      edge: 0.05,
      stakeUsdc: 10,
      priceDecimal: 2,
      reason: "test",
      sizing: { kellyFraction: 0.1, calibrationFactor: 1, allocationWeight: 1, bankrollUsdc: 2000 },
      inputs: { oddsMessageId: "m1", oddsTs: 999, lambdaHome: 1.2, lambdaAway: 0.9 },
    };
    const settlement: SettlementRecord = {
      decisionHash,
      settledAtTs: 2000,
      fixtureId: 7,
      won: true,
      pnlUsdc: 10,
      finalP1Goals: 1,
      finalP2Goals: 0,
    };

    const store = new TrackStore("devnet", "paper");
    store.addDecision(decision);
    store.addSettlement(settlement);
    store.updateSettlementCommit(decisionHash, "SettleCommitSig111");
    store.updateSettlementCommit(decisionHash, "SettleCommitSig111"); // idempotent no-op
    assert.equal(store.settlements.get(decisionHash)?.commitTxSig, "SettleCommitSig111");

    // A fresh process over the same ledger sees the amended settlement.
    const reborn = new TrackStore("devnet", "paper");
    assert.equal(reborn.settlements.get(decisionHash)?.commitTxSig, "SettleCommitSig111");

    // Exactly one amend line — the duplicate update appended nothing.
    const file = path.join(trackDir, "devnet", "paper", "settlements.ndjson");
    const amends = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
      .filter((l) => l.amend);
    assert.equal(amends.length, 1);
    assert.deepEqual(amends[0], {
      decisionHash,
      commitTxSig: "SettleCommitSig111",
      amend: true,
    });
  } finally {
    fs.rmSync(trackDir, { recursive: true, force: true });
  }
});

test("base58: signature encoding matches the reference vectors", async () => {
  const { toBase58 } = await import("../src/exec/commit");
  // Vectors generated with the reference bs58 implementation.
  assert.equal(toBase58(Uint8Array.from([0])), "1");
  assert.equal(toBase58(Uint8Array.from(Buffer.from("hello world", "utf8"))), "StV1DL6CwTryKyV");
  assert.equal(toBase58(new Uint8Array(64)), "1".repeat(64));
  assert.equal(
    toBase58(Uint8Array.from({ length: 64 }, (_, i) => (i * 7 + 3) % 256)),
    "4XR92Zct9ZodXzisJ4kov3upmTvMotYVrg65MHP8aoCjSPJwUa7vjaXK5VhDF7ZiiF16v7cY5BPazCLnVqZ3yzb",
  );
});
