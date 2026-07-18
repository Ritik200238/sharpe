# How SHARPE makes markets

SHARPE is an **in-play market maker**: it continuously quotes a two-sided price on every live
World Cup outcome, earns the spread on the flow it fills, and manages the inventory it takes on.
It never predicts the winner — it prices fair and survives adverse selection. This is the most
real job on a trading desk, and it's the one job that doesn't require beating TxLINE's
de-margined consensus (which is a structural loser — see below).

## The quoting engine (`src/mm/quote.ts`)

For a binary outcome with model fair probability `p` (a share that pays 1 if it occurs, 0 if
not), the maker posts:

```
bid = fair + skew − halfSpread      (the price it BUYS the share at)
ask = fair + skew + halfSpread      (the price it SELLS at)
```

- **fair** comes from the same deterministic in-play model the rest of SHARPE uses (Shin de-vig
  → market-implied goal expectancies → in-play Poisson).
- **halfSpread** widens with uncertainty: more time left and higher outcome variance mean the
  fair value can wander more, so the maker demands more cushion.
- **skew** shifts the mid with inventory: long the share → shade both quotes down to offload it;
  short → shade up. This keeps the book balanced without predicting anything.

## Adverse-selection protection (`src/mm/adverse.ts`) — the hard part

The entire difficulty of in-play market-making is **toxic flow**: the instant a goal lands, fair
value jumps, and anyone faster than you hits your now-stale quotes for a guaranteed profit.
Every real maker must defend against this. SHARPE's defence keys off TxLINE's event stream (the
canonical fastest source, so nobody is faster than us):

1. **Pull** — for a few seconds after the event, quote *nothing*. A quote that doesn't exist
   can't be picked off.
2. **Widen** — then re-quote at a wide spread while the new fair value settles, so early flow
   pays a premium.
3. **Normal** — resume tight quotes once the dust clears.

## The book (`src/mm/book.ts`)

Each outcome is an independent binary share. The maker starts flat; every fill moves cash and
inventory; at match end each outcome's inventory settles to 1 (it occurred) or 0 (it didn't).
P&L decomposes into the two forces that define market-making:

- **spread captured** — the half-spread edge earned vs fair on every fill
- **adverse selection** — the loss when informed flow trades a quote the fair value runs through

A profitable maker keeps the first bigger than the second. That's the whole game.

## What the numbers show

The flow that trades against the quotes is simulated — the standard way makers backtest a
quoting strategy against realistic order flow (deterministic, seeded from the event stream, so a
replay reproduces every fill). Two kinds: **noise** (uninformed, steady, random side — where the
maker earns its spread) and **informed** (a burst right after a goal, trading the jump — the
toxic flow the protection must deflect).

Validation on a real-structure match, protection ON vs OFF:

| | net P&L | spread captured | adverse selection | toxic flow |
|---|---|---|---|---|
| **protection ON** | **+16.13 USDC** | +10.33 | 0 | 25 deflected |
| **protection OFF** | −7.12 USDC | −122.39 | −132.18 | 25 filled |

**The adverse-selection defence is worth +23 USDC — it turns a loss into a profit.** That is the
maker's entire edge, and it's the sophisticated, defensible, *measurable* piece a professional
desk would care about.

Reproduce it yourself:

```bash
npm run mm-validate --workspace services/agent    # ~6s — the numbers above, on a synthetic match
```

That runs the quoting engine protection-ON then protection-OFF and prints both books, so the
value of the defence is measured directly. (13 tests cover the maker — 10 unit tests for
quoting, protection, fills, and settlement, plus 3 that drive a full match through the live
agent.) `npm run mm-backtest --workspace services/agent` runs the same over the real recorded
corpus — but real journals are large, so it takes minutes; bound it with `-- --matches N`.

## Why not directional trading

For the record, we built and measured the directional agent first (it still lives in
`src/strategy/` and powers the fair-value model the maker reuses). Trading TxLINE's de-margined
consensus for profit is a structural loser: the backtest over 20 real matches returned
**−18.6% ROI**, and the agent's own calibration correctly collapsed its stakes in response.
Beating the sharpest aggregate price on earth isn't an edge you can honestly claim — providing
liquidity around it is. That's why SHARPE makes markets.
