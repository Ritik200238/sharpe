import * as fs from "node:fs";
import * as path from "node:path";
import { AuthSession } from "./auth";
import { Network, NetworkConfig, RECORDINGS_DIR } from "./config";
import { SseClient } from "./sse";

type StreamName = "scores" | "odds";

interface JournalLine {
  recvTs: number;
  type: "event" | "status";
  id?: string;
  event?: string;
  data?: string;
  message?: string;
}

/**
 * Append-only NDJSON journal, one file per stream per UTC day:
 * data/recordings/<network>/<YYYY-MM-DD>/<stream>.ndjson
 * Raw event payloads are stored verbatim — fidelity over convenience.
 */
class Journal {
  private streams = new Map<string, { date: string; out: fs.WriteStream }>();
  public counts: Record<StreamName, number> = { scores: 0, odds: 0 };

  constructor(private readonly network: Network) {}

  private fileFor(stream: StreamName): fs.WriteStream {
    const date = new Date().toISOString().slice(0, 10);
    const existing = this.streams.get(stream);
    if (existing && existing.date === date) return existing.out;

    existing?.out.end();
    const dir = path.join(RECORDINGS_DIR, this.network, date);
    fs.mkdirSync(dir, { recursive: true });
    const out = fs.createWriteStream(path.join(dir, `${stream}.ndjson`), { flags: "a" });
    this.streams.set(stream, { date, out });
    return out;
  }

  write(stream: StreamName, line: JournalLine): void {
    this.fileFor(stream).write(`${JSON.stringify(line)}\n`);
    if (line.type === "event") this.counts[stream] += 1;
  }

  close(): void {
    for (const { out } of this.streams.values()) out.end();
  }
}

export async function runRecorder(cfg: NetworkConfig, session: AuthSession): Promise<void> {
  const journal = new Journal(cfg.network);

  const makeClient = (stream: StreamName): SseClient =>
    new SseClient({
      label: stream,
      url: `${cfg.apiBaseUrl}/${stream}/stream`,
      getHeaders: () => session.headers(),
      onEvent: (event) =>
        journal.write(stream, {
          recvTs: Date.now(),
          type: "event",
          id: event.id,
          event: event.event,
          data: event.data,
        }),
      onAuthRejected: async (status) => {
        console.log(`[${stream}] auth rejected (${status}) — renewing JWT`);
        if (status === 401) await session.renewJwt();
        // 403 = token/network mismatch; renewing won't fix it but retry logs it loudly.
      },
      onStatus: (message) => {
        console.log(`[${stream}] ${message}`);
        journal.write(stream, { recvTs: Date.now(), type: "status", message });
      },
    });

  const clients = [makeClient("scores"), makeClient("odds")];

  const heartbeat = setInterval(() => {
    console.log(
      `[recorder] alive — scores: ${journal.counts.scores} events, odds: ${journal.counts.odds} events`,
    );
  }, 30_000);

  const shutdown = () => {
    console.log("\n[recorder] stopping...");
    clearInterval(heartbeat);
    for (const client of clients) client.stop();
    journal.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(`[recorder] recording ${cfg.network} scores + odds → ${RECORDINGS_DIR}`);
  await Promise.all(clients.map((client) => client.run()));
}
