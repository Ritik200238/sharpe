/**
 * BrainStream — the agent's live thought feed (HARDENING item 2).
 *
 * A minimal in-process pub/sub with a replay ring, exposed over SSE by
 * api/server.ts. SHARPE broadcasts its brain the same way TxLINE broadcasts
 * matches: Server-Sent Events with monotonic ids and Last-Event-ID resume.
 * No event-bus library, no WebSocket dependency.
 */

export type BrainEventType =
  | "decision"
  | "settlement"
  | "review"
  | "status"
  | "mm_fill"
  | "mm_book";

export interface BrainEvent {
  /** Monotonic id, `<ts>:<n>` — mirrors TxLINE's own id shape. */
  id: string;
  type: BrainEventType;
  ts: number;
  data: unknown;
}

export interface StreamFilters {
  strategy?: string;
  fixtureId?: number;
}

type Subscriber = (event: BrainEvent) => void;

const RING_LIMIT = 500;

export class BrainStream {
  private ring: BrainEvent[] = [];
  private counter = 0;
  private subscribers = new Set<Subscriber>();

  publish(type: BrainEventType, ts: number, data: unknown): BrainEvent {
    this.counter += 1;
    const event: BrainEvent = { id: `${ts}:${this.counter}`, type, ts, data };
    this.ring.push(event);
    if (this.ring.length > RING_LIMIT) this.ring.shift();
    for (const subscriber of this.subscribers) {
      try {
        subscriber(event);
      } catch {
        // one broken client must never break the publisher
      }
    }
    return event;
  }

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  /** Events published after the given Last-Event-ID (all when unknown). */
  replayAfter(lastEventId: string | undefined): BrainEvent[] {
    if (!lastEventId) return [];
    const index = this.ring.findIndex((event) => event.id === lastEventId);
    // Unknown id (evicted or bogus): replay the whole ring — duplicates are
    // preferable to silent gaps for an audit feed.
    return index === -1 ? [...this.ring] : this.ring.slice(index + 1);
  }
}

export function matchesFilters(event: BrainEvent, filters: StreamFilters): boolean {
  const record = event.data as { strategy?: string; fixtureId?: number } | null;
  if (filters.strategy !== undefined) {
    // Strategy filtering is decision-feed semantics: only events that carry
    // a strategy can match; everything else is excluded.
    if (record?.strategy !== filters.strategy) return false;
  }
  if (filters.fixtureId !== undefined) {
    if (record?.fixtureId !== filters.fixtureId) return false;
  }
  return true;
}

export function formatSse(event: BrainEvent): string {
  const payload = JSON.stringify({ type: event.type, ts: event.ts, data: event.data });
  return `event: ${event.type}\nid: ${event.id}\ndata: ${payload}\n\n`;
}

/** The one process-wide stream: Agent publishes, the API server serves. */
export const brainStream = new BrainStream();
