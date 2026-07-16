import * as fs from "node:fs";
import * as path from "node:path";
import { MatchReview } from "../intelligence/review";
import { DecisionRecord, SettlementRecord } from "../strategy/types";
import { Network, TRACK_DIR } from "../platform/config";

/**
 * The public track record — append-only, event-sourced, replayable.
 * decisions.ndjson / settlements.ndjson / reviews.ndjson are the source of
 * truth; in-memory aggregates rebuild from them on boot. Every line is
 * hashed content whose hash lives on-chain — the record cannot be edited
 * without breaking the chain of commitments.
 */
export interface TrackAggregates {
  decisions: number;
  settled: number;
  wins: number;
  stakedUsdc: number;
  pnlUsdc: number;
  openPositions: number;
}

export class TrackStore {
  private dir: string;
  private decisionsFile: string;
  private settlementsFile: string;
  private reviewsFile: string;

  readonly decisions = new Map<string, DecisionRecord>();
  readonly settlements = new Map<string, SettlementRecord>();
  readonly reviews: MatchReview[] = [];

  constructor(network: Network, mode: string) {
    this.dir = path.join(TRACK_DIR, network, mode);
    fs.mkdirSync(this.dir, { recursive: true });
    this.decisionsFile = path.join(this.dir, "decisions.ndjson");
    this.settlementsFile = path.join(this.dir, "settlements.ndjson");
    this.reviewsFile = path.join(this.dir, "reviews.ndjson");
    this.load();
  }

  private load(): void {
    for (const record of readNdjson<DecisionRecord>(this.decisionsFile)) {
      this.decisions.set(record.hash, record);
    }
    for (const record of readNdjson<SettlementRecord>(this.settlementsFile)) {
      this.settlements.set(record.decisionHash, record);
    }
    for (const review of readNdjson<MatchReview>(this.reviewsFile)) {
      this.reviews.push(review);
    }
  }

  addDecision(decision: DecisionRecord): void {
    if (this.decisions.has(decision.hash)) return; // idempotent
    this.decisions.set(decision.hash, decision);
    fs.appendFileSync(this.decisionsFile, `${JSON.stringify(decision)}\n`);
  }

  updateDecisionCommit(hash: string, commitTxSig: string): void {
    const decision = this.decisions.get(hash);
    if (!decision) return;
    decision.commitTxSig = commitTxSig;
    // Append an amendment line rather than rewriting history.
    fs.appendFileSync(
      this.decisionsFile,
      `${JSON.stringify({ hash, commitTxSig, amend: true })}\n`,
    );
  }

  addSettlement(settlement: SettlementRecord): void {
    if (this.settlements.has(settlement.decisionHash)) return;
    this.settlements.set(settlement.decisionHash, settlement);
    fs.appendFileSync(this.settlementsFile, `${JSON.stringify(settlement)}\n`);
  }

  addReview(review: MatchReview): void {
    this.reviews.push(review);
    fs.appendFileSync(this.reviewsFile, `${JSON.stringify(review)}\n`);
  }

  openDecisions(): DecisionRecord[] {
    return [...this.decisions.values()].filter((d) => !this.settlements.has(d.hash));
  }

  openForFixture(fixtureId: number): DecisionRecord[] {
    return this.openDecisions().filter((d) => d.fixtureId === fixtureId);
  }

  aggregates(): TrackAggregates {
    let wins = 0;
    let staked = 0;
    let pnl = 0;
    for (const settlement of this.settlements.values()) {
      const decision = this.decisions.get(settlement.decisionHash);
      if (!decision) continue;
      staked += decision.stakeUsdc;
      pnl += settlement.pnlUsdc;
      if (settlement.won) wins += 1;
    }
    return {
      decisions: this.decisions.size,
      settled: this.settlements.size,
      wins,
      stakedUsdc: Math.round(staked * 100) / 100,
      pnlUsdc: Math.round(pnl * 100) / 100,
      openPositions: this.decisions.size - this.settlements.size,
    };
  }

  recentDecisions(limit: number): DecisionRecord[] {
    return [...this.decisions.values()]
      .sort((a, b) => b.decidedAtTs - a.decidedAtTs)
      .slice(0, limit);
  }
}

function readNdjson<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  const out: T[] = [];
  const amendments: Array<{ hash: string; commitTxSig: string }> = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.amend) amendments.push(parsed);
      else out.push(parsed as T);
    } catch {
      // tolerate a torn final line from a crash — event sourcing survives
    }
  }
  for (const amendment of amendments) {
    const target = (out as any[]).find((r) => r.hash === amendment.hash);
    if (target) target.commitTxSig = amendment.commitTxSig;
  }
  return out;
}
