import { Connection, Keypair } from "@solana/web3.js";
import { FeedEvent, FeedSource, ScoreRecord } from "./feed/types";
import { AllocationEngine } from "./intelligence/allocation";
import { CalibrationTracker } from "./intelligence/calibration";
import { buildMatchReview } from "./intelligence/review";
import { SuspensionMonitor } from "./intelligence/sprt";
import { AgentConfig } from "./platform/config";
import { AuthSession } from "./platform/auth";
import { DEFAULT_LIMITS, RiskState, initialRiskState, registerSettlement } from "./risk/limits";
import { planActualOutcome } from "./settle/proofs";
import { SettlementValidator } from "./settle/validate";
import { MatchStateStore, goals } from "./state/match";
import { OddsStateStore } from "./state/odds";
import { ModelStore, StrategyContext, Trigger, buildViews } from "./strategy/context";
import { runEngine } from "./strategy/engine";
import { DecisionRecord, SettlementRecord, StrategyId } from "./strategy/types";
import { TrackStore } from "./track/store";
import { ChainCommitter } from "./exec/commit";

const STRATEGIES: StrategyId[] = ["S1_COHERENCE", "S2_REACTION", "S3_CONVERGENCE"];

export interface AgentStatus {
  startedAtTs: number;
  network: string;
  feedMode: string;
  execMode: string;
  eventsSeen: { score: number; odds: number; heartbeat: number };
  lastEventTs: number | null;
  lastEventRecvTs: number | null;
  liveFixtures: number;
  trackedMarkets: number;
  equityUsdc: number;
  peakEquityUsdc: number;
  allocations: Record<string, number>;
  calibration: ReturnType<CalibrationTracker["report"]>;
  suspensions: Record<string, unknown>;
  aggregates: ReturnType<TrackStore["aggregates"]>;
  recentVetoes: Array<{ reason: string; strategy: string; marketKey: string; ts: number }>;
}

/**
 * SHARPE's autonomous loop: receive → analyze → decide → act → settle →
 * learn → repeat, forever. No human input after start. All I/O lives here;
 * everything it calls is pure and deterministic.
 */
export class Agent {
  private matchStore = new MatchStateStore();
  private oddsStore = new OddsStateStore();
  private modelStore = new ModelStore();
  private calibration = new CalibrationTracker();
  private allocation = new AllocationEngine(STRATEGIES);
  private suspension = new SuspensionMonitor(STRATEGIES);
  private riskState: RiskState;
  private track: TrackStore;
  private committer: ChainCommitter | null;
  private validator: SettlementValidator | null;

  private eventsSeen = { score: 0, odds: 0, heartbeat: 0 };
  private lastEventTs: number | null = null;
  private lastEventRecvTs: number | null = null;
  private recentVetoes: AgentStatus["recentVetoes"] = [];
  private startedAtTs = Date.now();
  private settling = new Set<number>();

  constructor(
    private readonly cfg: AgentConfig,
    private readonly feed: FeedSource,
    private readonly session: AuthSession | null,
    wallet: Keypair | null,
    private readonly log: (line: string) => void,
  ) {
    this.riskState = initialRiskState(cfg.bankrollUsdc);
    this.track = new TrackStore(cfg.network.network, cfg.execMode);

    if (cfg.execMode === "chain" && wallet) {
      const connection = new Connection(cfg.network.rpcUrl, "confirmed");
      this.committer = new ChainCommitter(cfg.network, wallet, (m) => this.log(`[chain] ${m}`));
      this.validator = this.session
        ? new SettlementValidator(cfg.network, connection, wallet)
        : null;
    } else {
      this.committer = null;
      this.validator = wallet && this.session
        ? new SettlementValidator(cfg.network, new Connection(cfg.network.rpcUrl, "confirmed"), wallet)
        : null;
    }

    // Rebuild open exposure from the persisted track record (crash-safe).
    for (const decision of this.track.openDecisions()) {
      if (decision.stakeUsdc > 0) {
        this.riskState.equityUsdc -= decision.stakeUsdc;
      }
    }
  }

