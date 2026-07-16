import { Connection } from "@solana/web3.js";
import { loadAgentWallet } from "../src/exec/commit";
import { AuthSession, loadCredentials } from "../src/platform/auth";
import { loadAgentConfig } from "../src/platform/config";
import { SettlementValidator } from "../src/settle/validate";
import { DiscretePredicate } from "../src/settle/proofs";

/**
 * The crown-jewel spike: verify a REAL match outcome against TxODDS'
 * on-chain Merkle root via validateStatV2 — and prove it's not a rubber
 * stamp by also submitting a false claim that must be rejected.
 *
 * Usage: tsx tools/verify-proof.ts [fixtureId] [seq]
 * Defaults: England 1-2 Argentina semifinal, game_finalised seq.
 */
async function main(): Promise<void> {
  const fixtureId = Number(process.argv[2] ?? 18241006);
  const seq = Number(process.argv[3] ?? 962);

  const cfg = loadAgentConfig(["--network", "devnet"]);
  const credentials = loadCredentials("devnet");
  if (!credentials?.apiToken) throw new Error("no devnet credentials — run recorder setup first");
  const session = new AuthSession(cfg.network, credentials.jwt, credentials.apiToken);
  const wallet = loadAgentWallet("devnet");
  const connection = new Connection(cfg.network.rpcUrl, "confirmed");
  const validator = new SettlementValidator(cfg.network, connection, wallet);

  const statKeys = [1, 2]; // P1 total goals, P2 total goals

  const claimP2Won: DiscretePredicate[] = [
    {
      binary: {
        indexA: 0,
        indexB: 1,
        op: { subtract: {} },
        predicate: { threshold: 0, comparison: { lessThan: {} } },
      },
    },
  ];
  const claimP1Won: DiscretePredicate[] = [
    {
      binary: {
        indexA: 0,
        indexB: 1,
        op: { subtract: {} },
        predicate: { threshold: 0, comparison: { greaterThan: {} } },
      },
    },
  ];

  console.log(`fixture ${fixtureId}, seq ${seq}, program ${validator.programId.toBase58()}`);

  console.log("\n[1/2] TRUE claim — 'participant 2 won' (goals P1 − P2 < 0):");
  const truthful = await validator.validate(session, fixtureId, seq, statKeys, claimP2Won);
  console.log(
    `  verified: ${truthful.verified}` +
      (truthful.error ? ` | error: ${truthful.error}` : "") +
      ` | proven stats: ${JSON.stringify(truthful.provenStats)}`,
  );

  console.log("\n[2/2] FALSE claim — 'participant 1 won' (goals P1 − P2 > 0):");
  const dishonest = await validator.validate(session, fixtureId, seq, statKeys, claimP1Won);
  console.log(
    `  verified: ${dishonest.verified}` + (dishonest.error ? ` | error: ${dishonest.error}` : ""),
  );

  if (truthful.verified && !dishonest.verified) {
    console.log(
      "\nRESULT: settlement primitive PROVEN — the on-chain Merkle root accepts the true outcome and rejects the false one.",
    );
  } else {
    console.log("\nRESULT: unexpected — investigate before relying on settlement.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error?.response?.data ?? error);
  process.exit(1);
});
