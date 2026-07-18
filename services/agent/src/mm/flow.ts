/**
 * Order-flow model — the counterparties that trade against the maker's quotes.
 *
 * A market maker earns nothing without flow to fill. Since these markets have
 * no public order tape to replay, we simulate realistic flow — the standard
 * way makers backtest a quoting strategy. Two kinds:
 *   - NOISE: uninformed traders arriving at a steady rate, random side. This
 *     is where the maker earns its spread.
 *   - INFORMED: a burst right after a goal / red card, trading the side that
 *     just became more likely. This is the toxic flow the maker must survive;
 *     its adverse-selection protection (mm/adverse.ts) is what deflects it.
 *
 * Everything is DETERMINISTIC — seeded from the event stream's own ids, never
 * Math.random — so a replay produces byte-identical flow, preserving SHARPE's
 * same-input-same-output guarantee.
 */

export interface Taker {
  /** "buy" lifts the maker's ask (taker buys the share); "sell" hits the bid. */
  side: "buy" | "sell";
  shares: number;
  informed: boolean;
}

export interface FlowParams {
  /** Probability a noise taker arrives on a given quote tick. */
  noiseArrivalRate: number;
  /** Max noise order size (shares); size is deterministic within [1, this]. */
  noiseMaxShares: number;
  /** Shares in an informed burst after an event. */
  informedShares: number;
}

export const DEFAULT_FLOW_PARAMS: FlowParams = {
  noiseArrivalRate: 0.35,
  noiseMaxShares: 12,
  informedShares: 20,
};

/** Deterministic uniform in [0,1) from a string seed (FNV-1a → normalized). */
export function hashUnit(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff;
}

/**
 * Noise taker for one outcome on one quote tick, or null if none arrived.
 * `seed` must be unique per (fixture, market, outcome, tick).
 */
export function sampleNoise(seed: string, params: FlowParams = DEFAULT_FLOW_PARAMS): Taker | null {
  if (hashUnit(seed + ":arr") >= params.noiseArrivalRate) return null;
  const side = hashUnit(seed + ":side") < 0.5 ? "buy" : "sell";
  const shares = 1 + Math.floor(hashUnit(seed + ":sz") * params.noiseMaxShares);
  return { side, shares, informed: false };
}

/**
 * Informed taker after a fair-value jump: trades the direction of the move
 * (fair went UP → buy the share). Returned once per event per outcome; the
 * engine only lets it fill if the maker failed to pull/widen in time.
 */
export function informedTaker(
  fairDelta: number,
  params: FlowParams = DEFAULT_FLOW_PARAMS,
): Taker | null {
  if (Math.abs(fairDelta) < 0.02) return null; // no meaningful jump
  return {
    side: fairDelta > 0 ? "buy" : "sell",
    shares: params.informedShares,
    informed: true,
  };
}
