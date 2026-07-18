import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { ReplayFeed } from "../src/feed/replay";
import { parseJson, parseScoreRecord } from "../src/feed/parse";
import { ScoreRecord, SoccerPhase } from "../src/feed/types";
import { AllocationEngine } from "../src/intelligence/allocation";
import { CalibrationTracker } from "../src/intelligence/calibration";
import { SuspensionMonitor } from "../src/intelligence/sprt";
import { FixtureModel, MarketView } from "../src/model/fair";
import { DEFAULT_LIMITS, initialRiskState, registerSettlement } from "../src/risk/limits";
import { planActualOutcome } from "../src/settle/proofs";
import { MatchState, MatchStateStore, goals } from "../src/state/match";
import { OddsStateStore } from "../src/state/odds";
import { ModelStore, StrategyContext, Trigger, buildViews } from "../src/strategy/context";
import { runEngine } from "../src/strategy/engine";
import { DecisionRecord, StrategyId } from "../src/strategy/types";

/**
 * Headless backtest harness — replays the recorded tournament corpus
 * through the EXACT live pipeline (feed → state → model → strategies →
 * risk → settlement) and produces a full track record without touching the
 * live agent's stores or the chain.
 *
 * Matches are processed sequentially in kickoff order with ONE shared
 * intelligence layer (calibration / allocation / SPRT), so what the agent
 * learns from match 1 shapes how it trades match 20 — the same evolution
 * the live agent would experience across the tournament. Risk state is
 * fresh per match (per-match exposure discipline) but equity carries.
 *
 * Deterministic by construction: every clock is a record timestamp; there
 * is no Date.now(), no randomness, no network. Same corpus → same report.
 *
 * Usage: tsx tools/backtest.ts [recordingsRoot]
 *   recordingsRoot defaults to data/recordings/devnet (backfill-* dirs).
 */

const STRATEGIES: StrategyId[] = ["S1_COHERENCE", "S2_REACTION", "S3_CONVERGENCE"];
const START_BANKROLL_USDC = 2000;
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DEFAULT_CORPUS_ROOT = path.join(REPO_ROOT, "data", "recordings", "devnet");
const REPORT_DIR = path.join(REPO_ROOT, "data", "backtest");

interface Intelligence {
  calibration: CalibrationTracker;
  allocation: AllocationEngine;
  suspension: SuspensionMonitor;
}

/**
 * ModelStore with a same-inputs memo on the pre-match refit.
 *
 * ModelStore.maybeRefit runs a nested-bisection λ solve on every pre-match
 * odds tick. Live, that cost is spread across days of trickling quotes;
 * replayed at full speed over ~70k ticks per match it dominates the run.
 * The solve is a pure function of exactly three numbers — P(home win),
 * P(over) and the totals line — so when a tick leaves those unchanged we
 * return the previous fit instead of re-deriving an identical one.
 *
 * Fidelity: decisions are bit-identical with the plain store. Strategies
 * consume only the fitted lambdas (fittedAtTs is informational, never read
 * by decision logic), and identical solver inputs always produce identical
 * lambdas. Any in-play call, missing view, or changed input delegates to
 * the real implementation.
 */
class MemoizedModelStore extends ModelStore {
  private lastKey = new Map<number, string>();
  private lastResult = new Map<number, FixtureModel | undefined>();

  override maybeRefit(
    fixtureId: number,
    views: Map<string, MarketView>,
    match: MatchState | undefined,
    nowTs: number,
  ): FixtureModel | undefined {
    const preMatch = !match || match.phase === SoccerPhase.NotStarted;
    if (!preMatch) {
      // In-play path (model freezing) is cheap — always the real store.
      this.lastKey.delete(fixtureId);
      this.lastResult.delete(fixtureId);
      return super.maybeRefit(fixtureId, views, match, nowTs);
    }

    // Mirror ModelStore.maybeRefit's view selection to derive the solver's
    // exact inputs (see src/strategy/context.ts — keep in lockstep).
    let winDrawWin: MarketView | undefined;
    let totals: MarketView | undefined;
    for (const view of views.values()) {
      if (view.family === "WIN_DRAW_WIN") {
        if (!winDrawWin || view.sourceTs > winDrawWin.sourceTs) winDrawWin = view;
      } else if (view.family === "TOTAL_GOALS") {
        const better =
          !totals ||
          Math.abs((view.line ?? 99) - 2.5) < Math.abs((totals.line ?? 99) - 2.5) ||
          ((view.line ?? 99) === (totals.line ?? 99) && view.sourceTs > totals.sourceTs);
        if (better) totals = view;
      }
    }
    if (!winDrawWin || !totals) return super.maybeRefit(fixtureId, views, match, nowTs);

    const overIndex = totals.outcomes.indexOf("over");
    const key =
      `${winDrawWin.marketProbs[0]}|` +
      `${totals.marketProbs[overIndex === -1 ? 0 : overIndex]}|` +
      `${totals.line ?? 2.5}`;
    if (this.lastKey.get(fixtureId) === key) return this.lastResult.get(fixtureId);

    const result = super.maybeRefit(fixtureId, views, match, nowTs);
    this.lastKey.set(fixtureId, key);
    this.lastResult.set(fixtureId, result);
    return result;
  }
}

