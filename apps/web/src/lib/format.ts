/**
 * Number, time, and identity formatting — spec §21, mirroring the
 * prototype's helpers exactly. en-US semantics throughout.
 */
import type { DecisionRecord } from "../api/types";

/** USDC, 2dp, unsigned ("1996.90"). */
export const usd = (n: number): string => n.toFixed(2);

/** Signed money — P&L is always signed ("+43.82", "-19.57"). */
export const signedUsd = (n: number): string =>
  (n >= 0 ? "+" : "-") + Math.abs(n).toFixed(2);

/** Probability fraction → percent, 1dp ("71.5%"). */
export const pct = (p: number): string => (p * 100).toFixed(1) + "%";

/** Edge fraction → signed probability points ("+18.2pp"). */
export const pp = (e: number): string =>
  (e >= 0 ? "+" : "-") + Math.abs(e * 100).toFixed(1) + "pp";

/** ROI / rate fraction → signed percent, 1dp ("+11.8%"). */
export const signedPct = (x: number): string =>
  (x >= 0 ? "+" : "-") + Math.abs(x * 100).toFixed(1) + "%";

/** Signed 3dp (calibration advantage). */
export const signed3 = (n: number): string =>
  (n >= 0 ? "+" : "-") + Math.abs(n).toFixed(3);

/** Decimal odds, 4dp as given ("1.8763"). */
export const odds4 = (n: number): string => n.toFixed(4);

/** Brier, 3dp (calibration panel). Lower is better. */
export const brier3 = (n: number): string => n.toFixed(3);

/** Brier, 4dp (digest table). Lower is better. */
export const brier4 = (n: number): string => n.toFixed(4);

/** Integer with en-US thousands separators ("18,211"). */
export const int = (n: number): string => n.toLocaleString("en-US");

/** Relative time from a server epoch-ms timestamp ("12s ago"). */
export function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Absolute UTC ("2026-07-16 12:59:01 UTC"). */
export const absUtc = (ts: number): string =>
  new Date(ts).toISOString().replace("T", " ").slice(0, 19) + " UTC";

/** Duration from seconds ("2h 15m" / "3m 41s"). */
export function dur(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${Math.floor(sec % 60)}s`;
}

/** Truncated hash/signature for display: first10…last4 (full value copyable). */
export const shortHash = (s: string | undefined): string =>
  s ? `${s.slice(0, 10)}…${s.slice(-4)}` : "";

/** Explorer link pattern (spec §20). */
export const explorerTx = (sig: string): string =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

// ---------- strategy identity ----------

export const STRATEGY_ORDER = ["S1_COHERENCE", "S2_REACTION", "S3_CONVERGENCE"] as const;

export const STRATEGY_COLORS: Record<string, string> = {
  S1_COHERENCE: "#7DA7FF",
  S2_REACTION: "#F5B84B",
  S3_CONVERGENCE: "#C792EA",
};

export const strategyColor = (id: string): string => STRATEGY_COLORS[id] ?? "#9AA3B5";

/** "S1_COHERENCE" → "S1 COHERENCE" (keep S1/S2/S3 identity stable). */
export const strategyLabel = (id: string): string => id.replace(/_/g, " ");

export const STRATEGY_DESCRIPTIONS: Record<string, string> = {
  S1_COHERENCE: "cross-market arithmetic",
  S2_REACTION: "trades lagging quotes after events",
  S3_CONVERGENCE: "fades no-event drift",
};

// ---------- domain labels ----------

/** WIN_DRAW_WIN outcome names arrive as 1/x/2 or part1/draw/part2. */
function wdwOutcome(outcomeName: string): string {
  const n = outcomeName.trim().toLowerCase();
  if (n === "part1" || n === "1") return "P1 win";
  if (n === "part2" || n === "2") return "P2 win";
  if (n === "draw" || n === "x") return "DRAW";
  return outcomeName;
}

/** Human market·outcome label ("OVER 2.5 goals", "match result: P1 win"). */
export function famLabel(d: DecisionRecord): string {
  if (d.family === "TOTAL_GOALS") return `${d.outcomeName.toUpperCase()} ${d.line} goals`;
  if (d.family === "BOTH_TEAMS_SCORE") return `both teams score: ${d.outcomeName.toUpperCase()}`;
  if (d.family === "WIN_DRAW_WIN") return `match result: ${wdwOutcome(d.outcomeName)}`;
  // Unknown family (contract grows) — render the raw facts honestly.
  return `${d.marketKey} · ${d.outcomeName}`;
}

/**
 * Fixture display. The feed delivers participant *ids*, but the current API
 * records carry only the fixture id — render it honestly (spec §21).
 */
export const fixtureLabel = (id: number): string => String(id);
