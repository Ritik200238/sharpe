import axios from "axios";
import * as fs from "node:fs";
import * as path from "node:path";
import { KEYS_DIR, Network, NetworkConfig } from "./config";

export interface Credentials {
  network: Network;
  wallet: string;
  jwt: string;
  apiToken: string;
  subscribeTxSig?: string;
  updatedAt: string;
}

export function credentialsPath(network: Network): string {
  return path.join(KEYS_DIR, `credentials.${network}.json`);
}

export function loadCredentials(network: Network): Credentials | null {
  const file = credentialsPath(network);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as Credentials;
}

export function saveCredentials(credentials: Credentials): void {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  fs.writeFileSync(credentialsPath(credentials.network), JSON.stringify(credentials, null, 2));
}

export async function fetchGuestJwt(cfg: NetworkConfig): Promise<string> {
  const response = await axios.post(cfg.jwtUrl);
  const token: unknown = response.data?.token;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error(`Guest JWT response missing token: ${JSON.stringify(response.data)}`);
  }
  return token;
}

/** Live auth pair; renews the short-lived JWT in place and persists it. */
export class AuthSession {
  constructor(
    private readonly cfg: NetworkConfig,
    public jwt: string,
    public readonly apiToken: string,
  ) {}

  headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.jwt}`, "X-Api-Token": this.apiToken };
  }

  async renewJwt(): Promise<string> {
    this.jwt = await fetchGuestJwt(this.cfg);
    const stored = loadCredentials(this.cfg.network);
    if (stored) {
      stored.jwt = this.jwt;
      stored.updatedAt = new Date().toISOString();
      saveCredentials(stored);
    }
    return this.jwt;
  }
}

/** GET against the data API; renews JWT once on 401 and retries. */
export async function apiGet<T = unknown>(
  cfg: NetworkConfig,
  session: AuthSession,
  requestPath: string,
): Promise<T> {
  const url = `${cfg.apiBaseUrl}${requestPath}`;
  try {
    const response = await axios.get<T>(url, { headers: session.headers(), timeout: 30_000 });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      await session.renewJwt();
      const retried = await axios.get<T>(url, { headers: session.headers(), timeout: 30_000 });
      return retried.data;
    }
    throw error;
  }
}
