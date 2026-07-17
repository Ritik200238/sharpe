import { useStore } from "../store/store";
import { connColor, connLabel } from "../components/Header";
import { ago, dur } from "../lib/format";

export function System() {
  const state = useStore();
  const health = state.health;

  return (
    <div className="narrow">
      <h1 className="page-title" style={{ marginBottom: 16 }}>
        System
      </h1>

      <section className="panel system-card">
        <h2 className="panel-label">Health — GET /health</h2>
        <div className="system-kv">
          <div>
            <div className="k">ok</div>
            <div
              style={{
                color: health ? (health.ok ? "var(--green)" : "var(--red)") : "var(--faint)",
                fontWeight: 600,
              }}
            >
              {health ? String(health.ok) : "—"}
            </div>
          </div>
          <div>
            <div className="k">phase</div>
            <div>{state.phase ?? "—"}</div>
          </div>
          <div>
            <div className="k">uptime</div>
            <div>{health ? dur(health.uptimeSec) : "—"}</div>
          </div>
          <div>
            <div className="k">now (UTC)</div>
            <div className="small">{health ? health.now : "—"}</div>
          </div>
        </div>
        <div className="system-note">
          On restart the agent rebuilds its complete state from its ledger — equity,
          calibration, allocations, and open positions all survive. This page reconnects and
          rehydrates automatically; the uptime reset is the only tell.
        </div>
      </section>

      <section className="panel system-card">
        <h2 className="panel-label">Stream</h2>
        <div className="stream-line">
          <span
            className="stream-dot"
            style={{ background: connColor(state.connection) }}
          />
          {connLabel(state.connection)} · SSE /stream · last event{" "}
          {state.lastStreamTs ? ago(state.lastStreamTs) : "—"}
        </div>
        <div className="system-note mt8">
          On disconnect the browser retries with Last-Event-ID; up to 500 missed events
          replay exactly once. Persistent failure falls back to polling /status.
        </div>
      </section>

      <section className="panel system-card">
        <h2 className="panel-label">Public read-only API — no auth, CORS *</h2>
        <div className="endpoint-list">
          <span>
            GET /health · /status · /decisions · /positions · /settlements · /reviews ·
            /digest?days=30 · /track-record · /stream (SSE)
          </span>
        </div>
        <div className="system-note mt8">
          Public and unauthenticated on purpose: radical transparency is the product. There
          are no write operations anywhere.
        </div>
      </section>

      <div className="feedback-line">
        Feedback:{" "}
        <a
          href="https://github.com/Ritik200238/sharpe/issues"
          target="_blank"
          rel="noopener noreferrer"
        >
          github.com/Ritik200238/sharpe/issues ↗
        </a>
      </div>
    </div>
  );
}
