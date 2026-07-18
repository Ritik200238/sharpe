/**
 * Hand-rolled hash routing. Routes:
 *   #/            command
 *   #/ledger      track record
 *   #/performance performance digest
 *   #/decision/<hash>
 *   #/fixture/<id>
 *   #/about
 *   #/system
 */

export type Route =
  | { name: "command" }
  | { name: "market" }
  | { name: "ledger" }
  | { name: "performance" }
  | { name: "detail"; hash: string }
  | { name: "fixture"; id: number }
  | { name: "about" }
  | { name: "system" };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, "");
  const parts = path.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return { name: "command" };
  switch (parts[0]) {
    case "market":
      return { name: "market" };
    case "ledger":
      return { name: "ledger" };
    case "performance":
      return { name: "performance" };
    case "about":
      return { name: "about" };
    case "system":
      return { name: "system" };
    case "decision":
      return parts[1] ? { name: "detail", hash: parts[1] } : { name: "ledger" };
    case "fixture": {
      const id = Number(parts[1]);
      return Number.isFinite(id) ? { name: "fixture", id } : { name: "ledger" };
    }
    default:
      return { name: "command" };
  }
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case "command":
      return "#/";
    case "market":
      return "#/market";
    case "ledger":
      return "#/ledger";
    case "performance":
      return "#/performance";
    case "about":
      return "#/about";
    case "system":
      return "#/system";
    case "detail":
      return `#/decision/${route.hash}`;
    case "fixture":
      return `#/fixture/${route.id}`;
  }
}
