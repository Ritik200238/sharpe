/**
 * Position sizing: fractional Kelly, scaled by the intelligence layer.
 *
 * For a binary bet at decimal odds o with model win probability p:
 *   b = o − 1,  q = 1 − p,  f* = (b·p − q) / b
 * We stake KELLY_FRACTION of f* (quarter-Kelly), then multiply by the
 * calibration factor (how well the model has actually been predicting)
 * and the strategy's allocation weight (how much bankroll it earned).
 */

export const KELLY_FRACTION = 0.25;

export interface SizingInputs {
  modelProb: number;
  /** Decimal odds obtained (we book at the market's implied price). */
  priceDecimal: number;
  bankrollUsdc: number;
  calibrationFactor: number; // 0.25..1.25 from calibration.ts
  allocationWeight: number; // 0..1 from allocation.ts
  maxStakeUsdc: number;
}

export interface SizingResult {
  stakeUsdc: number;
  kellyFraction: number;
}

export function sizePosition(inputs: SizingInputs): SizingResult {
  const { modelProb: p, priceDecimal: o } = inputs;
  if (!(o > 1) || p <= 0 || p >= 1) return { stakeUsdc: 0, kellyFraction: 0 };

  const b = o - 1;
  const fullKelly = (b * p - (1 - p)) / b;
  if (fullKelly <= 0) return { stakeUsdc: 0, kellyFraction: 0 };

  const fraction =
    fullKelly * KELLY_FRACTION * inputs.calibrationFactor * inputs.allocationWeight;
  const raw = inputs.bankrollUsdc * fraction;
  const stake = Math.min(raw, inputs.maxStakeUsdc);

  // Round to cents — deterministic, bankable numbers.
  return { stakeUsdc: Math.max(0, Math.round(stake * 100) / 100), kellyFraction: fraction };
}
