export interface SseEvent {
  id?: string;
  event?: string;
  data: string;
}

export interface SseClientOptions {
  label: string;
  url: string;
  getHeaders: () => Record<string, string>;
  onEvent: (event: SseEvent) => void;
  onAuthRejected: (status: number) => Promise<void>;
  onStatus: (message: string) => void;
  idleTimeoutMs?: number;
}

/**
 * Dependency-free SSE client on native fetch: resume via Last-Event-ID,
 * exponential backoff + jitter, auth renewal on 401/403, idle watchdog.
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
        attempt = 0;
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

export function parseSseBlock(block: string): SseEvent | null {
  let id: string | undefined;
  let eventName: string | undefined;
  const dataLines: string[] = [];

  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue;
    const colon = rawLine.indexOf(":");
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
    let value = colon === -1 ? "" : rawLine.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "id") id = value;
    else if (field === "event") eventName = value;
    else if (field === "data") dataLines.push(value);
  }

  if (dataLines.length === 0 && !id && !eventName) return null;
  return { id, event: eventName, data: dataLines.join("\n") };
}
