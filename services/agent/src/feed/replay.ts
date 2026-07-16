import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { parseJson, parseOddsRecord, parseScoreRecord } from "./parse";
import { FeedEvent, FeedSource } from "./types";

interface JournalLine {
  recvTs: number;
  type: "event" | "status";
  id?: string;
  event?: string;
  data?: string;
  message?: string;
}

/**
 * Replay feed: reads recorder NDJSON journals and emits the exact same
 * normalized events the live feed would produce — the whole agent runs
 * identically in both modes. Pacing: speed=0 → as fast as possible,
 * speed=1 → realtime gaps, speed=10 → 10x, etc.
 */
export class ReplayFeed implements FeedSource {
  private running = false;

  constructor(
    private readonly dir: string,
    private readonly speed: number = 0,
  ) {}

  stop(): void {
    this.running = false;
  }

  /** Find journal files under dir (any depth): scores.ndjson / odds.ndjson. */
  private discover(): Array<{ stream: "scores" | "odds"; file: string }> {
    const found: Array<{ stream: "scores" | "odds"; file: string }> = [];
    const walk = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "scores.ndjson") found.push({ stream: "scores", file: full });
        else if (entry.name === "odds.ndjson") found.push({ stream: "odds", file: full });
      }
    };
    walk(this.dir);
    return found;
  }

  private async loadAll(): Promise<FeedEvent[]> {
    const events: FeedEvent[] = [];
    for (const { stream, file } of this.discover()) {
      const rl = readline.createInterface({
        input: fs.createReadStream(file),
        crlfDelay: Infinity,
      });
      for await (const line of rl) {
        if (!line.trim()) continue;
        let journal: JournalLine;
        try {
          journal = JSON.parse(line) as JournalLine;
        } catch {
          continue;
        }
        if (journal.type !== "event" || !journal.data) continue;
        const payload = parseJson(journal.data);
        if (payload === undefined) continue;
        if (stream === "scores") {
          const record = parseScoreRecord(payload);
          if (record) events.push({ kind: "score", recvTs: journal.recvTs, record });
        } else {
          const record = parseOddsRecord(payload);
          if (record) events.push({ kind: "odds", recvTs: journal.recvTs, record });
        }
      }
    }
    // Deterministic global ordering: receive time, then stream kind, then
    // fixture/sequence — identical inputs always replay identically.
    events.sort((a, b) => {
      if (a.recvTs !== b.recvTs) return a.recvTs - b.recvTs;
      if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
      const aKey = a.kind === "score" ? a.record.seq : a.kind === "odds" ? a.record.ts : 0;
      const bKey = b.kind === "score" ? b.record.seq : b.kind === "odds" ? b.record.ts : 0;
      return aKey - bKey;
    });
    return events;
  }

  async *events(): AsyncGenerator<FeedEvent> {
    this.running = true;
    const all = await this.loadAll();
    let previousTs: number | undefined;

    for (const event of all) {
      if (!this.running) return;
      if (this.speed > 0 && previousTs !== undefined) {
        const gap = (event.recvTs - previousTs) / this.speed;
        if (gap > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(gap, 30_000)));
      }
      previousTs = event.recvTs;
      yield event;
    }
  }
}
