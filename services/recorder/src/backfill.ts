import * as fs from "node:fs";
import * as path from "node:path";
import { AuthSession, apiGet } from "./auth";
import { NetworkConfig, RECORDINGS_DIR } from "./config";

/**
 * Backfill — recover completed matches through the historical endpoints.
 *
 * TxLINE serves full score sequences for fixtures that started between two
 * weeks and six hours ago, and odds updates per fixture. We write them in
 * the exact recorder journal format so the agent's replay mode consumes
 * them identically to live recordings. This is how the semifinals (played
 * before we had credentials) still make it into the corpus.
 */

interface FixtureRow {
  FixtureId: number;
  StartTime: number;
  Participant1: string;
  Participant2: string;
  CompetitionId: number;
  Competition?: string;
}

const WORLD_CUP_COMPETITION_ID = 72;

export async function backfill(cfg: NetworkConfig, session: AuthSession): Promise<void> {
  const nowMs = Date.now();
  const startEpochDay = Math.floor((nowMs - 14 * 86_400_000) / 86_400_000);

  const fixtures = await apiGet<FixtureRow[]>(
    cfg,
    session,
    `/fixtures/snapshot?competitionId=${WORLD_CUP_COMPETITION_ID}&startEpochDay=${startEpochDay}`,
  );
  if (!Array.isArray(fixtures)) {
    console.log("[backfill] fixtures snapshot returned nothing usable");
    return;
  }

  const eligible = fixtures.filter(
    (f) =>
      f.StartTime >= nowMs - 14 * 86_400_000 && f.StartTime <= nowMs - 6 * 60 * 60_000,
  );
  console.log(
    `[backfill] ${fixtures.length} fixtures in window, ${eligible.length} eligible for historical pull`,
  );

  for (const fixture of eligible) {
    const dir = path.join(
      RECORDINGS_DIR,
      cfg.network,
      `backfill-${fixture.FixtureId}`,
    );
    const scoresFile = path.join(dir, "scores.ndjson");
    const oddsFile = path.join(dir, "odds.ndjson");
    if (fs.existsSync(scoresFile) && fs.statSync(scoresFile).size > 0) {
      console.log(`[backfill] fixture ${fixture.FixtureId} already backfilled — skipping`);
      continue;
    }

    try {
      const scores = normalizeRecords(
        await apiGet<unknown>(cfg, session, `/scores/historical/${fixture.FixtureId}`),
      );
      const odds = normalizeRecords(
        await apiGet<unknown>(cfg, session, `/odds/updates/${fixture.FixtureId}`).catch(() => []),
      );

      fs.mkdirSync(dir, { recursive: true });
      writeJournal(scoresFile, scores, (r) => r.ts ?? r.Ts ?? fixture.StartTime);
      writeJournal(oddsFile, odds, (r) => r.Ts ?? r.ts ?? fixture.StartTime);
      console.log(
        `[backfill] ${fixture.Participant1} vs ${fixture.Participant2} (${fixture.FixtureId}): ` +
          `${scores?.length ?? 0} score records, ${odds?.length ?? 0} odds records`,
      );
    } catch (error: any) {
      console.log(
        `[backfill] fixture ${fixture.FixtureId} failed: ${error?.response?.status ?? ""} ${error?.message ?? error}`,
      );
    }
  }
  console.log("[backfill] complete");
}

/**
 * Endpoints answer in different shapes: JSON arrays, or SSE-formatted text
 * ("data: {...}" per line — the historical endpoint does this). Normalize
 * everything to an array of records.
 */
function normalizeRecords(response: unknown): any[] {
  if (Array.isArray(response)) return response;
  if (typeof response !== "string") return [];
  const records: any[] = [];
  for (const rawLine of response.split(/\r?\n/)) {
    const line = rawLine.startsWith("data:") ? rawLine.slice(5).trim() : rawLine.trim();
    if (!line || !line.startsWith("{")) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // tolerate torn lines
    }
  }
  return records;
}

function writeJournal(
  file: string,
  records: any[],
  timestampOf: (record: any) => number,
): void {
  if (!Array.isArray(records) || records.length === 0) {
    fs.writeFileSync(file, "");
    return;
  }
  const lines = records.map((record) =>
    JSON.stringify({
      recvTs: timestampOf(record),
      type: "event",
      data: JSON.stringify(record),
    }),
  );
  fs.writeFileSync(file, lines.join("\n") + "\n");
}
