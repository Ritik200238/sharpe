# PLAN.md — Master Build & Launch Plan

**Product (working name): SHARPE** — *The Provable Sports Trading Agent*
Pairs with: `CLAUDE.md` (build rules) · `judge.md` (scorecard) · `DECISIONS.md` (why this idea won)

---

## 0. The Job (one sentence — Factor 1: The Brain)

> **SHARPE watches every World Cup match in real time, computes the fair price of every outcome from TxLINE's consensus odds + live match state, trades mispricings with USDC on-chain, and settles + proves every result cryptographically — with zero human input.**

If a judge asks "what does it do?", that sentence is the answer. Everything below serves it.

**Official identity — the ONLY way we ever describe this product:**
> **"The autonomous sports trading agent with an unfakeable public track record."**
Every feature is a detail behind that sentence. If a feature needs its own sentence to matter, it gets demoted.

**The hidden-requirement answer (judge.md §2):** SHARPE automates what betting syndicates pay analyst teams to do manually (price, monitor, execute, settle, audit) — and produces the one thing money can't currently buy in this industry: **a track record that cannot be faked.**

---

## 0.5 The Framing Law (how we don't lose)

Three ways this project can lose, and the standing rules that prevent them:

1. **Never look like a Track 3 project.** The **agent is the hero of every sentence** — in the demo, README, dashboard copy, and interviews. The exchange, escrow, and vault are *the agent's tools*, mentioned only as things the agent uses. We never introduce ourselves as a market, protocol, or infrastructure.
2. **Never miss the data window.** Recording real World Cup matches (semis + final, before July 19, 2026) outranks every other task this week. No exceptions.
3. **Never let complexity into the demo.** The 5-minute video tells ONE story — *agent sees → decides → acts → proves* — told through the agent's own decision feed. All depth (mechanism design, program architecture, math derivations) lives in the repo/docs for judges who dig.

**Standing advantage to exploit:** after the World Cup, TxLINE keeps streaming international friendlies. During the judging window our agent runs **genuinely live, 24/7** — judges open our link and watch it deciding in real time. Most teams will only have recordings. Every surface (portal, README, video outro) must point at the live agent.

---

## 1. The Three Pillars (design spine)

| Pillar | Question it answers | Our answer |
|---|---|---|
| **Brain** — strategy | What job runs automatically? | Fair-value pricing + mispricing detection + risk-managed execution (§4) |
| **Engine** — autonomy | Can it run unsupervised forever? | Event-driven loop, self-healing, deploy-and-leave (§5) |
| **Logic** — decisions | Why did it act? | Deterministic math, human-readable reason per decision, on-chain commit (§4.4) |

Rule: **any feature that doesn't strengthen a pillar gets cut.** UI stays basic-but-clean; depth goes into the pillars (per judge guidance: agent behavior > pretty dashboard).

---

## 2. Product Overview

### 2.1 What we ship (4 layers, built inside-out)

1. **Signal Engine** — TxLINE SSE ingestion → normalized events → fair-value model → edge signals.
2. **On-chain Execution + Settlement** — Anchor programs: USDC escrow markets, positions, `validateStatV2` CPI settlement, decision-commit registry.
3. **Strategy Suite** — 3 deterministic strategies (§4.3) running on the engine.
4. **Vault** — users deposit USDC; agent trades it; unfakeable public P&L; performance fees. *The market-launch product.*

**The agent's venue (a tool, never the headline):** on devnet there is no liquid sports market, so P3 ships a **minimal escrow market program** — just enough surface for the agent to act and settle. The **batch-auction mechanism** (uniform clearing, auto-suspend on events) is a **post-P5 enhancement, built only after the agent story is undeniable**. It stays in the repo's future, not in the pitch.

**Agent-first naming (public surfaces only):** vault → **"the agent's bankroll"** · registry → **"the agent's logbook"** · market program → **"the agent's venue."** Internal/code names stay technical.

Each layer is complete and submittable on its own → "nothing half-baked" guaranteed structurally.

### 2.2 Feature list (complete)

**Agent:** pre-match + in-play trading · multi-market (1X2, totals, corners, cards, BTTS, half-based props — *only* markets provable via `validateStatV2`; see §6.3) · decision commit-before-outcome · auto-settlement keeper · glass-box decision feed · paper/live modes · replay mode · risk engine (§4.5) · self-healing (§5.2).

