# SHARPEFRONTEND.md — The Frontend Source of Truth

> **Who this is for:** our frontend designer/developer.
> **What it is:** everything you need to understand SHARPE completely — product, users,
> domain, functionality, data contracts, states, flows, quality bars — so you can design
> and build the frontend with near-zero functional ambiguity.
> **What it deliberately is NOT:** a design spec. Nothing here prescribes colors,
> typography, layout, components, animation, icons, visual hierarchy, or design language.
> You are the design authority. Where this document names "screens" or "surfaces," it
> defines *information and actions*, never presentation — whether something becomes a
> page, panel, tab, modal, or anything else is entirely your call.

---

# PART I — THE PRODUCT

## 1. What SHARPE is

**Identity line:** *SHARPE — the autonomous sports trading agent with an unfakeable public track record.*

SHARPE is a fully autonomous trading system. It watches live football (soccer) matches
through **TxLINE** (TxODDS' real-time sports data layer: scores, match events, and
consensus odds, cryptographically anchored on the Solana blockchain). It computes the
mathematically fair price of match outcomes; when the market's price disagrees with its
model beyond a threshold, it opens a position in USDC. It sizes positions with disciplined
bankroll math, settles them when matches end, learns from the results, and repeats —
24/7, with zero human input after launch.

The loop, which is also our product mantra:
**decide → commit on-chain → outcome lands → Merkle-proof settle → learn from proven facts → repeat**

## 2. The problem it solves

Two trust problems define this industry, and SHARPE attacks both:

1. **Performance claims in trading/betting are unfalsifiable.** Tipsters cherry-pick
   screenshots. Bots delete losing runs. "Verified" track records are hosted by whoever
   profits from them. A documented scam collected $3.7M in subscriptions on fabricated
   results. There is currently *no way* for a skilled trader to prove — and no way for a
   customer to check — that a track record is real and complete.
2. **Even "decentralized" settlement depends on humans.** Prediction markets resolve
   through oracle committees, dispute windows, and admin keys. The referee is still a
   person.

SHARPE's answer, mechanically:
- Every decision's cryptographic hash is written to Solana **before the outcome exists**
  → nothing can be backdated, edited, or quietly deleted. The bad days are as permanent
  as the good ones.
- Every settlement is verified by submitting a **Merkle proof of the final match stats to
  a program on Solana** (TxLINE's `validateStatV2`), which checks it against the data
  root TxODDS anchored on-chain. **If the proof doesn't verify, money does not move.**
  No oracle committee, no dispute window, no human judgment anywhere in the loop.

## 3. Why we're building it — the vision

Near-term: win the TxODDS World Cup Hackathon, **Track 2: Trading Tools & Agents**
(judging criteria are in `judge.md`; the frontend is a major part of how judges
experience the product).

The real goal: a market product. Today SHARPE is one agent trading paper money on Solana
devnet with a provable record. The trajectory: the same agent with real on-chain
commitments → **the agent's bankroll** (outsiders deposit USDC and ride its performance,
non-custodially) → **third-party strategists** (anyone can run a strategy on our
accountability rails; every one of them inherits the same unfakeable track record) →
mainnet. The long-term bet: *provable performance becomes the standard the whole
category is judged by*, and SHARPE is the reference implementation.

## 4. Product philosophy (internalize these — they resolve ambiguities better than any spec)

1. **Radical transparency IS the product.** The API is public, read-only, unauthenticated
   — on purpose. Anything that hides, delays, or softens a bad number is a product bug.
   Losses get exactly the same prominence as wins.
2. **The agent is the protagonist.** Everything on screen is something *the agent did,
   decided, refused, or learned*. We never present SHARPE as an exchange, a platform, or
   infrastructure.
3. **Glass box, not black box.** Every action carries its own plain-English explanation,
   written by the agent itself at decision time. The frontend never has to invent copy
   for why something happened — it has to *surface* the agent's own reasoning faithfully.
4. **Determinism is sacred.** Same input → same decision → same hash, bit-for-bit,
   provable by test. The frontend reflects this: what it shows is reconstructable fact,
   never approximation.
5. **Proof over promise.** Wherever a claim can link to its evidence (an on-chain
   transaction, a verified proof, a recomputable hash), the evidence must be reachable.
   The deep verification path must exist for experts and never be required for
   understanding.
6. **Nothing half-baked.** A smaller surface done completely beats a larger one with
   stubs. (This is a repo-wide law from `CLAUDE.md`; it applies to the frontend too.)

## 5. Positioning, voice, and legal constraints

- **Vocabulary we use:** positions, trades, decisions, settlements, track record, edge,
  the agent's bankroll.
- **Vocabulary we avoid:** *bet/betting/gambling* (legal exposure + wrong identity),
  *platform/protocol/exchange* (violates the framing law — agent first, always).
- **Required disclaimer**, persistent somewhere reasonable, verbatim:
  *"SHARPE is a technology demonstration on Solana devnet using TxLINE data. Nothing here
  is gambling services or financial advice."*
