/**
 * Fetch helpers against the SHARPE read-only API.
 * One backend at a time, configured by VITE_API_BASE (spec §19).
 */
import type {
  AgentStatus,
  DecisionRecord,
  Digest,
  Health,
  MatchReview,
  MmStatus,
  SettlementRecord,
  TrackRecord,
} from "./types";

/**
 * Backend base URL. Precedence: `?api=<url>` query param (lets the deployed
 * site point at any agent with no rebuild — judge-friendly) → build-time
 * VITE_API_BASE → localhost dev default.
 */
function resolveBase(): string {
  try {
    const q = new URLSearchParams(window.location.search).get("api");
    if (q) return q.replace(/\/+$/, "");
  } catch {
    /* SSR/no-window — ignore */
  }
  return (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8787";
}

export const BASE: string = resolveBase();

/**
 * DEMO mode: a production build with NO backend configured (no `?api=`, no
 * VITE_API_BASE) — i.e. someone opening the bare deployed URL. There's nothing
 * to fetch live, so we serve bundled fixtures captured from a real agent run
 * (see `tools/capture-demo.ts`). The site becomes a self-contained, testable
 * demo with zero hosting. Dev (`npm run dev`) and any `?api=`/VITE_API_BASE
 * deployment always talk to the real agent.
 */
export const DEMO_MODE: boolean = (() => {
  try {
    if (new URLSearchParams(window.location.search).get("api")) return false;
  } catch {
    /* no window */
  }
  if (import.meta.env.VITE_API_BASE) return false;
  return !import.meta.env.DEV;
})();

const DEMO_ROOT = `${import.meta.env.BASE_URL}demo`;

/** Map an API path (with query) onto a bundled fixture filename. */
function demoFixture(path: string): string {
  const [p, qs] = path.split("?");
  const name = p.replace(/^\//, "");
  if (name === "digest") {
    const days = new URLSearchParams(qs ?? "").get("days") ?? "30";
    return `digest-${days}`;
  }
  if (name === "decisions") return "decisions";
  return name; // health · status · mm · settlements · reviews · track-record
}

async function getJson<T>(path: string): Promise<T> {
  const url = DEMO_MODE ? `${DEMO_ROOT}/${demoFixture(path)}.json` : BASE + path;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${DEMO_MODE ? "demo:" : ""}${path} → ${res.status}`);
  return (await res.json()) as T;
}

export const fetchHealth = (): Promise<Health> => getJson<Health>("/health");

/**
 * /status returns the full AgentStatus once the agent is constructed;
 * during startup it returns only { phase }. Callers should type-guard.
 */
export const fetchStatus = (): Promise<unknown> => getJson<unknown>("/status");

export function isAgentStatus(value: unknown): value is AgentStatus {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { startedAtTs?: unknown }).startedAtTs === "number"
  );
}

export const fetchDecisions = (limit = 200): Promise<DecisionRecord[]> =>
  getJson<DecisionRecord[]>(`/decisions?limit=${limit}`);

export const fetchSettlements = (): Promise<SettlementRecord[]> =>
  getJson<SettlementRecord[]>("/settlements");

export const fetchReviews = (): Promise<MatchReview[]> => getJson<MatchReview[]>("/reviews");

export const fetchDigest = (days: number): Promise<Digest> =>
  getJson<Digest>(`/digest?days=${days}`);

export const fetchTrackRecord = (): Promise<TrackRecord> =>
  getJson<TrackRecord>("/track-record");

/** /mm — the market maker's live book (enabled:false when the maker is off). */
export const fetchMm = (): Promise<MmStatus> => getJson<MmStatus>("/mm");

export const streamUrl = (): string => `${BASE}/stream`;
