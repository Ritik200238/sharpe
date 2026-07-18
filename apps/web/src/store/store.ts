/**
 * Hand-rolled reactive store (spec §11 + handoff "Data / State Management").
 *
 * Hydration: /health + /status first paint → /decisions?limit=200,
 * /settlements, /reviews, /digest → EventSource('/stream'). Records are
 * upsert-by-hash (commitTxSig upgrades in place); settlements join by
 * decisionHash. Persistent SSE failure falls back to 2s polling of
 * /status + /decisions + /settlements while retrying SSE every 30s.
 * Rehydrates on tab-visibility regain and on agent restart
 * (startedAtTs change — the kill -9 resilience path).
 */
import { useSyncExternalStore } from "react";
import {
  DEMO_MODE,
  fetchDecisions,
  fetchDigest,
  fetchHealth,
  fetchMm,
  fetchReviews,
  fetchSettlements,
  fetchStatus,
  fetchTrackRecord,
  isAgentStatus,
  streamUrl,
} from "../api/client";
import type {
  AgentStatus,
  DecisionRecord,
  Digest,
  FeedStatusEvent,
  Health,
  MatchReview,
  MmStatus,
  SettlementRecord,
  StreamEnvelope,
  VetoRecord,
} from "../api/types";
import { parseHash, routeToHash, type Route } from "../lib/router";

export type ConnectionState = "live-sse" | "polling" | "dead";

export type FeedItemType = "decision" | "settlement" | "review" | "status" | "veto" | "score";

/**
 * A raw feed entry. Decisions/settlements store only the join hash so the
 * rendered card always reflects the latest upserted record (commit upgrades);
 * reviews/status/vetoes carry their payload.
 */
export interface FeedItem {
  key: string;
  type: FeedItemType;
  ts: number;
  hash?: string;
  payload?: unknown;
}

export interface LedgerFilters {
  strategy: string; // "all" | StrategyId
  status: string; // "all" | "open" | "settled" | "won" | "lost" | "shadow"
}

export interface StoreState {
  route: Route;
  decisions: Map<string, DecisionRecord>;
  settlements: Map<string, SettlementRecord>;
  reviews: MatchReview[];
  status: AgentStatus | null;
  health: Health | null;
  phase: string | null;
  /** The market maker's live book (null before first fetch; enabled:false when off). */
  mm: MmStatus | null;
  digests: Map<number, Digest>;
  connection: ConnectionState;
  feed: FeedItem[];
  buffer: FeedItem[];
  paused: boolean;
  filters: LedgerFilters;
  windowDays: number;
  showRaw: boolean;
  rawJson: string | null;
  announce: string;
  /** Last SSE message received in this browser (epoch ms), null before first. */
  lastStreamTs: number | null;
  /** Bumped every ~4s so relative timestamps re-render. */
  tick: number;
}

const FEED_CAP = 120;
/** Bound the dedupe sets so a 24/7 session can't leak memory. Feed keys are
 * unique and never re-pushed (each decision streams once; re-fetches go
 * through upsert, not pushFeed), so trimming the oldest keys — far older than
 * anything still in the 120-item feed — can never resurrect a duplicate. */
const SEEN_KEYS_CAP = 5000;
const DECISION_LIMIT = 200;
const STATUS_POLL_MS = 5000;
const FALLBACK_POLL_MS = 2000;
const DECISIONS_REFRESH_MS = 30_000;
const SSE_RETRY_MS = 30_000;
const ANNOUNCE_THROTTLE_MS = 4000;
const NOTIFY_COALESCE_MS = 40;
const COPY_FLASH_MS = 1600;

class SharpeStore {
  state: StoreState = {
    route: { name: "command" },
    decisions: new Map(),
    settlements: new Map(),
    reviews: [],
    status: null,
    health: null,
    phase: null,
    mm: null,
    digests: new Map(),
    connection: "polling",
    feed: [],
    buffer: [],
    paused: false,
    filters: { strategy: "all", status: "all" },
    windowDays: 30,
    showRaw: false,
    rawJson: null,
    announce: "",
    lastStreamTs: null,
    tick: 0,
  };

