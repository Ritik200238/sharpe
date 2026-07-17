# Handoff: SHARPE Frontend

## Overview
Production-quality frontend for **SHARPE** — the autonomous sports trading agent with an unfakeable public track record. Single-page app with 7 surfaces: Command (landing), Track Record/Ledger, Performance Digest, Decision Detail, Fixture Story, About (trust story), and System. It renders the read-only SHARPE API (`SHARPEFRONTEND.md` §15) and its SSE stream in real time.

**Source of truth for all functionality:** `SHARPEFRONTEND.md` (bundled). This handoff covers the *design*; that document covers the *contract*. If they disagree on function, the spec wins.

## About the Design Files
`SHARPE.dc.html` is a **design reference created in HTML** — a working prototype showing intended look and behavior, running against a **simulated** data engine that mimics the real API contract (replay cycles, goal bursts, commit upgrades, settlements, reviews, suspension arc). It is NOT production code to copy directly. Your task: **recreate this design in the target codebase** (React/Vite recommended if none exists; the repo is TypeScript — use React + TypeScript) and wire it to the real API at the configured base URL (`http://localhost:8787` in dev) using REST hydration + `EventSource('/stream')` per spec §11.

## Fidelity
**High-fidelity.** Colors, typography, spacing, and interactions are final. Recreate pixel-perfectly. All copy in the prototype is final copy (the `reason`/`notes` strings shown are examples of server data — always render server strings as plain text, never HTML).

## Design Tokens

Colors:
- Background: `#0B0C0F`
- Panel: `#12141A` · Panel-inset / code: `#0E1015` · Panel hover: `#171A21`
- Border: `#1E222B` · Border strong / control: `#2A3040` · Border hover: `#3A4256`
- Text: `#E7EAF0` · Muted: `#9AA3B5` · Faint/labels: `#6B7386` · Mid: `#C9D2E3` · Shadow-gray: `#8A93A5`
- Brand accent (lime): `#B7F542` (link hover `#D3FF7A`) — used for wordmark block, active states, live dots, links, focus rings
- Win/verified green: `#43D98A` · Loss/failed red: `#FF7A76` · Pending amber: `#F5B84B`
- Strategy identity: S1_COHERENCE `#7DA7FF` (blue) · S2_REACTION `#F5B84B` (amber) · S3_CONVERGENCE `#C792EA` (purple)
- Selection: `rgba(183,245,66,.25)` · Active chip bg: `rgba(183,245,66,.08)`

Typography:
- Display/UI: **Space Grotesk** (400/500/600/700)
- All numbers, hashes, timestamps, chips, labels: **IBM Plex Mono** (400/500/600)
- Base 14px/1.5. Page titles 20px/700 (About hero 26px). Stat values 22px/600 mono. Section labels 11px, uppercase, letter-spacing .12em, color `#6B7386`, weight 600. Kind badges 10px mono, letter-spacing .1em. Chips/meta 11–12px mono.

Spacing & shape:
- Content max-width 1400px, padding 20–24px; About/System max-width 760px
- Panels: radius 10px, padding 14–16px, 1px border `#1E222B`
- Feed cards: radius 8px, padding 11px 14px, **3px left border in the event's accent color**
- Chips: radius 5px (14px pill for filter chips), padding 2px 8px
- Buttons: radius 6px, bg `#171A21`, border `#2A3040`, hover border → lime
- Focus (everything interactive): `outline: 2px solid #B7F542; outline-offset: 2px`
- Grid gaps 12–16px

Motion:
- Live dots: 2.2s opacity pulse. Allocation bars: `width .8s ease`. All motion disabled under `prefers-reduced-motion`.

## Screens / Views

### 1. Header (persistent, sticky)
56px, `rgba(11,12,15,.92)` + `backdrop-filter: blur(14px)`, bottom border. Left→right: wordmark **SHARPE** + 8×14px lime block (click = home); nav (Command, Ledger, Performance, About, System — active = `#1E222B` bg, white text; Ledger stays active on Detail/Fixture views); right-aligned mono badges `devnet`, `feed: replay|live`, `exec: paper|chain` (from `/status`, never assumed) + pulsing connection dot + `LIVE STREAM` label.