  status(): AgentStatus {
    return {
      startedAtTs: this.startedAtTs,
      network: this.cfg.network.network,
      feedMode: this.cfg.feedMode,
      execMode: this.cfg.execMode,
      eventsSeen: this.eventsSeen,
      lastEventTs: this.lastEventTs,
      lastEventRecvTs: this.lastEventRecvTs,
      liveFixtures: this.matchStore.all().filter((m) => !m.finalised).length,
      trackedMarkets: this.oddsStore.all().reduce((s, f) => s + f.markets.size, 0),
      equityUsdc: Math.round(this.riskState.equityUsdc * 100) / 100,
      peakEquityUsdc: Math.round(this.riskState.peakEquityUsdc * 100) / 100,
      allocations: Object.fromEntries(
        [...this.allocation.weights()].map(([k, v]) => [k, Math.round(v * 1000) / 1000]),
      ),
      calibration: this.calibration.report(),
      suspensions: this.suspension.snapshot(),
      aggregates: this.track.aggregates(),
      recentVetoes: this.recentVetoes.slice(-20),
    };
  }

  recentDecisions(limit = 50): DecisionRecord[] {
    return this.track.recentDecisions(limit);
  }

  openPositions(): DecisionRecord[] {
    return this.track.openDecisions();
  }

  settlements(): SettlementRecord[] {
    return [...this.track.settlements.values()].sort((a, b) => b.settledAtTs - a.settledAtTs);
  }

  reviews() {
    return this.track.reviews;
  }

  /** The loop. Runs until the feed ends (replay) or stop() (live: never). */
  async run(): Promise<void> {
    this.log(
      `[agent] starting — network=${this.cfg.network.network} feed=${this.cfg.feedMode} exec=${this.cfg.execMode} bankroll=${this.cfg.bankrollUsdc} USDC`,
    );
    for await (const event of this.feed.events()) {
      try {
        await this.onEvent(event);
      } catch (error: any) {
        // One bad event must never kill the loop.
        this.log(`[agent] event error (contained): ${error?.message ?? error}`);
      }
    }
    this.log("[agent] feed ended");
  }

