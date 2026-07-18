import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Synthetic match generator — produces recorder-format journals for a
 * scripted World Cup-style match. Used by the determinism tests and as a
 * stand-in demo corpus until real recordings land. Fully deterministic:
 * a seeded LCG drives every "random" choice, so the same seed always
 * produces byte-identical journals.
 *
 * Usage: tsx tools/synthesize.ts <outDir> [seed]
 */

class Lcg {
  constructor(private state: number) {}
  next(): number {
    // Numerical Recipes LCG — deterministic across platforms.
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return this.state / 0xffffffff;
  }
}

interface JournalLine {
  recvTs: number;
  type: "event";
  id?: string;
  event?: string;
  data: string;
}

export interface SyntheticMatch {
  fixtureId: number;
  scores: JournalLine[];
  odds: JournalLine[];
  finalScore: { p1: number; p2: number };
}

export function synthesizeMatch(
  seed = 42,
  fixtureId = 90000001,
  // Fixed epoch base by default → byte-identical output for the determinism
  // tests. The demo-capture tool passes a recent kickoff so the fixtures read
  // as a just-finished match (relative times + digest windows stay sensible).
  kickoff = 1_766_000_000_000,
): SyntheticMatch {
  const rng = new Lcg(seed);
  const scores: JournalLine[] = [];
  const odds: JournalLine[] = [];

  let seq = 0;
  const stats: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 };

  const pushScore = (ts: number, action: string, phase: number, extra: object = {}) => {
    seq += 1;
    scores.push({
      recvTs: ts + 400,
      type: "event",
      id: `${ts}:${seq}`,
      data: JSON.stringify({
        fixtureId,
        seq,
        ts,
        action,
        statusSoccerId: phase,
        competitionId: 72,
        participant1Id: 501,
        participant2Id: 502,
        participant1IsHome: true,
        startTime: kickoff,
        stats: { ...stats },
        ...extra,
      }),
    });
  };

  const pushOdds = (
    ts: number,
    superOddsType: string,
    priceNames: string[],
    pct: number[],
    marketParameters?: string,
    inRunning = true,
  ) => {
    odds.push({
      recvTs: ts + 350,
      type: "event",
      id: `${ts}:o${odds.length}`,
      data: JSON.stringify({
        FixtureId: fixtureId,
        MessageId: `m-${ts}-${superOddsType}`,
        Ts: ts,
        Bookmaker: "StablePrice",
        BookmakerId: 1,
        SuperOddsType: superOddsType,
        InRunning: inRunning,
        MarketPeriod: "FT",
        MarketParameters: marketParameters,
        PriceNames: priceNames,
        Prices: pct.map((p) => Math.round(1000 / p)),
        Pct: pct.map((p) => (p * 100).toFixed(3)),
      }),
    });
  };

  // True latent strength baked into the synthetic market.
  let pHome = 0.46;
  let pDraw = 0.27;
  let pOver = 0.55;

  const quoteAll = (ts: number, noise: number, inRunning: boolean) => {
    const jitter = () => (rng.next() - 0.5) * noise;
    const h = Math.min(0.9, Math.max(0.05, pHome + jitter()));
    const d = Math.min(0.6, Math.max(0.05, pDraw + jitter() / 2));
    const a = Math.max(0.05, 1 - h - d);
    pushOdds(ts, "1X2", ["1", "X", "2"], [h, d, a], undefined, inRunning);
    const over = Math.min(0.95, Math.max(0.05, pOver + jitter()));
    pushOdds(ts, "Total Goals", ["Over", "Under"], [over, 1 - over], "2.5", inRunning);
    // A second, correlated totals line and BTTS widen the tradable surface.
    const over35 = Math.min(0.9, Math.max(0.03, over - 0.24 + jitter() / 2));
    pushOdds(ts, "Total Goals", ["Over", "Under"], [over35, 1 - over35], "3.5", inRunning);
    const btts = Math.min(0.92, Math.max(0.05, over * 0.82 + 0.08 + jitter()));
    pushOdds(ts, "Both Teams To Score", ["Yes", "No"], [btts, 1 - btts], undefined, inRunning);
  };

  // Pre-match: 30 minutes of quotes each minute.
  for (let minute = -30; minute < 0; minute++) {
    quoteAll(kickoff + minute * 60_000, 0.012, false);
  }

  pushScore(kickoff, "phase_change", 2); // kickoff, H1

  // Match script: goal minutes chosen deterministically from the rng.
  const events: Array<{ minute: number; scorer: 1 | 2 }> = [];
  const goalCount = 3; // 2-1 thriller
  for (let i = 0; i < goalCount; i++) {
    events.push({
      minute: 8 + Math.floor(rng.next() * 78),
      scorer: rng.next() < 0.62 ? 1 : 2,
    });
  }
  events.sort((x, y) => x.minute - y.minute);

  let eventIndex = 0;
  for (let minute = 1; minute <= 90; minute++) {
    const ts = kickoff + minute * 60_000;

    if (minute === 45) pushScore(ts, "phase_change", 3); // HT
    if (minute === 46) pushScore(ts, "phase_change", 4); // H2

    while (eventIndex < events.length && events[eventIndex].minute === minute) {
      const goal = events[eventIndex];
      stats[goal.scorer] += 1;
      pushScore(ts, "goal", minute <= 45 ? 2 : 4, { participant: goal.scorer });

      // Market reprices — but 20–40s LATE (the S2 window, deterministic lag).
      const shift = goal.scorer === 1 ? 0.14 : -0.16;
      pHome = Math.min(0.92, Math.max(0.04, pHome + shift));
      pDraw = Math.max(0.04, pDraw - 0.05);
      pOver = Math.min(0.95, pOver + 0.1);
      quoteAll(ts + 25_000 + Math.floor(rng.next() * 15_000), 0.008, true);
      eventIndex += 1;
    }

    // Steady-state quotes every 5 minutes; time decay pulls pOver down.
    if (minute % 5 === 0) {
      pOver = Math.max(0.03, pOver - 0.022);
      pDraw = Math.min(0.72, pDraw + (minute > 60 ? 0.012 : 0.004));
      pHome = Math.max(0.03, Math.min(0.94, 1 - pDraw - Math.max(0.03, 1 - pHome - pDraw)));
      quoteAll(kickoff + minute * 60_000 + 2_000, 0.01, true);
    }
  }

  const fullTime = kickoff + 91 * 60_000;
  pushScore(fullTime, "phase_change", 5); // F
  pushScore(fullTime + 120_000, "game_finalised", 100, { period: 100 }); // finalised

  return { fixtureId, scores, odds, finalScore: { p1: stats[1], p2: stats[2] } };
}

export function writeJournals(outDir: string, match: SyntheticMatch): void {
  const dir = path.join(outDir, "synthetic", "2026-07-16");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "scores.ndjson"),
    match.scores.map((l) => JSON.stringify(l)).join("\n") + "\n",
  );
  fs.writeFileSync(
    path.join(dir, "odds.ndjson"),
    match.odds.map((l) => JSON.stringify(l)).join("\n") + "\n",
  );
}

if (require.main === module) {
  const outDir = process.argv[2] ?? path.join(__dirname, "..", "..", "..", "data", "synthetic");
  const seed = Number(process.argv[3] ?? 42);
  const match = synthesizeMatch(seed);
  writeJournals(outDir, match);
  console.log(
    `synthetic match ${match.fixtureId} written to ${outDir} — final ${match.finalScore.p1}-${match.finalScore.p2}, ` +
      `${match.scores.length} score events, ${match.odds.length} odds events`,
  );
}