interface MatchSource {
  name: string;
  dir: string;
  fixtureId: number;
  /** Scheduled kickoff from the first score record carrying one. */
  startTime: number;
}

interface SuspensionEvent {
  ts: number;
  fixtureId: number;
  strategy: StrategyId;
  event: "suspended" | "resumed";
}

interface StrategyTally {
  decisions: number;
  settled: number;
  wins: number;
  stakedUsdc: number;
  pnlUsdc: number;
}

interface MatchResult {
  name: string;
  fixtureId: number;
  participants: string;
  startTime: number;
  finalScore: string;
  finalised: boolean;
  decisions: number;
  settled: number;
  wins: number;
  stakedUsdc: number;
  pnlUsdc: number;
  /** Zero-stake decisions made while a strategy ran in SPRT shadow mode. */
  shadow: number;
  /** Positions left open because the journal never finalised the fixture. */
  voided: number;
  equityAfterUsdc: number;
}

/** Find backfill-* match directories and order them by scheduled kickoff. */
async function discoverMatches(root: string): Promise<MatchSource[]> {
  const sources: MatchSource[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("backfill-")) continue;
    const dir = path.join(root, entry.name);
    const scoresFile = path.join(dir, "scores.ndjson");
    if (!fs.existsSync(scoresFile) || !fs.existsSync(path.join(dir, "odds.ndjson"))) continue;
    const peek = await peekFirstScore(scoresFile);
    if (!peek) continue;
    sources.push({
      name: entry.name,
      dir,
      fixtureId: peek.fixtureId,
      startTime: peek.startTime ?? peek.firstTs,
    });
  }
  sources.sort((a, b) => a.startTime - b.startTime || a.fixtureId - b.fixtureId);
  return sources;
}

