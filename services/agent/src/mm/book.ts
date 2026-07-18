/**
 * The maker's book — inventory, cash, and P&L, per outcome.
 *
 * Each outcome is an independent binary share that settles to 1 (it occurred)
 * or 0 (it didn't). The maker starts flat (cash 0, inventory 0). Every fill
 * moves cash and inventory; at match end each outcome's inventory converts to
 * cash at its settled value. Final P&L = cash on the book.
 *
 * We decompose P&L into the two forces that define market-making:
 *   - spread captured: the half-spread edge earned vs fair value on every fill
 *   - adverse selection: the immediate loss when informed flow trades against
 *     a quote the fair value is about to run through
 * A profitable maker keeps the first bigger than the second — that is the
 * whole game, and it never requires predicting the outcome.
 */

export interface OutcomeBook {
  key: string;
  inventory: number; // signed shares; + = long the outcome
  cash: number; // USDC realized from trading (excludes open inventory)
  fills: number;
  volumeShares: number;
  spreadCapturedUsdc: number;
  adverseUsdc: number; // signed; negative = lost to informed flow
  settled: boolean;
}

export class MakerBook {
  private books = new Map<string, OutcomeBook>();

  private book(key: string): OutcomeBook {
    let b = this.books.get(key);
    if (!b) {
      b = {
        key,
        inventory: 0,
        cash: 0,
        fills: 0,
        volumeShares: 0,
        spreadCapturedUsdc: 0,
        adverseUsdc: 0,
        settled: false,
      };
      this.books.set(key, b);
    }
    return b;
  }

  get(key: string): OutcomeBook | undefined {
    return this.books.get(key);
  }
  all(): OutcomeBook[] {
    return [...this.books.values()];
  }
  inventoryOf(key: string): number {
    return this.books.get(key)?.inventory ?? 0;
  }

  /**
   * A taker BUYS the share from the maker at `askProb`. The maker sells:
   * inventory falls, cash rises. Edge vs fair = (ask − fair) per share.
   */
  fillBuy(key: string, askProb: number, fairProb: number, shares: number, informed: boolean): void {
    const b = this.book(key);
    b.inventory -= shares;
    b.cash += askProb * shares;
    b.fills += 1;
    b.volumeShares += shares;
    b.spreadCapturedUsdc += (askProb - fairProb) * shares;
    if (informed) b.adverseUsdc -= Math.max(0, fairProb - askProb) * shares;
  }

  /**
   * A taker SELLS the share to the maker at `bidProb`. The maker buys:
   * inventory rises, cash falls. Edge vs fair = (fair − bid) per share.
   */
  fillSell(key: string, bidProb: number, fairProb: number, shares: number, informed: boolean): void {
    const b = this.book(key);
    b.inventory += shares;
    b.cash -= bidProb * shares;
    b.fills += 1;
    b.volumeShares += shares;
    b.spreadCapturedUsdc += (fairProb - bidProb) * shares;
    if (informed) b.adverseUsdc -= Math.max(0, bidProb - fairProb) * shares;
  }

  /** Settle an outcome's inventory to cash at its final value (1 or 0). */
  settle(key: string, occurred: boolean): void {
    const b = this.book(key);
    if (b.settled) return;
    b.cash += b.inventory * (occurred ? 1 : 0);
    b.inventory = 0;
    b.settled = true;
  }

  /** Aggregate P&L (realized cash across all outcomes). */
  totals(): {
    cashUsdc: number;
    fills: number;
    volumeShares: number;
    spreadCapturedUsdc: number;
    adverseUsdc: number;
    openInventoryAbs: number;
  } {
    let cash = 0;
    let fills = 0;
    let volume = 0;
    let spread = 0;
    let adverse = 0;
    let openInv = 0;
    for (const b of this.books.values()) {
      cash += b.cash;
      fills += b.fills;
      volume += b.volumeShares;
      spread += b.spreadCapturedUsdc;
      adverse += b.adverseUsdc;
      openInv += Math.abs(b.inventory);
    }
    return {
      cashUsdc: round2(cash),
      fills,
      volumeShares: volume,
      spreadCapturedUsdc: round2(spread),
      adverseUsdc: round2(adverse),
      openInventoryAbs: openInv,
    };
  }
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