**Vault:** epoch-based deposit/withdraw (no mid-match exits) · share accounting with high-water mark · 15% performance fee, 0% management · on-chain position caps (program-enforced — even a compromised agent can't exceed them) · live NAV/P&L/drawdown.

**Agent's venue:** minimal escrow markets (P3) — open/trade/settle, enough for the agent to act on devnet. *Enhancement (P5.5, optional):* 10s batch auctions with uniform clearing + auto-suspend on match events + parimutuel pre-match pools.

**Surfaces:** dashboard (live agent-brain feed, model-vs-market chart, vault stats) · **track-record explorer** (every decision → its on-chain commit → its settlement proof) · judge portal (`/status`, `/health`, `/decisions`, `/positions` REST + "run replay match" button) · Telegram alerts.

**Judging-window mode:** the agent stays live 24/7 on whatever TxLINE streams post-tournament (international friendlies) — the judge portal's default view is the **live** agent, with replay as the backup button. Judges must land on a running system, not a recording.

---

## 3. System Architecture

```
                         ┌─────────────────────────────────────────────┐
                         │                  TxLINE                     │
                         │  /api/odds/stream   /api/scores/stream      │
                         │  /api/scores/stat-validation  (proofs)      │
                         └──────────────┬──────────────────────────────┘
                                        │ SSE (auth: guest JWT + X-Api-Token)
                                        ▼
   ┌────────────┐   append    ┌──────────────────┐
   │  Replay    │◄───────────►│   feed-service    │  normalize → EventBus
   │  corpus    │   read      │  (ingest+journal) │  journal every event (seq, ts)
   └────────────┘             └─────────┬────────┘
        (recorded real matches)         │ typed events
                                        ▼
                              ┌──────────────────┐     pure function:
                              │  strategy-engine  │  (MatchState, OddsState, Params)
                              │  (deterministic)  │        → Decision + Reason
                              └─────────┬────────┘
                                        │ decisions
                                        ▼
                              ┌──────────────────┐   signs & sends Solana txs
                              │ execution-service │   idempotent, retries, prio fees
                              └─────────┬────────┘
                                        │
              ┌─────────────────────────┼──────────────────────────┐
              ▼                         ▼                          ▼
     ┌────────────────┐       ┌────────────────┐        ┌────────────────┐
     │ market program │       │ vault program  │        │ registry prog. │
     │ escrow, batch  │       │ shares, fees,  │        │ decision hash  │
     │ auction, settle│       │ caps, epochs   │        │ commits        │
     └───────┬────────┘       └────────────────┘        └────────────────┘
             │ CPI on match end
             ▼
     ┌──────────────────────┐        ┌──────────────────┐
     │ TxLINE program        │◄───────│ settlement-keeper │ fetches proof,
     │ validateStatV2        │        │ (autonomous)      │ fires settle tx
     └──────────────────────┘        └──────────────────┘

     dashboard (Next.js/Vercel, read-only)  ·  Postgres (journal, decisions)
     Docker · VPS for agent (24/7) · health/metrics/alerts
```

**Stack:** TypeScript (strict) monorepo for all off-chain services · Rust/Anchor for programs · Postgres · Next.js dashboard on Vercel · agent on a long-running VPS (Docker, restart policy).

**Key architectural law:** the strategy engine is a **pure, deterministic library** with zero I/O. Live mode and replay mode feed it the same event types through the same interface. This gives: perfect demos, perfect backtests, perfect debuggability, and bit-for-bit reproducible decisions (criterion #3).

---

## 4. The Brain — Strategy Spec v1 (Factor 1 + Factor 3)

### 4.1 Fair-value model (deterministic, defensible)

1. **De-vig:** TxLINE StablePrice consensus odds → strip the bookmaker margin (Shin's method / power method) → true implied probabilities.
2. **Market-implied match parameters:** from pre-match 1X2 + totals lines, derive goal expectancies (λ_home, λ_away) — the market itself is our prior; no scraped training data needed.
3. **In-play state model:** Poisson/Dixon-Robinson goal-intensity model — remaining-time λ adjusted for score line, red cards, match phase. Textbook sports-quant math judges will recognize.
4. **Fair price** of every tracked outcome = model probability under current state.

### 4.2 Signal
`edge = model_probability − devigged_market_probability`. Act when `|edge| > θ` after costs. θ per market type, set from backtest calibration.

### 4.3 Strategy suite (3 deterministic strategies)

| Strategy | What it does | Why it's defensible |
|---|---|---|
| **S1 Coherence** | 1X2, totals, and handicap prices must imply consistent (λ_home, λ_away). Trade the leg that breaks coherence. | Pure cross-market arithmetic — no opinion, just consistency. |
| **S2 Reaction** | On goal/red-card events, the model reprices instantly; trade quotes that lag beyond θ. On our exchange: quote fair prices into post-event batches. | Speed + math, not prediction. TxLINE feed is the canonical fastest source. |
| **S3 Convergence** | Pre-match: provide anchor liquidity at fair value in pools/auctions; capture flow that deviates from consensus. | Market-making at provably fair prices. |

### 4.4 Explainability (Factor 3 — the glass box)
Every decision emits a **DecisionRecord**:
`{inputs: {seq ids, odds snapshot, match state}, model: {λs, fair prob}, market: {implied prob}, edge, threshold, stake calc, action, reason string}`
- Reason strings are human sentences: *"Model P(Over 2.5)=0.61 (λh 1.8, λa 1.1, 34', 1–0, red card away). Market implies 0.52 de-vigged. Edge +9pp > θ 3pp. ¼-Kelly stake 42 USDC (cap 50)."*
- `hash(DecisionRecord)` is committed **on-chain before the outcome** (registry program). Full records published. Track record = mathematically unfakeable.
- No LLM anywhere in the decision path. (An optional LLM may *narrate* logs for the dashboard later — never decide.)

### 4.5 The Intelligence Layer — deterministic self-evaluation & adaptation

The agent doesn't just execute — **it grades itself and adapts.** Every adaptation is a pure function of its own settled, provable history: deterministic, replayable, defensible. No LLM, no black box.

- **Confidence calibration:** after every settlement, recompute calibration (Brier score) per market type; stake sizing scales down automatically as calibration degrades (calibration-scaled Kelly).
- **Meta-allocation (strategy evolution):** bankroll split across S1–S3 by a deterministic UCB-style rule over each strategy's on-chain-proven rolling performance. The agent reallocates toward what's working — and you can audit exactly why.
- **Threshold recalibration:** entry thresholds θ recomputed per market from realized edge decay on settled positions. Fixed formula, zero discretion.
- **Self-suspension:** a sequential statistical test (SPRT-style) halts any strategy whose live results breach its expected bounds. **The agent fires itself before a human would.**
- **Public self-review:** after each match the agent publishes — and commits on-chain — its own post-mortem: predicted vs realized, calibration delta, and the exact parameter adjustments it will apply next match.

**The judge line:** *"It learns only from facts it can prove."* Intelligence = a deterministic learning loop over a cryptographically verified history — that's the difference between a 2015 betting script and an autonomous worker.

### 4.6 Risk engine (deterministic, program-enforced where it counts)
- ¼-Kelly fractional staking, hard caps: per market, per match, per day.
- Exposure correlation cap (no stacking same-team risk).
- Drawdown circuit breaker (halt at −X% from HWM; alert).
- Data-staleness guard: heartbeat gap > N sec → cancel quotes, no new entries.
- Spread/liquidity guard: no entries when market too thin or too wide.
- On-chain caps in vault program = final backstop.

---

## 5. The Engine — True Autonomy (Factor 2)

### 5.1 The loop (what the judge must feel: "deploy and leave it")
```
start → discover fixtures (poll) → subscribe SSE (odds+scores)
  → for each event: journal → update state → strategy → decision?
      → execute tx → commit decision hash → notify
  → match ends → keeper fetches Merkle proof → settle tx (CPI validateStatV2)
      → payouts release → P&L recorded → track record updates
  → next event / next match → repeat forever
```
Human input: **config at deploy only** (risk params). Never per-decision.

### 5.2 Self-healing (reliability non-negotiable)
- SSE reconnect with exponential backoff + jitter; resume from last event id.
- 401 → auto-renew guest JWT (same host), keep `X-Api-Token`; 403 → alert (network mismatch).
- Idempotent decision processing (dedupe by stream seq); idempotent tx submission (client ids).
- Crash recovery: replay journal → rebuild exact state → continue.
- Watchdog + Docker restart policy; `/health` endpoint; heartbeat metric.
- Chaos tests in CI: kill stream mid-match, kill process mid-decision, feed corrupt data — agent must recover unaided.
- **Demo power move:** `kill -9` the agent live on camera; watch it restart, recover state, and carry on.

---

## 6. Solana Integration (winning level, per CLAUDE.md)

### 6.1 Programs (Anchor)
- **market**: binary-outcome markets; USDC escrow PDAs; batch-auction state (collect → uniform-price clear); positions; settlement instruction that **CPIs into TxLINE `validateStatV2`**; claim payouts.
- **vault**: deposits/withdrawals by epoch; share math with high-water mark; 15% perf fee; agent authority via PDA-delegated signing; on-chain risk caps.
- **registry**: agent identity; decision-hash commits (per-decision on devnet; batched Merkle roots per minute for mainnet cost).

### 6.2 Settlement flow (the crown jewel)
1. Keeper detects match end (scores stream state → F/FET/FPE).
2. Fetch proof: `/api/scores/stat-validation?fixtureId=…&seq=…&statKeys=…` (real observed seq).
3. Build settle tx: proof payload + strategy predicates as args; accounts include TxLINE program + `dailyScoresMerkleRoots` PDA (epoch day u16 LE **from proof timestamp, never wall clock**).
4. CPI verify (~1.4M CU — plan: settlement tx does verification + market state flip only; payouts are separate claim txs to respect compute budget).
5. Escrow releases to winners. No human, no oracle, no dispute window.

### 6.3 Provable-market menu (design law: *if we can't prove it, we don't trade it*)
Stat encoding `period_prefix + base_key` gives us: 1X2 (goals binary subtract), totals (goals sum vs threshold), BTTS (two single predicates), corners totals, cards, first-half/second-half props (H1/H2 prefixes), "goal in both halves". Every market we list maps 1:1 to a `validateStatV2` strategy predicate.

### 6.4 Wallet & ops
Agent hot wallet (encrypted keypair, KMS at mainnet); devnet SOL faucet; Circle devnet USDC (exact mint resolved in P0); priority fees + compute budget tuning; all txs linked in dashboard to explorer.

---

## 7. Competition & Moat

| vs | Their thing | Our answer |
|---|---|---|
| Sponsor's example ideas | detector / arena / market-maker | Full closed-loop capital system with cryptographic accountability — a category above |
| Billy-Bets-style AI pickers | LLM picks, on-chain *logging* | Deterministic glass-box + trustless *settlement* + vault capital |
| OddsJam/RebelBetting | show +EV, human must act | agent acts itself and proves its results |
| Polymarket/Kalshi | venues with liquidity | we're the *strategy + trust layer*; venue-agnostic at launch |
| Other hackathon entries | dashboards, simple bots | 4-layer depth, mechanism design, proofs, production ops |

**Compounding moat:** every settled match adds to an unfakeable public track record. Trust accrues to us over time and cannot be copied, bought, or faked.

**Judging-window edge:** while rivals submit recordings, our agent is **live during review** (friendlies keep streaming post-WC). A judge who opens two submissions — one a video, one a running trader deciding in real time — remembers ours.

---

## 8. Roadmap (phases with gates — priority-first, per CLAUDE.md)

> ### 🚨 P0 IS TIME-CRITICAL — everything else has 6 months; P0 has DAYS
> **The World Cup ends July 19, 2026** — free premium live data ends with it. Live World Cup matches exist for ~6 more days (semis → final). **We must sign up + record full live streams NOW** (raw SSE bytes with timestamps, odds + scores, multiple matches). This corpus becomes our replay/backtest/demo goldmine. Miss it and we demo on friendlies data forever.

| Phase | Weeks | Deliverable (each = complete & working) | Gate to pass |
|---|---|---|---|
| **P0 Capture** | NOW | TxLINE signup (wallet → guest JWT → devnet activation), stream recorder, **record semis + final live**, snapshot + proof endpoint samples | Corpus of ≥3 full real matches replayable |
| **P1 Data spine** | 1–3 | feed-service: ingest, normalize, journal, replay harness (same interface live/replay), fixture lifecycle | Replay = byte-identical event flow |
| **P2 Brain v1** | 3–7 | de-vig, λ-derivation, in-play Poisson model, S1–S3, risk engine, backtest + calibration report on corpus | Deterministic (property-tested); positive-EV evidence on corpus |
| **P3 Chain layer** | 5–11 (parallel) | **Week-5 spike: `validateStatV2` CPI end-to-end on devnet (highest unknown — de-risk first)**; then **minimal** market program (agent's venue), vault, registry; fuzz + tests | Full lifecycle on devnet: open → trade → settle via proof → payout |
| **P4 Integration** | 10–14 | execution-service, keeper, end-to-end vs replayed matches, chaos suite, 72-hour soak | Agent survives kill/drop/corrupt unaided for 72h |
| **P5 Surfaces** | 12–16 | dashboard, track-record explorer, judge portal + replay button, alerts | A stranger can verify a decision → commit → proof in 3 clicks |
| **P5.5 Venue upgrade** *(optional)* | 15–17 | Batch-auction mechanism + parimutuel pools — **built only if the agent story is already undeniable** | Agent demo works with AND without it |
| **P6 Submission** | 16–18 | 5-min demo video, README, endpoint list, TxLINE feedback writeup, deployed devnet + agent running 24/7 | Dry-run scored vs judge.md = max on all 5 |
| **P7 Launch** | post | mainnet hardening + audit, venue adapters (BetDEX/Polymarket), geo-gating/legal wrapper, fee switch, third-party strategist program | External capital safe |

---

## 9. Engineering Quality Bar (no AI slop, exceptional architecture)

- Strict TypeScript everywhere; Rust programs with full test coverage; property-based tests (fast-check) proving determinism; fuzzing on programs.
- Event-sourced core (journal is truth); ADRs for every major decision; conventional commits; CI runs unit + integration + chaos + replay-regression.
- Structured JSON logs; Prometheus metrics; runbooks.
- Docs written like a production product: architecture, threat model, ops guide, API reference, TxLINE endpoint list.
- Code reads human-made: consistent idiom, no boilerplate comments, no generated-looking filler.

---

## 10. Demo Video (5 min — judged heavily; scripted early, not last-minute)

**The ONE-story rule:** the entire video is *agent sees → decides → acts → proves*, narrated through the agent's own decision feed. No architecture tours, no mechanism lectures — that depth lives in the repo. If a shot doesn't show the agent being smart, autonomous, or provable, cut it.

1. **0:00 Hook** — "Every betting 'expert' can fake their record. Here's a trader that can't lie."
2. **0:40** Agent live (replay of real semifinal through live pipeline): brain feed streaming decisions with reasons; model-vs-market chart.
3. **1:40** Goal happens → exchange auto-suspends → model reprices → agent trades the lag. Explain the math on screen.
4. **2:30** Match ends → keeper fetches Merkle proof → settle tx → CPI `validateStatV2` → **USDC moves on-chain, no human** (explorer on screen).
5. **3:30** Track-record explorer: every decision committed *before* outcomes, every settlement proven. Vault P&L, drawdown, fees.
6. **4:15** `kill -9` the agent on camera → auto-restart → resumes mid-match. "Deploy it and leave."
7. **4:45** Close: endpoints used, stack, what's next.

---

## 11. Risks & Mitigations (living list)

| Risk | Mitigation |
|---|---|
| Miss live World Cup data window | **P0 now** — record semis + final |
| `validateStatV2` CPI surprises (CU, accounts, proof formats) | Week-5 spike before building around it; TxODDS Discord support channel |
| 1.4M CU settlement budget | Verify-only settle tx; payouts as separate claims |
| Proof/PDA mismatch bugs | Follow doc checklist: epoch day from proof ts, u16 LE, 32-byte hashes, statKeys order stable, same-host proofs |
| TxLINE dependency (roots stop post-event) | Hackathon: fine. Launch: abstraction layer for additional proof sources |
| Empty-exchange demo | Seeded simulated flow (labeled honestly) + agent anchor liquidity; judged layer is the agent |
| Legal (launch) | Devnet for judging; launch = geo-gating + vault-on-external-venues first |
| Scope creep | Inside-out build; every phase independently submittable |
| **Mis-framed as Track 3 infra** | Framing Law §0.5: agent-first language everywhere; exchange/vault only ever described as the agent's tools |
| **Complexity drowns the demo** | ONE-story rule (§10); depth lives in repo/docs, never in the video |
| Judges review after matches end | Judging-window mode: agent live 24/7 on friendlies; portal defaults to live view |

---

## 12. Team Allocation (≤3 per rules)

- **Dev A — Chain:** Anchor programs, CPI settlement, wallet/tx infra (P3, P4).
- **Dev B — Core:** feed-service, strategy engine, risk, backtests (P0–P2, P4).
- **Dev C — Product:** dashboard, judge portal, ops/monitoring, demo video (P5, P6).
Solo/duo fallback: strict phase order P0→P6, cut exchange batch-auction to minimum viable, never cut settlement or autonomy.

---

## 13. Do This Week (priority order)

1. **TxLINE signup** (Solana wallet → guest JWT → devnet activation) — user action, guided.
2. **Stream recorder built + running** before the next live match.
3. **Record semifinals + final** (July 14–19) — raw SSE, both streams, plus snapshot/proof samples per match.
4. Monorepo scaffold + CI.
5. `validateStatV2` devnet spike prep (read runnable examples, collect sample proofs).

*Naming shortlist (pick later, doesn't block):* **SHARPE** (sharp bettor + Sharpe ratio) · **FAIRLINE** (the fair line) · **KELLY** (Kelly criterion).