- Credit line where appropriate: data by **TxLINE / TxODDS**; settlement on **Solana**.
- Tone of any microcopy you do write: precise, calm, confident, zero hype. The numbers do
  the selling. (See §21 for formatting semantics.)

---

# PART II — USERS

## 6. Target audience & personas

**Persona 1 — "The Judge" (primary until submission; the demo video is scored heavily).**
A trading/data engineer at TxODDS evaluating hackathon entries. Deeply expert in sports
data and market mechanics; allergic to vaporware; reviews dozens of projects fast.
- *Goal:* determine in minutes whether this agent is real, autonomous, intelligent, and
  production-grade.
- *Key tasks:* land on the URL → see the agent alive and thinking; open any decision and
  understand exactly why it acted; follow one settlement to its on-chain proof; skim the
  season scorecard; confirm it recovers from failure.
- *Critical context:* judging happens **after the World Cup ends** — there may be no live
  match during review. Replay of real matches must feel first-class, and live-vs-replay
  labeling must be unmissably honest.
- *Failure mode to avoid:* anything that looks like a mockup, anything requiring
  explanation from us, any claim without a clickable evidence path.

**Persona 2 — "The Quant" (post-launch core user).**
A professional sports trader/quant evaluating whether the agent is *good*.
- *Goal:* judge skill, not story: calibration vs the market, per-strategy ROI and Brier,
  drawdown, edge distribution, how sizing responds to performance decay.
- *Key tasks:* interrogate the digest; filter history by strategy/market/fixture; verify
  the record isn't survivorship-biased (open positions and vetoes visible); export-level
  access to raw records (`/track-record` exists for this).
- *Failure mode:* any whiff of marketing spin over statistics.

