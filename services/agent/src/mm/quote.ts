/**
 * The quoting engine — the heart of the market maker.
 *
 * For a binary outcome with model fair probability p (a "share" that pays 1
 * if the outcome occurs, 0 otherwise), the maker publishes a two-sided quote:
 * a bid (the price it will BUY the share at) and an ask (the price it will
 * SELL at). It profits from the spread between them, NOT from predicting the
 * outcome — so it never needs to beat the consensus, only to quote fair and
 * manage its risk.
 *
 * Half-spread widens with uncertainty (more time left / higher variance = the
 * fair value can move more, so demand more cushion) and the mid skews with
 * inventory (long the share → shade both quotes down to offload it). All pure
 * and deterministic — same inputs, same quote, every time.
 */

export interface QuoteParams {
  /** Floor half-spread in probability points (e.g. 0.02 = ±2pp). */
  baseHalfSpread: number;
  /** Extra half-spread scaled by remaining-match uncertainty. */
  uncertaintyScale: number;
  /** Inventory that fully saturates the skew (shares). */
  maxInventory: number;
  /** How hard inventory shifts the mid (probability points at saturation). */
  skewStrength: number;
  /** Multiplier applied to the half-spread while adverse-selection
   * protection is active (see mm/adverse.ts). */
  widenFactor: number;
}

export const DEFAULT_QUOTE_PARAMS: QuoteParams = {
  baseHalfSpread: 0.02,
  uncertaintyScale: 0.04,
  maxInventory: 100,
  skewStrength: 0.03,
  widenFactor: 3,
};

export interface Quote {
  /** Fair value (mid before skew), probability in (0,1). */
  fairProb: number;
  /** Price the maker BUYS the share at. */
  bidProb: number;
  /** Price the maker SELLS the share at. */
  askProb: number;
  halfSpread: number;
  /** Signed mid shift from inventory (negative when long). */
  skew: number;
  /** True while adverse-selection protection widened this quote. */
  widened: boolean;
}

const clampProb = (p: number): number => Math.min(0.99, Math.max(0.01, p));

/**
 * Build a two-sided quote for one outcome.
 *
 * @param fairProb    model probability the outcome occurs (0..1)
 * @param remaining   fraction of the match left (0..1) — the volatility proxy
 * @param inventory   maker's net position in this outcome's shares (signed)
 * @param widen       adverse-selection protection active this instant
 */
export function makeQuote(
  fairProb: number,
  remaining: number,
  inventory: number,
  widen: boolean,
  params: QuoteParams = DEFAULT_QUOTE_PARAMS,
): Quote {
  const fair = clampProb(fairProb);
  const rem = Math.min(1, Math.max(0, remaining));

  // Variance of the terminal outcome is highest near 0.5 and when time
  // remains for the fair value to wander — widen the quote for both.
  const variance = fair * (1 - fair); // 0..0.25
  let halfSpread = params.baseHalfSpread + params.uncertaintyScale * rem * (variance / 0.25);
  if (widen) halfSpread *= params.widenFactor;

  // Inventory skew: long shares → shade the mid DOWN so takers buy from us
  // (lifting our ask) and we bid less eagerly. Short → shade up. Bounded.
  const invFrac = Math.max(-1, Math.min(1, inventory / params.maxInventory));
  const skew = -params.skewStrength * invFrac;

  const mid = fair + skew;
  const bidProb = clampProb(mid - halfSpread);
  const askProb = clampProb(mid + halfSpread);

  return { fairProb: fair, bidProb, askProb, halfSpread, skew, widened: widen };
}

/** Edge (in probability points) the maker earns per share round-tripped. */
export function quotedSpread(q: Quote): number {
  return q.askProb - q.bidProb;
}
