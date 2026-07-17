# SHARPE

**The autonomous sports trading agent with an unfakeable public track record.**

SHARPE watches every World Cup match in real time through [TxLINE](https://txline.txodds.com)'s
cryptographically-anchored data feeds, computes the fair price of every outcome, trades
mispricings with USDC — and proves every step. Each decision is hashed and committed to
Solana **before** the outcome is known; each settlement is verified against TxODDS'
on-chain Merkle roots via the TxLINE program's `validateStatV2`. No oracle committee,
no admin key, no way to fake the record.

Built for the TxODDS World Cup Hackathon — **Track 2: Trading Tools & Agents**.

---

## Why this exists

Every betting "expert" can fake their track record: cherry-picked screenshots, deleted
losses, backdated picks. And every trading bot demo can quietly re-run until it looks
good. SHARPE makes both impossible:

1. **Commit before outcome.** The hash of every decision (inputs, model state, stake,
   reason) lands on Solana while the match is still running.
2. **Settle by proof.** When TxLINE publishes the `game_finalised` record, the agent
   fetches the Merkle proof and verifies the final stats against the daily root that
   TxODDS anchored on-chain. Truth is cryptographic, not editorial.
3. **Learn only from proven facts.** Stake sizing, strategy allocation, and
   self-suspension all derive — deterministically — from the settled, provable history.

## How it thinks (the brain, in one breath)

The market itself is the prior: consensus 1X2 + totals prices pin down goal
expectancies (λ_home, λ_away) for an in-play Poisson model. Live state (score, cards,
time remaining) conditions the model; three deterministic strategies trade deviations:

| Strategy | Trigger | Edge it captures |
|---|---|---|
| **S1 Coherence** | odds update | cross-market inconsistency vs the jointly-fitted model |
| **S2 Reaction** | goal / red card | quotes that lag the event repricing |
| **S3 Convergence** | drift, no event | quotes that ran from consensus without news |

Sizing is quarter-Kelly, scaled by **calibration** (rolling Brier of model vs market on
settled decisions) and **allocation** (deterministic UCB over each strategy's proven
ROI). A per-strategy **SPRT** self-suspends anything statistically underperforming its
own promises — it keeps trading in shadow mode and re-arms itself after a clean run.
Same input → same decision → same hash. Always.

## Repository layout

```
services/agent/       the product — autonomous trading agent
  src/feed/           SSE live feed + replay feed (identical event interface)
  src/state/          match state (phases, stat keys) + odds state
  src/model/          de-vig (Shin), Poisson in-play model, market pricing
  src/strategy/       S1/S2/S3, decision engine, canonical decision hashing
  src/risk/           fractional Kelly + hard limits, drawdown breaker
  src/intelligence/   calibration, UCB allocation, SPRT, self-reviews
  src/exec/           on-chain decision commitments (Solana)
  src/settle/         proof planning + validateStatV2 verification
  src/track/          append-only, event-sourced public track record
  src/api/            read-only status API + dashboard
  tools/synthesize.ts deterministic synthetic-match generator
  test/               unit + determinism suite
services/recorder/    TxLINE signup + raw stream recorder (builds the corpus)
vendor/tx-on-chain/   TxODDS' official examples/IDL (reference, cloned)
judge.md · CLAUDE.md · PLAN.md · DECISIONS.md   the build's governing docs
```

## Run it

```bash
npm install

# 1. one-time TxLINE signup + start recording (devnet)
npm run setup  --workspace services/recorder
npm run record --workspace services/recorder

# 2. run the agent LIVE (waits for credentials automatically)
npm run start --workspace services/agent -- --network devnet --exec paper

# 3. or replay any recorded (or synthetic) match through the same pipeline
npx tsx services/agent/tools/synthesize.ts
npm run replay --workspace services/agent -- --replay-dir data/synthetic

# 4. watch it think
open http://localhost:8787        # dashboard (live-updating)
curl  http://localhost:8787/status        # brain state + 30-day digest summary
curl  http://localhost:8787/decisions     # glass-box decision feed
curl  http://localhost:8787/digest?days=7 # season scorecard + inactivity flags
curl -N http://localhost:8787/stream      # live brain feed (SSE; ?strategy=, ?fixtureId=)

# tests (17: model math, intelligence layer, bit-for-bit determinism)
npm test --workspace services/agent
```

Execution modes: `--exec paper` (default) tracks positions off-chain; `--exec chain`
additionally commits every decision/settlement/review hash to Solana and verifies
settlements through `validateStatV2`.

## TxLINE endpoints used

| Purpose | Endpoint |
|---|---|
| Guest session | `POST /auth/guest/start` |
| API activation | `POST /api/token/activate` (after on-chain `subscribe`) |
| Live scores | `GET /api/scores/stream` (SSE) |
| Live odds | `GET /api/odds/stream` (SSE) |
| Fixtures | `GET /api/fixtures/snapshot` |
| Historical scores | `GET /api/scores/historical/{fixtureId}` |
| Settlement proofs | `GET /api/scores/stat-validation?fixtureId&seq&statKeys` |
| On-chain verification | `validateStatV2` on the TxLINE program (devnet `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`) |

## Status

- [x] Data spine: live SSE + replay with identical semantics, raw-fidelity journals
- [x] Deterministic brain: de-vig, λ-solver, in-play Poisson, S1–S3, risk engine
- [x] Intelligence layer: calibration-scaled Kelly, UCB allocation, SPRT self-suspension, on-chain self-reviews
- [x] Track record store: append-only, event-sourced, crash-safe
- [x] TxLINE signup live on devnet (on-chain free-tier subscription, activated API token)
- [x] Real corpus: 20 complete World Cup knockout matches recovered via historical endpoints
- [x] **Trustless settlement proven on real data** — England 1-2 Argentina verified via
      `validateStatV2` against the on-chain Merkle root (true claim accepted, false claim rejected)
- [x] Live 24/7: agent trading the real devnet streams (paper mode); recorder capturing
- [x] Hardening: boot-time intelligence rebuild · write-ahead commit journal with boot
      reconcile · `GET /stream` live brain feed (SSE) · `GET /digest` season scorecard
- [x] 36-test suite incl. bit-for-bit determinism over the full pipeline
- [ ] 20-match backtest report (harness built, sweep running)
- [ ] Anchor programs (escrow market, vault, registry) — P3, toolchain confirmed working
- [ ] Demo video + deployment

---

*This project reads live data from TxLINE under the World Cup hackathon access terms.
It is a technology demonstration on Solana devnet; nothing here is gambling services
or financial advice.*
