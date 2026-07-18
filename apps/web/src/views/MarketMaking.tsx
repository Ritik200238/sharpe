import { useStore } from "../store/store";
import type { MmQuoteLine } from "../api/types";
import { ago, int, pct, shortHash, signedUsd, explorerTx } from "../lib/format";

/** "Total Goals|FT|2.5" → "Total Goals 2.5"; "1X2|FT|" → "1X2". */
function prettyMarket(marketKey: string): string {
  const [type, , param] = marketKey.split("|");
  return param ? `${type} ${param}` : type;
}

/** Spread and skew read most naturally in probability points. */
const ppFrac = (x: number): string => (x * 100).toFixed(1) + "pp";
const signedPpFrac = (x: number): string =>
  (x >= 0 ? "+" : "−") + (Math.abs(x) * 100).toFixed(1) + "pp";

function QuoteRow({ q }: { q: MmQuoteLine }) {
  const spread = q.askProb - q.bidProb;
  const invTone = q.inventory > 0 ? "var(--green)" : q.inventory < 0 ? "var(--red)" : "var(--muted)";
  return (
    <tr>
      <td className="mm-mkt">{prettyMarket(q.marketKey)}</td>
      <td style={{ fontWeight: 600 }}>{q.outcomeName.toUpperCase()}</td>
      <td className="num" style={{ color: "var(--red)" }}>{pct(q.bidProb)}</td>
      <td className="num mm-fair">{pct(q.fairProb)}</td>
      <td className="num" style={{ color: "var(--green)" }}>{pct(q.askProb)}</td>
      <td className="num">{ppFrac(spread)}</td>
      <td className="num" style={{ color: q.skew === 0 ? "var(--muted)" : undefined }}>
        {signedPpFrac(q.skew)}
      </td>
      <td className="num" style={{ color: invTone, fontWeight: 600 }}>
        {q.inventory > 0 ? "+" : ""}
        {q.inventory}
      </td>
      <td>
        <span className={"mm-state" + (q.widened ? " widened" : "")}>
          {q.widened ? "WIDENED" : "normal"}
        </span>
      </td>
    </tr>
  );
}

