import { FixtureModel, MarketView, classifyMarket, fitFixtureModel } from "../model/fair";
import { OddsRecord, ScoreRecord, SoccerPhase } from "../feed/types";
import { MatchState, MatchStateStore } from "../state/match";
import { FixtureOdds, OddsStateStore } from "../state/odds";

/** What triggered this evaluation pass. */
export type Trigger =
  | { type: "odds"; record: OddsRecord }
  | { type: "score"; record: ScoreRecord; goal: boolean; red: boolean };

export interface StrategyContext {
  nowTs: number;
  trigger: Trigger;
  match: MatchState | undefined;
  odds: FixtureOdds;
  model: FixtureModel | undefined;
  /** Classified, priceable view per market key (only supported markets). */
  views: Map<string, MarketView>;
}

/**
 * Maintains per-fixture λ models. Refit on pre-match consensus updates;
 * frozen from kickoff (the in-play conditioning happens in modelProbs).
 */
export class ModelStore {
  private models = new Map<number, FixtureModel>();

  get(fixtureId: number): FixtureModel | undefined {
    return this.models.get(fixtureId);
  }

  maybeRefit(
    fixtureId: number,
    views: Map<string, MarketView>,
    match: MatchState | undefined,
    nowTs: number,
  ): FixtureModel | undefined {
    const existing = this.models.get(fixtureId);
    const preMatch = !match || match.phase === SoccerPhase.NotStarted;

    if (!preMatch) {
      if (existing && !existing.frozen) {
        existing.frozen = true;
        this.models.set(fixtureId, existing);
      }
      return existing;
    }

    let winDrawWin: MarketView | undefined;
    let totals: MarketView | undefined;
    for (const view of views.values()) {
      if (view.family === "WIN_DRAW_WIN") {
        if (!winDrawWin || view.sourceTs > winDrawWin.sourceTs) winDrawWin = view;
      } else if (view.family === "TOTAL_GOALS") {
        // Prefer the main line (closest to 2.5) then freshest.
        const better =
          !totals ||
          Math.abs((view.line ?? 99) - 2.5) < Math.abs((totals.line ?? 99) - 2.5) ||
          ((view.line ?? 99) === (totals.line ?? 99) && view.sourceTs > totals.sourceTs);
        if (better) totals = view;
      }
    }
    if (!winDrawWin || !totals) return existing;

    const fitted = fitFixtureModel(fixtureId, winDrawWin, totals, nowTs);
    // Reject fits the solver couldn't reconcile — incoherent inputs.
    if (fitted.fitError > 0.05) return existing;
    this.models.set(fixtureId, fitted);
    return fitted;
  }
}

/** Build the classified market views for one fixture's current odds. */
export function buildViews(odds: FixtureOdds): Map<string, MarketView> {
  const views = new Map<string, MarketView>();
  for (const [key, quote] of odds.markets) {
    const view = classifyMarket(quote.latest);
    if (view) views.set(key, view);
  }
  return views;
}
