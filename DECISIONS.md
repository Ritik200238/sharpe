# DECISIONS.md — Idea Selection Log (Track 2)

## The Frame
- **Decision:** Which autonomous sports-trading system to build for TxODDS Track 2 AND launch as a real market product.
- **#1 criterion:** Wins the track (autonomy + deterministic logic + Solana settlement) AND has real post-launch PMF/revenue.
- **Constraints:** No time/dev limits (~6 months). Prefer the harder path if the system is better. No GPT-wrapper, no copy of their example ideas, no TxL wagering (USDC/SOL only). Must self-settle via `validate_stat` Merkle proof CPI.

## Research facts the attacks used (July 2026)
- Prediction-market sports volume exploded: **$45B combined in June 2026** (Kalshi $31B+, Polymarket $10.8B record); sports ≈ **85% of Kalshi volume**; in-play World Cup contracts do **$500K–$2M per match**; DraftKings/FanDuel losing users to event markets.
- Odds-intelligence SaaS has **proven paid demand**: OddsJam **$39–$999/mo**, RebelBetting **$99/mo**.
- Tipster fraud is a real documented pain (fake track records, $3.7M "Elite Sports Syndicates" scam). Existing verification (Tipstrr etc.) is centralized/gameable.
- **Billy Bets** (AI betting agent, Decrypt) already logs bets on-chain for provability — but it's an LLM pick-seller, no deterministic engine, no trustless settlement, no vaults. Wedge must go deeper than "on-chain logging."
- **Hyperliquid vaults** prove "deposit into a strategy" demand: billions TVL, 10% performance fee standard, copy-trading model works.
- **BetDEX/Monaco Protocol** = open-source Solana betting order-book infra (a *venue we can execute on*, not a competitor to our layer). SX Bet $1.2B cumulative.

## Candidates & Verdicts

| # | Candidate | Verdict | Cause of death / survival |
|---|---|---|---|
| A | **Verifiable autonomous strategy vaults** (Hyperliquid-for-sports: USDC vaults, deterministic agents, commit-before-outcome, Merkle-proof settlement) | ✅ SURVIVES — #1 | Legal wound (pooled funds + wagering) → mitigated: non-custodial per-user allocations, jurisdiction gating, devnet for judging. No one combines deterministic agent + trustless settlement + vaults. |
| B | **Provable odds-intelligence engine** (no-vig fair value + anomaly signals, commit-reveal on-chain track record, agent executes its own signals) | ✅ SURVIVES — #2 | Iterated once: "signals only" failed the ACTS-not-prints rule → agent now executes its own signals. Cleanest legal profile (SaaS/data). OddsJam-analog revenue. |
| E | **Cross-venue fair-value arbitrage agent** (TxLINE consensus anchor vs Polymarket/Kalshi/BetDEX mispricings) | ✅ SURVIVES — #3 | Wounds: venue API/legal friction, limited capacity, ban risk. Survivable as flagship strategy INSIDE A's vaults. Deadly-good demo math. |
| C | **Autonomous parametric risk underwriter** (corners/cards props, fantasy hedges; B2B book-hedging tier) | ⚠️ WOUNDED — #4 | Consumer demand unproven (who buys sports insurance?) → reframed B2B (books/fantasy ops hedge exposure). validate_stat is literally built for this. Keep as expansion, not flagship. |
| D | **Sports settlement keeper network** (bonded keepers settle any third-party contract for fees) | ⚠️ REFRAMED — #5 | Dies standalone: no ecosystem to serve yet (chicken-egg). Survives as a *component* of A (keeper triggers settlement) → spin off as infra product once A is live. |
| F | Sports index/structured products (tournament baskets) | ❌ DIES | Needs deep hedging liquidity that doesn't exist + NAV insolvency risk + securities exposure. Revisit post-launch. |
| G | Agent-run consumer streak/survivor game | ❌ DIES | Track-1 energy; operator autonomy is thin; wrong judges. |
| H | Sportsbook risk-hedging agent (B2B) | ❌ DIES standalone | Real pain but enterprise sales cold-start kills launch; folded into C's B2B tier. |

## Recurring kill pattern (the meta-insight)
Ideas died from exactly two causes: **(a) depending on an ecosystem that doesn't exist yet, (b) unproven buyer demand.**
Everything that survived anchors to **already-proven spend**: $45B/mo event-trading volume, $99–999/mo odds-tool subscriptions, billions in vault copy-trading TVL.

## The stack insight
The 5 survivors are **one platform, not five products**:
**A (vaults)** is the flagship → powered by **B (signal engine)** → running **E (arb/value strategies)** → settled by **D (keeper)** → expanding into **C (parametric contracts)**.
Build A with B+D inside it for the submission. E is the hero strategy. C is the roadmap.

## Current best survivor
**A — Verifiable Autonomous Strategy Vaults** (working thesis: "Hyperliquid vaults for sports markets, with track records that cannot be faked and settlement that needs no referee").
