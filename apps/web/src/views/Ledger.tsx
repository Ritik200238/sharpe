import { store, useStore } from "../store/store";
import type { DecisionRecord, SettlementRecord } from "../api/types";
import {
  ago,
  famLabel,
  odds4,
  pp,
  signedUsd,
  strategyColor,
  strategyLabel,
  usd,
} from "../lib/format";

const STRAT_CHIPS: Array<[string, string]> = [
  ["all", "ALL"],
  ["S1_COHERENCE", "S1 COHERENCE"],
  ["S2_REACTION", "S2 REACTION"],
  ["S3_CONVERGENCE", "S3 CONVERGENCE"],
];

const STATUS_CHIPS: Array<[string, string]> = [
  ["all", "ALL"],
  ["open", "OPEN"],
  ["settled", "SETTLED"],
  ["won", "WON"],
  ["lost", "LOST"],
  ["shadow", "SHADOW"],
];

function matchesStatus(
  d: DecisionRecord,
  s: SettlementRecord | undefined,
  filter: string,
): boolean {
  const shadow = d.stakeUsdc === 0;
  if (filter === "open") return !s && !shadow;
  if (filter === "settled") return !!s && !shadow;
  if (filter === "won") return !!s && s.won && !shadow;
  if (filter === "lost") return !!s && !s.won && !shadow;
  if (filter === "shadow") return shadow;
  return true;
}

export function Ledger() {
  const state = useStore();
  const f = state.filters;

  let rowsSrc = [...state.decisions.values()].sort((a, b) => b.decidedAtTs - a.decidedAtTs);
  if (f.strategy !== "all") rowsSrc = rowsSrc.filter((d) => d.strategy === f.strategy);
  rowsSrc = rowsSrc.filter((d) => matchesStatus(d, state.settlements.get(d.hash), f.status));

  const agg = rowsSrc.reduce(
    (a, d) => {
      const s = state.settlements.get(d.hash);
      a.staked += d.stakeUsdc;
      if (s) {
        a.settled += 1;
        if (s.won) a.wins += 1;
        a.pnl += s.pnlUsdc;
      } else if (d.stakeUsdc > 0) {
        a.open += 1;
      }
      return a;
    },
    { staked: 0, settled: 0, wins: 0, pnl: 0, open: 0 },
  );

  const rows = rowsSrc.slice(0, 80);

  return (
    <div>
      <div className="ledger-head">
        <h1 className="page-title">Track record</h1>
        <span className="page-subtitle">
          append-only · every decision and settlement, wins and losses alike
        </span>
        <button className="btn btn-mono-lg raw-toggle" onClick={() => store.toggleRaw()}>
          {state.showRaw ? "hide raw JSON" : "raw export · GET /track-record"}
        </button>
      </div>

      {state.showRaw ? (
        <pre className="raw-pre">{state.rawJson ?? "fetching /track-record …"}</pre>
      ) : null}

      <div className="chip-row" role="group" aria-label="Filter by strategy">
        {STRAT_CHIPS.map(([value, label]) => (
          <button
            key={value}
            className={"filter-chip" + (f.strategy === value ? " active" : "")}
            onClick={() => store.setFilters({ ...f, strategy: value })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="chip-row last" role="group" aria-label="Filter by status">
        {STATUS_CHIPS.map(([value, label]) => (
          <button
            key={value}
            className={"filter-chip" + (f.status === value ? " active" : "")}
            onClick={() => store.setFilters({ ...f, status: value })}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="agg-bar ledger">
        <span>
          <span className="k">decisions </span>
          {rowsSrc.length}
        </span>
        <span>
          <span className="k">settled </span>
          {agg.settled}
        </span>
        <span>
          <span className="k">wins </span>
          {agg.wins}
        </span>
        <span>
          <span className="k">open </span>
          {agg.open}
        </span>
        <span>
          <span className="k">staked </span>
          {usd(agg.staked)} USDC
        </span>
        <span>
          <span className="k">P&L </span>
          <span style={{ color: agg.pnl >= 0 ? "var(--green)" : "var(--red)" }}>
            {signedUsd(agg.pnl)} USDC
          </span>
        </span>
      </div>

      <div className="table-wrap">
        <table className="data-table ledger-table">
          <thead>
            <tr>
              <th>Decided</th>
              <th>Strategy</th>
              <th>Fixture</th>
              <th>Market · outcome</th>
              <th className="num">Edge</th>
              <th className="num">Stake</th>
              <th className="num">Price</th>
              <th>Status</th>
              <th className="num">P&L</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const s = state.settlements.get(d.hash);
              const shadow = d.stakeUsdc === 0;
              const statusLabel = s
                ? shadow
                  ? `SHADOW · ${s.won ? "W" : "L"}`
                  : s.won
                    ? "WON"
                    : "LOST"
                : shadow
                  ? "SHADOW · OPEN"
                  : "OPEN";
              const statusColor = s
                ? shadow
                  ? "#8A93A5"
                  : s.won
                    ? "var(--green)"
                    : "var(--red)"
                : "var(--amber)";
              const open = () => store.navigate({ name: "detail", hash: d.hash });
              return (
                <tr key={d.hash} onClick={open}>
                  <td className="mono-cell" style={{ color: "var(--muted)" }}>
                    {ago(d.decidedAtTs)}
                  </td>
                  <td
                    className="mono-cell"
                    style={{ fontWeight: 600, color: strategyColor(d.strategy) }}
                  >
                    {strategyLabel(d.strategy)}
                  </td>
                  <td className="mono-cell" style={{ color: "var(--muted)" }}>
                    {d.fixtureId}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{famLabel(d)}</td>
                  <td className="mono-cell num">{pp(d.edge)}</td>
                  <td className="mono-cell num">{shadow ? "0 (shadow)" : usd(d.stakeUsdc)}</td>
                  <td className="mono-cell num">{odds4(d.priceDecimal)}</td>
                  <td
                    className="mono-cell"
                    style={{ fontSize: 11, fontWeight: 600, color: statusColor }}
                  >
                    {statusLabel}
                  </td>
                  <td
                    className="mono-cell num"
                    style={{
                      fontWeight: 600,
                      color:
                        s && !shadow
                          ? s.won
                            ? "var(--green)"
                            : "var(--red)"
                          : "var(--faint)",
                    }}
                  >
                    {s ? (shadow ? "0.00" : signedUsd(s.pnlUsdc)) : "—"}
                  </td>
                  <td>
                    <button
                      className="open-btn"
                      aria-label="Open decision detail"
                      onClick={(e) => {
                        e.stopPropagation();
                        open();
                      }}
                    >
                      open
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <div className="empty-note">No records match this filter.</div> : null}
    </div>
  );
}