  version = 0;

  private listeners = new Set<() => void>();
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  private es: EventSource | null = null;
  private sseErrors = 0;
  private sseRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackPollTimer: ReturnType<typeof setInterval> | null = null;

  private seenFeedKeys = new Set<string>();
  private seenVetoKeys = new Set<string>();
  private vetoBaselineDone = false;
  private seededFeed = false;
  private started = false;
  private hydrating = false;

  private pendingAnnounce = 0;
  private announceTimer: ReturnType<typeof setTimeout> | null = null;
  private digestRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private mmRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  // ---------- subscription ----------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  /** Coalesce notifications so ~20 events/s bursts render in batches. */
  private notify(): void {
    if (this.notifyTimer !== null) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.version += 1;
      for (const listener of this.listeners) listener();
    }, NOTIFY_COALESCE_MS);
  }

  // ---------- lifecycle ----------

  start(): void {
    if (this.started) return;
    this.started = true;

    this.state.route = parseHash(window.location.hash);
    window.addEventListener("hashchange", () => {
      this.state.route = parseHash(window.location.hash);
      window.scrollTo(0, 0);
      this.notify();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void this.hydrate();
        if (!this.es || this.es.readyState === EventSource.CLOSED) this.openStream();
      }
    });

    setInterval(() => {
      this.state.tick += 1;
      this.notify();
    }, 4000);

    setInterval(() => void this.pollStatus(), STATUS_POLL_MS);
    setInterval(() => void this.refreshRecords(), DECISIONS_REFRESH_MS);

    void this.hydrate().then(() => this.openStream());
  }

  navigate(route: Route): void {
    window.location.hash = routeToHash(route);
  }

  // ---------- hydration ----------

  private async hydrate(): Promise<void> {
    if (this.hydrating) return;
    this.hydrating = true;
    try {
      // Cheap first paint: /health + /status together.
      const [health, statusRaw] = await Promise.all([fetchHealth(), fetchStatus()]);
      this.applyHealth(health);
      this.applyStatus(statusRaw);
      if (this.state.connection === "dead") this.state.connection = this.es ? "live-sse" : "polling";
      this.notify();

      void this.refreshMm();
      const [decisions, settlements, reviews, digest] = await Promise.all([
        fetchDecisions(DECISION_LIMIT),
        fetchSettlements(),
        fetchReviews(),
        fetchDigest(this.state.windowDays),
      ]);
      for (const d of decisions) this.upsertDecision(d);
      for (const s of settlements) this.upsertSettlement(s);
      for (const r of reviews) this.upsertReview(r);
      // Pre-agent /digest returns only { phase } — cache real digests only.
      if (Array.isArray(digest?.strategies)) this.state.digests.set(digest.windowDays, digest);
      if (!this.seededFeed) this.seedFeed();
      this.notify();
    } catch {
      this.state.connection = "dead";
      this.notify();
    } finally {
      this.hydrating = false;
    }
  }

  /** Seed the feed from history so the page shows life immediately on load. */
  private seedFeed(): void {
    this.seededFeed = true;
    const items: FeedItem[] = [];
    for (const d of this.state.decisions.values()) {
      items.push({ key: `d:${d.hash}`, type: "decision", ts: d.decidedAtTs, hash: d.hash });
    }
    for (const s of this.state.settlements.values()) {
      items.push({
        key: `s:${s.decisionHash}`,
        type: "settlement",
        ts: s.settledAtTs,
        hash: s.decisionHash,
      });
    }
    for (const r of this.state.reviews) {
      items.push({ key: `r:${r.hash}`, type: "review", ts: r.generatedAtTs, payload: r });
    }
    items.sort((a, b) => b.ts - a.ts);
    this.state.feed = items.slice(0, 60);
    for (const item of this.state.feed) this.seenFeedKeys.add(item.key);
  }

  private applyHealth(health: Health): void {
    this.state.health = health;
    this.state.phase = health.phase;
  }

  private applyStatus(raw: unknown): void {
    if (!isAgentStatus(raw)) {
      const phase = (raw as { phase?: unknown } | null)?.phase;
      if (typeof phase === "string") this.state.phase = phase;
      return;
    }
    const prev = this.state.status;
    this.state.status = raw;
    this.deriveVetoes(raw.recentVetoes ?? []);
    // Agent restart: process rebuilt its state from the ledger — rehydrate.
    if (prev && prev.startedAtTs !== raw.startedAtTs) void this.hydrate();
  }

  /** VETO feed events are poll-derived from /status.recentVetoes. */
  private deriveVetoes(vetoes: VetoRecord[]): void {
    if (!this.vetoBaselineDone) {
      // Pre-existing vetoes stay in the right rail only; don't replay them
      // into the feed on first load (mirrors the prototype's behavior).
      for (const v of vetoes) this.seenVetoKeys.add(this.vetoKey(v));
      this.vetoBaselineDone = true;
      return;
    }
    for (const v of vetoes) {
      const key = this.vetoKey(v);
      if (this.seenVetoKeys.has(key)) continue;
      this.seenVetoKeys.add(key);
      this.boundSet(this.seenVetoKeys);
      this.pushFeed({ key: `v:${key}`, type: "veto", ts: v.ts, payload: v });
    }
  }

  private vetoKey(v: VetoRecord): string {
    return `${v.ts}:${v.strategy}:${v.reason}:${v.marketKey}`;
  }

  // ---------- record upserts (idempotent; records upgrade) ----------

  private upsertDecision(d: DecisionRecord): void {
    const existing = this.state.decisions.get(d.hash);
    // Never lose a commitTxSig upgrade to a staler snapshot.
    if (existing?.commitTxSig && !d.commitTxSig) {
      this.state.decisions.set(d.hash, { ...d, commitTxSig: existing.commitTxSig });
    } else {
      this.state.decisions.set(d.hash, d);
    }
  }

  private upsertSettlement(s: SettlementRecord): void {
    const existing = this.state.settlements.get(s.decisionHash);
    if (existing?.commitTxSig && !s.commitTxSig) {
      this.state.settlements.set(s.decisionHash, { ...s, commitTxSig: existing.commitTxSig });
    } else {
      this.state.settlements.set(s.decisionHash, s);
    }
  }

  private upsertReview(r: MatchReview): void {
    const idx = this.state.reviews.findIndex((x) => x.hash === r.hash);
    if (idx === -1) this.state.reviews.push(r);
    else this.state.reviews[idx] = r;
  }

  // ---------- feed ----------

  /** Trim a dedupe set to its most-recent entries (JS Sets keep insertion
   * order, so the first entries are the oldest). */
  private boundSet(set: Set<string>): void {
    if (set.size <= SEEN_KEYS_CAP) return;
    const drop = set.size - Math.floor(SEEN_KEYS_CAP * 0.8);
    const it = set.values();
    for (let i = 0; i < drop; i++) {
      const next = it.next();
      if (next.done) break;
      set.delete(next.value);
    }
  }

  private pushFeed(item: FeedItem): void {
    if (this.seenFeedKeys.has(item.key)) return;
    this.seenFeedKeys.add(item.key);
    this.boundSet(this.seenFeedKeys);
    if (this.state.paused) {
      this.state.buffer.unshift(item);
    } else {
      this.state.feed.unshift(item);
      if (this.state.feed.length > FEED_CAP) this.state.feed.length = FEED_CAP;
    }
    this.queueAnnounce();
    this.notify();
  }

  private queueAnnounce(): void {
    this.pendingAnnounce += 1;
    if (this.announceTimer !== null) return;
    this.announceTimer = setTimeout(() => {
      const n = this.pendingAnnounce;
      this.pendingAnnounce = 0;
      this.announceTimer = null;
      this.state.announce = `${n} new event${n > 1 ? "s" : ""} in the agent feed`;
      this.notify();
    }, ANNOUNCE_THROTTLE_MS);
  }

  togglePause(): void {
    if (this.state.paused) {
      this.state.feed = [...this.state.buffer, ...this.state.feed].slice(0, FEED_CAP);
      this.state.buffer = [];
    }
    this.state.paused = !this.state.paused;
    this.notify();
  }

  // ---------- SSE ----------

  private openStream(): void {
    // DEMO mode has no backend to stream from — the bundled fixtures are
    // static, so we stay on the (harmless) poll loop and skip SSE entirely.
    if (DEMO_MODE) {
      this.state.connection = "polling";
      this.notify();
      return;
    }
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    let es: EventSource;
    try {
      es = new EventSource(streamUrl());
    } catch {
      this.startFallbackPolling();
      return;
    }
    this.es = es;

    es.onopen = () => {
      this.sseErrors = 0;
      this.state.connection = "live-sse";
      this.stopFallbackPolling();
      this.notify();
    };

    es.onerror = () => {
      this.sseErrors += 1;
      if (es.readyState === EventSource.CLOSED || this.sseErrors >= 3) {
        es.close();
        if (this.es === es) this.es = null;
        this.startFallbackPolling();
        this.scheduleSseRetry();
      }
    };

    const handle = (raw: MessageEvent): void => {
      let envelope: StreamEnvelope;
      try {
        envelope = JSON.parse(raw.data as string) as StreamEnvelope;
      } catch {
        return; // tolerate malformed frames
      }
      this.state.lastStreamTs = Date.now();
      this.ingest(envelope);
    };
    // The server emits named SSE events — listen per type, not onmessage.
    es.addEventListener("decision", handle);
    es.addEventListener("settlement", handle);
    es.addEventListener("review", handle);
    es.addEventListener("status", handle);
    // Maker activity: mark the stream alive and debounce a /mm refetch (the
    // book detail is served whole by /mm, so we don't reconstruct it here).
    const makerHandle = (): void => {
      this.state.lastStreamTs = Date.now();
      this.scheduleMmRefresh();
    };
    es.addEventListener("mm_fill", makerHandle);
    es.addEventListener("mm_book", makerHandle);
  }

  private ingest(envelope: StreamEnvelope): void {
    const { type, ts, data } = envelope;
    if (type === "decision") {
      const d = data as DecisionRecord;
      if (typeof d?.hash !== "string") return;
      this.upsertDecision(d);
      this.pushFeed({ key: `d:${d.hash}`, type: "decision", ts, hash: d.hash });
    } else if (type === "settlement") {
      const s = data as SettlementRecord;
      if (typeof s?.decisionHash !== "string") return;
      this.upsertSettlement(s);
      this.pushFeed({ key: `s:${s.decisionHash}`, type: "settlement", ts, hash: s.decisionHash });
      this.scheduleDigestRefresh();
    } else if (type === "review") {
      const r = data as MatchReview;
      if (typeof r?.hash !== "string") return;
      this.upsertReview(r);
      this.pushFeed({ key: `r:${r.hash}`, type: "review", ts, payload: r });
      this.scheduleDigestRefresh();
    } else if (type === "status") {
      const payload = data as FeedStatusEvent;
      this.pushFeed({ key: `st:${ts}:${payload?.message ?? ""}`, type: "status", ts, payload });
    }
    // Unknown event types: ignored silently (contract grows).
    this.notify();
  }

  private scheduleSseRetry(): void {
    if (this.sseRetryTimer !== null) return;
    this.sseRetryTimer = setTimeout(() => {
      this.sseRetryTimer = null;
      // Only retry if no stream is currently open/connecting.
      if (this.es && this.es.readyState !== EventSource.CLOSED) return;
      this.sseErrors = 0;
      this.openStream();
    }, SSE_RETRY_MS);
  }

  // ---------- polling ----------

  private async pollStatus(): Promise<void> {
    try {
      const [health, statusRaw] = await Promise.all([fetchHealth(), fetchStatus()]);
      this.applyHealth(health);
      this.applyStatus(statusRaw);
      void this.refreshMm();
      if (this.state.connection === "dead") {
        this.state.connection = this.es && this.es.readyState === EventSource.OPEN ? "live-sse" : "polling";
        void this.hydrate();
      }
      this.notify();
    } catch {
      if (!this.es || this.es.readyState !== EventSource.OPEN) {
        this.state.connection = "dead";
        this.notify();
      }
    }
  }

  /** Re-fetch decisions + settlements: catches commitTxSig upgrades, which
   * are never re-published on the stream. */
  private async refreshRecords(): Promise<void> {
    try {
      const [decisions, settlements] = await Promise.all([
        fetchDecisions(DECISION_LIMIT),
        fetchSettlements(),
      ]);
      for (const d of decisions) this.upsertDecision(d);
      for (const s of settlements) this.upsertSettlement(s);
      this.notify();
    } catch {
      // status poll owns dead-state detection
    }
  }

  private startFallbackPolling(): void {
    if (this.state.connection !== "dead") this.state.connection = "polling";
    this.notify();
    if (this.fallbackPollTimer !== null) return;
    this.fallbackPollTimer = setInterval(() => {
      void this.pollStatus();
      void this.refreshRecords();
    }, FALLBACK_POLL_MS);
  }

  private stopFallbackPolling(): void {
    if (this.fallbackPollTimer !== null) {
      clearInterval(this.fallbackPollTimer);
      this.fallbackPollTimer = null;
    }
  }

  private scheduleDigestRefresh(): void {
    if (this.digestRefreshTimer !== null) return;
    this.digestRefreshTimer = setTimeout(() => {
      this.digestRefreshTimer = null;
      void this.refreshDigest(this.state.windowDays);
    }, 2000);
  }

  private async refreshDigest(days: number): Promise<void> {
    try {
      const digest = await fetchDigest(days);
      if (Array.isArray(digest?.strategies)) {
        this.state.digests.set(digest.windowDays, digest);
        this.notify();
      }
    } catch {
      // non-fatal; digest stays cached
    }
  }

  /** Pull the maker's live book. The /mm payload carries everything the
   * market-making view needs (snapshot + fills + on-chain commits), so the
   * view is a pure function of it — no client-side book reconstruction. */
  private async refreshMm(): Promise<void> {
    try {
      const mm = await fetchMm();
      this.state.mm = mm;
      this.notify();
    } catch {
      // non-fatal; the last snapshot stays on screen
    }
  }

  /** Coalesce the burst of mm_fill/mm_book stream events into one refetch. */
  private scheduleMmRefresh(): void {
    if (this.mmRefreshTimer !== null) return;
    this.mmRefreshTimer = setTimeout(() => {
      this.mmRefreshTimer = null;
      void this.refreshMm();
    }, 1200);
  }

  // ---------- UI actions ----------

  setFilters(filters: LedgerFilters): void {
    this.state.filters = filters;
    this.notify();
  }

  /** Drill path helper: set filters, then go to the ledger. */
  goLedgerFiltered(strategy: string, status: string): void {
    this.state.filters = { strategy, status };
    this.navigate({ name: "ledger" });
  }

  setWindowDays(days: number): void {
    this.state.windowDays = days;
    this.notify();
    if (!this.state.digests.has(days)) void this.refreshDigest(days);
  }

  toggleRaw(): void {
    this.state.showRaw = !this.state.showRaw;
    this.notify();
    if (this.state.showRaw && this.state.rawJson === null) {
      void fetchTrackRecord()
        .then((tr) => {
          this.state.rawJson = JSON.stringify(tr, null, 2);
          this.notify();
        })
        .catch(() => {
          this.state.rawJson = "// GET /track-record failed — the API may be unreachable. Retrying on next open.";
          this.notify();
        });
    }
    // Re-fetch next time it opens so the export stays fresh.
    if (!this.state.showRaw) this.state.rawJson = null;
  }
}

export const store = new SharpeStore();

/** React hook: re-renders on store changes; read state from the returned object. */
export function useStore(): StoreState {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store.state;
}

export { COPY_FLASH_MS };
