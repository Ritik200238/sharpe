/**
 * In-play soccer pricing model.
 *
 * Approach (standard sports-quant practice, fully deterministic):
 *  1. Pre-match, extract goal expectancies (λ_home, λ_away) implied by the
 *     market itself — the consensus 1X2 + total-goals prices pin down the
 *     two-parameter independent-Poisson model. No historical training data
 *     needed: the market is the prior.
 *  2. In-play, scale the remaining expectancy by time left and adjust for
 *     red cards; condition on the current score.
 *  3. Price any outcome from the resulting score distribution.
 */

const MAX_GOALS = 12; // truncation for grid sums; beyond this, mass ≈ 0

export function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

export interface ScoreDistribution {
  /** grid[h][a] = P(home scores h more, away scores a more). */
  grid: number[][];
}

export function scoreDistribution(lambdaHome: number, lambdaAway: number): ScoreDistribution {
  const grid: number[][] = [];
  for (let h = 0; h <= MAX_GOALS; h++) {
    grid[h] = [];
    for (let a = 0; a <= MAX_GOALS; a++) {
      grid[h][a] = poissonPmf(lambdaHome, h) * poissonPmf(lambdaAway, a);
    }
  }
  return { grid };
}

export interface MatchProbabilities {
  homeWin: number;
  draw: number;
  awayWin: number;
  /** P(total goals over the line), keyed by the line (e.g. 2.5). */
  over: (line: number, currentTotal?: number) => number;
  bothScore: (currentHome: number, currentAway: number) => number;
}

/**
 * Outcome probabilities given current score and remaining expectancies.
 * All results derive from one truncated Poisson grid — self-consistent by
 * construction (the coherence strategy exploits markets that are not).
 */
export function outcomeProbabilities(
  currentHome: number,
  currentAway: number,
  remLambdaHome: number,
  remLambdaAway: number,
): MatchProbabilities {
  const { grid } = scoreDistribution(remLambdaHome, remLambdaAway);

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const finalHome = currentHome + h;
      const finalAway = currentAway + a;
      if (finalHome > finalAway) homeWin += grid[h][a];
      else if (finalHome === finalAway) draw += grid[h][a];
      else awayWin += grid[h][a];
    }
  }

  const over = (line: number, currentTotal = currentHome + currentAway): number => {
    let p = 0;
    for (let h = 0; h <= MAX_GOALS; h++) {
      for (let a = 0; a <= MAX_GOALS; a++) {
        if (currentTotal + h + a > line) p += grid[h][a];
      }
    }
    return p;
  };

  const bothScore = (curHome: number, curAway: number): number => {
    let p = 0;
    for (let h = 0; h <= MAX_GOALS; h++) {
      for (let a = 0; a <= MAX_GOALS; a++) {
        if ((curHome + h > 0) && (curAway + a > 0)) p += grid[h][a];
      }
    }
    return p;
  };

  return { homeWin, draw, awayWin, over, bothScore };
}

export interface ImpliedLambdas {
  lambdaHome: number;
  lambdaAway: number;
  /** Residual of the solver — small means the market fit is coherent. */
  fitError: number;
}

/**
 * Solve (λh, λa) from market-implied P(home win) and P(total > 2.5-style
 * line). Two equations, two unknowns; deterministic nested bisection on
 * total expectancy T and supremacy S with λh = (T+S)/2, λa = (T−S)/2.
 */
export function lambdasFromMarket(
  pHomeWin: number,
  pOverLine: number,
  line: number,
): ImpliedLambdas {
  const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
  const pHome = clamp(pHomeWin, 0.01, 0.99);
  const pOver = clamp(pOverLine, 0.01, 0.99);

  // Outer bisection on total T: P(over line | T, S(T)) is increasing in T.
  const solveSupremacy = (total: number): number => {
    // Inner bisection on supremacy S: P(home win) increasing in S.
    let lo = -total + 0.02;
    let hi = total - 0.02;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      const lh = (total + mid) / 2;
      const la = (total - mid) / 2;
      const p = outcomeProbabilities(0, 0, lh, la).homeWin;
      if (p < pHome) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };

  let tLo = 0.2;
  let tHi = 7;
  for (let i = 0; i < 50; i++) {
    const mid = (tLo + tHi) / 2;
    const s = solveSupremacy(mid);
    const lh = (mid + s) / 2;
    const la = (mid - s) / 2;
    const p = outcomeProbabilities(0, 0, lh, la).over(line, 0);
    if (p < pOver) tLo = mid;
    else tHi = mid;
  }

  const total = (tLo + tHi) / 2;
  const supremacy = solveSupremacy(total);
  const lambdaHome = (total + supremacy) / 2;
  const lambdaAway = (total - supremacy) / 2;

  const check = outcomeProbabilities(0, 0, lambdaHome, lambdaAway);
  const fitError =
    Math.abs(check.homeWin - pHome) + Math.abs(check.over(line, 0) - pOver);

  return { lambdaHome, lambdaAway, fitError };
}

export interface InPlayAdjustment {
  remLambdaHome: number;
  remLambdaAway: number;
}

/**
 * Scale pre-match expectancies to the remainder of the match.
 * - Time: proportional to remaining fraction, with a late-game intensity
 *   lift (goals cluster late; ~20% uplift weighting toward the final third).
 * - Red cards: a man down cuts that side's rate ~33% and lifts the
 *   opponent ~12% per card (bounded), consistent with published estimates.
 */
export function inPlayLambdas(
  lambdaHome: number,
  lambdaAway: number,
  remainingFraction: number,
  redsHome: number,
  redsAway: number,
): InPlayAdjustment {
  const rem = Math.min(1, Math.max(0, remainingFraction));
  // Late-game lift: integrate intensity g(t) = 0.8 + 0.4t over the remainder.
  const intensityIntegral = 0.8 * rem + 0.2 * rem * rem;

  const homeCardFactor =
    Math.max(0.3, 1 - 0.33 * redsHome) * (1 + Math.min(0.24, 0.12 * redsAway));
  const awayCardFactor =
    Math.max(0.3, 1 - 0.33 * redsAway) * (1 + Math.min(0.24, 0.12 * redsHome));

  return {
    remLambdaHome: lambdaHome * intensityIntegral * homeCardFactor,
    remLambdaAway: lambdaAway * intensityIntegral * awayCardFactor,
  };
}