**Persona 3 — "The Allocator" (roadmap; design decisions today shouldn't foreclose this).**
Crypto-native user considering depositing USDC into the agent's bankroll when the vault
ships.
- *Goal:* understand risk honestly — worst drawdown, suspension history, what happens to
  deposits when strategies get benched.
- *Not in v1:* no deposit flows, no wallet connect. But the information architecture you
  choose should leave a natural home for "my stake in the agent" later.

**Persona 4 — "The Observer."**
Crypto-curious visitor who arrived from the repo or a demo link.
- *Goal:* get "the track record can't be faked" in under a minute without knowing what a
  Merkle tree is.
- *Need:* a self-explanatory trust story (§13, the About surface) and evidence that's
  *visible* even when not understood in depth.

## 7. User roles & permissions

**v1 has exactly one role: the anonymous public reader.** There are no accounts, no
logins, no sessions, no cookies required, no personalization, and — critically — **no
write operations of any kind** reachable from the frontend. The API is read-only by
design; there is nothing destructive to guard, and nothing privileged to gate. Operator
actions (starting/stopping the agent, changing modes) happen at the deployment level and
must NOT be exposed in the frontend.

**Future roles (roadmap, do not build):** wallet-connected depositor (vault deposits/
withdrawals — the first write surface and the first real permission boundary);
strategist (third-party agent operators). Keep them in mind only as "this product will
one day have a signed-in state."

## 8. Authentication flow

**None in v1 — deliberately.** No signup, no login, no API keys in the client. This is a
product statement (radical transparency), not an omission. The only "auth-like" concept
anywhere is on the roadmap: wallet connect (e.g., Solana wallet adapter) for the future
vault. Do not scaffold it now.

---

# PART III — THE DOMAIN (concepts you must be fluent in)

Every field in the API maps to one of these. Read twice.

- **Fixture** — one match. Numeric id (e.g. `18241006` = the England–Argentina World Cup
  semifinal in our recorded corpus). Two participants; participant 1 / participant 2 map
  to home/away by feed convention. The corpus: **20 complete real World Cup knockout
  matches** recorded for replay.
- **Market & family** — a tradeable question about a fixture. SHARPE trades exactly three
  families, all full-match: `WIN_DRAW_WIN` (labels may arrive as `1/x/2` or
  `part1/draw/part2`), `TOTAL_GOALS` (over/under a half-line like 2.5 — the agent refuses
  integer/quarter lines because they can't settle as a single binary proof), and
  `BOTH_TEAMS_SCORE` (yes/no). Raw `marketKey` strings look like
  `"OVERUNDER_PARTICIPANT_GOALS||line=2.5"`.
- **Decision** — the atomic unit of the product. The agent backing one outcome at a
  stake. Carries: strategy, model probability vs market-implied probability, **edge**
  (their difference — "why we acted", in probability points), stake (USDC), decimal
  price, a **plain-English reason sentence written by the agent**, full input provenance
  (which score record, which odds message, model parameters), sizing internals (Kelly
  fraction, calibration factor, allocation weight, bankroll), and its canonical SHA-256
  **hash**.
- **Commitment** — the decision hash written to Solana BEFORE the outcome
  (`commitTxSig`). Arrives seconds after the decision itself (records *upgrade* after
  first appearance). A committed decision is provably not backdated.
- **Strategies** — three deterministic ones; their ids appear on every decision:
  - `S1_COHERENCE`: trades markets that disagree with the jointly-fitted model — pure cross-market arithmetic.
  - `S2_REACTION`: after a goal/red card, trades quotes that lag the repricing. The most dramatic; reasons state how stale the quote was and how far the model moved.
  - `S3_CONVERGENCE`: fades quotes that drifted from consensus without any match event.
- **Veto** — a trade the agent *considered and refused*, with the reason (risk gates:
  stale quote, exposure caps, drawdown breaker, stake too small). The agent's restraint,
  made visible.
- **Settlement** — a decision's resolution once its match is finalised: `won`, signed
  `pnlUsdc`, the final score, and **verification** — the on-chain Merkle proof check
  (see below). One settlement per decision.
- **Verification** — `{ method: "validateStatV2", verified: boolean, statKeys, seq }`.
  `verified: true` = the outcome was cryptographically checked against the on-chain root:
  the settlement is *fact*. Absent = paper-mode settle without a validator (honest,
  lesser guarantee). `verified: false` = the proof failed; **the position stays open and
  retries** — money never moves on unverified data. Three distinct truths; never conflate.
- **Shadow decision** — `stakeUsdc: 0`, produced by a suspended strategy proving itself
  back to health. Fully visible, clearly distinct from real stakes.
- **Calibration** — rolling Brier-score comparison of the model's predictions vs the
  market's, over settled decisions. Surfaces as `factor` (0.25–1.25): below 1 means the
  agent has detected its own edge decaying and is automatically shrinking every stake.
  The single most honest number in the system.
- **Allocations** — the agent's live capital split across S1/S2/S3 (fractions summing to
  1), re-derived continuously from realized ROI (UCB algorithm).
- **SPRT / suspension** — a per-strategy sequential statistical test. A strategy whose
  real win rate falls below what its own probabilities promised gets `suspended: true`
  (shadow-only) until it re-qualifies. *The agent fires itself before a human would.*
- **Review** — the agent's public post-match self-assessment: predicted vs realized hit
  rate, per-strategy P&L, and its own notes (e.g. "overconfident this match"). Hashed and
  committable on-chain like decisions.
- **Digest** — the season-so-far scorecard over a window (7/30 days): per-strategy stats
  plus an `activity` flag (`active` / `quiet` = no decisions in 7 days / `stale` = 21).
- **Track record** — all of the above, append-only, event-sourced, independently auditable.
- **Feed modes** — `live` (real TxLINE streams) vs `replay` (recorded real matches pushed
  through the *identical* pipeline — same code, same decisions; it IS the agent, on
  recorded input). **Exec modes** — `paper` vs `chain` (real on-chain commitments +
  proof-gated settlement).
- **Equity vs realized** — `equityUsdc` = cash on hand (realized minus stakes currently
  escrowed in open positions). `realizedUsdc` = bankroll + all settled P&L — the honest
  "how is it doing" number. `peakRealizedUsdc` = its high-water mark (drawdown context).

---

# PART IV — FUNCTIONAL SCOPE

## 9. Complete feature breakdown (what the frontend must let users do)

F1. **See the agent alive** — mode (network/feed/exec), phase, uptime, feed liveness
    (last event age, events seen), fixtures currently tracked, at a glance.
F2. **Watch the brain live** — decisions, settlements, reviews, and feed-status events
    appearing in real time as they happen (push, not refresh), including during replays.
F3. **Read any decision in full** — every field of the record: the reason sentence, model
    vs market probability and edge, stake/price/sizing internals, provenance inputs,
    hash, commitment status + explorer link.
F4. **Follow a decision's lifecycle** — open position → settlement (won/lost, P&L,
    final score) → the proof verification status → the match's self-review.
F5. **Audit the track record** — full history of decisions and settlements with
    filtering (at minimum by strategy, fixture, and settled/open/shadow status),
    plus honest aggregates (staked, P&L, win rate, open count).
F6. **Judge performance like a quant** — the digest: per-strategy n/wins/hit-rate/
    staked/P&L/ROI/Brier/mean-edge, activity flags, per-day buckets for trends, overall
    totals; window switch (7/30 days).
F7. **See the agent's self-regulation** — calibration factor and its meaning, live
    allocations, suspension states, shadow decisions, and recent vetoes with reasons.
F8. **Verify** — for any decision/settlement: copy the full hash, open the commitment
    transaction on Solana Explorer (devnet), and see the proof-verification facts
    (statKeys, seq, verified). Plus the global anchors: TxLINE devnet program id and our
    on-chain subscription tx (§20).
F9. **Understand the product** — a self-contained "how this works / why you can't fake
    this" explanation for Persona 4 (content outline in §13).
F10. **Read a match's story** — everything the agent did on one fixture, in order:
    decisions → settlements → review, with final score.
F11. **Know the mode honestly** — live vs replay vs waiting states always truthfully
    labeled; "replay of real match data" is a first-class, non-apologetic mode.
F12. **Health** — a plain liveness answer (phase, uptime) — judges will check it.

## 10. Screen inventory — functional surfaces (presentation entirely yours)