  private async onEvent(event: FeedEvent): Promise<void> {
    if (event.kind === "heartbeat") {
      this.eventsSeen.heartbeat += 1;
      return;
    }
    if (event.kind === "status") {
      this.log(`[feed:${event.stream}] ${event.message}`);
      return;
    }

    this.lastEventRecvTs = event.recvTs;
    this.lastEventTs = event.record.ts;

    if (event.kind === "odds") {
      this.eventsSeen.odds += 1;
      this.oddsStore.apply(event.record);
      this.evaluate(
        event.record.fixtureId,
        { type: "odds", record: event.record },
        event.recvTs,
      );
      return;
    }

    // Score event.
    this.eventsSeen.score += 1;
    const delta = this.matchStore.apply(event.record);
    if (delta.goalScored || delta.redCardShown) {
      this.evaluate(
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
    if (delta.becameFinal) {
      await this.settleFixture(event.record.fixtureId, event.record);
    }
  }

  private evaluate(fixtureId: number, trigger: Trigger, recvTs: number): void {
    const odds = this.oddsStore.get(fixtureId);
    if (!odds) return; // nothing priced yet

    const match = this.matchStore.get(fixtureId);
    const views = buildViews(odds);
    if (views.size === 0) return;

    const nowTs = trigger.type === "odds" ? trigger.record.ts : trigger.record.ts;
    const model = this.modelStore.maybeRefit(fixtureId, views, match, nowTs);
    if (!model) return; // no coherent model yet — the agent does nothing

    const ctx: StrategyContext = { nowTs, trigger, match, odds, model, views };
    const output = runEngine(ctx, {
      calibration: this.calibration,
      allocation: this.allocation,
      suspension: this.suspension,
      riskState: this.riskState,
      limits: DEFAULT_LIMITS,
      mode: this.cfg.execMode,
      hasOpenSameOutcome: (fid, marketKey, outcomeIndex) =>
        this.track
          .openDecisions()
          .some(
            (d) =>
              d.fixtureId === fid &&
              d.marketKey === marketKey &&
              d.outcomeIndex === outcomeIndex &&
              d.stakeUsdc > 0,
          ),
    }, recvTs);

    for (const veto of output.vetoes) {
      this.recentVetoes.push({
        reason: veto.reason,
        strategy: veto.intent.strategy,
        marketKey: veto.intent.marketKey,
        ts: nowTs,
      });
      if (this.recentVetoes.length > 100) this.recentVetoes.shift();
    }

    for (const decision of output.decisions) {
      this.track.addDecision(decision);
      this.log(
        `[decide] ${decision.strategy} ${decision.stakeUsdc} USDC on ${decision.outcomeName.toUpperCase()} ` +
          `(${decision.marketKey}) @ ${decision.priceDecimal} | ${decision.reason}`,
      );
      if (this.committer && decision.stakeUsdc > 0) {
        void this.committer.commit("decision", decision.hash).then((sig) => {
          if (sig) this.track.updateDecisionCommit(decision.hash, sig);
        });
      }
    }
  }

  private async settleFixture(fixtureId: number, finalRecord: ScoreRecord): Promise<void> {
    if (this.settling.has(fixtureId)) return; // idempotent
    const open = this.track.openForFixture(fixtureId);
    if (open.length === 0) return;
    this.settling.add(fixtureId);

    const state = this.matchStore.get(fixtureId);
    if (!state) return;
    const finalGoals = goals(state);
    this.log(
      `[settle] fixture ${fixtureId} finalised ${finalGoals.p1}-${finalGoals.p2}; settling ${open.length} position(s)`,
    );

    const settledPairs: Array<{ decision: DecisionRecord; settlement: SettlementRecord }> = [];

    for (const decision of open) {
      const outcomes = decision.family === "WIN_DRAW_WIN" ? ["1", "x", "2"] : decision.family === "TOTAL_GOALS" ? ["over", "under"] : ["yes", "no"];
      const plan = planActualOutcome(
        decision.family,
        outcomes,
        finalGoals.p1,
        finalGoals.p2,
        decision.line,
      );
      if (!plan) continue;

      const won = plan.actualOutcomeIndex === normalizeOutcomeIndex(decision, outcomes);

      let verification: SettlementRecord["verification"];
      if (this.validator && this.session) {
        const seq = state.finalisedSeq ?? finalRecord.seq;
        const result = await this.validator.validate(
          this.session,
          fixtureId,
          seq,
          plan.statKeys,
          plan.predicates,
        );
        verification = {
          method: "validateStatV2",
          verified: result.verified,
          statKeys: plan.statKeys,
          seq,
          txSigOrView: result.error ? `view-error: ${result.error}` : "view",
        };
        this.log(
          `[settle] proof ${result.verified ? "VERIFIED on-chain" : `FAILED (${result.error ?? "predicate false"})`} — ${plan.description}`,
        );
      }

      const pnlUsdc =
        decision.stakeUsdc > 0
          ? Math.round(registerSettlement(decision, won, this.riskState) * 100) / 100
          : 0;

      const settlement: SettlementRecord = {
        decisionHash: decision.hash,
        settledAtTs: finalRecord.ts,
        fixtureId,
        won,
        pnlUsdc,
        finalP1Goals: finalGoals.p1,
        finalP2Goals: finalGoals.p2,
        verification,
      };
      this.track.addSettlement(settlement);
      settledPairs.push({ decision, settlement });

      // Learn — deterministically — from the settled, provable outcome.
      this.calibration.add({
        modelProb: decision.modelProb,
        marketProb: decision.marketProb,
        won,
      });
      if (decision.stakeUsdc > 0) {
        this.allocation.recordSettlement(decision.strategy, pnlUsdc, decision.stakeUsdc);
      }
      this.suspension.recordSettlement(decision.strategy, decision.modelProb, won);

      this.log(
        `[settle] ${decision.strategy} ${decision.outcomeName.toUpperCase()} ${won ? "WON" : "LOST"} ` +
          `${pnlUsdc >= 0 ? "+" : ""}${pnlUsdc} USDC (equity ${Math.round(this.riskState.equityUsdc * 100) / 100})`,
      );

      if (this.committer) {
        void this.committer.commit("settlement", decision.hash);
      }
    }

    const review = buildMatchReview(
      fixtureId,
      settledPairs,
      this.calibration.report(),
      finalRecord.ts,
    );
    this.track.addReview(review);
    this.log(`[review] ${review.notes.join(" | ")}`);
    if (this.committer) void this.committer.commit("review", review.hash);
    this.settling.delete(fixtureId);
  }
}

/** Map a decision's outcome name onto the canonical outcome ordering. */
function normalizeOutcomeIndex(decision: DecisionRecord, outcomes: string[]): number {
  const index = outcomes.indexOf(decision.outcomeName.toLowerCase());
  return index === -1 ? decision.outcomeIndex : index;
}
