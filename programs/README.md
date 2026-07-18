# programs/ — On-chain settlement (P3, roadmap)

## What already works on-chain (this is the important part)

SHARPE's trustless settlement is **already proven end-to-end on Solana devnet** — it does
not depend on anything in this directory:

- Every decision hash is committed on-chain before the outcome (Memo program, with a
  write-ahead journal + boot reconcile so a commitment can never be silently lost).
- Every settlement is verified by submitting a Merkle proof to TxLINE's on-chain program
  (`validateStatV2`, devnet `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`) and checking
  it against the daily root TxODDS anchored on-chain. **A real semifinal (England 1–2
  Argentina, fixture 18241006, seq 962) was verified: the true outcome accepted, a false
  claim rejected.** Reproduce: `npx tsx services/agent/tools/verify-proof.ts`.

Per `CLAUDE.md`'s Solana ladder, that places the submission at the **Competitive→Winning**
line: the agent autonomously signs Solana transactions to record its decisions, and
self-verifies outcomes trustlessly via `validate_stat`. The pieces below complete the
"full on-chain execution loop" (escrowed USDC + proof-released payouts) — an enhancement,
not the headline. Per our framing law, the *agent* is the product; escrow/vault is
Track-3-flavored infrastructure that rides underneath it.

## The design (three Anchor programs)

1. **`market`** — binary-outcome escrow. USDC held in per-market PDAs; a settlement
   instruction CPIs into TxLINE `validateStatV2` with the Merkle proof + strategy
   predicate; on `verified == true`, funds route to the winning side. No admin key, no
   oracle, no dispute window — the same primitive the agent already exercises off-chain,
   moved into custody.
2. **`vault`** — "the agent's bankroll." Non-custodial USDC deposits by epoch; share
   accounting with a high-water-mark performance fee; the agent trades vault capital via a
   PDA-delegated authority; program-enforced position caps (even a compromised agent key
   can't exceed them).
3. **`registry`** — agent identity + decision-hash commitments as typed accounts
   (superseding the Memo path once live; batched Merkle roots per minute for mainnet cost).

The settlement predicate mapping is already built and tested off-chain
(`services/agent/src/settle/proofs.ts` — `planActualOutcome` for WIN_DRAW_WIN /
TOTAL_GOALS / BTTS), so porting it into a `market` CPI is a well-scoped, low-unknown task
once the toolchain is available.

## Why this directory ships as design, not code — honest status (we tried, empirically)

Building on the principle *"nothing half-baked — no stubs pretending to be features"*
(`CLAUDE.md`), we do **not** commit uncompiled, untested Anchor programs and call them
done. The blocker is environmental, not conceptual — and we confirmed it by actually
attempting the build four different ways, not by theorizing:

1. **`cargo-build-sbf` directly** (Agave 4.1.2 / platform-tools v1.54, both installed and
   working). The SBF program object links fine with `rust-lld`, but the host-side
   `build.rs` scripts of universal deps (`proc-macro2`, `serde_core`, `quote`) must link a
   native Windows binary → invokes **MSVC `link.exe`**, which is absent (VS 2022 Build
   Tools are installed **without the C++ workload**). → `linking with link.exe failed`.
2. **Checked for the MSVC SDK/CRT directly** — `link.exe`, `msvcrt.lib`, and the Windows
   SDK import libs (`kernel32.lib`, …) are **not present anywhere on the machine**, so even
   redirecting to `rust-lld` (which *is* available) can't link — there are no import libs.
3. **GNU host toolchain** (`stable-x86_64-pc-windows-gnu`, bundled linker). Trivial crates
   build, but anything needing an import lib (`windows-sys`) fails: the bundled `dlltool`
   errors with `CreateProcess` — the shipped mingw is **incomplete** (no assembler).
4. **`xwin`** (the standard *no-admin* way to fetch the MSVC CRT + SDK into a user dir).
   Building `xwin` itself needs `windows-sys` → blocked by the same incomplete-`dlltool`
   failure as (3).

Every autonomous path is walled off by a missing **native-Windows toolchain** component,
and every fix is a **system-level install requiring an elevation prompt** a sleeping
operator can't approve. Forcing that, then rushing three *untested* on-chain programs
before morning, would violate the "built fully" bar. This is the disciplined call —
documented in the open, with the real errors above.

### Unblock (any one — ~30–60 min)

- **WSL (recommended for Solana on Windows):** `wsl --install`, then the standard Linux
  Agave + Anchor toolchain builds cleanly with no MSVC dependency.
- **MSVC:** install the "Desktop development with C++" workload
  (`Microsoft.VisualStudio.Component.VC.Tools.x86.x64`) via the VS Build Tools installer
  (needs elevation), then `cargo-build-sbf` works natively.
- **Docker:** any `solanalabs`/`backpackapp` build image compiles it in a container.

Once any of these is in place, the three programs above are a well-scoped build: the
settlement predicate mapping is already implemented and unit-tested off-chain
(`services/agent/src/settle/proofs.ts`), and the Memo commitment path the `registry`
supersedes is already live on devnet.
