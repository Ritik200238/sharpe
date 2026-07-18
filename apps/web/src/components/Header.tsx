import { store, useStore, type ConnectionState } from "../store/store";
import type { Route } from "../lib/router";

const NAV: Array<{ label: string; route: Route }> = [
  { label: "Command", route: { name: "command" } },
  { label: "Market Making", route: { name: "market" } },
  { label: "Ledger", route: { name: "ledger" } },
  { label: "Performance", route: { name: "performance" } },
  { label: "About", route: { name: "about" } },
  { label: "System", route: { name: "system" } },
];

export function connColor(connection: ConnectionState): string {
  if (connection === "live-sse") return "var(--lime)";
  if (connection === "polling") return "var(--amber)";
  return "var(--red)";
}

export function connLabel(connection: ConnectionState): string {
  if (connection === "live-sse") return "LIVE STREAM";
  if (connection === "polling") return "POLLING";
  return "OFFLINE";
}

function isActive(current: Route, nav: Route): boolean {
  if (current.name === nav.name) return true;
  // Ledger stays active on Detail/Fixture views.
  return nav.name === "ledger" && (current.name === "detail" || current.name === "fixture");
}

export function Header() {
  const state = useStore();
  const status = state.status;
  return (
    <header className="site-header">
      <div className="header-inner">
        <button
          className="wordmark"
          aria-label="SHARPE — command view"
          onClick={() => store.navigate({ name: "command" })}
        >
          <span className="wordmark-text">SHARPE</span>
          <span className="wordmark-block" />
        </button>
        <nav aria-label="Primary" className="primary-nav">
          {NAV.map((n) => (
            <button
              key={n.label}
              className={"nav-btn" + (isActive(state.route, n.route) ? " active" : "")}
              onClick={() => store.navigate(n.route)}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <div className="header-right">
          <span className="badge">{status?.network ?? "—"}</span>
          <span className="badge">feed: {status?.feedMode ?? "—"}</span>
          <span className="badge">exec: {status?.execMode ?? "—"}</span>
          <span className="conn">
            <span className="conn-dot" style={{ background: connColor(state.connection) }} />
            {connLabel(state.connection)}
          </span>
        </div>
      </div>
    </header>
  );
}