### 2. Command view (landing)
- **Vitals strip**: auto-fit grid (min 180px) of 5 stat cards: Realized bankroll (+ signed all-time delta + peak), Equity (+ escrowed note), Open positions (clickable → ledger filtered to open), All-time P&L (signed, green/red), Calibration factor (`×1.06` + plain-English meaning).
- **Digest one-liner**: `digestSummary` verbatim in a mono inset bar.
- **Main grid** `1.7fr / 1fr` (stack on mobile):
  - **Agent feed** (left): heading + live dot + Pause/Resume button. While paused, buffer events and show "N events buffered — data still flowing". Event cards (full-width buttons): kind badge (DECISION lime / SHADOW gray / SETTLEMENT green-or-red / REVIEW purple / VETO gray / MATCH white / STATUS gray), strategy id in its color, bold title, right-aligned relative time; reason sentence in muted 12.5px; chip row (edge, stake, price, `commit pending…` amber → `committed ✓` green; for settlements: signed P&L, final score, `VERIFIED ✓ on-chain proof` / `paper settle — no validator` / `PROOF FAILED — position stays open, retrying`). Click → decision detail / fixture story / system.
  - **Right rail**: Feed liveness panel (last event age, live fixtures, odds/score/heartbeat counters, tracked markets + "nothing worth trading is healthy" note); Capital allocation (3 labeled bars in strategy colors, % + suspended note); Self-regulation (Brier pair, advantage, samples, factor meaning + per-strategy LIVE/SUSPENDED rows with llr/shadow-wins); Recent vetoes (strategy + reason, left-rule list).

### 3. Track record / Ledger
Title + "raw export · GET /track-record" toggle (reveals scrollable `<pre>` of the JSON). Two filter chip rows (strategy: ALL/S1/S2/S3; status: ALL/OPEN/SETTLED/WON/LOST/SHADOW — single-select each, lime active state). Aggregates bar for the current filter (decisions, settled, wins, open, staked, signed P&L). Table (min-width 940px, horizontal scroll **inside its container** — page never scrolls horizontally): Decided (relative), Strategy (colored mono), Fixture id, Market·outcome, Edge (`+14.0pp`), Stake, Price (4dp), Status (WON green / LOST red / OPEN amber / SHADOW gray — text label, never color alone), signed P&L, "open" button. Row hover `#171A21`; row click → detail. Empty filter → "No records match this filter."

### 4. Performance digest
Window toggle (7/30 days). Overall aggregates bar. Strategy table: n, wins, hit, staked, P&L, ROI, `Brier ↓` (with "lower is better" title tooltip), mean edge, Activity (`ACTIVE` green / `QUIET`/`STALE` amber, prefixed `SUSPENDED ·` red when SPRT-benched). Row click → ledger pre-filtered to that strategy. Below, grid `1.6fr/1fr`: Daily P&L bar chart (bars green/red by sign, signed value above, date + decision count below, height ∝ |pnl|, horizontal scroll) and SPRT suspension panel (per-strategy state + llr/shadow wins/suspension count + explainer copy).

### 5. Decision detail
Back link → ledger. Header: strategy chip (colored border), title (market · outcome), `SHADOW · stake 0` badge when applicable, absolute UTC + relative time. Meta line: fixture link, raw `marketKey`, mode. **Reason blockquote**: 15.5px, panel with 3px strategy-colored left border, attribution "— written by the agent at decision time". Three-card grid:
- *Why it acted*: model vs market probability bars (lime vs gray, width = %), edge in pp with "(probability points, model − market)".
- *Position & sizing internals*: stake, price, Kelly fraction, calibration factor, allocation weight, bankroll at decision.
- *Input provenance*: score seq/ts, odds message id, odds age, λ home/away + determinism note.

**Verification panel**: full 64-hex hash (word-break, copy button → "copied ✓" for 1.6s), commitment row (`CONFIRMED ✓` green + truncated sig + explorer link `https://explorer.solana.com/tx/<sig>?cluster=devnet`, target blank + `rel="noopener noreferrer"`; or `PENDING…` amber), verify-yourself row with `npx tsx tools/verify-proof.ts` code chip.

**Settlement panel** (if settled): WON/LOST + signed P&L (border tinted `rgba(67,217,138,.4)` / `rgba(255,122,118,.4)`), final score, timestamp, verification chip (VERIFIED ✓ / PAPER SETTLE / PROOF FAILED — RETRYING) + statKeys/seq/method detail. If open: dashed-border "POSITION OPEN" card explaining escrow + proof-gated settlement. Footer buttons: "Fixture story →", "S# history →".

