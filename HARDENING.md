# HARDENING.md — Pre-P3 Hardening Brief (items 0–3, in order)

**What this is:** four small, high-leverage work items distilled from a full external-repo research pass,
specified against this codebase as it exists today. Each is a pattern re-implemented in our own
TypeScript — **no new runtime dependencies, no cloned code, no frameworks.** Sources of the ideas
(mcp-agent's durable execution, VoltAgent's observability envelope, hermes-agent's insights engine)
are referenced for credit only; nothing in them is liftable code for us.

**Laws (from CLAUDE.md, non-negotiable):**
- Never touch the decision path: `src/model/`, `src/strategy/`, `src/risk/` stay byte-identical.
- Everything new is deterministic; persisted records get canonical hashing (`canonicalJson` idiom).
- Keep all 17 existing tests green; each item adds its own tests.
- Follow existing idioms: append-only NDJSON with amend lines (`track/store.ts`), plain `node:http`
  (`api/server.ts`), no new deps.
- One commit per item, in this order — item 0 first, it's the cheapest and item 1's demo story
  depends on it.

---

## Item 0 — Rebuild intelligence state on boot (~15 lines + test)

**Problem (verified):** `Agent` constructor (`services/agent/src/agent.ts`) rebuilds only open
exposure from the track record. `CalibrationTracker`, `AllocationEngine`, and `SuspensionMonitor`
start empty on every restart — calibration factor, UCB weights, and SPRT states silently reset.
This contradicts PLAN §5.2 ("replay journal → rebuild exact state") and would be visible on camera
during the `kill -9` demo move (allocations snap back to defaults).

**Fix:** in the `Agent` constructor, after `TrackStore` loads: iterate all settlements in
deterministic order (`settledAtTs` asc, tie-break `decisionHash` lexicographic), join each to its
decision via `track.decisions.get(settlement.decisionHash)`, and replay through the exact same
three calls `settleFixture` already makes:
- `this.calibration.add({ modelProb, marketProb, won })`
- `if (decision.stakeUsdc > 0) this.allocation.recordSettlement(strategy, pnlUsdc, stakeUsdc)`
- `this.suspension.recordSettlement(strategy, modelProb, won)`

**Acceptance test:** run a replay that settles decisions; snapshot `status()` (allocations,
calibration, suspensions). Construct a fresh `Agent` over the same track dir with no new events;
`status()` intelligence fields must match the snapshot exactly.

---

## Item 1 — Write-ahead commit checkpoint + boot reconcile (the core reliability fix)

**Problem (verified in `src/exec/commit.ts` + `agent.ts`):**
1. The commit queue is in-memory; after 3 failed attempts a commitment is **silently lost forever**.
2. A crash between `sendRawTransaction` and the journal amend orphans an on-chain commitment the
   record never references.
3. Settlement and review commits are fired with `void` and their signatures are thrown away —
   `SettlementRecord.commitTxSig` exists in the type but is **never set** anywhere.

"Commit before outcome" is the product's identity; a silently dropped commitment looks exactly like
a faked record. This item protects the core claim and makes `kill -9` safe.

**Design (write-ahead intent journal, reconcile on boot):**
- New file `commits.ndjson` in the track dir, same append-only idiom as `store.ts`:
  - intent line: `{ kind, hash, sig, blockhash, lastValidBlockHeight, ts, status: "intent" }`
  - confirm amend: `{ sig, status: "confirmed", ts, amend: true }`
  - expire amend: `{ sig, status: "expired", ts, amend: true }`
- `ChainCommitter.send`: build **and sign** the tx first — the signature is available pre-broadcast
  (base58 of the fee payer's signature over the message) — append the intent line, **then**
  `sendRawTransaction`, confirm, append the confirm line.
- Boot reconcile (new `ChainCommitter.reconcile()` called from `main.ts` before the loop starts):
  for every intent with no confirm/expire amend →
  `connection.getSignatureStatuses([sig], { searchTransactionHistory: true })`:
  - landed → append confirm line + backfill the record (`updateDecisionCommit` / new settlement
    equivalent);
  - not landed and blockhash expired (`getBlockHeight("confirmed") > lastValidBlockHeight`) →
    append expire line and re-enqueue a fresh commit for that `{kind, hash}`.
- Idempotency key is `kind:hash` — never send a second commit for a pair that has a confirmed line.
- Retry policy change: after 3 in-process attempts, the commitment stays pending in the journal
  (retried on a timer and on next boot) — **never dropped**.
- `agent.ts`: capture settlement/review signatures — add `TrackStore.updateSettlementCommit(hash, sig)`
  (amend-line idiom, mirrors `updateDecisionCommit`) and stop `void`-ing those promises' results.

**Acceptance tests:**
- Simulated crash after intent-write but before send → restart → reconcile marks expired and
  resubmits exactly once (mock connection).
- Simulated crash after send-landed but before confirm-write → restart → reconcile finds it landed,
  backfills the record, does **not** resubmit.
- Settlement records now carry `commitTxSig` after chain-mode settle.

*Idea credit: durable-execution write-ahead activity markers (lastmile-ai/mcp-agent / Temporal).
Do not clone it — Python, framework-coupled; the design above is complete.*

---

## Item 2 — Live brain feed: `/stream` SSE endpoint (demo-critical)

**Problem:** `api/server.ts` is poll-only. The demo video's spine is "watch the agent think" —
that needs push, not refresh.

**Design (typed envelope + filters, over SSE — NOT WebSocket):**
- `GET /stream` on the existing `node:http` server. Headers: `Content-Type: text/event-stream`,
  `Cache-Control: no-store`, CORS as today. **No `ws` dependency — we are SSE-native end to end,
  mirroring TxLINE's own delivery (docs line: "SHARPE broadcasts its brain the same way TxLINE
  broadcasts matches").**
- Event format: `event: decision|settlement|review|status`, `id: <ts>:<n>` (monotonic, mirrors
  TxLINE's id shape), `data: {"type": ..., "ts": ..., "data": <record>}`.
- Filters via query params, server-side: `?strategy=S1_COHERENCE`, `?fixtureId=123` (both optional,
  AND-ed).
- Heartbeat: comment line (`: hb`) every 15s so proxies keep the socket open.
- Resume: keep an in-memory ring buffer of the last 500 events; on connect with `Last-Event-ID`,
  replay everything after it before going live.
- Wiring: add a minimal emitter to `Agent` (array of subscriber callbacks, fired where it already
  calls `this.track.addDecision/addSettlement/addReview`); `api/server.ts` subscribes. No event-bus
  library.
- `dashboard.html`: switch to `EventSource` with the existing polling kept as fallback.

**Acceptance tests:** during a replay run, `curl -N /stream` shows live events; reconnecting with
`Last-Event-ID` replays missed events exactly once; `?strategy=` filter excludes other strategies.

*Idea credit: VoltAgent's observability envelope (`{type, success, data}` + entity filters).
Do not clone it — its console is closed-source and its transport choice doesn't fit us.*

---

## Item 3 — Windowed digest + strategy inactivity flags

**Problem (verified):** `review.ts` is per-match only; `TrackStore.aggregates()` is all-time totals.
During the judging window the agent runs live 24/7 on friendlies — a judge needs a "season so far"
view. Separately, SPRT/UCB update **only on settlements**: a strategy that goes silent accumulates
zero evidence and is never flagged.

**Design:**
- New `src/intelligence/digest.ts`: pure function
  `buildDigest(track: TrackStore, nowTs: number, windowDays: number)` →
  per-strategy `{ n, wins, hitRate, stakedUsdc, pnlUsdc, roi, brier, meanEdge, lastDecisionTs,
  lastSettlementTs, activity: "active" | "quiet" | "stale" }` + overall totals + per-day buckets
  (for trend rendering). Brier from `decision.modelProb` vs `settlement.won`. Deterministic;
  hash the body with `canonicalJson` exactly like `MatchReview`.
- Inactivity rule (observational ONLY — never gates the engine): 0 decisions in 7 days → `quiet`;
  0 in 21 days → `stale`. Surfaces in the digest and `/status`; the decision path is untouched.
- API: `GET /digest?days=30` (default 30, also accept 7); include a one-line digest summary in
  `/status`.
- Optional (nice, cheap): commit the digest hash on-chain — add `"digest"` to the `CommitKind`
  union in `exec/commit.ts`.

**Acceptance tests:** synthetic settled history → window math verified by hand-computed values;
same inputs → identical hash (determinism); a strategy with no decisions inside the window is
flagged `quiet`/`stale` per rule.

*Idea credit: hermes-agent's `InsightsEngine.generate(days)` shape. Do not clone it — Python,
private UI kit; the spec above is complete.*

---

## Explicitly out of scope here
- **ogion** (encrypted offsite backups of `data/track` + `data/recordings`, NEVER `_keys/`) — one
  docker-compose service, added at deployment time (P6), not now.
- **assistant-ui** interrogation panel — cut unless the demo script has slack after P5's four core
  surfaces exist.
- Anchor programs (P3) — separate spike per PLAN; references are `vendor/tx-on-chain`,
  solana-program-library escrow/stake-pool, Drift/Kamino vault patterns.