/** Stream the scores journal just far enough to learn kickoff + fixture. */
async function peekFirstScore(
  file: string,
): Promise<{ fixtureId: number; startTime?: number; firstTs: number } | null> {
  const stream = fs.createReadStream(file);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let fixtureId: number | undefined;
  let firstTs: number | undefined;
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let journal: { type?: string; data?: unknown };
      try {
        journal = JSON.parse(line);
      } catch {
        continue;
      }
      if (journal.type !== "event" || typeof journal.data !== "string") continue;
      const record = parseScoreRecord(parseJson(journal.data));
      if (!record) continue;
      fixtureId ??= record.fixtureId;
      firstTs ??= record.ts;
      if (record.startTime !== undefined) {
        return { fixtureId: record.fixtureId, startTime: record.startTime, firstTs };
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return fixtureId !== undefined && firstTs !== undefined ? { fixtureId, firstTs } : null;
}

/**
 * Run one match through the full pipeline. Mirrors Agent.onEvent /
 * Agent.evaluate / Agent.settleFixture exactly (minus chain I/O): odds
 * updates and goal/red-card score deltas trigger the engine; the
 * game_finalised record settles every open position from the proof plan.
 */
async function runMatch(
  source: MatchSource,
  intel: Intelligence,
  equityStartUsdc: number,
  tallies: Map<StrategyId, StrategyTally>,
  suspensionEvents: SuspensionEvent[],
  vetoCounts: Map<string, number>,
): Promise<MatchResult> {
  const feed = new ReplayFeed(source.dir, 0);
  const matchStore = new MatchStateStore();
  const oddsStore = new OddsStateStore();
  const modelStore = new MemoizedModelStore();
  // Fresh risk state per match (clean exposure maps and day counter), with
  // equity carried across the tournament. Deterministic: the day key is set
  // from the first gated event's own timestamp.
  const riskState = initialRiskState(equityStartUsdc);

  const open = new Map<string, DecisionRecord>();
  const result: MatchResult = {
    name: source.name,
    fixtureId: source.fixtureId,
    participants: "?",
    startTime: source.startTime,
    finalScore: "-",
    finalised: false,
    decisions: 0,
    settled: 0,
    wins: 0,
    stakedUsdc: 0,
    pnlUsdc: 0,
    shadow: 0,
    voided: 0,
    equityAfterUsdc: equityStartUsdc,
  };

  const evaluate = (fixtureId: number, trigger: Trigger, recvTs: number): void => {
    const odds = oddsStore.get(fixtureId);
    if (!odds) return;
    const match = matchStore.get(fixtureId);
    const views = buildViews(odds);
    if (views.size === 0) return;
    const nowTs = trigger.record.ts;
    const model = modelStore.maybeRefit(fixtureId, views, match, nowTs);
    if (!model) return;

    const ctx: StrategyContext = { nowTs, trigger, match, odds, model, views };
    const output = runEngine(
      ctx,
      {
        calibration: intel.calibration,
        allocation: intel.allocation,
        suspension: intel.suspension,
        riskState,
        limits: DEFAULT_LIMITS,
        mode: "paper",
        hasOpenIdentical: (intent, shadow) =>
          [...open.values()].some(
            (d) =>
              d.fixtureId === intent.fixtureId &&
              d.marketKey === intent.marketKey &&
              d.outcomeIndex === intent.outcomeIndex &&
              (shadow
                ? d.stakeUsdc === 0 && d.strategy === intent.strategy
                : d.stakeUsdc > 0),
          ),
      },
      recvTs,
    );

    for (const veto of output.vetoes) {
      // Collapse variable details ("data stale (34s old)") into one bucket.
      const reason = veto.reason.replace(/\s*\(.*\)$/, "");
      vetoCounts.set(reason, (vetoCounts.get(reason) ?? 0) + 1);
    }
    for (const decision of output.decisions) {
      open.set(decision.hash, decision);
      result.decisions += 1;
      if (decision.stakeUsdc === 0) result.shadow += 1;
      tally(tallies, decision.strategy).decisions += 1;
    }
  };

  const settleFixture = (fixtureId: number, finalRecord: ScoreRecord): void => {
    const positions = [...open.values()].filter((d) => d.fixtureId === fixtureId);
    if (positions.length === 0) return;
    const state = matchStore.get(fixtureId);
    if (!state) return;
    const finalGoals = goals(state);

    for (const decision of positions) {
      const outcomes =
        decision.family === "WIN_DRAW_WIN"
          ? ["1", "x", "2"]
          : decision.family === "TOTAL_GOALS"
            ? ["over", "under"]
            : ["yes", "no"];
      const plan = planActualOutcome(
        decision.family,
        outcomes,
        finalGoals.p1,
        finalGoals.p2,
        decision.line,
      );
      if (!plan) continue;

      const won = plan.actualOutcomeIndex === normalizeOutcomeIndex(decision, outcomes);
      const pnlUsdc =
        decision.stakeUsdc > 0
          ? Math.round(registerSettlement(decision, won, riskState) * 100) / 100
          : 0;
      open.delete(decision.hash);

      // Learn — identical order and inputs to Agent.settleFixture. Shadow
      // (stake-0) settlements feed ONLY the SPRT; they must not move the
      // global calibration/allocation that size healthy strategies.
      if (decision.stakeUsdc > 0) {
        intel.calibration.add({
          modelProb: decision.modelProb,
          marketProb: decision.marketProb,
          won,
        });
        intel.allocation.recordSettlement(decision.strategy, pnlUsdc, decision.stakeUsdc);
      }
      const wasSuspended = intel.suspension.isSuspended(decision.strategy);
      intel.suspension.recordSettlement(decision.strategy, decision.modelProb, won);
      const isSuspended = intel.suspension.isSuspended(decision.strategy);
      if (wasSuspended !== isSuspended) {
        suspensionEvents.push({
          ts: finalRecord.ts,
          fixtureId,
          strategy: decision.strategy,
          event: isSuspended ? "suspended" : "resumed",
        });
      }

      result.settled += 1;
      result.stakedUsdc = round2(result.stakedUsdc + decision.stakeUsdc);
      result.pnlUsdc = round2(result.pnlUsdc + pnlUsdc);
      if (won) result.wins += 1;
      const strategyTally = tally(tallies, decision.strategy);
      strategyTally.settled += 1;
      strategyTally.stakedUsdc = round2(strategyTally.stakedUsdc + decision.stakeUsdc);
      strategyTally.pnlUsdc = round2(strategyTally.pnlUsdc + pnlUsdc);
      if (won) strategyTally.wins += 1;
    }
  };

  for await (const event of feed.events()) {
    if (event.kind === "odds") {
      oddsStore.apply(event.record);
      evaluate(event.record.fixtureId, { type: "odds", record: event.record }, event.recvTs);
    } else if (event.kind === "score") {
      const delta = matchStore.apply(event.record);
      if (delta.goalScored || delta.redCardShown) {
        evaluate(
          event.record.fixtureId,
          {
            type: "score",
            record: event.record,
            goal: delta.goalScored,
            red: delta.redCardShown,
          },
          event.recvTs,
        );
      }
      if (delta.becameFinal) settleFixture(event.record.fixtureId, event.record);
    }
  }

  // Journal exhausted. Any position still open (fixture never finalised)
  // is voided: escrowed stake returns to equity, nothing is scored.
  for (const decision of open.values()) {
    if (decision.stakeUsdc > 0) riskState.equityUsdc += decision.stakeUsdc;
    result.voided += 1;
  }

  const state = matchStore.get(source.fixtureId);
  if (state) {
    result.finalised = state.finalised;
    if (state.participant1Id !== undefined && state.participant2Id !== undefined) {
      result.participants = `${state.participant1Id} v ${state.participant2Id}`;
    }
    if (state.finalised) {
      const finalGoals = goals(state);
      result.finalScore = `${finalGoals.p1}-${finalGoals.p2}`;
    }
  }
  result.equityAfterUsdc = round2(riskState.equityUsdc);
  return result;
}

/** Same normalization Agent uses before comparing to the proof plan. */
function normalizeOutcomeIndex(decision: DecisionRecord, outcomes: string[]): number {
  const index = outcomes.indexOf(decision.outcomeName.toLowerCase());
  return index === -1 ? decision.outcomeIndex : index;
}

function tally(tallies: Map<StrategyId, StrategyTally>, strategy: StrategyId): StrategyTally {
  let entry = tallies.get(strategy);
  if (!entry) {
    entry = { decisions: 0, settled: 0, wins: 0, stakedUsdc: 0, pnlUsdc: 0 };
    tallies.set(strategy, entry);
  }
  return entry;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function round4(x: number | null): number | null {
  return x === null ? null : Math.round(x * 10000) / 10000;
}

function usd(x: number): string {
  return x.toFixed(2);
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function pad(value: string | number, width: number, left = false): string {
  const s = String(value);
  return left ? s.padEnd(width) : s.padStart(width);
}

interface Report {
  corpus: { root: string; matches: number; firstKickoff: string; lastKickoff: string };
  config: {
    startBankrollUsdc: number;
    mode: "paper";
    strategies: StrategyId[];
    limits: typeof DEFAULT_LIMITS;
  };
  aggregate: {
    decisions: number;
    settled: number;
    wins: number;
    winRate: number | null;
    stakedUsdc: number;
    pnlUsdc: number;
    roi: number | null;
    finalEquityUsdc: number;
    voided: number;
    shadowDecisions: number;
  };
  perStrategy: Record<
    string,
    StrategyTally & { winRate: number | null; roi: number | null }
  >;
  calibration: ReturnType<CalibrationTracker["report"]>;
  allocation: {
    finalWeights: Record<string, number>;
    arms: ReturnType<AllocationEngine["stats"]>;
  };
  suspension: {
    events: SuspensionEvent[];
    final: ReturnType<SuspensionMonitor["snapshot"]>;
  };
  vetoesByReason: Record<string, number>;
  matches: MatchResult[];
}

function buildMarkdown(report: Report): string {
  const a = report.aggregate;
  const c = report.calibration;
  const lines: string[] = [];
  lines.push("# SHARPE Backtest Report");
  lines.push("");
  lines.push(
    `Replay of **${report.corpus.matches} recorded matches** (${report.corpus.firstKickoff} → ` +
      `${report.corpus.lastKickoff}) through the exact live pipeline — paper execution, ` +
      `starting bankroll ${usd(report.config.startBankrollUsdc)} USDC, one shared intelligence ` +
      `layer evolving across matches in kickoff order.`,
  );
  lines.push("");
  lines.push("## Aggregate");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---|");
  lines.push(`| Decisions | ${a.decisions} |`);
  lines.push(`| Settled | ${a.settled} |`);
  lines.push(`| Wins | ${a.wins} |`);
  lines.push(`| Win rate | ${a.winRate === null ? "-" : pct(a.winRate)} |`);
  lines.push(`| Total staked | ${usd(a.stakedUsdc)} USDC |`);
  lines.push(`| Total P&L | ${a.pnlUsdc >= 0 ? "+" : ""}${usd(a.pnlUsdc)} USDC |`);
  lines.push(`| ROI (P&L / staked) | ${a.roi === null ? "-" : pct(a.roi)} |`);
  lines.push(
    `| Equity | ${usd(report.config.startBankrollUsdc)} → ${usd(a.finalEquityUsdc)} USDC |`,
  );
  lines.push(`| Shadow (zero-stake) decisions | ${a.shadowDecisions} |`);
  lines.push(`| Voided (fixture never finalised) | ${a.voided} |`);
  lines.push("");
  lines.push("## Per strategy");
  lines.push("");
  lines.push("| Strategy | Decisions | Settled | Wins | Win rate | Staked | P&L | ROI |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const id of report.config.strategies) {
    const s = report.perStrategy[id];
    if (!s) continue;
    lines.push(
      `| ${id} | ${s.decisions} | ${s.settled} | ${s.wins} | ` +
        `${s.winRate === null ? "-" : pct(s.winRate)} | ${usd(s.stakedUsdc)} | ` +
        `${s.pnlUsdc >= 0 ? "+" : ""}${usd(s.pnlUsdc)} | ${s.roi === null ? "-" : pct(s.roi)} |`,
    );
  }
  lines.push("");
  lines.push("## Calibration (model vs market)");
  lines.push("");
  if (c.samples === 0 || c.modelBrier === null || c.marketBrier === null) {
    lines.push("No settled samples — calibration unavailable.");
  } else {
    const advantage = c.advantage ?? 0;
    lines.push("| Metric | Value |");
    lines.push("|---|---|");
    lines.push(`| Samples (rolling window) | ${c.samples} |`);
    lines.push(`| Model Brier | ${c.modelBrier.toFixed(4)} |`);
    lines.push(`| Market Brier | ${c.marketBrier.toFixed(4)} |`);
    lines.push(`| Advantage (market − model) | ${advantage >= 0 ? "+" : ""}${advantage.toFixed(4)} |`);
    lines.push(`| Staking factor | ${c.factor.toFixed(2)} |`);
    lines.push("");
    lines.push(
      advantage > 0
        ? `**Verdict: the model is beating the market** — lower Brier score by ${advantage.toFixed(4)} over the last ${c.samples} settlements.`
        : `**Verdict: the model is NOT beating the market** — Brier score higher by ${(-advantage).toFixed(4)} over the last ${c.samples} settlements; the calibration factor has scaled stakes to ${c.factor.toFixed(2)}x in response.`,
    );
  }
  lines.push("");
  lines.push("## Suspension events (SPRT)");
  lines.push("");
  if (report.suspension.events.length === 0) {
    lines.push("None — no strategy tripped the sequential test.");
  } else {
    lines.push("| Time (UTC) | Fixture | Strategy | Event |");
    lines.push("|---|---|---|---|");
    for (const e of report.suspension.events) {
      lines.push(
        `| ${new Date(e.ts).toISOString()} | ${e.fixtureId} | ${e.strategy} | ${e.event} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Per match");
  lines.push("");
  lines.push("| # | Fixture | Teams | Kickoff (UTC) | Final | Decisions | Settled | Wins | Staked | P&L | Equity after |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
  report.matches.forEach((m, i) => {
    lines.push(
      `| ${i + 1} | ${m.fixtureId} | ${m.participants} | ${new Date(m.startTime).toISOString().slice(0, 16)} | ` +
        `${m.finalScore} | ${m.decisions} | ${m.settled} | ${m.wins} | ${usd(m.stakedUsdc)} | ` +
        `${m.pnlUsdc >= 0 ? "+" : ""}${usd(m.pnlUsdc)} | ${usd(m.equityAfterUsdc)} |`,
    );
  });
  lines.push("");
  lines.push("## Vetoes by reason");
  lines.push("");
  lines.push("| Reason | Count |");
  lines.push("|---|---|");
  for (const [reason, count] of Object.entries(report.vetoesByReason)) {
    lines.push(`| ${reason} | ${count} |`);
  }
  lines.push("");
  lines.push("## Method");
  lines.push("");
  lines.push(
    "- Same code path as the live agent: `ReplayFeed` → `MatchStateStore`/`OddsStateStore` → " +
      "`ModelStore.maybeRefit` → `runEngine` (odds triggers + goal/red-card triggers) → " +
      "`planActualOutcome` settlement at each fixture's `game_finalised` record.",
  );
  lines.push(
    "- One shared `CalibrationTracker`/`AllocationEngine`/`SuspensionMonitor` across all matches, " +
      "fed settlements sequentially in kickoff order; fresh risk state per match with equity carried.",
  );
  lines.push(
    "- Fully deterministic: all clocks are record timestamps from the journals. " +
      "Re-running this harness over the same corpus reproduces this report byte for byte.",
  );
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const root = process.argv[2]
    ? path.resolve(process.argv[2])
    : DEFAULT_CORPUS_ROOT;
  const sources = await discoverMatches(root);
  if (sources.length === 0) {
    console.error(`no backfill-* match directories with journals found under ${root}`);
    process.exitCode = 1;
    return;
  }

  console.log(`[backtest] corpus: ${sources.length} matches under ${root}`);
  console.log(`[backtest] bankroll: ${usd(START_BANKROLL_USDC)} USDC (paper), intelligence shared across matches\n`);

  const intel: Intelligence = {
    calibration: new CalibrationTracker(),
    allocation: new AllocationEngine(STRATEGIES),
    suspension: new SuspensionMonitor(STRATEGIES),
  };
  const tallies = new Map<StrategyId, StrategyTally>();
  const suspensionEvents: SuspensionEvent[] = [];
  const vetoCounts = new Map<string, number>();
  const results: MatchResult[] = [];
  let equity = START_BANKROLL_USDC;

  const header =
    `${pad("#", 3)}  ${pad("fixture", 9)}  ${pad("teams", 13, true)}  ${pad("final", 5)}  ` +
    `${pad("dec", 4)}  ${pad("set", 4)}  ${pad("win", 4)}  ${pad("staked", 9)}  ${pad("pnl", 9)}  ${pad("equity", 9)}`;
  console.log(header);
  console.log("-".repeat(header.length));

  for (const [index, source] of sources.entries()) {
    const result = await runMatch(source, intel, equity, tallies, suspensionEvents, vetoCounts);
    equity = result.equityAfterUsdc;
    results.push(result);
    console.log(
      `${pad(index + 1, 3)}  ${pad(result.fixtureId, 9)}  ${pad(result.participants, 13, true)}  ` +
        `${pad(result.finalScore, 5)}  ${pad(result.decisions, 4)}  ${pad(result.settled, 4)}  ` +
        `${pad(result.wins, 4)}  ${pad(usd(result.stakedUsdc), 9)}  ` +
        `${pad((result.pnlUsdc >= 0 ? "+" : "") + usd(result.pnlUsdc), 9)}  ${pad(usd(result.equityAfterUsdc), 9)}`,
    );
  }

  const decisions = results.reduce((s, r) => s + r.decisions, 0);
  const settled = results.reduce((s, r) => s + r.settled, 0);
  const wins = results.reduce((s, r) => s + r.wins, 0);
  const staked = round2(results.reduce((s, r) => s + r.stakedUsdc, 0));
  const pnl = round2(results.reduce((s, r) => s + r.pnlUsdc, 0));
  const voided = results.reduce((s, r) => s + r.voided, 0);
  const shadowDecisions = results.reduce((s, r) => s + r.shadow, 0);
  const calibration = intel.calibration.report();

  const perStrategy: Report["perStrategy"] = {};
  for (const id of STRATEGIES) {
    const t = tallies.get(id) ?? { decisions: 0, settled: 0, wins: 0, stakedUsdc: 0, pnlUsdc: 0 };
    perStrategy[id] = {
      ...t,
      winRate: t.settled > 0 ? round4(t.wins / t.settled) : null,
      roi: t.stakedUsdc > 0 ? round4(t.pnlUsdc / t.stakedUsdc) : null,
    };
  }

  const report: Report = {
    corpus: {
      root,
      matches: sources.length,
      firstKickoff: new Date(sources[0].startTime).toISOString(),
      lastKickoff: new Date(sources[sources.length - 1].startTime).toISOString(),
    },
    config: {
      startBankrollUsdc: START_BANKROLL_USDC,
      mode: "paper",
      strategies: STRATEGIES,
      limits: DEFAULT_LIMITS,
    },
    aggregate: {
      decisions,
      settled,
      wins,
      winRate: settled > 0 ? round4(wins / settled) : null,
      stakedUsdc: staked,
      pnlUsdc: pnl,
      roi: staked > 0 ? round4(pnl / staked) : null,
      finalEquityUsdc: equity,
      voided,
      shadowDecisions,
    },
    perStrategy,
    calibration: {
      ...calibration,
      modelBrier: round4(calibration.modelBrier),
      marketBrier: round4(calibration.marketBrier),
      advantage: round4(calibration.advantage),
    },
    allocation: {
      finalWeights: Object.fromEntries(
        [...intel.allocation.weights()].map(([k, v]) => [k, round4(v) as number]),
      ),
      arms: intel.allocation.stats(),
    },
    suspension: { events: suspensionEvents, final: intel.suspension.snapshot() },
    vetoesByReason: Object.fromEntries(
      [...vetoCounts.entries()].sort((a, b) => b[1] - a[1]),
    ),
    matches: results,
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const jsonPath = path.join(REPORT_DIR, "report.json");
  const mdPath = path.join(REPORT_DIR, "report.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(mdPath, buildMarkdown(report));

  console.log("-".repeat(header.length));
  console.log(
    `[aggregate] decisions=${decisions} settled=${settled} wins=${wins} ` +
      `winRate=${settled > 0 ? pct(wins / settled) : "-"} staked=${usd(staked)} ` +
      `pnl=${pnl >= 0 ? "+" : ""}${usd(pnl)} roi=${staked > 0 ? pct(pnl / staked) : "-"} ` +
      `equity=${usd(START_BANKROLL_USDC)}→${usd(equity)}`,
  );
  for (const id of STRATEGIES) {
    const s = perStrategy[id];
    console.log(
      `[strategy] ${id}: n=${s.settled} wins=${s.wins} ` +
        `winRate=${s.winRate === null ? "-" : pct(s.winRate)} staked=${usd(s.stakedUsdc)} ` +
        `pnl=${s.pnlUsdc >= 0 ? "+" : ""}${usd(s.pnlUsdc)}`,
    );
  }
  if (calibration.modelBrier !== null && calibration.marketBrier !== null) {
    console.log(
      `[calibration] samples=${calibration.samples} modelBrier=${calibration.modelBrier.toFixed(4)} ` +
        `marketBrier=${calibration.marketBrier.toFixed(4)} ` +
        `advantage=${(calibration.advantage ?? 0) >= 0 ? "+" : ""}${(calibration.advantage ?? 0).toFixed(4)} ` +
        `factor=${calibration.factor.toFixed(2)}`,
    );
  }
  console.log(
    `[suspension] events=${suspensionEvents.length}` +
      (suspensionEvents.length > 0
        ? ` — ${suspensionEvents.map((e) => `${e.strategy} ${e.event} @ fixture ${e.fixtureId}`).join("; ")}`
        : ""),
  );
  if (voided > 0) console.log(`[warn] ${voided} position(s) voided — fixture(s) never finalised in journal`);
  console.log(`[report] ${jsonPath}`);
  console.log(`[report] ${mdPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[backtest] fatal: ${error?.stack ?? error}`);
    process.exitCode = 1;
  });
}
