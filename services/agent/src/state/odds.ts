import { OddsRecord } from "../feed/types";

/** Stable identity of one market line on one fixture. */
export function marketKey(record: OddsRecord): string {
  return `${record.superOddsType}|${record.marketPeriod ?? ""}|${record.marketParameters ?? ""}`;
}

export interface MarketQuote {
  key: string;
  latest: OddsRecord;
  /** Small history ring (oldest→newest) for drift detection. */
  history: Array<{ ts: number; pct: Array<number | null> }>;
}

export interface FixtureOdds {
  fixtureId: number;
  markets: Map<string, MarketQuote>;
  lastTs: number;
}

const HISTORY_LIMIT = 24;

/** Latest consensus quotes per fixture per market, with short history. */
export class OddsStateStore {
  private fixtures = new Map<number, FixtureOdds>();

  get(fixtureId: number): FixtureOdds | undefined {
    return this.fixtures.get(fixtureId);
  }

  all(): FixtureOdds[] {
    return [...this.fixtures.values()];
  }

  apply(record: OddsRecord): MarketQuote {
    let fixture = this.fixtures.get(record.fixtureId);
    if (!fixture) {
      fixture = { fixtureId: record.fixtureId, markets: new Map(), lastTs: 0 };
      this.fixtures.set(record.fixtureId, fixture);
    }

    const key = marketKey(record);
    let quote = fixture.markets.get(key);
    if (!quote) {
      quote = { key, latest: record, history: [] };
      fixture.markets.set(key, quote);
    }

    // Keep only forward progress per market (out-of-order updates dropped).
    if (record.ts >= quote.latest.ts) {
      quote.latest = record;
      quote.history.push({ ts: record.ts, pct: record.pct });
      if (quote.history.length > HISTORY_LIMIT) quote.history.shift();
      fixture.lastTs = Math.max(fixture.lastTs, record.ts);
    }
    return quote;
  }
}
