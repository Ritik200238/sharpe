import { strict as assert } from "node:assert";
import { test } from "node:test";
import { makeQuote, quotedSpread, DEFAULT_QUOTE_PARAMS } from "../src/mm/quote";
import { protectionFor } from "../src/mm/adverse";
import { hashUnit, sampleNoise, informedTaker } from "../src/mm/flow";
import { MakerBook } from "../src/mm/book";

test("quote: two-sided, bid < fair < ask, spread positive", () => {
  const q = makeQuote(0.5, 0.5, 0, false);
  assert.ok(q.bidProb < q.fairProb && q.fairProb < q.askProb);
  assert.ok(quotedSpread(q) > 0);
});

test("quote: widens with time remaining and under protection", () => {
  const early = makeQuote(0.5, 1.0, 0, false);
  const late = makeQuote(0.5, 0.05, 0, false);
  assert.ok(quotedSpread(early) > quotedSpread(late), "more time left → wider");
  const widened = makeQuote(0.5, 0.5, 0, true);
  const normal = makeQuote(0.5, 0.5, 0, false);
  assert.ok(quotedSpread(widened) > quotedSpread(normal), "protection widens");
});

test("quote: inventory skews the mid to offload", () => {
  const flat = makeQuote(0.5, 0.5, 0, false);
  const long = makeQuote(0.5, 0.5, 80, false); // long the share
  const short = makeQuote(0.5, 0.5, -80, false);
  assert.ok(long.askProb < flat.askProb, "long → lower ask to sell inventory");
  assert.ok(short.bidProb > flat.bidProb, "short → higher bid to buy inventory back");
});

test("quote: clamps to a valid probability range", () => {
  const extreme = makeQuote(0.995, 1, 0, true);
  assert.ok(extreme.bidProb > 0 && extreme.askProb < 1);
});

test("adverse: pull → widen → normal phases by time-since-event", () => {
  const base = 1_000_000;
  assert.equal(protectionFor(base, base + 1_000).phase, "pull");
  assert.equal(protectionFor(base, base + 10_000).phase, "widen");
  assert.equal(protectionFor(base, base + 60_000).phase, "normal");
  assert.equal(protectionFor(null, base).phase, "normal");
});

test("flow: hashUnit is deterministic and in [0,1)", () => {
  assert.equal(hashUnit("abc"), hashUnit("abc"));
  assert.notEqual(hashUnit("abc"), hashUnit("abd"));
  for (const s of ["x", "y", "z:1", "long-seed-string"]) {
    const u = hashUnit(s);
    assert.ok(u >= 0 && u < 1);
  }
});

test("flow: sampleNoise deterministic; informedTaker follows the jump", () => {
  assert.deepEqual(sampleNoise("k:1"), sampleNoise("k:1"));
  assert.equal(informedTaker(0.2)!.side, "buy");
  assert.equal(informedTaker(-0.2)!.side, "sell");
  assert.equal(informedTaker(0.001), null); // no meaningful jump
});

test("book: a full round-trip at the quoted spread nets positive", () => {
  const book = new MakerBook();
  // Sell 10 shares at ask 0.55 (taker buys), buy 10 back at bid 0.45 (taker
  // sells), fair 0.5 throughout → captured spread ≈ 0.10 * 10 = 1.00.
  book.fillBuy("k", 0.55, 0.5, 10, false);
  book.fillSell("k", 0.45, 0.5, 10, false);
  const t = book.totals();
  assert.equal(t.cashUsdc, 1.0);
  assert.equal(book.inventoryOf("k"), 0);
  assert.ok(t.spreadCapturedUsdc > 0);
});

test("book: settles open inventory at the outcome value", () => {
  const book = new MakerBook();
  book.fillSell("k", 0.4, 0.5, 10, false); // maker buys 10 shares, pays 4.00
  book.settle("k", true); // outcome occurred → shares worth 1.00 each = 10.00
  assert.equal(book.totals().cashUsdc, 6.0); // 10.00 − 4.00
});

test("book: adverse selection is charged on informed fills", () => {
  const book = new MakerBook();
  // Informed taker buys at a stale ask 0.50 while true fair is now 0.70 →
  // maker is short a share worth 0.70 sold for 0.50 → 0.20 adverse per share.
  book.fillBuy("k", 0.5, 0.7, 10, true);
  const t = book.totals();
  assert.ok(t.adverseUsdc < 0, "informed flow charges adverse selection");
  assert.equal(t.adverseUsdc, -2.0);
});
