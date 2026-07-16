import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { NetworkConfig } from "./config";
import devnetIdl from "./txline/devnet/txoracle.json";
import mainnetIdl from "./txline/mainnet/txoracle.json";
import type { Txoracle } from "./txline/devnet/txoracle";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function makeProgram(
  cfg: NetworkConfig,
  connection: Connection,
  wallet: Keypair,
): anchor.Program<Txoracle> {
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const idl = (cfg.network === "devnet" ? devnetIdl : mainnetIdl) as unknown as Txoracle;
  return new anchor.Program<Txoracle>(idl, provider);
}

export async function printPricingMatrix(program: anchor.Program<Txoracle>): Promise<void> {
  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    program.programId,
  );
  const matrix = await program.account.pricingMatrix.fetch(pricingMatrixPda);
  console.log("[subscribe] pricing matrix (level | tokens/week | sampling sec | leagues | markets):");
  for (const row of matrix.rows as any[]) {
    console.log(
      `  ${String(row.rowId).padStart(3)} | ${String(row.pricePerWeekToken).padStart(11)} | ` +
        `${String(row.samplingIntervalSec).padStart(12)} | ${String(row.leagueBundleId).padStart(7)} | ` +
        `${String(row.marketBundleId).padStart(7)}`,
    );
  }
}

/**
 * Free-tier on-chain subscription: ensure the TxL token account exists, then
 * call subscribe(serviceLevelId, weeks). Costs only network fees + rent.
 * Returns the confirmed transaction signature (needed for activation).
 */
export async function subscribeOnChain(
  cfg: NetworkConfig,
  connection: Connection,
  wallet: Keypair,
  program: anchor.Program<Txoracle>,
): Promise<string> {
  if (!cfg.txlMint) {
    throw new Error(`TxL mint unset for ${cfg.network} — set TXL_MINT before subscribing.`);
  }
  if (cfg.weeks < 4 || cfg.weeks % 4 !== 0) {
    throw new Error(`Subscription weeks must be a multiple of 4, got ${cfg.weeks}`);
  }

  const tokenMint = new PublicKey(cfg.txlMint);
  const userTokenAccountAddress = getAssociatedTokenAddressSync(
    tokenMint,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
  );

  if (!(await connection.getAccountInfo(userTokenAccountAddress))) {
    console.log("[subscribe] creating TxL Token-2022 account...");
    const createAta = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        userTokenAccountAddress,
        wallet.publicKey,
        tokenMint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
    await anchor.web3.sendAndConfirmTransaction(connection, createAta, [wallet], {
      commitment: "confirmed",
    });
  }

  let userTokenAccount;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      userTokenAccount = await getAccount(
        connection,
        userTokenAccountAddress,
        "confirmed",
        TOKEN_2022_PROGRAM_ID,
      );
      break;
    } catch (error: any) {
      if (error.name !== "TokenAccountNotFoundError" || attempt === 5) throw error;
      console.log(`[subscribe] RPC not synced yet, retrying (${attempt}/5)...`);
      await delay(2000);
    }
  }
  if (!userTokenAccount) throw new Error("Token account never appeared on RPC");

  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    program.programId,
  );
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    program.programId,
  );
  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    tokenMint,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID,
  );

  console.log(`[subscribe] level ${cfg.serviceLevelId}, ${cfg.weeks} weeks, leagues=[${cfg.leagues}]`);
  const tx = await program.methods
    .subscribe(cfg.serviceLevelId, cfg.weeks)
    .accounts({
      user: wallet.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint,
      userTokenAccount: userTokenAccount.address,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as any)
    .transaction();

  const latest = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = latest.blockhash;
  tx.feePayer = wallet.publicKey;
  tx.sign(wallet);

  const signature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  console.log(`[subscribe] confirmed: ${signature}`);
  return signature;
}
