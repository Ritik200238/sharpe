import { AuthSession } from "../platform/auth";
import { NetworkConfig } from "../platform/config";
import { SseClient } from "../platform/sse";
import { parseJson, parseOddsRecord, parseScoreRecord } from "./parse";
import { FeedEvent, FeedSource } from "./types";

/**
 * Live TxLINE feed: both SSE streams multiplexed into one ordered event
 * queue. Reconnection, JWT renewal, and backoff live in SseClient; this
 * class only normalizes payloads.
 */
export class LiveFeed implements FeedSource {
  private queue: FeedEvent[] = [];
  private waiters: Array<() => void> = [];
  private clients: SseClient[] = [];
  private running = false;

  constructor(
    private readonly cfg: NetworkConfig,
    private readonly session: AuthSession,
  ) {}

  private push(event: FeedEvent): void {
    this.queue.push(event);
    const waiter = this.waiters.shift();
    if (waiter) waiter();
  }

  private makeClient(stream: "scores" | "odds"): SseClient {
    return new SseClient({
      label: stream,
      url: `${this.cfg.apiBaseUrl}/${stream}/stream`,
      getHeaders: () => this.session.headers(),
      onAuthRejected: async (status) => {
        if (status === 401) await this.session.renewJwt();
      },
      onStatus: (message) => this.push({ kind: "status", recvTs: Date.now(), stream, message }),
      onEvent: (sse) => {
        const recvTs = Date.now();
        if (sse.event === "heartbeat") {
          this.push({ kind: "heartbeat", recvTs, stream });
          return;
        }
        const payload = parseJson(sse.data);
        if (payload === undefined) return;
        if (stream === "scores") {
          const record = parseScoreRecord(payload);
          if (record) this.push({ kind: "score", recvTs, record });
        } else {
          const record = parseOddsRecord(payload);
          if (record) this.push({ kind: "odds", recvTs, record });
        }
      },
    });
  }

  stop(): void {
    this.running = false;
    for (const client of this.clients) client.stop();
    for (const waiter of this.waiters.splice(0)) waiter();
  }

  async *events(): AsyncGenerator<FeedEvent> {
    this.running = true;
    this.clients = [this.makeClient("scores"), this.makeClient("odds")];
    for (const client of this.clients) void client.run();

    while (this.running) {
      if (this.queue.length === 0) {
        await new Promise<void>((resolve) => this.waiters.push(resolve));
        continue;
      }
      yield this.queue.shift()!;
    }
  }
}
