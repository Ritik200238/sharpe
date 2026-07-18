/**
 * Adverse-selection protection — why this maker doesn't get picked off.
 *
 * The instant a goal or red card lands, the fair value of every outcome jumps.
 * Anyone with a faster feed than the maker can hit its now-stale quotes for a
 * guaranteed profit ("toxic flow"). Every real in-play maker defends against
 * this, and it's the single hardest part of quoting live sport.
 *
 * SHARPE's defence, keyed off TxLINE's event stream (the canonical fastest
 * source) so nobody is faster than us:
 *   1. PULL  — for a short window after the event, quote nothing at all. A
 *              quote that doesn't exist can't be picked off.
 *   2. WIDEN — then quote again but at a wide spread while the new fair value
 *              settles, so any early flow pays a premium.
 *   3. NORMAL — once the dust clears, resume tight quotes.
 *
 * Deterministic: the phase is a pure function of time-since-event.
 */

export interface AdverseParams {
  /** No quotes for this long after a score-changing event (ms). */
  pullMs: number;
  /** Widened quotes until this long after the event (ms). */
  widenMs: number;
}

export const DEFAULT_ADVERSE_PARAMS: AdverseParams = {
  pullMs: 4_000,
  widenMs: 45_000,
};

export type ProtectionPhase = "pull" | "widen" | "normal";

export interface Protection {
  phase: ProtectionPhase;
  /** Post no quotes this instant. */
  pull: boolean;
  /** Quote, but with a widened spread. */
  widen: boolean;
}

/**
 * Protection phase for one market at `nowTs`, given the timestamp of the last
 * score-changing event that affects it (goal / red card), or null if none.
 */
export function protectionFor(
  lastEventTs: number | null,
  nowTs: number,
  params: AdverseParams = DEFAULT_ADVERSE_PARAMS,
): Protection {
  if (lastEventTs === null) return { phase: "normal", pull: false, widen: false };
  const since = nowTs - lastEventTs;
  if (since < 0) return { phase: "normal", pull: false, widen: false };
  if (since < params.pullMs) return { phase: "pull", pull: true, widen: false };
  if (since < params.widenMs) return { phase: "widen", pull: false, widen: true };
  return { phase: "normal", pull: false, widen: false };
}
