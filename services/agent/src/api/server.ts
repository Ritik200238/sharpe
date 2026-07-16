import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { Agent } from "../agent";

/**
 * Read-only status API + dashboard. This is how judges verify the agent is
 * genuinely alive: /health for liveness, /status for the brain's state,
 * /decisions for the glass-box feed, /track-record for the full log.
 */
export function startApiServer(
  getAgent: () => Agent | null,
  port: number,
  getPhase: () => string,
  log: (line: string) => void,
): http.Server {
  const dashboardPath = path.join(__dirname, "dashboard.html");
  const dashboard = fs.existsSync(dashboardPath)
    ? fs.readFileSync(dashboardPath, "utf8")
    : "<h1>SHARPE</h1><p>dashboard asset missing</p>";

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (code: number, body: unknown, type = "application/json") => {
      res.writeHead(code, {
        "Content-Type": type,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      res.end(type === "application/json" ? JSON.stringify(body, null, 2) : String(body));
    };

    const agent = getAgent();
    try {
      switch (url.pathname) {
        case "/":
          return send(200, dashboard, "text/html; charset=utf-8");
        case "/health":
          return send(200, {
            ok: true,
            phase: getPhase(),
            uptimeSec: Math.floor(process.uptime()),
            now: new Date().toISOString(),
          });
        case "/status":
          return send(200, agent ? agent.status() : { phase: getPhase() });
        case "/decisions": {
          const limit = Number(url.searchParams.get("limit") ?? 50);
          return send(200, agent ? agent.recentDecisions(limit) : []);
        }
        case "/positions":
          return send(200, agent ? agent.openPositions() : []);
        case "/settlements":
          return send(200, agent ? agent.settlements() : []);
        case "/reviews":
          return send(200, agent ? agent.reviews() : []);
        case "/track-record":
          return send(200, {
            aggregates: agent?.status().aggregates ?? null,
            decisions: agent?.recentDecisions(500) ?? [],
            settlements: agent?.settlements() ?? [],
            reviews: agent?.reviews() ?? [],
          });
        default:
          return send(404, { error: "not found" });
      }
    } catch (error: any) {
      return send(500, { error: error?.message ?? String(error) });
    }
  });

  server.listen(port, () => log(`[api] listening on http://localhost:${port}`));
  return server;
}
