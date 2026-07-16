import { Connection } from "@solana/web3.js";
import {
  AuthSession,
  activateApiToken,
  apiGet,
  fetchGuestJwt,
  loadCredentials,
  saveCredentials,
} from "./auth";
import { loadConfig, NetworkConfig } from "./config";
import { runRecorder } from "./recorder";
import { makeProgram, printPricingMatrix, subscribeOnChain } from "./subscribe";
import { ensureSol, loadOrCreateWallet } from "./wallet";

/**
 * One-time signup per network: wallet → SOL → guest JWT → on-chain
 * subscribe → activation → persisted credentials → REST smoke test.
 * Idempotent: skips whatever already exists.
 */
export async function setup(): Promise<void> {
  const cfg = loadConfig();
  console.log(`[setup] network: ${cfg.network}`);

  const connection = new Connection(cfg.rpcUrl, "confirmed");
  const wallet = loadOrCreateWallet(cfg.network);
  await ensureSol(connection, wallet, cfg.network);

  let credentials = loadCredentials(cfg.network);
  if (credentials?.apiToken) {
    console.log("[setup] existing API token found — refreshing JWT");
    const jwt = await fetchGuestJwt(cfg);
    credentials = { ...credentials, jwt, updatedAt: new Date().toISOString() };
    saveCredentials(credentials);
  } else {
    const jwt = await fetchGuestJwt(cfg);
    console.log("[setup] guest JWT acquired");

    const program = makeProgram(cfg, connection, wallet);
    console.log(`[setup] TxLINE program: ${program.programId.toBase58()}`);
    await printPricingMatrix(program);

    const txSig = await subscribeOnChain(cfg, connection, wallet, program);
    const apiToken = await activateApiToken(cfg, jwt, wallet, txSig, cfg.leagues);
    console.log("[setup] API token activated");

    credentials = {
      network: cfg.network,
      wallet: wallet.publicKey.toBase58(),
      jwt,
      apiToken,
      subscribeTxSig: txSig,
      updatedAt: new Date().toISOString(),
    };
    saveCredentials(credentials);
    console.log(`[setup] credentials saved for ${cfg.network}`);
  }

  await smokeTest(cfg, new AuthSession(cfg, credentials.jwt, credentials.apiToken));
}

export async function smokeTest(cfg: NetworkConfig, session: AuthSession): Promise<void> {
  const epochDay = Math.floor(Date.now() / 86_400_000);
  const fixtures = await apiGet<unknown[]>(
    cfg,
    session,
    `/fixtures/snapshot?competitionId=72&startEpochDay=${epochDay}`,
  );
  console.log(
    `[setup] smoke test OK — fixtures snapshot returned ${Array.isArray(fixtures) ? fixtures.length : "?"} rows`,
  );
}

export async function record(): Promise<void> {
  const cfg = loadConfig();
  const credentials = loadCredentials(cfg.network);
  if (!credentials?.apiToken) {
    throw new Error(`No credentials for ${cfg.network}. Run setup first.`);
  }
  const session = new AuthSession(cfg, credentials.jwt, credentials.apiToken);
  await session.renewJwt();
  await runRecorder(cfg, session);
}

export async function snapshot(requestPath: string): Promise<void> {
  const cfg = loadConfig();
  const credentials = loadCredentials(cfg.network);
  if (!credentials?.apiToken) {
    throw new Error(`No credentials for ${cfg.network}. Run setup first.`);
  }
  const session = new AuthSession(cfg, credentials.jwt, credentials.apiToken);
  const data = await apiGet(cfg, session, requestPath);
  console.log(JSON.stringify(data, null, 2));
}
