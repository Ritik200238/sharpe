import { store, useStore } from "../store/store";
import { buildEventVm } from "../lib/vm";
import { connColor } from "../components/Header";
import { EventCard } from "../components/EventCard";
import {
  ago,
  brier3,
  int,
  pct,
  signed3,
  signedUsd,
  strategyColor,
  strategyLabel,
  usd,
  STRATEGY_ORDER,
} from "../lib/format";

export function Command() {
  const state = useStore();
  const status = state.status;
  const agg = status?.aggregates ?? null;
  const cal = status?.calibration ?? null;

  const escrow = status ? status.realizedUsdc - status.equityUsdc : 0;
  const settled = agg?.settled ?? 0;
  const wins = agg?.wins ?? 0;
  const pnl = agg?.pnlUsdc ?? 0;
  const openCount = agg?.openPositions ?? 0;

  const feedVms = state.feed
    .slice(0, 30)
    .map((item) => buildEventVm(item, state))
    .filter((vm): vm is NonNullable<typeof vm> => vm !== null);

  const allocations = STRATEGY_ORDER.filter((k) => status?.allocations?.[k] !== undefined).map(
    (k) => ({
      id: k,
      value: status!.allocations[k]!,
      suspended: status?.suspensions?.[k]?.suspended ?? false,
    }),
  );

  const suspRows = STRATEGY_ORDER.filter((k) => status?.suspensions?.[k] !== undefined).map(
    (k) => ({ id: k, s: status!.suspensions[k]! }),
  );

  const vetoes = (status?.recentVetoes ?? []).slice(-5).reverse();

  const mm = state.mm;
  const mmT = mm?.enabled ? mm.snapshot?.totals ?? null : null;
  const mmS = mm?.enabled ? mm.snapshot?.stats ?? null : null;

  return (
    <div>
      {mmT && mmS ? (
        <button
          className="mm-home-band"
          onClick={() => store.navigate({ name: "market" })}
          aria-label="Open the live market-making book"
        >
          <div className="mm-home-head">
            <span className="mm-home-title">MARKET MAKING — live book</span>
            <span className="mm-home-link">view the book →</span>
          </div>
          <div className="mm-home-stats">
            <span>
              <span className="k">net P&L </span>
              <span
                className="big"
                style={{ color: mmT.cashUsdc >= 0 ? "var(--green)" : "var(--red)" }}
              >
                {signedUsd(mmT.cashUsdc)} USDC
              </span>
            </span>
            <span>
              <span className="k">spread captured </span>
              <span style={{ color: "var(--green)" }}>{signedUsd(mmT.spreadCapturedUsdc)}</span>
            </span>
            <span>
              <span className="k">adverse </span>
              <span style={{ color: mmT.adverseUsdc < 0 ? "var(--red)" : "var(--muted)" }}>
                {signedUsd(mmT.adverseUsdc)}
              </span>
            </span>
            <span>
              <span className="k">toxic flow deflected </span>
              {int(mmS.informedDeflected)}/{int(mmS.informedDeflected + mmS.informedFilled)}
            </span>
            <span>
              <span className="k">live quotes </span>
              {mm?.snapshot?.quotes.length ?? 0}
            </span>
          </div>
        </button>
      ) : null}

      <div className="research-caption">
        Directional research layer (paper) — the fair-value engine the maker prices off. We
        measured directional trading at −18.6% ROI; that's why the job is market-making.
      </div>

      <div className="vitals-grid">
        <div className="stat-card">
          <div className="stat-label">Realized bankroll</div>
          <div className="stat-value">
            {status ? usd(status.realizedUsdc) : "—"} <span className="stat-unit">USDC</span>
          </div>
          <div
            className="stat-sub"
            style={{ color: pnl >= 0 ? "var(--green)" : "var(--red)" }}
          >
            {agg ? `${signedUsd(agg.pnlUsdc)} all-time` : "—"} · peak{" "}
            {status ? usd(status.peakRealizedUsdc) : "—"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Equity (cash on hand)</div>
          <div className="stat-value">
            {status ? usd(status.equityUsdc) : "—"} <span className="stat-unit">USDC</span>
          </div>
          <div className="stat-sub">
            {status ? `${usd(escrow)} USDC escrowed in open positions` : "—"}
          </div>
        </div>
        <button
          className="stat-card clickable"
          onClick={() => store.goLedgerFiltered("all", "open")}
        >
          <div className="stat-label">Open positions</div>
          <div className="stat-value">{agg ? openCount : "—"}</div>
          <div className="stat-sub">
            {openCount > 0 ? "view in ledger →" : "none — nothing worth trading"}
          </div>
        </button>
        <div className="stat-card">
          <div className="stat-label">All-time P&L</div>
          <div
            className="stat-value"
            style={{ color: pnl >= 0 ? "var(--green)" : "var(--red)" }}
          >
            {agg ? signedUsd(agg.pnlUsdc) : "—"} <span className="stat-unit">USDC</span>
          </div>
          <div className="stat-sub">
            {agg ? `${settled} settled · ${wins}W/${settled - wins}L` : "—"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Calibration factor</div>
          <div className="stat-value">{cal ? `×${cal.factor.toFixed(2)}` : "—"}</div>
          <div className="stat-sub">
            {cal
              ? cal.factor < 1
                ? "edge decaying — auto-shrinking every stake"
                : "model beating market — full sizing"
              : "—"}
          </div>
        </div>
      </div>

      {status?.digestSummary ? (
        <div className="inset-bar digest-oneliner">{status.digestSummary}</div>
      ) : null}

      <div className="command-grid">
        <section aria-label="Agent feed" className="feed-section">
          <div className="feed-head">
            <h2 className="feed-heading">Agent feed</h2>
            <span className="feed-dot" style={{ background: connColor(state.connection) }} />
            <span className="feed-paused-note">
              {state.paused
                ? `${state.buffer.length} events buffered — data still flowing`
                : ""}
            </span>
            <button className="btn btn-mono pause-btn" onClick={() => store.togglePause()}>
              {state.paused ? "Resume" : "Pause"}
            </button>
          </div>
          <div className="feed-list">
            {feedVms.length === 0 ? (
              <div className="feed-empty">
                No events yet — the feed fills the moment the agent decides, settles, or
                reports.
              </div>
            ) : (
              feedVms.map((vm) => <EventCard key={vm.key} vm={vm} />)
            )}
          </div>
        </section>

        <aside className="right-rail">
          <section className="panel">
            <h2 className="panel-label">Feed liveness</h2>
            <div className="kv-grid">
              <div>
                <div className="k">last event</div>
                <div className="v">
                  {status?.lastEventRecvTs ? ago(status.lastEventRecvTs) : "—"}
                </div>
              </div>
              <div>
                <div className="k">live fixtures</div>
                <div className="v">{status ? status.liveFixtures : "—"}</div>
              </div>
              <div>
                <div className="k">odds msgs</div>
                <div className="v">{status ? int(status.eventsSeen.odds) : "—"}</div>
              </div>
              <div>
                <div className="k">score msgs</div>
                <div className="v">{status ? int(status.eventsSeen.score) : "—"}</div>
              </div>
              <div>
                <div className="k">heartbeats</div>
                <div className="v">{status ? int(status.eventsSeen.heartbeat) : "—"}</div>
              </div>
              <div>
                <div className="k">tracked markets</div>
                <div className="v">{status ? status.trackedMarkets : "—"}</div>
              </div>
            </div>
            <div className="rail-note">
              Odds ticks arrive nearly continuously while any covered fixture is active. A
              quiet feed with fresh ticks means: nothing worth trading — a healthy state.
            </div>
          </section>

          <section className="panel">
            <h2 className="panel-label">Capital allocation</h2>
            <div className="alloc-list">
              {allocations.map((a) => (
                <div key={a.id}>
                  <div className="alloc-head">
                    <span style={{ color: strategyColor(a.id), fontWeight: 600 }}>
                      {strategyLabel(a.id)}
                    </span>
                    <span className="p">{pct(a.value)}</span>
                  </div>
                  <div className="alloc-track">
                    <div
                      className="alloc-fill"
                      style={{
                        width: `${(a.value * 100).toFixed(1)}%`,
                        background: strategyColor(a.id),
                      }}
                    />
                  </div>
                  {a.suspended ? (
                    <div className="alloc-note">suspended — shadow only, stake 0</div>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="rail-note">Re-derived continuously from realized ROI (UCB).</div>
          </section>

          <section className="panel">
            <h2 className="panel-label">Self-regulation</h2>
            <div className="kv-grid">
              <div>
                <div className="k">model Brier</div>
                <div className="v">
                  {cal && cal.modelBrier !== null ? brier3(cal.modelBrier) : "—"}
                </div>
              </div>
              <div>
                <div className="k">market Brier</div>
                <div className="v">
                  {cal && cal.marketBrier !== null ? brier3(cal.marketBrier) : "—"}
                </div>
              </div>
              <div>
                <div className="k">advantage</div>
                <div className="v">
                  {cal && cal.advantage !== null ? signed3(cal.advantage) : "—"}
                </div>
              </div>
              <div>
                <div className="k">samples</div>
                <div className="v">{cal ? cal.samples : "—"}</div>
              </div>
            </div>
            <div className="cal-meaning">
              {cal
                ? `Rolling Brier comparison over settled decisions (lower is better). Factor ×${cal.factor.toFixed(2)} scales every stake — below ×1.00 means the agent detected its own edge decaying and is shrinking automatically.`
                : "Calibration reports once enough decisions settle."}
            </div>
            <div className="susp-list">
              {suspRows.map(({ id, s }) => (
                <div key={id} className="susp-row">
                  <span className="lbl" style={{ color: strategyColor(id) }}>
                    {id.slice(0, 2)}
                  </span>
                  <span style={{ color: s.suspended ? "var(--red)" : "var(--green)" }}>
                    {s.suspended ? "SUSPENDED — shadow only" : "LIVE"}
                  </span>
                  <span className="detail">
                    llr {s.llr.toFixed(2)} · shadow wins {s.shadowWins} · suspensions{" "}
                    {s.suspensions}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2 className="panel-label">Recent vetoes — trades the agent refused</h2>
            <div className="veto-list">
              {vetoes.length === 0 ? (
                <div className="feed-empty" style={{ padding: 0 }}>
                  none yet
                </div>
              ) : (
                vetoes.map((v, i) => (
                  <div key={`${v.ts}:${i}`} className="veto-row">
                    <div className="head">
                      <span style={{ color: strategyColor(v.strategy), fontWeight: 600 }}>
                        {strategyLabel(v.strategy)}
                      </span>
                      <span className="when">{ago(v.ts)}</span>
                    </div>
                    <div className="why">
                      {v.reason} — {v.marketKey}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
