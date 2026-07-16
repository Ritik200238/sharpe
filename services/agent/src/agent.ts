import { Connection, Keypair } from "@solana/web3.js";
import { FeedEvent, FeedSource, ScoreRecord } from "./feed/types";
import { AllocationEngine } from "./intelligence/allocation";
import { CalibrationTracker } from "./intelligence/calibration";
import { buildMatchReview } from "./intelligence/review";
import { SuspensionMonitor } from "./intelligence/sprt";
import { AgentConfig } from "./platform/config";
import { AuthSession } from "./platform/auth";
import { DEFAULT_LIMITS, RiskState, rebuildRiskState, registerSettlement } from "./risk/limits";
import { planActualOutcome } from "./settle/proofs";
import { SettlementValidator } from "./settle/validate";
import { MatchStateStore, goals } from "./state/match";
import { OddsStateStore } from "./state/odds";
import { ModelStore, StrategyContext, Trigger, buildViews } from "./strategy/context";
import { runEngine } from "./strategy/engine";
import { DecisionRecord, SettlementRecord, StrategyId } from "./strategy/types";
import { TrackStore } from "./track/store";
import { ChainCommitter } from "./exec/commit";
import { brainStream } from "./api/stream";

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
  realizedUsdc: number;
  peakRealizedUsdc: number;
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
    // Replay runs get their own store — the live track record stays pure.
    this.track = new TrackStore(
      cfg.network.network,
      cfg.feedMode === "replay" ? "replay" : cfg.execMode,
    );

    // Crash-safe boot: rebuild the ENTIRE risk state from the persisted
    // ledger — realized P&L, exposure maps, day counter, high-water mark.
    const { pnlUsdc, peakRealizedUsdc } = this.track.settledPnl(cfg.bankrollUsdc);
    this.riskState = rebuildRiskState(
      cfg.bankrollUsdc,
      this.track.openDecisions(),
      pnlUsdc,
      peakRealizedUsdc,
      Date.now(),
    );

    // The intelligence layer must survive restarts too: replay the
    // settlement ledger through the same calls settleFixture makes live.
    // Ledger append order IS the exact live processing order (and floating-
    // point accumulation is order-sensitive), so iterate it as persisted —
    // calibration, allocation weights, and SPRT state resume bit-identical.
    for (const settlement of this.track.settlements.values()) {
      const decision = this.track.decisions.get(settlement.decisionHash);
      if (!decision) continue;
      if (decision.stakeUsdc > 0) {
        this.calibration.add({
          modelProb: decision.modelProb,
          marketProb: decision.marketProb,
          won: settlement.won,
        });
        this.allocation.recordSettlement(decision.strategy, settlement.pnlUsdc, decision.stakeUsdc);
      }
      this.suspension.recordSettlement(decision.strategy, decision.modelProb, settlement.won);
    }

    if (cfg.execMode === "chain" && wallet) {
      const connection = new Connection(cfg.network.rpcUrl, "confirmed");
      this.committer = new ChainCommitter(
        cfg.network,
        wallet,
        (m) => this.log(`[chain] ${m}`),
        this.track.dir,
        {
          // Fires on the send path AND the boot/timer reconcile path, so a
          // commitment confirmed after a crash still backfills its record.
          onConfirmed: (kind, hash, sig) => {
            if (kind === "decision") this.track.updateDecisionCommit(hash, sig);
            else if (kind === "settlement") this.track.updateSettlementCommit(hash, sig);
            // reviews stay journal-only
          },
        },
      );
      this.validator = this.session
        ? new SettlementValidator(cfg.network, connection, wallet)
        : null;
    } else {
      this.committer = null;
      this.validator = wallet && this.session
        ? new SettlementValidator(cfg.network, new Connection(cfg.network.rpcUrl, "confirmed"), wallet)
        : null;
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
      realizedUsdc: Math.round(this.riskState.realizedUsdc * 100) / 100,
      peakRealizedUsdc: Math.round(this.riskState.peakRealizedUsdc * 100) / 100,
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

  /** Settle the write-ahead commit journal against the chain (call at boot,
   * before run()): landed intents backfill records, expired ones resubmit. */
  async reconcileCommits(): Promise<void> {
    if (this.committer) await this.committer.reconcile();
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
      brainStream.publish("status", event.recvTs, {
        stream: event.stream,
        message: event.message,
      });
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
    } else if (
      delta.state.finalised &&
      this.track.openForFixture(event.record.fixtureId).length > 0
    ) {
      // Retry path: a proof that failed at first finalisation gets another
      // attempt on any later record for the fixture.
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
        this.track.hasOpenSameOutcome(fid, marketKey, outcomeIndex),
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
      brainStream.publish("decision", decision.decidedAtTs, decision);
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
    const state = this.matchStore.get(fixtureId);
    if (!state) return;
    this.settling.add(fixtureId);
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

      // With a validator available, the Merkle proof is LAW: no verified
      // proof, no settlement. The position stays open and is retried on the
      // fixture's next record — local score state alone never moves money.
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
        if (!result.verified) {
          this.log(
            `[settle] proof FAILED (${result.error ?? "predicate false"}) — ${plan.description}; ` +
              `position ${decision.hash.slice(0, 12)}… stays OPEN for retry`,
          );
          continue;
        }
        this.log(`[settle] proof VERIFIED on-chain — ${plan.description}`);
      }

      // Book EXACTLY what the ledger records: payouts round to cents, and
      // the risk state is snapped to those cents so a rebuilt process
      // (rebuildRiskState over the ledger) lands on identical numbers.
      let pnlUsdc = 0;
      if (decision.stakeUsdc > 0) {
        const peakBefore = this.riskState.peakRealizedUsdc;
        const rawPnl = registerSettlement(decision, won, this.riskState);
        pnlUsdc = Math.round(rawPnl * 100) / 100;
        const delta = pnlUsdc - rawPnl;
        this.riskState.equityUsdc =
          Math.round((this.riskState.equityUsdc + delta) * 100) / 100;
        this.riskState.realizedUsdc =
          Math.round((this.riskState.realizedUsdc + delta) * 100) / 100;
        this.riskState.peakRealizedUsdc = Math.max(peakBefore, this.riskState.realizedUsdc);
      }

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
      brainStream.publish("settlement", settlement.settledAtTs, settlement);
      settledPairs.push({ decision, settlement });

      // Learn — deterministically — from the settled, provable outcome.
      // Shadow (stake-0) settlements feed only the SPRT that governs the
      // suspended strategy's re-enable; they must not move the global
      // calibration that sizes healthy strategies.
      if (decision.stakeUsdc > 0) {
        this.calibration.add({
          modelProb: decision.modelProb,
          marketProb: decision.marketProb,
          won,
        });
        this.allocation.recordSettlement(decision.strategy, pnlUsdc, decision.stakeUsdc);
      }
      this.suspension.recordSettlement(decision.strategy, decision.modelProb, won);

      this.log(
        `[settle] ${decision.strategy} ${decision.outcomeName.toUpperCase()} ${won ? "WON" : "LOST"} ` +
          `${pnlUsdc >= 0 ? "+" : ""}${pnlUsdc} USDC (equity ${Math.round(this.riskState.equityUsdc * 100) / 100})`,
      );

      if (this.committer) {
        void this.committer.commit("settlement", decision.hash).then((sig) => {
          if (sig) this.track.updateSettlementCommit(decision.hash, sig);
        });
      }
    }

    const review = buildMatchReview(
      fixtureId,
      settledPairs,
      this.calibration.report(),
      finalRecord.ts,
    );
    this.track.addReview(review);
    brainStream.publish("review", review.generatedAtTs, review);
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