export function MarketMaking() {
  const state = useStore();
  const mm = state.mm;

  if (mm && !mm.enabled) {
    return (
      <div className="narrow">
        <h1 className="page-title">Market making</h1>
        <div className="empty-note">
          The market maker is disabled for this process (started with <code>--mm off</code>). Run
          the agent without that flag — it's on by default — to make markets live.
        </div>
      </div>
    );
  }

  if (!mm || !mm.snapshot) {
    return (
      <div className="narrow">
        <h1 className="page-title">Market making</h1>
        <div className="empty-note">waiting for the maker's first live book…</div>
      </div>
    );
  }

  const { totals, stats, quotes } = mm.snapshot;
  const netTone = totals.cashUsdc >= 0 ? "var(--green)" : "var(--red)";
  const defended = stats.informedDeflected + stats.informedFilled;
  const deflectRate = defended > 0 ? stats.informedDeflected / defended : 1;

  return (
    <div>
      <div className="perf-head">
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>
            Market making — live book
          </h1>
          <div className="mm-tagline">
            quotes both sides · earns the spread · defends toxic flow around goals
          </div>
        </div>
      </div>

      {/* Hero: the two forces that define market-making, decomposed. */}
      <div className="agg-bar mm">
        <span>
          <span className="k">net P&L </span>
          <span style={{ color: netTone, fontWeight: 700 }}>{signedUsd(totals.cashUsdc)} USDC</span>
        </span>
        <span>
          <span className="k">spread captured </span>
          <span style={{ color: "var(--green)" }}>{signedUsd(totals.spreadCapturedUsdc)}</span>
        </span>
        <span>
          <span className="k">adverse selection </span>
          <span style={{ color: totals.adverseUsdc < 0 ? "var(--red)" : "var(--muted)" }}>
            {signedUsd(totals.adverseUsdc)}
          </span>
        </span>
        <span>
          <span className="k">fills </span>
          {int(totals.fills)}
        </span>
        <span>
          <span className="k">volume </span>
          {int(totals.volumeShares)} sh
        </span>
        <span>
          <span className="k">open inventory </span>
          {int(totals.openInventoryAbs)} sh
        </span>
      </div>

      <div className="mm-grid">
        <section className="panel">
          <h2 className="panel-label">Adverse-selection defence</h2>
          <div className="mm-defence">
            <div className="mm-stat">
              <span className="v" style={{ color: "var(--green)" }}>
                {int(stats.informedDeflected)}
              </span>
              <span className="l">toxic flows deflected</span>
            </div>
            <div className="mm-stat">
              <span className="v" style={{ color: stats.informedFilled > 0 ? "var(--red)" : "var(--muted)" }}>
                {int(stats.informedFilled)}
              </span>
              <span className="l">picked off</span>
            </div>
            <div className="mm-stat">
              <span className="v">{int(stats.pulled)}</span>
              <span className="l">quotes pulled</span>
            </div>
            <div className="mm-stat">
              <span className="v">{int(stats.widened)}</span>
              <span className="l">quotes widened</span>
            </div>
          </div>
          <div className="mm-defence-bar" aria-hidden="true">
            <div className="fill" style={{ width: `${Math.round(deflectRate * 100)}%` }} />
          </div>
          <div className="mm-note">
            {defended > 0
              ? `${pct(deflectRate)} of the informed flow that fired around goals was deflected — the maker pulls its quotes the instant TxLINE reports a goal or red card, then re-quotes wide until the new price settles.`
              : "No goal-driven informed flow yet — the defence arms the instant a goal or red card lands."}
          </div>
        </section>

        <section className="panel">
          <h2 className="panel-label">Quotes posted</h2>
          <div className="mm-defence">
            <div className="mm-stat">
              <span className="v">{int(stats.quotesPosted)}</span>
              <span className="l">two-sided quotes</span>
            </div>
            <div className="mm-stat">
              <span className="v">{quotes.length}</span>
              <span className="l">live right now</span>
            </div>
          </div>
          <div className="mm-note">
            The maker never tries to out-predict TxLINE's de-margined consensus (a −18.6% ROI
            game). It prices fair off the same model, quotes a bid and an ask around it, and earns
            the half-spread on the flow it fills — keeping spread captured bigger than adverse
            selection. That difference is its edge.
          </div>
        </section>
      </div>

      <section className="panel mm-quotes-panel">
        <h2 className="panel-label">Live two-sided quotes</h2>
        {quotes.length === 0 ? (
          <div className="feed-empty" style={{ padding: 0 }}>
            no live quotes — the maker quotes only in-play (a match must be running)
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table mm-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Outcome</th>
                  <th className="num">Bid (buy)</th>
                  <th className="num">Fair</th>
                  <th className="num">Ask (sell)</th>
                  <th className="num">Spread</th>
                  <th className="num">Skew</th>
                  <th className="num">Inventory</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => (
                  <QuoteRow key={`${q.fixtureId}|${q.marketKey}|${q.outcomeIndex}`} q={q} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mm-grid">
        <section className="panel">
          <h2 className="panel-label">Recent fills</h2>
          <div className="mm-tape">
            {mm.recentFills.length === 0 ? (
              <div className="feed-empty" style={{ padding: 0 }}>no fills yet</div>
            ) : (
              mm.recentFills.slice(0, 14).map((f, i) => (
                <div className="mm-fill-row" key={`${f.ts}:${f.marketKey}:${f.outcomeIndex}:${i}`}>
                  <span className={"mm-side " + f.side}>{f.side === "buy" ? "SOLD" : "BOUGHT"}</span>
                  <span className="mm-fill-body">
                    {f.shares} {f.outcomeName.toUpperCase()}{" "}
                    <span className="muted">{prettyMarket(f.marketKey)}</span> @ {pct(f.priceProb)}
                  </span>
                  {f.informed ? <span className="mm-badge adverse">adverse</span> : null}
                  <span className="mm-fill-ago">{ago(f.ts)}</span>
                </div>
              ))
            )}
          </div>
          <div className="mm-note">
            Fills from the maker's perspective: <em>SOLD</em> = a taker lifted its ask;{" "}
            <em>BOUGHT</em> = a taker hit its bid. <em>adverse</em> marks the informed flow that
            slipped past the defence.
          </div>
        </section>

        <section className="panel">
          <h2 className="panel-label">On-chain quote-book commits</h2>
          <div className="mm-tape">
            {mm.bookCommits.length === 0 ? (
              <div className="feed-empty" style={{ padding: 0 }}>no book snapshots yet</div>
            ) : (
              mm.bookCommits.slice(0, 14).map((c) => (
                <div className="mm-commit-row" key={c.hash}>
                  <code className="mm-hash">{shortHash(c.hash)}</code>
                  {c.sig ? (
                    <a href={explorerTx(c.sig)} target="_blank" rel="noopener noreferrer" className="mm-sig">
                      {shortHash(c.sig)} ↗
                    </a>
                  ) : (
                    <span className="mm-sig muted">paper / pending</span>
                  )}
                  <span className="mm-fill-ago">{ago(c.ts)}</span>
                </div>
              ))
            )}
          </div>
          <div className="mm-note">
            The canonical hash of the live book is committed to Solana on a cadence and at
            settlement — tamper-proof, timestamped evidence of exactly what the maker was quoting.
            In paper mode the hash is journalled locally; in chain mode each carries its
            transaction signature.
          </div>
        </section>
      </div>

      <div className="mm-footnote">
        Book totals as of the maker's last snapshot
        {mm.snapshot.quotes[0] ? ` · updated ${ago(mm.snapshot.quotes[0].ts)}` : ""}
      </div>
    </div>
  );
}
