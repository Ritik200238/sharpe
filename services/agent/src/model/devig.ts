/**
 * De-vig utilities: turn quoted prices into fair probabilities.
 *
 * TxLINE's StablePrice feed already ships de-margined consensus
 * probabilities (`Pct`), which we treat as the primary fair-probability
 * source. These functions are the independent cross-check and the fallback
 * when Pct is absent ("NA") — and they let us de-vig any third-party book
 * later. Everything here is pure and deterministic.
 */

/** Implied probabilities from decimal odds (contain the margin). */
export function impliedFromDecimal(odds: number[]): number[] {
  return odds.map((o) => {
    if (!(o > 1)) throw new Error(`decimal odds must be > 1, got ${o}`);
    return 1 / o;
  });
}

/** Multiplicative (proportional) de-vig: normalize implied to sum 1. */
export function devigMultiplicative(implied: number[]): number[] {
  const total = implied.reduce((sum, p) => sum + p, 0);
  if (total <= 0) throw new Error("implied probabilities must sum > 0");
  return implied.map((p) => p / total);
}

/**
 * Shin de-vig: models the margin as protection against informed flow, which
 * shades longshots more than favourites (the classic longshot bias).
 * Solves for z via bisection on Σ shin(p_i, z) = 1; deterministic.
 */
export function devigShin(implied: number[], iterations = 60): number[] {
  const total = implied.reduce((sum, p) => sum + p, 0);
  if (total <= 1) return devigMultiplicative(implied); // no overround → trivial

  const shin = (z: number): number[] =>
    implied.map((pi) => {
      const term = Math.sqrt(z * z + 4 * (1 - z) * ((pi * pi) / total));
      return (term - z) / (2 * (1 - z));
    });

  let low = 0;
  let high = 0.2; // z beyond 20% insider share is implausible for consensus lines
  for (let i = 0; i < iterations; i++) {
    const mid = (low + high) / 2;
    const sum = shin(mid).reduce((s, p) => s + p, 0);
    if (sum > 1) low = mid;
    else high = mid;
  }
  const result = shin((low + high) / 2);
  const norm = result.reduce((s, p) => s + p, 0);
  return result.map((p) => p / norm); // exact renormalization of residue
}

/** Overround (bookmaker margin) of a price set, e.g. 1.05 = 5% vig. */
export function overround(implied: number[]): number {
  return implied.reduce((sum, p) => sum + p, 0);
}
