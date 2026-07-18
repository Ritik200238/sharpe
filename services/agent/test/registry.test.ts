import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  DEVNET_REGISTRY_PROGRAM_ID,
  REGISTRY_KIND,
  buildRegistryCommitIx,
  commitPda,
} from "../src/exec/registry";

const PROGRAM = new PublicKey(DEVNET_REGISTRY_PROGRAM_ID);
const AUTH = new PublicKey("CeUgBttcgRqAH1He876VBbA2PgUCMkU9Nnq2DqVEy9rk");
const HASH = "85535b3df19412fc9ebd9c65888135b7cb7819ed4c2e56ef363ba474c857a7a9"; // 64 hex

test("registry: kind tags match the on-chain program", () => {
  assert.equal(REGISTRY_KIND.decision, 1);
  assert.equal(REGISTRY_KIND.settlement, 2);
  assert.equal(REGISTRY_KIND.quote_book, 7);
});

test("registry: PDA derivation is deterministic and seeded by the hash", () => {
  const [a] = commitPda(PROGRAM, HASH);
  const [b] = commitPda(PROGRAM, HASH);
  assert.equal(a.toBase58(), b.toBase58(), "same hash → same PDA");
  const [c] = commitPda(PROGRAM, HASH.replace(/.$/, "0"));
  assert.notEqual(a.toBase58(), c.toBase58(), "different hash → different PDA");
});

test("registry: instruction matches the program's account + data contract", () => {
  const ix = buildRegistryCommitIx(PROGRAM, AUTH, "quote_book", HASH);
  assert.ok(ix.programId.equals(PROGRAM));

  // accounts: [authority (signer, writable), pda (writable), system (ro)]
  assert.equal(ix.keys.length, 3);
  assert.ok(ix.keys[0].pubkey.equals(AUTH));
  assert.equal(ix.keys[0].isSigner, true);
  assert.equal(ix.keys[0].isWritable, true);
  const [pda] = commitPda(PROGRAM, HASH);
  assert.ok(ix.keys[1].pubkey.equals(pda));
  assert.equal(ix.keys[1].isSigner, false);
  assert.equal(ix.keys[1].isWritable, true);
  assert.ok(ix.keys[2].pubkey.equals(SystemProgram.programId));
  assert.equal(ix.keys[2].isSigner, false);

  // data: kind(1) || hash(32) = 33 bytes
  assert.equal(ix.data.length, 33);
  assert.equal(ix.data[0], REGISTRY_KIND.quote_book);
  assert.equal(ix.data.subarray(1).toString("hex"), HASH);
});

test("registry: rejects a non-32-byte hash", () => {
  assert.throws(() => buildRegistryCommitIx(PROGRAM, AUTH, "decision", "abcd"));
});
