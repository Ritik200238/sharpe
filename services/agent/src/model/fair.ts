import { OddsRecord } from "../feed/types";
import { MatchState, goals, redCards, remainingFraction } from "../state/match";
import { devigMultiplicative, impliedFromDecimal } from "./devig";
import { inPlayLambdas, lambdasFromMarket, outcomeProbabilities } from "./poisson";

/** Market families the agent knows how to price AND settle via proofs. */
export type MarketFamily = "WIN_DRAW_WIN" | "TOTAL_GOALS" | "BOTH_TEAMS_SCORE";

export interface MarketView {
  family: MarketFamily;
  /** Goals line for totals (e.g. 2.5). */
  line?: number;
  /** Outcome labels aligned with probability vectors, normalized casing. */
  outcomes: string[];
  /** Market-implied fair probabilities per outcome (consensus Pct first). */
  marketProbs: number[];
  sourceTs: number;
  inRunning: boolean;
}

const NAME_SETS: Record<MarketFamily, string[][]> = {
  WIN_DRAW_WIN: [
    ["1", "x", "2"],
    ["home", "draw", "away"],
  ],
  TOTAL_GOALS: [["over", "under"]],
  BOTH_TEAMS_SCORE: [
    ["yes", "no"],
    ["both", "not both"],
  ],
};

function extractLine(parameters?: string): number | undefined {
  if (!parameters) return undefined;
  const match = parameters.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

/**
 * Classify a TxLINE odds record into a priceable market view.
 * Conservative: returns null for anything we cannot both price and settle.
 */
export function classifyMarket(record: OddsRecord): MarketView | null {
  const names = record.priceNames.map((n) => n.trim().toLowerCase());
  if (names.length < 2) return null;

  let family: MarketFamily | null = null;
  const type = record.superOddsType.toLowerCase();

  for (const candidate of Object.keys(NAME_SETS) as MarketFamily[]) {
    if (NAME_SETS[candidate].some((set) => set.length === names.length && set.every((n, i) => names[i] === n))) {
      family = candidate;
      break;
    }
  }
  if (!family) {
    if (names.length === 3 && (type.includes("1x2") || type.includes("match") || type.includes("money"))) {
      family = "WIN_DRAW_WIN";
    } else if (names.length === 2 && (type.includes("total") || type.includes("over"))) {
      family = "TOTAL_GOALS";
    } else if (names.length === 2 && (type.includes("both") || type.includes("btts"))) {
      family = "BOTH_TEAMS_SCORE";
    }
  }
  if (!family) return null;

  // Totals need a line; only full-match markets are settle-able v1.
  const line = family === "TOTAL_GOALS" ? extractLine(record.marketParameters) : undefined;
  if (family === "TOTAL_GOALS" && line === undefined) return null;
  const period = (record.marketPeriod ?? "").toLowerCase();
  if (period && !["ft", "full", "fulltime", "full time", "match", "90", "reg"].some((p) => period.includes(p))) {
    return null;
  }

  // Market probabilities: consensus Pct preferred; fall back to de-vigged
  // prices only when every Pct entry is missing and prices look like
  // decimal odds ×1000 (TxLINE's integer scaling).
  let marketProbs: number[] | null = null;
  if (record.pct.length === names.length && record.pct.every((p) => p !== null)) {
    marketProbs = record.pct as number[];
  } else if (
    record.prices.length === names.length &&
    record.prices.every((p) => p >= 1001)
  ) {
    marketProbs = devigMultiplicative(impliedFromDecimal(record.prices.map((p) => p / 1000)));
  }
  if (!marketProbs) return null;

  const total = marketProbs.reduce((s, p) => s + p, 0);
  if (total < 0.9 || total > 1.1) return null; // reject inconsistent data
  marketProbs = marketProbs.map((p) => p / total);

  return {
    family,
    line,
    outcomes: names,
    marketProbs,
    sourceTs: record.ts,
    inRunning: record.inRunning,
  };
}

export interface FixtureModel {
  fixtureId: number;
  lambdaHome: number;
  lambdaAway: number;
  fitError: number;
  fittedAtTs: number;
  frozen: boolean;
}

/**
 * Fit (λh, λa) from the freshest pre-match WIN_DRAW_WIN + TOTAL_GOALS
 * consensus. Called on pre-match odds updates; frozen at kickoff.
 * Participant1 is treated as "home" per feed convention.
 */
export function fitFixtureModel(
  fixtureId: number,
  winDrawWin: MarketView,
  totals: MarketView,
  nowTs: number,
): FixtureModel {
  const overIndex = totals.outcomes.indexOf("over");
  const solved = lambdasFromMarket(
    winDrawWin.marketProbs[0],
    totals.marketProbs[overIndex === -1 ? 0 : overIndex],
    totals.line ?? 2.5,
  );
  return {
    fixtureId,
    lambdaHome: solved.lambdaHome,
    lambdaAway: solved.lambdaAway,
    fitError: solved.fitError,
    fittedAtTs: nowTs,
    frozen: false,
  };
}

/**
 * Model probabilities for a market, conditioned on the live match state.
 * Pure: (model, state, market, nowTs) → probability per outcome.
 */
export function modelProbs(
  model: FixtureModel,
  state: MatchState,
  market: Pick<MarketView, "family" | "line" | "outcomes">,
  nowTs: number,
): number[] | null {
  const score = goals(state);
  const reds = redCards(state);
  const rem = remainingFraction(state, nowTs);
  const { remLambdaHome, remLambdaAway } = inPlayLambdas(
    model.lambdaHome,
    model.lambdaAway,
    rem,
    reds.p1,
    reds.p2,
  );
  const probs = outcomeProbabilities(score.p1, score.p2, remLambdaHome, remLambdaAway);

  switch (market.family) {
    case "WIN_DRAW_WIN":
      return [probs.homeWin, probs.draw, probs.awayWin];
    case "TOTAL_GOALS": {
      if (market.line === undefined) return null;
      const over = probs.over(market.line);
      const overIndex = market.outcomes.indexOf("over");
      return overIndex === 0 ? [over, 1 - over] : [1 - over, over];
    }
    case "BOTH_TEAMS_SCORE": {
      const yes = probs.bothScore(score.p1, score.p2);
      const yesIndex = market.outcomes.indexOf("yes");
      return yesIndex === 0 || yesIndex === -1 ? [yes, 1 - yes] : [1 - yes, yes];
    }
  }
}
