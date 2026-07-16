export interface SseEvent {
  id?: string;
  event?: string;
  data: string;
}

export interface SseClientOptions {
  label: string;
  url: string;
  /** Fresh auth headers for each (re)connect attempt. */
  getHeaders: () => Record<string, string>;
  /** Called once per parsed SSE event. */
  onEvent: (event: SseEvent) => void;
  /** Called on 401/403 so the owner can renew credentials before retry. */
  onAuthRejected: (status: number) => Promise<void>;
  /** Lifecycle/status logging hook. */
  onStatus: (message: string) => void;
  /** Reconnect if the stream is silent this long (default 90s). */
  idleTimeoutMs?: number;
}

/**
 * Minimal, dependency-free SSE client on native fetch with: resume via
 * Last-Event-ID, exponential backoff + jitter, auth renewal on 401/403,
 * and an idle watchdog. Runs until stop() is called.
 */
export class SseClient {
  private stopped = false;
  private lastEventId?: string;
  private abort?: AbortController;

  constructor(private readonly opts: SseClientOptions) {}

  stop(): void {
    this.stopped = true;
    this.abort?.abort();
  }

  async run(): Promise<void> {
    let attempt = 0;
    while (!this.stopped) {
      try {
        await this.connectOnce();
        attempt = 0; // clean close → reconnect promptly
      } catch (error: any) {
        if (this.stopped) break;
        attempt += 1;
        const backoff = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
        const wait = backoff / 2 + Math.random() * (backoff / 2);
        this.opts.onStatus(
          `disconnected (${error?.message ?? error}); retry ${attempt} in ${Math.round(wait)}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }

  private async connectOnce(): Promise<void> {
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
      ...this.opts.getHeaders(),
    };
    if (this.lastEventId) headers["Last-Event-ID"] = this.lastEventId;

    this.abort = new AbortController();
    const response = await fetch(this.opts.url, { headers, signal: this.abort.signal });

    if (response.status === 401 || response.status === 403) {
      await this.opts.onAuthRejected(response.status);
      throw new Error(`auth rejected (${response.status})`);
    }
    if (!response.ok || !response.body) {
      throw new Error(`unexpected response ${response.status}`);
    }
    this.opts.onStatus("connected");

    const idleMs = this.opts.idleTimeoutMs ?? 90_000;
    let idleTimer = setTimeout(() => this.abort?.abort(), idleMs);
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => this.abort?.abort(), idleMs);
    };

    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        resetIdle();
        buffer += decoder.decode(chunk, { stream: true });

        // SSE messages are separated by a blank line (\n\n or \r\n\r\n).
        let boundary: number;
        while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, "");
          const event = parseSseBlock(block);
          if (event) {
            if (event.id) this.lastEventId = event.id;
            this.opts.onEvent(event);
          }
        }
      }
    } finally {
      clearTimeout(idleTimer);
    }
    this.opts.onStatus("stream ended by server");
  }
}

function parseSseBlock(block: string): SseEvent | null {
  let id: string | undefined;
  let eventName: string | undefined;
  const dataLines: string[] = [];

  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue; // comment/keepalive
    const colon = rawLine.indexOf(":");
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
    let value = colon === -1 ? "" : rawLine.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    switch (field) {
      case "id":
        id = value;
        break;
      case "event":
        eventName = value;
        break;
      case "data":
        dataLines.push(value);
        break;
      default:
        break; // per spec, ignore unknown fields (incl. retry for our use)
    }
  }

  if (dataLines.length === 0 && !id && !eventName) return null;
  return { id, event: eventName, data: dataLines.join("\n") };
}