These are *information scopes with tasks*, not pages. Merge, split, nest, or rename them
as your design dictates.

| # | Surface | Must contain (information) | Must afford (actions) |
|---|---|---|---|
| A | **Command view** (default landing) | agent vitals (mode, phase, equity/realized/peak, aggregates, calibration factor, allocations, digest one-liner `digestSummary`), live event feed, feed liveness | jump to any event's detail; reach every other surface; pause/resume the live feed rendering (data keeps flowing underneath) |
| B | **Decision detail** | the complete decision record (§F3) + its settlement if settled + link to its fixture story and strategy history | copy hash; open explorer link; navigate to fixture/strategy contexts |
| C | **Track record / ledger** | filterable, ordered history of decisions + settlements; aggregates for current filter; open positions distinctly queryable; shadow decisions distinguishable | filter (strategy, fixture, open/settled/shadow, won/lost); reach decision detail; reach `/track-record` raw JSON (the auditor's export) |
| D | **Performance / digest** | everything in §F6; suspension states; per-day trend data | switch window (7/30); drill from a strategy row into its filtered ledger |
| E | **Fixture story** | one match: participants (ids), final score once known, every decision/settlement/review on it in time order | reach decision details; back to ledger |
| F | **Verification surface** (could live inside B) | hash (full, copyable), commitTxSig + explorer link, verification block, the recompute-it-yourself pointer (`npx tsx tools/verify-proof.ts`), global anchors (§20) | copy everything; open explorer |
| G | **About / trust story** | §13 content | none (reading) |
| H | **System** (can be minimal) | `/health` data; stream connection state; the disclaimer | none |

**Navigation flow (the canonical drill paths users must be able to travel):**
- feed event → decision detail → its fixture story → its proof → explorer (out).
- digest strategy row → that strategy's filtered ledger → any decision detail.
- vitals aggregate (e.g. open positions count) → the corresponding filtered ledger.
- Anything → About (for the newcomer), always reachable.

**Landing priority:** the Command view. A judge must see life within seconds of load —
if the agent is quiet (live, no matches), "alive and watching" must still be evident from
vitals + liveness + vetoes rather than an empty feed.

## 11. Application flow & data flow (how the client should work)

**Recommended client model** (SSE + REST hydration — final architecture yours):
1. On load: fetch `/health` + `/status` (cheap, instant paint), then hydrate history from
   `/decisions?limit=…`, `/settlements`, `/reviews`, `/digest` as surfaces need them.
2. Open `EventSource('/stream')`. Apply incoming events (`decision` / `settlement` /
   `review` / `status`) to your in-memory store incrementally.
3. `id:` on every SSE event is monotonic (`"<ts>:<n>"`); the browser auto-sends
   `Last-Event-ID` on reconnect and the server replays up to 500 missed events **exactly
   once** — dedupe by decision `hash` / settlement `decisionHash` anyway (idempotent
   upserts make everything simpler).
4. **Records upgrade:** a decision may arrive without `commitTxSig`, which appears later
   (re-fetch of `/decisions` or its presence in later snapshots). Model records as
   upsert-by-hash, not append-only inserts.
5. Fall back to polling (`/status` + `/decisions`) if `EventSource` errors persist; the
   current scaffold polls at 2s and it's fine. Poll cadence beyond that is your judgment.
6. `/status` is cheap and safe to poll for vitals (it recomputes a 30-day digest per
   call — fine at a few-second cadence, don't hammer it at 100ms).
7. No client persistence required — the server IS the source of truth and reloads are
   instant. Session-level UI state (filters, paused feed) is yours to manage; any state
   library or none — your call.
8. Timestamps: trust server `ts` fields (epoch ms UTC), never client clocks, for ordering
   and "x ago" math (compute against `Date.now()` but expect modest skew gracefully).

**Server-side stream filters** exist (`/stream?strategy=…&fixtureId=…`, AND-ed) — useful
for focused surfaces (e.g. a fixture story that live-updates), optional otherwise.

## 12. States — loading, empty, error, edge (all real; all must be handled)

**Phases** (from `/health.phase`, also implied by `/status`): `starting` · `waiting for
TxLINE credentials` (agent idle pre-onboarding; frontend should present the system
honestly as configured-but-not-fed) · `live` · `replaying` · `replay complete` (terminal
for that process; API stays up for inspection — history fully browsable, no new events).

**Data-shape states:**
1. **Fresh install / zero history** — everything empty except vitals. The product must
   still make sense (About + vitals carry it).
2. **Live but quiet** (no matches right now — common; friendlies schedule) — zero
   decisions for hours is NORMAL. Liveness comes from `lastEventRecvTs` (odds ticks
   arrive almost continuously when any covered fixture is active), `eventsSeen` counters,
   `trackedMarkets`, and vetoes. "Nothing worth trading" is a healthy state the interface
   must communicate as such.
3. **Burst** — a goal triggers several decisions within ~1–2 seconds; match end brings a
   settlement wave (5–15 at once) + one review. Feed rendering must stay coherent under
   ~20 events/second spikes.
4. **Open positions long-lived** — positions stay open for the full match (~2h live).
5. **Shadow decisions** interleaved with real ones (stake 0; see §III).
6. **Failed verification** — settlement attempt with `verified: false`: the position
   REMAINS OPEN and retries later. Truthful presentation of this rare state is an
   integrity feature.
7. **commitTxSig upgrade** — §11.4.
8. **Stream drop** — SSE `onerror`: browser retries automatically; show connection state
   honestly; fall back to polling if it persists. On resume, missed events replay.
9. **API completely down** — a clear, calm dead-state (the agent process is gone or
   restarting); retry automatically.
10. **Agent restart mid-session** — process reboots and **rebuilds its complete state
    from its ledger** (equity, calibration, allocations, open positions all survive —
    this is tested). Frontend: reconnect + rehydrate; `startedAtTs`/uptime reset is the
    only tell. (This is the `kill -9` demo move — the frontend riding through it
    gracefully is part of the show.)
11. **Long-idle background tab** — browsers throttle timers and may kill SSE; on
    visibility regain, rehydrate cleanly.
12. **Malformed/unknown fields** — tolerate unknown extra fields (contract grows);
    treat all string content (e.g. `reason`) as text, never HTML (§19).

**Success flow (the one that matters most — make it legible end-to-end):**
goal happens → decision(s) burst in with reasons (S2's "quote is Xs older than the
event" is the hero) → position visible as open → match finalises → settlement wave:
won/lost with P&L and `verified: true` → review lands with the agent's self-notes →
digest/vitals shift (allocations, calibration) — the learning made visible.

**Failure flows:** losing settlement (routine — equal prominence); proof failure →
retry (rare); strategy suspension (visible in `/status.suspensions` + subsequent shadow
decisions — a *feature* to surface: "it benched itself"); veto streams during risk halts
(e.g. drawdown breaker: vetoes with that reason appear while entries are frozen).

## 13. The About / trust story (content outline — write/polish copy as you see fit, keep claims exact)

1. The problem: track records you can't verify; referees you must trust (§2 has the facts
   — the $3.7M scam is citable).
2. What SHARPE does differently, in three beats: *commits before outcomes* (can't fake
   history) · *settles by on-chain proof* (can't fake results) · *learns only from proven
   facts, and benches itself* (can't hide decay).
3. "Check it yourself": the three-artifact chain — record hash → commitment tx on
   explorer → proof verification — with the England–Argentina example (§20).
4. What it trades and how it thinks (the three strategies in one sentence each; the
   model-vs-market-probability idea).
5. Honest limits: devnet, paper exec unless stated; win rates hover near 50% by
   construction — the claim is provable honesty + positive expected value, never "it
   always wins."
6. The disclaimer (§5).

## 14. Notifications & user feedback

- **In-app only, v1.** The event stream IS the notification system (new decision /
  settlement / review / feed status). No push, email, or browser notifications. Derived
  moments worth elevating in-stream, if you choose: a strategy entering/leaving
  suspension (detectable via `/status.suspensions` changes), the drawdown breaker
  engaging (vetoes with that reason), `verified: true` settlements.
- **User feedback channel:** a link to the GitHub repo's issues
  (`github.com/Ritik200238/sharpe/issues`) is sufficient for v1. No in-app forms, no
  chat widgets, no third-party feedback SDKs.

---

# PART V — THE TECHNICAL CONTRACT

## 15. API reference (complete)

One HTTP server (default port `8787`; deployment URL TBD). All endpoints **GET**,
read-only, no auth, CORS `*`, `Cache-Control: no-store`. All timestamps **epoch
milliseconds UTC**. Money = USDC numbers (2dp). Probabilities = 0–1 fractions. `edge` =
fraction (display as signed percentage points). Decimal odds 4dp. Hashes = 64-hex.
Tx signatures = base58 → `https://explorer.solana.com/tx/<sig>?cluster=devnet`.

### `GET /health`
```json
{ "ok": true, "phase": "live", "uptimeSec": 8141, "now": "2026-07-16T12:59:01.000Z" }
```

### `GET /status`
```json
{
  "startedAtTs": 1784275000000,
  "network": "devnet", "feedMode": "live", "execMode": "paper",
  "eventsSeen": { "score": 1042, "odds": 18211, "heartbeat": 320 },
  "lastEventTs": 1784279000000, "lastEventRecvTs": 1784279000420,
  "liveFixtures": 1, "trackedMarkets": 14,
  "equityUsdc": 1992.11, "realizedUsdc": 2000, "peakRealizedUsdc": 2005.5,
  "allocations": { "S1_COHERENCE": 0.376, "S2_REACTION": 0.312, "S3_CONVERGENCE": 0.312 },
  "calibration": { "samples": 12, "modelBrier": 0.21, "marketBrier": 0.24,
                   "advantage": 0.03, "factor": 1.11 },
  "suspensions": { "S1_COHERENCE": { "llr": 0.4, "suspended": false,
                   "shadowWins": 0, "suspensions": 0 } },
  "aggregates": { "decisions": 9, "settled": 8, "wins": 4, "stakedUsdc": 206.6,
                  "pnlUsdc": -3.1, "openPositions": 1 },
  "recentVetoes": [ { "reason": "quote stale (312s old)", "strategy": "S2_REACTION",
                      "marketKey": "…", "ts": 1784278000000 } ],
  "digestSummary": "30d: 9 decisions, 8 settled, 4W/4L, pnl -3.1 USDC | flags: S3_CONVERGENCE:quiet"
}
```
Semantics: `calibration.modelBrier/marketBrier` are null below sample minimums;
`advantage` positive = model beating market; `factor` scales every stake. `recentVetoes`
capped at last 20.

### `GET /decisions?limit=50` — newest first. Record shape (real example):
```json
{
  "hash": "4f2a…c9e1 (64 hex)",
  "decidedAtTs": 1784142600000,
  "mode": "paper",
  "strategy": "S2_REACTION",
  "fixtureId": 18241006,
  "marketKey": "OVERUNDER_PARTICIPANT_GOALS||line=2.5",
  "family": "TOTAL_GOALS", "line": 2.5,
  "outcomeIndex": 0, "outcomeName": "over",
  "modelProb": 0.715, "marketProb": 0.533, "edge": 0.182,
  "stakeUsdc": 50, "priceDecimal": 1.8763,
  "reason": "Goal at seq 2 repriced this match; quote is 298s older than the event. Model now 71.5% for OVER, stale quote implies 53.3%, edge +18.2%.",
  "sizing": { "kellyFraction": 0.031, "calibrationFactor": 1.0,
              "allocationWeight": 0.312, "bankrollUsdc": 2000 },
  "inputs": { "scoreSeq": 2, "scoreTs": 1784142598000, "oddsMessageId": "m-…",
              "oddsTs": 1784142300000, "lambdaHome": 1.18, "lambdaAway": 1.16 },
  "commitTxSig": "5Kd…9fQ (present only once confirmed on-chain)"
}
```
`line` present only for `TOTAL_GOALS`. `reason` sentences reference λ values,
percentages, seq numbers — they're written for humans and safe to show verbatim.

### `GET /positions` — open (unsettled) decisions; same record shape.

### `GET /settlements` — newest first:
```json
{
  "decisionHash": "4f2a…c9e1",
  "settledAtTs": 1784149200000,
  "fixtureId": 18241006,
  "won": true, "pnlUsdc": 43.82,
  "finalP1Goals": 1, "finalP2Goals": 2,
  "verification": { "method": "validateStatV2", "verified": true,
                    "statKeys": [1, 2], "seq": 962, "txSigOrView": "view" },
  "commitTxSig": "… (settlement's own on-chain commitment, chain mode)"
}
```
Join to its decision via `decisionHash`. `verification` may be absent entirely (§III).

### `GET /reviews` — the agent's post-match self-assessments:
```json
{
  "hash": "…", "fixtureId": 18241006, "generatedAtTs": 1784149200000,
  "decisions": 8, "wins": 4, "losses": 4, "stakedUsdc": 206.6, "pnlUsdc": -3.1,
  "meanModelProb": 0.51, "realizedHitRate": 0.5,
  "calibrationAfter": { "…": "same shape as /status.calibration" },
  "perStrategy": { "S2_REACTION": { "n": 3, "wins": 1, "pnlUsdc": -43.58 } },
  "notes": ["Predictions and outcomes consistent this match.",
            "S2_REACTION: 3 decisions, 1 wins, -43.58 USDC — under SPRT watch."]
}
```

### `GET /digest?days=30` (any 1–365; 7 and 30 are the canonical windows)
```json
{
  "hash": "… (deterministic — same inputs, same hash)",
  "generatedAtTs": 1784280000000, "windowDays": 30, "windowStartTs": 1781688000000,
  "strategies": [{
    "strategy": "S1_COHERENCE", "n": 5, "wins": 3, "hitRate": 0.6,
    "stakedUsdc": 120.5, "pnlUsdc": 14.2, "roi": 0.1178,
    "brier": 0.2210, "meanEdge": 0.0512,
    "lastDecisionTs": 1784142600000, "lastSettlementTs": 1784149200000,
    "activity": "active"
  }],
  "overall": { "decisions": 9, "settled": 8, "wins": 4, "stakedUsdc": 206.6,
               "pnlUsdc": -3.1, "roi": -0.015, "hitRate": 0.5 },
  "days": [ { "day": "2026-07-15", "decisions": 4, "settled": 4, "pnlUsdc": -8.0 } ]
}
```
`brier`/`meanEdge` null when no data; `days[]` only contains active days, ascending —
built for trend rendering. P&L buckets to the *decision's* day.

### `GET /track-record` — `{ aggregates, decisions(≤500), settlements, reviews }` in one
call. The auditor's/export endpoint; also your bulk-hydration option.

### `GET /stream` — Server-Sent Events (the realtime backbone)
- Works with the native `EventSource` API.
- Event types: `decision` · `settlement` · `review` · `status` (feed connect/disconnect notices).
- Payload envelope: `data: { "type": "...", "ts": 1784…, "data": { …the record… } }`.
- `id:` monotonic `"<ts>:<n>"`; reconnect with `Last-Event-ID` replays missed events
  (500-event buffer) exactly once — automatic with `EventSource`.
- Query filters, AND-ed: `?strategy=S2_REACTION` (matches decision events only),
  `?fixtureId=18241006`.
- Heartbeat comment (`: hb`) every 15s.

**Contract source of truth:** the TypeScript types in the repo —
`services/agent/src/strategy/types.ts` (DecisionRecord, SettlementRecord),
`src/agent.ts` (AgentStatus), `src/intelligence/review.ts` (MatchReview),
`src/intelligence/digest.ts` (Digest). If this document and the types ever disagree, the
types win; flag the discrepancy to the founder.

## 16. Non-functional requirements

**Performance**
- First meaningful paint fast on a mid-range laptop over ordinary broadband; the API
  itself is on modest hardware — be gentle (§11.6) and render from cache-then-upgrade.
- Smooth under the burst regime (§12.3): ~20 events/s spikes without dropped frames or
  input lag; feed memory bounded over a 24h-open tab (cap in-memory event history;
  full history is always one REST call away).
- **The demo video is scored heavily** and will be a screen recording of this frontend.
  It must look flawless while being recorded (no jank, no layout shifts mid-burst) and
  read clearly at 1080p compression.

**Responsiveness**
- Desktop-first (judges, quants), fully usable on mobile (traders check phones). Wide
  tabular data scrolls within its own container — the page never scrolls horizontally.

**Accessibility**
- WCAG 2.1 AA intent: semantic structure, full keyboard operability, visible focus,
  contrast-compliant text, alt text.
- Win/lose and verified/unverified must never be encoded by color alone.
- Live feed updates: announce politely and rate-limited for assistive tech (a firehose of
  aria-live announcements during bursts would be hostile — batch or summarize).
- Respect `prefers-reduced-motion` for anything that moves.

**Internationalization** — English-only v1. `en-US` number formatting (§21). No i18n
framework needed; don't hard-block a future one.

**Security (frontend perspective)**
- The API is read-only and public — there are no secrets, tokens, or keys to manage.
  Never introduce any.
- Treat ALL server strings (`reason`, `notes`, `digestSummary`, market keys) as plain
  text — render inert, never as HTML (defense in depth even though we control the API).
- External links (explorer, GitHub): `rel="noopener noreferrer"`.
- Keep the app CSP-friendly: no `eval`, no inline-script reliance, self-hosted assets
  (badges/fonts/CDNs are fine to avoid entirely).
- No trackers, no third-party analytics SDKs (see §18).

**Reliability behaviors** — reconnection, rehydration, dedupe, and dead-states per §11–12.

## 17. Reusable information molecules (recurring across every surface — good component candidates; implementation entirely yours)

- **Decision record** (feed-density and full-detail representations of the same data).
- **Reason sentence** (verbatim agent text; the soul of the product).
- **Model-vs-market probability pair + edge** — the "why" in numbers.
- **Verification status** — the three-state fact (verified / unverified-paper / failed-retrying).
- **Commitment status** — hash + pending/confirmed (+ explorer link when confirmed).
- **Strategy identity** (S1/S2/S3) — appears on decisions, digest, allocations, suspensions, vetoes.
- **Signed money** (P&L) and **stake** (USDC, 2dp, honest signs).
- **Hash / signature** — truncated display, full-value copy, optional external link.
- **Timestamp** — relative ("12s ago") + absolute UTC on demand.
- **Activity flag** (active/quiet/stale) and **suspension state**.
- **Feed-liveness indicator** (stream connected / reconnecting / polling-fallback / dead).
- **Fixture reference** (id + participants + final score when known).

## 18. Analytics

None in v1 — no cookies, no third-party SDKs, no fingerprinting (it would contradict the
transparency-without-surveillance posture and complicate hackathon hosting). If product
analytics are ever wanted post-launch, propose a cookieless, self-hosted, PII-free
approach to the founder first. Nothing in the build should depend on analytics existing.

## 19. Environments & configuration

- The frontend targets exactly one backend at a time via a single configurable base URL
  (build-time env var or equivalent). Local dev: `http://localhost:8787`.
- Modes arrive from the API (`network`, `feedMode`, `execMode`) — the frontend renders
  them truthfully; it never assumes.
- Deployment target for judging: a public URL (host TBD — likely static hosting for the
  frontend + a small VPS for the agent). Design nothing that requires server-side
  rendering of the API's data.

## 20. Verifiability anchors (real, current values — used in §F8/§13)

- TxLINE program (devnet): `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`
- Our on-chain subscription tx: `XeNPJGSyBW9XUVXiPTqjsPMyWCBUgy3BwwNB1eRHn7bZiiviCejQLoMfFZMrgra94E5uk4PLcnBsZioeoax6Kxm`
- Worked proof example (England 1–2 Argentina, fixture `18241006`, seq `962`): TRUE claim
  verified / FALSE claim rejected — reproducible via `npx tsx tools/verify-proof.ts`
  in `services/agent/`.
- Explorer link pattern: `https://explorer.solana.com/tx/<sig>?cluster=devnet`.

## 21. Numbers, formatting & language semantics (functional correctness, not styling)

- **USDC:** 2dp always; P&L always signed (`+43.82`, `-19.57`); never round stakes/P&L
  beyond 2dp (these are ledger values).
- **Probabilities:** fraction → percent, 1dp (`0.715` → `71.5%`).
- **Edge:** signed percentage points (`0.182` → `+18.2pp` or "+18.2%-pts" — your wording,
  but distinguish it from a percentage *of* something).
- **Decimal odds:** as given, up to 4dp (`1.8763`).
- **Brier:** 3–4dp; lower is better (worth a hint for non-quants).
- **ROI / hit rate:** percent, 1dp.
- **Timestamps:** relative for recency, absolute UTC (ISO-like) for records; never local
  time without labeling.
- **Hashes/signatures:** truncate for display (e.g. first 8–12 chars + ellipsis), always
  full-value copyable.
- **Fixture display:** we only have participant *ids* today (`1888 v 1489`) — no team
  names in the feed we consume. Present ids honestly (e.g. "fixture 18241006 · P1888 vs
  P1489"); a name-mapping may come later.
- Strategy ids may be presented with or without underscores (`S1 COHERENCE`) — keep the
  S1/S2/S3 identity stable.

## 22. Future scalability (design headroom, not current scope)

Ordered by likelihood of arriving first:
1. **Chain exec on by default** — commitment/verification artifacts on every record (the
   fields already exist; density of "verified" facts goes way up).
2. **The agent's bankroll (vault)** — wallet connect, deposit/withdraw, share value,
   personal P&L: the first authenticated, write-capable, "my stake" surface.
3. **Multi-agent / third-party strategists** — today's "the agent" framing becomes "this
   agent among agents": digests become comparative; strategy identity generalizes.
4. **Mainnet** — network switch awareness (explorer links, badges of seriousness).
5. **Corpus browser** — replaying any of the 20 recorded matches on demand as a public
   showcase.

None of these should be built now; none should be architecturally impossible later.

---

# PART VI — WORKING TOGETHER

## 23. Setup (working today)

```bash
git clone https://github.com/Ritik200238/sharpe && cd sharpe
npm install

# Instant data, no credentials — synthetic match through the REAL pipeline:
npx tsx services/agent/tools/synthesize.ts
npm run replay --workspace services/agent -- --replay-dir data/synthetic
# → API on http://localhost:8787 (plus the current scaffold page)

# A REAL World Cup match (if you've received the data/recordings folder):
npm run replay --workspace services/agent -- --replay-dir data/recordings/devnet/backfill-18241006
# pacing: --speed 0 = instant · 1 = realtime · 10 = 10x
```
The API is byte-identical across live/replay — build against replay, ship against live.

**Functional reference (NOT a design reference):** `services/agent/src/api/dashboard.html`
is a single-file scaffold page I built for smoke-testing. It shows which data points
belong together functionally. Replace it wholesale. Existing brand artifacts (the
`SHARPE▮` wordmark, tagline, `docs/assets/banner.svg`) are currently used in the README —
evolve or replace them as your design system dictates; your call, with the founder.

## 24. Collaboration & change control

- **Contract changes:** the API is versionless and evolving. Additive changes (new
  fields) will happen — tolerate unknown fields silently. Breaking needs you'll hit →
  raise them; backend adjustments are cheap right now and the founder can route them.
- **The TS types are the contract** (§15 last block). PRs welcome directly against the
  repo; `README.md`, `PLAN.md`, `judge.md`, `HARDENING.md`, `DECISIONS.md` hold deeper
  context if you want it.
- **Questions:** anything ambiguous → ask the founder. Prefer over-asking to guessing on
  *functional* matters; on design matters, don't ask — decide.

## 25. Acceptance — what "done" means for v1

1. Every feature in §9 is reachable and truthful; every state in §12 is handled (we will
   literally `kill -9` the agent during review and watch the frontend ride through it).
2. **The judge journey under 2 minutes:** land → see the agent demonstrably alive/thinking
   → open one decision and understand it fully → follow it to a `verified: true`
   settlement → touch one on-chain artifact (explorer) → see the season scorecard. No
   guidance, no tooltips from us, no README required.
3. The burst regime and the quiet regime both feel intentional.
4. Losses and suspensions are as visible as wins.
5. Accessibility bar of §16 met; no horizontal page scroll anywhere; demo-recording
   smooth.
6. No writes, no secrets, no third-party data dependencies, disclaimer present.

---

*Written by the founding team (founder + AI cofounder). Everything stated as fact above
is implemented and tested in the repo as of this document's commit — nothing described
in §9–§15 is aspirational except where explicitly marked as roadmap.*
