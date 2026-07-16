import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AuthSession, apiGet } from "../platform/auth";
import { NetworkConfig } from "../platform/config";
import devnetIdl from "../txline/devnet/txoracle.json";
import mainnetIdl from "../txline/mainnet/txoracle.json";
import type { Txoracle } from "../txline/devnet/txoracle";
import { DiscretePredicate } from "./proofs";

/**
 * validateStatV2 client — the trustless settlement primitive.
 *
 * Fetches the Merkle proof bundle from TxLINE, reconstructs the exact
 * on-chain payload, and executes the TxLINE program's validateStatV2
 * against the daily on-chain Merkle root. The boolean that comes back is
 * cryptographic truth: either the claimed stats are anchored under the
 * root TxODDS committed on Solana, or they are not.
 */

function toBytes32(value: string | number[] | Uint8Array): number[] {
  const bytes = Array.isArray(value)
    ? Uint8Array.from(value)
    : value instanceof Uint8Array
      ? value
      : typeof value === "string" && value.startsWith("0x")
        ? Buffer.from(value.slice(2), "hex")
        : Buffer.from(value as string, "base64");
  if (bytes.length !== 32) throw new Error(`Expected 32 bytes, received ${bytes.length}`);
  return Array.from(bytes);
}

function toProofNodes(
  nodes: Array<{ hash: string | number[] | Uint8Array; isRightSibling: boolean }>,
) {
  return nodes.map((node) => ({
    hash: toBytes32(node.hash),
    isRightSibling: node.isRightSibling,
  }));
}

export interface ValidationOutcome {
  verified: boolean;
  statKeys: number[];
  seq: number;
  fixtureId: number;
  /** Raw stat values the proof attests to (for the public record). */
  provenStats: Array<{ key: number; value: number; period: number }>;
  error?: string;
}

export class SettlementValidator {
  private program: anchor.Program<Txoracle>;

  constructor(
    private readonly cfg: NetworkConfig,
    connection: Connection,
    wallet: Keypair,
  ) {
    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), {
      commitment: "confirmed",
    });
    const idl = (cfg.network === "devnet" ? devnetIdl : mainnetIdl) as unknown as Txoracle;
    this.program = new anchor.Program<Txoracle>(idl, provider);
  }

  get programId(): PublicKey {
    return this.program.programId;
  }

  async validate(
    session: AuthSession,
    fixtureId: number,
    seq: number,
    statKeys: number[],
    predicates: DiscretePredicate[],
  ): Promise<ValidationOutcome> {
    try {
      const validation = await apiGet<any>(
        this.cfg,
        session,
        `/scores/stat-validation?fixtureId=${fixtureId}&seq=${seq}&statKeys=${statKeys.join(",")}`,
      );

      const targetTs: number = validation.summary.updateStats.minTimestamp;
      // Epoch day MUST derive from the proof's own timestamp (doc rule).
      const epochDay = Math.floor(targetTs / 86_400_000);
      const [dailyScoresPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)],
        this.program.programId,
      );

      const payload = {
        ts: new BN(targetTs),
        fixtureSummary: {
          fixtureId: new BN(validation.summary.fixtureId),
          updateStats: {
            updateCount: validation.summary.updateStats.updateCount,
            minTimestamp: new BN(validation.summary.updateStats.minTimestamp),
            maxTimestamp: new BN(validation.summary.updateStats.maxTimestamp),
          },
          eventsSubTreeRoot: toBytes32(validation.summary.eventStatsSubTreeRoot),
        },
        fixtureProof: toProofNodes(validation.subTreeProof),
        mainTreeProof: toProofNodes(validation.mainTreeProof),
        eventStatRoot: toBytes32(validation.eventStatRoot),
        stats: validation.statsToProve.map((stat: unknown, index: number) => ({
          stat,
          statProof: toProofNodes(validation.statProofs[index]),
        })),
      };

      const strategy = {
        geometricTargets: [],
        distancePredicate: null,
        discretePredicates: predicates,
      };

      const verified: boolean = await (this.program.methods as any)
        .validateStatV2(payload, strategy)
        .accounts({ dailyScoresMerkleRoots: dailyScoresPda })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
        .view();

      return {
        verified,
        statKeys,
        seq,
        fixtureId,
        provenStats: (validation.statsToProve ?? []).map((s: any) => ({
          key: s.key,
          value: s.value,
          period: s.period,
        })),
      };
    } catch (error: any) {
      return {
        verified: false,
        statKeys,
        seq,
        fixtureId,
        provenStats: [],
        error: error?.message ?? String(error),
      };
    }
  }
}