### 6. Fixture story
Back link; title "Fixture <id>", score (`final 1–2` white / `IN PLAY` lime), sub-line "P1888 vs P1489 · participant ids as delivered by the feed…". Chronological list (max-width 860px) of the same event-card component with **absolute UTC timestamps** instead of relative: decisions → settlements → review.

### 7. About / trust story
Max 760px. Hero "A track record that cannot be faked." + subhead. Sections (lime uppercase labels): The problem ($3.7M scam fact); three numbered cards (01 commits before outcomes / 02 settles by on-chain proof / 03 learns & benches itself); Check-it-yourself (3-artifact chain, England 1–2 Argentina fixture 18241006 seq 962, verify command, mono anchor block with TxLINE program id `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` + subscription tx explorer link); How it thinks (edge concept + S1/S2/S3 one-liners in their colors); Honest limits (devnet/paper, ~50% win rate by construction, replay = same pipeline).

### 8. System
Health card (`ok` green, phase, uptime, now UTC + restart/rehydrate note), Stream card (dot + state + Last-Event-ID replay note + polling fallback), API card (endpoint list, "public and unauthenticated on purpose"), GitHub issues link.

### Footer (persistent)
Verbatim disclaimer: *"SHARPE is a technology demonstration on Solana devnet using TxLINE data. Nothing here is gambling services or financial advice."* + "data by TxLINE / TxODDS · settlement on Solana · repo ↗".

## Interactions & Behavior
- Canonical drill paths: feed event → decision detail → fixture story → explorer; digest row → filtered ledger → detail; vitals open-count → open-filtered ledger.
- Copy buttons: clipboard write, label → "copied ✓" for ~1.6s.
- Feed pause: rendering pauses, data keeps flowing into a buffer; resume prepends buffered events. Cap in-memory feed (~120 events).
- Relative timestamps re-render on a ~4s tick; use server `ts`, tolerate clock skew.
- Bursts (~20 events/s): batch state updates; no layout shift.
- External links: new tab + `noopener noreferrer`.

## Data / State Management (production wiring — spec §11–12)
- Store: upsert-by-hash maps for decisions (join settlements via `decisionHash`); records **upgrade** (commitTxSig arrives late).
- Load: `/health` + `/status` first paint → hydrate `/decisions`, `/settlements`, `/reviews`, `/digest` → open `EventSource('/stream')`; dedupe by hash; fall back to 2s polling on persistent SSE errors; rehydrate on tab-visibility regain and after agent restart (`kill -9` resilience).
- UI state: route, ledger filters (strategy/status), digest window (7/30), feed paused, copied-flash. No client persistence needed.
- Handle every state in spec §12: zero history, live-but-quiet, burst, long-lived opens, shadow decisions, `verified:false` retry, commit upgrade, stream drop, API dead-state, restart, idle tab, unknown fields (ignore silently).

## Accessibility
- WCAG 2.1 AA: semantic headings, real `<button>`s everywhere clickable, visible lime focus ring on all interactives, no color-only encoding (WON/LOST/VERIFIED always text), `aria-live="polite"` region announcing batched feed updates ("N new events…", throttled ~4s), `prefers-reduced-motion` kills all animation, tables scroll in-container only.

## Number formatting (spec §21)
USDC 2dp, P&L always signed; probabilities 1dp percent; edge signed `pp`; odds 4dp; Brier 3–4dp ("lower is better" hint); ROI/hit 1dp percent; relative + absolute-UTC timestamps; hashes truncated for display (`first10…last4`), full value copyable; fixtures as `id · P<p1> vs P<p2>`.

## Assets
No images/icons required. Fonts: Space Grotesk + IBM Plex Mono (Google Fonts in prototype — self-host in production per spec's CSP guidance). Wordmark is pure CSS (text + lime block).

## Files
- `SHARPE.dc.html` — the full high-fidelity prototype (all 7 views, simulated data engine, event VM builders, digest computation). Template markup = the layout truth; logic class shows formatting helpers, view-model shapes, and the simulation you'll replace with real API calls.
- `SHARPEFRONTEND.md` — the functional specification (API contract, states, acceptance criteria). Implement against this.
