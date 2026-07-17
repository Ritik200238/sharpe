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
  SettlementRecord,
  TrackRecord,
} from "./types";

export const BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8787";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
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

export const streamUrl = (): string => `${BASE}/stream`;
