# CLAUDE.md — Build Rules (Track 2)

**Hackathon:** TxODDS World Cup (Superteam Earn) · **Track 2 — Trading Tools & Agents**

> This is the rulebook for the build. Follow it on every decision. Pairs with `judge.md` (what we're scored on).

---

## 🚫 Non-Negotiables (miss any = we lose)

1. **True autonomy.** It loops/runs on its own. If a human must approve each decision → instant fail on criterion #2.
2. **Live TxLINE data, not a snapshot.** Must consume the real SSE stream (`/api/scores/stream` + `/api/odds/stream`), reacting as the match moves.
3. **It ACTS, not just prints.** The agent must execute a decision (send a transaction, open/close a position, fire a signal) — not only display text.
4. **Deterministic, defensible logic.** Same input → same decision. We can explain *why* it acts, with math/rules.
5. **Reliability.** Survives stream drops, reconnects, restarts, bad data. Doesn't die mid-match.
6. **A track record.** It stores its decisions and checks if it was right (accuracy / P&L log). Their own example says "track whether it predicted the outcome."
7. **Judges can test it.** Deployed + running, OR a live API/devnet endpoint they can hit.
8. **Public repo + clean docs + list of TxLINE endpoints used.**

---

## ✅ Do's

- Run it as a real loop (long-running process or scheduler). Show it running 24/7.
- Use **both** odds + scores streams — richer signal = smarter agent.
- Log the agent "thinking out loud" (why it decided X) — makes the demo legible.
- Build the **replay harness early** (feeds recorded match data through the same pipeline for the demo).
- Track and display a **live scoreboard of its performance** (win rate / P&L).
- Handle errors gracefully (retries, reconnect, idempotency).

## ❌ Don'ts

- ❌ Build a ChatGPT wrapper that just narrates the match. Not autonomous, not defensible → dead on arrival. **This is the #1 mistake everyone makes.**
- ❌ Require a human to click "go" for each move.
- ❌ Use only a static data pull.
- ❌ Hide the logic in a mystery black box with no explanation.
- ❌ Blow all your time on a fancy UI. Their words: *"Clear logic and a working system beats a polished demo with neither."*
- ❌ Use TxLINE's own **TxL token** for betting/positions — it's locked to their program. Use other coins (e.g. USDC/SOL).

---

## Solana Integration — How Much Is a Must

| Level | Solana use | Verdict |
|---|---|---|
| **Bare minimum** | Just signing up for TxLINE data (needs a Solana wallet + activation). Agent runs fully off-chain otherwise. | ❌ Too weak. Won't win. |
| **Competitive** (our floor) | Agent autonomously signs & sends Solana transactions to act on its decisions — records each signal/position on-chain (tamper-proof, timestamped track record). | ✅ Solid. Real Solana story. |
| **Winning** | Full on-chain execution loop: reads TxLINE → decides → executes a real Solana tx (open/close position, settle P&L) → uses TxLINE's Merkle proof / `validate_stat` to verify the outcome and self-settle trustlessly on-chain. | 🏆 Screams "production ready." |

**🎯 Our target: the Winning level.**

---

## Build Principles (the quality bar)

- **No AI slop — ever.** From every angle it must read as **human-made, with proficiency and professionalism.**
- **Nothing half-baked.** Anything we build is built **fully** — complete, working end-to-end. No stubs pretending to be features.
- **Product–Market Fit.** Clear potential to attract and retain real users.
- **Innovation & Creativity.** Original approach that pushes boundaries — not a copy of their example ideas.

---

## How We Work (method)

- Stay **organized**. Do things **priority-first**.
- Finish the **highest-priority thing first**, then move to the next, then the next.
- Keep repeating this in an **organized, disciplined manner** — no jumping around, no loose ends.
