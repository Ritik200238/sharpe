import { strict as assert } from "node:assert";
import { test } from "node:test";
import { startApiServer } from "../src/api/server";
import {
  BrainStream,
  brainStream,
  formatSse,
  matchesFilters,
} from "../src/api/stream";
import { parseSseBlock } from "../src/platform/sse";

// HARDENING item 2 acceptance: live SSE brain feed with filters and
// Last-Event-ID resume, replaying missed events exactly once.

test("brain stream: ring replay returns exactly the events after an id", () => {
  const stream = new BrainStream();
  const a = stream.publish("decision", 1000, { strategy: "S1_COHERENCE", fixtureId: 1 });
  const b = stream.publish("settlement", 2000, { fixtureId: 1 });
  const c = stream.publish("review", 3000, { fixtureId: 1 });

  assert.deepEqual(stream.replayAfter(a.id).map((e) => e.id), [b.id, c.id]);
  assert.deepEqual(stream.replayAfter(c.id), []);
  // Unknown id → full ring (duplicates beat silent gaps in an audit feed).
  assert.equal(stream.replayAfter("bogus").length, 3);
  assert.deepEqual(stream.replayAfter(undefined), []);
});

test("brain stream: filters — strategy is decision-feed semantics, fixture is AND-ed", () => {
  const decision = { id: "1:1", type: "decision" as const, ts: 1, data: { strategy: "S1_COHERENCE", fixtureId: 7 } };
  const other = { id: "1:2", type: "decision" as const, ts: 1, data: { strategy: "S2_REACTION", fixtureId: 7 } };
  const review = { id: "1:3", type: "review" as const, ts: 1, data: { fixtureId: 7 } };

  assert.equal(matchesFilters(decision, { strategy: "S1_COHERENCE" }), true);
  assert.equal(matchesFilters(other, { strategy: "S1_COHERENCE" }), false);
  assert.equal(matchesFilters(review, { strategy: "S1_COHERENCE" }), false); // no strategy field
  assert.equal(matchesFilters(review, { fixtureId: 7 }), true);
  assert.equal(matchesFilters(review, { fixtureId: 8 }), false);
  assert.equal(matchesFilters(decision, { strategy: "S1_COHERENCE", fixtureId: 8 }), false);
});

test("brain stream: SSE wire format carries event, id, and envelope", () => {
  const wire = formatSse({ id: "5:9", type: "decision", ts: 5, data: { x: 1 } });
  const parsed = parseSseBlock(wire.trimEnd());
  assert.ok(parsed);
  assert.equal(parsed!.event, "decision");
  assert.equal(parsed!.id, "5:9");
  assert.deepEqual(JSON.parse(parsed!.data), { type: "decision", ts: 5, data: { x: 1 } });
});

test("GET /stream: live events, server-side filter, Last-Event-ID resume", async () => {
  const port = 18797;
  const server = startApiServer(() => null, port, () => "test", () => {});
  try {
    // Client 1: filtered to S1 only.
    const controller1 = new AbortController();
    const response1 = await fetch(`http://localhost:${port}/stream?strategy=S1_COHERENCE`, {
      signal: controller1.signal,
    });
    assert.equal(response1.headers.get("content-type"), "text/event-stream");
    const reader1 = readEvents(response1);

    brainStream.publish("decision", 10_000, { strategy: "S1_COHERENCE", fixtureId: 1, n: 1 });
    brainStream.publish("decision", 10_001, { strategy: "S2_REACTION", fixtureId: 1, n: 2 });
    brainStream.publish("decision", 10_002, { strategy: "S1_COHERENCE", fixtureId: 1, n: 3 });

    const received = await reader1.take(2, 5000);
    controller1.abort();
    assert.deepEqual(
      received.map((e) => (JSON.parse(e.data).data as any).n),
      [1, 3],
      "S2 event must be filtered out",
    );
    const lastId = received[1].id!;

    // Events missed while disconnected...
    brainStream.publish("decision", 10_003, { strategy: "S1_COHERENCE", fixtureId: 2, n: 4 });
    brainStream.publish("decision", 10_004, { strategy: "S1_COHERENCE", fixtureId: 2, n: 5 });

    // ...are replayed exactly once on resume.
    const controller2 = new AbortController();
    const response2 = await fetch(`http://localhost:${port}/stream?strategy=S1_COHERENCE`, {
      signal: controller2.signal,
      headers: { "Last-Event-ID": lastId },
    });
    const reader2 = readEvents(response2);
    const resumed = await reader2.take(2, 5000);
    controller2.abort();
    assert.deepEqual(
      resumed.map((e) => (JSON.parse(e.data).data as any).n),
      [4, 5],
      "resume must replay missed events exactly once, no duplicates",
    );
  } finally {
    server.close();
  }
});

/** Tiny SSE consumer for tests: buffers blocks, hands out parsed events. */
function readEvents(response: Response) {
  const events: Array<{ id?: string; event?: string; data: string }> = [];
  const waiters: Array<() => void> = [];
  void (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let boundary: number;
        while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, "");
          const parsed = parseSseBlock(block);
          if (parsed?.data) {
            events.push(parsed);
            waiters.splice(0).forEach((w) => w());
          }
        }
      }
    } catch {
      // aborted by test — fine
    }
  })();

  return {
    async take(n: number, timeoutMs: number) {
      const deadline = Date.now() + timeoutMs;
      while (events.length < n) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${n} events`);
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, 100);
        });
      }
      return events.slice(0, n);
    },
  };
}
