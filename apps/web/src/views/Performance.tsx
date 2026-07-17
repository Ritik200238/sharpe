import { store, useStore } from "../store/store";
import {
  brier4,
  pct,
  pp,
  signedPct,
  signedUsd,
  strategyColor,
  strategyLabel,
  usd,
  STRATEGY_DESCRIPTIONS,
  STRATEGY_ORDER,
} from "../lib/format";

export function Performance() {
  const state = useStore();
  const dig = state.digests.get(state.windowDays) ?? null;
  const status = state.status;
  const overall = dig?.overall ?? null;
  const ovPnlTone =
    overall && overall.pnlUsdc >= 0 ? "var(--green)" : "var(--red)";

  const maxAbs = dig ? Math.max(1, ...dig.days.map((d) => Math.abs(d.pnlUsdc))) : 1;
  const days = dig ? dig.days.slice(-12) : [];

  const suspRows = STRATEGY_ORDER.filter((k) => status?.suspensions?.[k] !== undefined).map(
    (k) => ({ id: k, s: status!.suspensions[k]! }),
  );

  return (
    <div>
      <div className="perf-head">
        <h1 className="page-title">Performance digest</h1>
        <div role="group" aria-label="Window" className="window-group">
          <button
            className={"window-btn" + (state.windowDays === 7 ? " active" : "")}
            onClick={() => store.setWindowDays(7)}
          >
            7 days
          </button>
          <button
            className={"window-btn" + (state.windowDays === 30 ? " active" : "")}
            onClick={() => store.setWindowDays(30)}
          >
            30 days
          </button>
        </div>
      </div>

      <div className="agg-bar perf">
        <span>
          <span className="k">decisions </span>
          {overall ? overall.decisions : "—"}
        </span>
        <span>
          <span className="k">settled </span>
          {overall ? overall.settled : "—"}
        </span>
        <span>
          <span className="k">hit rate </span>
          {overall && overall.settled > 0 ? pct(overall.hitRate) : "—"}
        </span>
        <span>
          <span className="k">staked </span>
          {overall ? usd(overall.stakedUsdc) : "—"} USDC
        </span>
        <span>
          <span className="k">P&L </span>
          <span style={{ color: ovPnlTone }}>
            {overall ? signedUsd(overall.pnlUsdc) : "—"} USDC
          </span>
        </span>
        <span>
          <span className="k">ROI </span>
          <span style={{ color: ovPnlTone }}>
            {overall && overall.stakedUsdc > 0 ? signedPct(overall.roi) : "—"}
          </span>
        </span>
      </div>

      <div className="table-wrap perf-table-wrap">
        <table className="data-table perf-table">
          <thead>
            <tr>
              <th>Strategy</th>
              <th className="num">n</th>
              <th className="num">Wins</th>
              <th className="num">Hit</th>
              <th className="num">Staked</th>
              <th className="num">P&L</th>
              <th className="num">ROI</th>
              <th className="num">
                <span title="Mean squared error of predicted probabilities vs outcomes — lower is better">
                  Brier ↓
                </span>
              </th>
              <th className="num">Mean edge</th>
              <th>Activity</th>
            </tr>
          </thead>
          <tbody>
            {(dig?.strategies ?? []).map((s) => {
              const suspended = status?.suspensions?.[s.strategy]?.suspended ?? false;
              const pnlTone = s.pnlUsdc >= 0 ? "var(--green)" : "var(--red)";
              const activityColor = suspended
                ? "var(--red)"
                : s.activity === "active"
                  ? "var(--green)"
                  : "var(--amber)";
              return (
                <tr
                  key={s.strategy}
                  onClick={() => store.goLedgerFiltered(s.strategy, "all")}
                >
                  <td
                    style={{
                      fontWeight: 600,
                      color: strategyColor(s.strategy),
                      whiteSpace: "nowrap",
                    }}
                  >
                    {strategyLabel(s.strategy)}{" "}
                    <span className="strat-desc">
                      {STRATEGY_DESCRIPTIONS[s.strategy] ?? ""}
                    </span>
                  </td>
                  <td className="num">{s.n}</td>
                  <td className="num">{s.wins}</td>
                  <td className="num">{s.n > 0 ? pct(s.hitRate) : "—"}</td>
                  <td className="num">{usd(s.stakedUsdc)}</td>
                  <td className="num" style={{ fontWeight: 600, color: pnlTone }}>
                    {signedUsd(s.pnlUsdc)}
                  </td>
                  <td className="num" style={{ color: pnlTone }}>
                    {s.stakedUsdc > 0 ? signedPct(s.roi) : "—"}
                  </td>
                  <td className="num">{s.brier !== null ? brier4(s.brier) : "—"}</td>
                  <td className="num">{s.meanEdge !== null ? pp(s.meanEdge) : "—"}</td>
                  <td
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: activityColor,
                      whiteSpace: "nowrap",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {(suspended ? "SUSPENDED · " : "") + s.activity.toUpperCase()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!dig ? <div className="empty-note">loading digest…</div> : null}

      <div className="perf-grid">
        <section className="panel" style={{ minWidth: 0 }}>
          <h2 className="panel-label mb12">Daily P&L (bucketed to decision day)</h2>
          <div className="daily-chart">
            {days.length === 0 ? (
              <div className="feed-empty" style={{ padding: 0, alignSelf: "center" }}>
                no activity in this window
              </div>
            ) : (
              days.map((d) => {
                const tone = d.pnlUsdc >= 0 ? "var(--green)" : "var(--red)";
                const h = Math.round((Math.abs(d.pnlUsdc) / maxAbs) * 80) + 6;
                return (
                  <div key={d.day} className="daily-col">
                    <span className="amt" style={{ color: tone }}>
                      {signedUsd(d.pnlUsdc)}
                    </span>
                    <div className="bar" style={{ height: h, background: tone }} />
                    <span className="day">{d.day.slice(5)}</span>
                    <span className="cnt">{d.decisions} dec</span>
                  </div>
                );
              })
            )}
          </div>
        </section>
        <section className="panel">
          <h2 className="panel-label">SPRT suspension state</h2>
          <div className="sprt-list">
            {suspRows.length === 0 ? (
              <div className="feed-empty" style={{ padding: 0 }}>
                suspension state reports once the agent is live
              </div>
            ) : (
              suspRows.map(({ id, s }) => (
                <div
                  key={id}
                  className="sprt-row"
                  style={{ borderLeftColor: strategyColor(id) }}
                >
                  <div className="head">
                    <span className="lbl" style={{ color: strategyColor(id) }}>
                      {id.slice(0, 2)}
                    </span>
                    <span
                      className="st"
                      style={{ color: s.suspended ? "var(--red)" : "var(--green)" }}
                    >
                      {s.suspended ? "SUSPENDED — shadow only" : "LIVE"}
                    </span>
                  </div>
                  <div className="detail">
                    llr {s.llr.toFixed(2)} · shadow wins {s.shadowWins} · suspensions{" "}
                    {s.suspensions}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="sprt-note">
            A strategy whose real win rate falls below what its own probabilities promised is
            suspended to shadow-only (stake 0) until it re-qualifies. The agent benches itself
            before a human would.
          </div>
        </section>
      </div>
    </div>
  );
}
