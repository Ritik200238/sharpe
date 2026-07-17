# DEMOVIDEO.md — Shot-by-shot script for the ≤5-minute submission video

**Why this matters:** the hackathon states submissions are "evaluated heavily based on the
demo video," and matches end before judging — so this recording IS the product the judges
see. Every shot below maps to a `judge.md` criterion. Total target: **4:30**.

**One-time stage setup (run before recording):**
```bash
# 1. A quiet machine — stop the recorder + any backtests so the agent has full headroom.
# 2. Start the agent replaying the real England 1-2 Argentina semifinal at watchable speed:
cd services/agent
npx tsx src/main.ts --mode replay --replay-dir ../../data/recordings/devnet/backfill-18241006 --exec paper --port 8787 --speed 8
# 3. In another terminal, start the frontend pointed at it:
cd apps/web && VITE_API_BASE=http://localhost:8787 npm run dev
# 4. Open the frontend; open a second terminal ready for the kill -9 shot.
# Screen-record at 1080p. Speak in a calm, confident voice — let the numbers carry it.
```
Tip: do a dry run first so the goal/settlement moments land where you want them; restart
the replay to re-time. The ledger persists, so for a clean slate delete `data/track/devnet/replay/` between takes.

---

## 0:00–0:25 — The hook (Innovation & Novelty)
- **On screen:** the About page hero, then the Command view with the live feed ticking.
- **Say:** "Every betting expert can fake their track record — cherry-picked screenshots,
  deleted losses. SHARPE can't. It's an autonomous agent that trades World Cup matches,
  and commits every decision to Solana *before* the outcome exists. Watch."

## 0:25–1:15 — It's alive and thinking (Core Functionality · Autonomous Operation)
- **On screen:** Command view. Point to the vitals (equity, calibration, allocations),
  the feed streaming decisions, the liveness rail.
- **Do:** let a decision arrive; click it open.
- **Say:** "No human input — it ingests TxLINE's live scores and odds, prices every
  outcome, and acts on its own. Here's a real decision. It tells you exactly why."
- **On screen (Decision detail):** read the reason sentence aloud; point to model-vs-market
  probability and the edge.

## 1:15–2:10 — The reaction moment (Logic & Code Architecture)
- **On screen:** back to the feed; wait for the goal in the replay.
- **Do:** when the goal hits, an S2_REACTION decision fires.
- **Say:** "A goal just changed the true odds. The market's quote is stale — the agent
  reprices instantly and trades the lag. That's not a guess; it's a deterministic model.
  Same input, same decision, every time — provable by test."

## 2:10–3:10 — Settlement by proof (the crown jewel · Production Readiness)
- **On screen:** let the replayed match finish; the settlement wave lands.
- **Do:** open a settled decision → the Verification panel.
- **Say:** "The match ended. No oracle, no referee. The agent submitted a Merkle proof of
  the final score to a program on Solana, which checked it against the on-chain root. This
  settlement is a cryptographic fact." Point to `VERIFIED ✓ · validateStatV2 · seq 962`.
- **Optional cut:** a terminal running `npx tsx tools/verify-proof.ts` showing the TRUE
  claim accepted and the FALSE claim rejected.

## 3:10–3:45 — It grades itself (Innovation)
- **On screen:** the match Review card + the Performance digest.
- **Say:** "After every match it writes a public self-review, measures its own accuracy,
  and — this is the part no other agent has — statistically benches its own strategies
  when they underperform. It fires itself before a human would."
- **On screen:** point to a SUSPENDED flag / the calibration factor below 1.

## 3:45–4:15 — Deploy it and leave it (Production Readiness)
- **On screen:** the terminal running the agent.
- **Do:** `Ctrl-C` / `kill` the agent process on camera, then restart it with the same
  command.
- **Say:** "Kill it mid-session — it rebuilds its entire state from its on-chain-anchored
  ledger and keeps going. Equity, calibration, open positions, all intact."
- **On screen:** the frontend reconnects; vitals are unchanged.

## 4:15–4:30 — Close
- **On screen:** the About "check it yourself" section (hash → tx → proof), then the repo.
- **Say:** "Deterministic logic, trustless settlement, a track record anyone can verify
  and no one can fake. That's SHARPE." Show the repo URL and the live link.

---

## Coverage check (every judge.md criterion is hit)
| Criterion | Shot |
|---|---|
| Core Functionality & Data Ingestion | 0:25–1:15 (live feed, vitals) |
| Autonomous Operation | 0:25–1:15 + 3:45 (no human; kill/restart) |
| Logic & Code Architecture | 1:15–2:10 (reason sentences, determinism) |
| Innovation & Novelty | 0:00 hook + 3:10 (self-review, self-suspension) |
| Production Readiness | 2:10 (proof settlement) + 3:45 (crash recovery) |

## Assets already captured for you
- `docs/assets/dashboard-live.jpg` — a real live-session screenshot (fallback B-roll).
- `docs/assets/demo.gif` — the animated capture (see README) for thumbnails/B-roll.
- The banner (`docs/assets/banner.svg`) for the title card.
