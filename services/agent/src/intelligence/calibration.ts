/**
 * Confidence calibration — the agent grades its own predictions.
 *
 * For every settled decision we know the model's probability p and the
 * outcome y ∈ {0,1}. The Brier score mean((p−y)²) measures prediction
 * quality; we track it for the model AND for the market's implied
 * probability on the same events. Staking confidence scales with how much
 * the model actually beats the market — pure arithmetic over settled,
 * provable history. When the model stops beating the market, stakes shrink
 * automatically.
 */

export interface CalibrationSample {
  modelProb: number;
  marketProb: number;
  won: boolean;
}

export interface CalibrationReport {
  samples: number;
  modelBrier: number | null;
  marketBrier: number | null;
  /** Positive = model beating market. */
  advantage: number | null;
  factor: number;
}

const WINDOW = 100; // rolling window of most recent settlements
const MIN_SAMPLES = 10; // below this, stay conservative but neutral

export class CalibrationTracker {
  private samples: CalibrationSample[] = [];

  add(sample: CalibrationSample): void {
    this.samples.push(sample);
    if (this.samples.length > WINDOW) this.samples.shift();
  }

  report(): CalibrationReport {
    const n = this.samples.length;
    if (n === 0) {
      return { samples: 0, modelBrier: null, marketBrier: null, advantage: null, factor: 1 };
    }
    let modelSum = 0;
    let marketSum = 0;
    for (const s of this.samples) {
      const y = s.won ? 1 : 0;
      modelSum += (s.modelProb - y) ** 2;
      marketSum += (s.marketProb - y) ** 2;
    }
    const modelBrier = modelSum / n;
    const marketBrier = marketSum / n;
    const advantage = marketBrier - modelBrier;

    let factor = 1;
    if (n >= MIN_SAMPLES) {
      // advantage +0.01 (clearly beating market) → 1.25; −0.02 or worse → 0.25.
      factor = Math.min(1.25, Math.max(0.25, 1 + advantage * 25));
    }
    return { samples: n, modelBrier, marketBrier, advantage, factor };
  }
}
