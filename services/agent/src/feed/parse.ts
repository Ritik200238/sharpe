import { OddsRecord, ScoreRecord } from "./types";

/** Read a field that may appear in either PascalCase or camelCase. */
function pick(obj: any, ...names: string[]): unknown {
  for (const name of names) {
    if (obj?.[name] !== undefined && obj[name] !== null) return obj[name];
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

/**
 * Parse one scores payload (stream data / snapshot row / historical row).
 * Returns null when the payload has no usable fixture identity.
 */
export function parseScoreRecord(payload: unknown): ScoreRecord | null {
  if (typeof payload !== "object" || payload === null) return null;
  const fixtureId = asNumber(pick(payload, "fixtureId", "FixtureId"));
  const seq = asNumber(pick(payload, "seq", "Seq"));
  const ts = asNumber(pick(payload, "ts", "Ts"));
  if (fixtureId === undefined || seq === undefined || ts === undefined) return null;

  const statsRaw = pick(payload, "stats", "Stats");
  let stats: Record<number, number> | undefined;
  if (typeof statsRaw === "object" && statsRaw !== null) {
    stats = {};
    for (const [key, value] of Object.entries(statsRaw as Record<string, unknown>)) {
      const k = asNumber(key);
      const v = asNumber(value);
      if (k !== undefined && v !== undefined) stats[k] = v;
    }
  }

  return {
    fixtureId,
    seq,
    ts,
    action: String(pick(payload, "action", "Action") ?? ""),
    gameState: pick(payload, "gameState", "GameState") as string | undefined,
    phase:
      asNumber(pick(payload, "statusSoccerId", "StatusSoccerId")) ??
      asNumber(pick(payload, "statusId", "StatusId")),
    period: asNumber(pick(payload, "period", "Period")),
    competitionId: asNumber(pick(payload, "competitionId", "CompetitionId")),
    participant1Id: asNumber(pick(payload, "participant1Id", "Participant1Id")),
    participant2Id: asNumber(pick(payload, "participant2Id", "Participant2Id")),
    participant1IsHome: pick(payload, "participant1IsHome", "Participant1IsHome") as
      | boolean
      | undefined,
    startTime: asNumber(pick(payload, "startTime", "StartTime")),
    stats,
    confirmed: pick(payload, "confirmed", "Confirmed") as boolean | undefined,
    raw: payload,
  };
}

/** Parse one odds payload (stream data / snapshot row). */
export function parseOddsRecord(payload: unknown): OddsRecord | null {
  if (typeof payload !== "object" || payload === null) return null;
  const fixtureId = asNumber(pick(payload, "FixtureId", "fixtureId"));
  const ts = asNumber(pick(payload, "Ts", "ts"));
  const messageId = pick(payload, "MessageId", "messageId");
  if (fixtureId === undefined || ts === undefined || messageId === undefined) return null;

  const priceNames = (pick(payload, "PriceNames", "priceNames") as string[] | undefined) ?? [];
  const prices = ((pick(payload, "Prices", "prices") as unknown[] | undefined) ?? [])
    .map(asNumber)
    .filter((value): value is number => value !== undefined);

  // Pct entries are "NA" or "12.345" (percent, 3 decimals) → fraction or null.
  const pctRaw = (pick(payload, "Pct", "pct") as string[] | undefined) ?? [];
  const pct = pctRaw.map((entry) => {
    const value = asNumber(entry);
    return value === undefined ? null : value / 100;
  });

  return {
    fixtureId,
    messageId: String(messageId),
    ts,
    bookmaker: String(pick(payload, "Bookmaker", "bookmaker") ?? ""),
    bookmakerId: asNumber(pick(payload, "BookmakerId", "bookmakerId")),
    superOddsType: String(pick(payload, "SuperOddsType", "superOddsType") ?? ""),
    inRunning: Boolean(pick(payload, "InRunning", "inRunning") ?? false),
    gameState: pick(payload, "GameState", "gameState") as string | undefined,
    marketParameters: pick(payload, "MarketParameters", "marketParameters") as
      | string
      | undefined,
    marketPeriod: pick(payload, "MarketPeriod", "marketPeriod") as string | undefined,
    priceNames,
    prices,
    pct,
    raw: payload,
  };
}

export function parseJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}
