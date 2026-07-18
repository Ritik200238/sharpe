# DEMOVIDEO.md — Shot-by-shot script for the ≤5-minute submission video

**Why this matters:** the hackathon states submissions are "evaluated heavily based on the
demo video," and matches end before judging — so this recording IS the product the judges
see. Every shot below maps to a `judge.md` criterion. Total target: **4:30**.

**The story in one line:** SHARPE is an autonomous **in-play market maker** — it quotes both
sides of every live outcome, earns the spread, defends itself from getting picked off around
goals, and commits its whole book to Solana so it can't be faked.

**One-time stage setup (run before recording):**
```bash
# 1. A quiet machine — stop the recorder + any backtests so the agent has full headroom.
# 2. Start the agent replaying the real England 1-2 Argentina semifinal at watchable speed.
#    The market maker is on by default; it quotes live off the same feed.
cd services/agent
npx tsx src/main.ts --mode replay --replay-dir ../../data/recordings/devnet/backfill-18241006 --exec paper --port 8787 --speed 8
# 3. In another terminal, start the frontend pointed at it:
cd apps/web && VITE_API_BASE=http://localhost:8787 npm run dev
# 4. Open the frontend on the "Market Making" tab; open a second terminal ready for kill -9.
# Screen-record at 1080p. Speak in a calm, confident voice — let the numbers carry it.
```
Tip: do a dry run first so the goal/settlement moments land where you want them; restart
the replay to re-time. The ledger persists, so for a clean slate delete `data/track/devnet/replay/` between takes.

---

## 0:00–0:25 — The hook (Innovation & Novelty)
- **On screen:** the About page hero, then the **Market Making** view with the live book.
- **Say:** "Most trading agents try to *beat* the market — and lose; the odds here are the
  sharpest consensus on earth. SHARPE does the real desk job instead: it **makes markets**.
  It quotes a price to buy and a price to sell on every live outcome, earns the spread — and
  every quote it makes is provable on-chain. A market maker whose book can't be faked."

## 0:25–1:15 — It's alive and quoting (Core Functionality · Autonomous Operation)
- **On screen:** Market Making view. Point to the hero bar — **net P&L, spread captured vs
  adverse selection** — then the live two-sided quotes table (bid / fair / ask, spread, skew).
- **Say:** "No human input — it ingests TxLINE's live scores and odds, prices fair value with
  a deterministic model, and posts a two-sided quote around it. Watch the bids and asks move
  as the match does. It's earning the half-spread on the flow it fills, and skewing its
  quotes to manage the inventory it takes on."

## 1:15–2:15 — The defence moment (the crown jewel · Logic & Code Architecture)
- **On screen:** stay on the book; wait for the goal in the replay.
- **Do:** when the goal hits, quotes flip to **WIDENED**; the "toxic flows deflected" counter
  ticks up while "picked off" stays at **0**.
- **Say:** "This is the whole game of in-play market-making. A goal just moved every price. A
  faster trader would pick off my stale quotes for free. But the instant TxLINE reports the
  goal, SHARPE **pulls its quotes, then re-quotes wide** until the new price settles — so
  there's nothing to pick off. Watch: the toxic flow that fired is deflected, and my
  picked-off count stays at zero. We measured that defence turning a loss into a profit."

## 2:15–3:00 — The book is provable (Production Readiness)
- **On screen:** scroll to **On-chain quote-book commits**; then, when the match ends, open a
  settlement and the Verification panel.
- **Say:** "Every snapshot of the book is hashed and committed to Solana — timestamped proof
  of exactly what I was quoting, before outcomes existed. And when the match ends there's no
  oracle and no referee: the agent submits a Merkle proof of the final score to a program on
  Solana that checks it against the on-chain root." Point to `VERIFIED ✓ · validateStatV2 · seq 962`.
- **Optional cut:** a terminal running `npx tsx tools/verify-proof.ts` — TRUE claim accepted,
  FALSE claim rejected.

## 3:00–3:40 — Deterministic + it grades itself (Innovation)
- **On screen:** the Performance digest / the research layer note on Command.
- **Say:** "Same events in, same quotes out — bit-for-bit, proven by test. And the directional
  research it also runs keeps itself honest: it measures its own accuracy and benches a
  strategy that underperforms. It fires itself before a human would — which is exactly why the
  job is market-making, not betting."

## 3:40–4:15 — Deploy it and leave it (Production Readiness)
- **On screen:** the terminal running the agent.
- **Do:** `Ctrl-C` / `kill` the agent process on camera, then restart it with the same command.
- **Say:** "Kill it mid-session — it rebuilds its entire state from its on-chain-anchored
  ledger and keeps going. It reconnects to the live streams and picks the book back up."
- **On screen:** the frontend reconnects; the numbers are intact.

## 4:15–4:30 — Close
- **On screen:** the Market Making view, then the About "check it yourself" section (hash → tx
  → proof), then the repo.
- **Say:** "A market maker that quotes both sides, defends its own book, and settles by proof —
  a liquidity provider anyone can audit and no one can fake. That's SHARPE." Show the repo URL
  and the live link.

---

## Coverage check (every judge.md criterion is hit)
| Criterion | Shot |
|---|---|
| Core Functionality & Data Ingestion | 0:25–1:15 (live feed → live two-sided quotes) |
| Autonomous Operation | 0:25–1:15 + 3:40 (no human; kill/restart) |
| Logic & Code Architecture | 1:15–2:15 (the pull/widen defence, determinism) |
| Innovation & Novelty | 0:00 hook (make markets, not predict) + 2:15 (adverse-selection defence) |
| Production Readiness | 2:15 (on-chain book + proof settlement) + 3:40 (crash recovery) |

## Assets already captured for you
- `docs/assets/dashboard-live.jpg` — a real live-session screenshot (fallback B-roll).
- `docs/assets/demo.gif` — the animated capture (see README) for thumbnails/B-roll.
- The banner (`docs/assets/banner.svg`) for the title card.
