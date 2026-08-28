import { getClassName, getRaceName } from "../domain/wotlk.js";
import type { StatsPopulation } from "./death-leaderboard.js";
import {
  getStatsDatabase,
  type StatsDatabaseConfig,
  validateStatsDatabaseIdentifier
} from "./stats-database.js";

const QUEST_COMPLETE_EVENT = "QUEST_COMPLETE";
const QUEST_TARGET_TYPE = 4;
const QUEST_SOURCE = "quest";
const CACHE_TTL_MS = 60_000;
const QUERY_TIMEOUT_MS = 8_000;
const MAX_ROWS = 25;

export type { StatsPopulation };

export interface QuestCompletionLeaderboardEntry {
  characterName: string;
  race: string;
  class: string;
  level: number;
  accountLogin: string;
  isBot: boolean;
  questCompletions: number;
}

export interface QuestCompletionLeaderboardResponse {
  generatedAt: string;
  population: StatsPopulation;
  coverage: { firstRecordedAt: string | null };
  count: number;
  entries: QuestCompletionLeaderboardEntry[];
}

export interface QuestCompletionLeaderboardQuery {
  sql: string;
  values: readonly [number, string, string, string];
}

export interface MappedQuestCompletionRows {
  coverage: { firstRecordedAt: string | null };
  entries: QuestCompletionLeaderboardEntry[];
}

export class QuestCompletionLeaderboardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestCompletionLeaderboardError";
  }
}

export class QuestCompletionContractIntegrityError extends QuestCompletionLeaderboardError {
  constructor() {
    super("Quest completion provider contract integrity check failed.");
    this.name = "QuestCompletionContractIntegrityError";
  }
}

function qualified(database: string, table: string): string {
  return `\`${database}\`.\`${table}\``;
}

export function buildQuestCompletionLeaderboardQuery(
  config: Pick<StatsDatabaseConfig, "charactersDatabase" | "authDatabase">,
  population: StatsPopulation
): QuestCompletionLeaderboardQuery {
  const charactersDatabase = validateStatsDatabaseIdentifier(
    config.charactersDatabase,
    "STATS_CHARACTERS_DATABASE"
  );
  const authDatabase = validateStatsDatabaseIdentifier(config.authDatabase, "STATS_AUTH_DATABASE");
  const eventsTable = qualified(charactersDatabase, "mod_player_stats_events");
  const charactersTable = qualified(charactersDatabase, "characters");
  const accountsTable = qualified(authDatabase, "account");
  const populationClause = population === "players" ? "      AND e.actor_is_bot = 0\n" : "";

  return {
    sql: `WITH quest_contract AS (
    SELECT
        MIN(event_time) AS firstRecordedAt,
        COALESCE(MAX(
            event_time IS NULL
            OR target_type IS NULL OR target_type <> ?
            OR target_entry IS NULL OR target_entry = 0
            OR target_guid IS NULL OR target_guid <> 0
            OR target_is_bot IS NULL OR target_is_bot <> 0
            OR value1 IS NULL OR value1 <> 0
            OR value2 IS NULL OR value2 <> 0
            OR source IS NULL OR source <> ?
            OR actor_guid IS NULL OR actor_guid = 0
            OR actor_is_bot IS NULL OR actor_is_bot NOT IN (0, 1)
        ), 0) AS hasInvalidEvent
    FROM ${eventsTable}
    WHERE event_type = ?
),
quest_totals AS (
    SELECT
        e.actor_guid,
        e.actor_is_bot,
        COUNT(*) AS questCompletions
    FROM ${eventsTable} e
    WHERE e.event_type = ?
${populationClause}    GROUP BY e.actor_guid, e.actor_is_bot
),
eligible_totals AS (
    SELECT
        c.name AS characterName,
        c.race AS raceId,
        c.class AS classId,
        c.level,
        a.username AS accountLogin,
        q.actor_is_bot AS isBot,
        q.questCompletions
    FROM quest_totals q
    JOIN ${charactersTable} c ON c.guid = q.actor_guid
    LEFT JOIN ${accountsTable} a ON a.id = c.account
    WHERE c.deleteDate IS NULL
    ORDER BY q.questCompletions DESC, c.name ASC, q.actor_is_bot ASC
    LIMIT 25
)
SELECT
    qc.firstRecordedAt,
    qc.hasInvalidEvent,
    e.characterName,
    e.raceId,
    e.classId,
    e.level,
    e.accountLogin,
    e.isBot,
    e.questCompletions
FROM quest_contract qc
LEFT JOIN eligible_totals e ON TRUE
ORDER BY e.questCompletions DESC, e.characterName ASC, e.isBot ASC`,
    values: [QUEST_TARGET_TYPE, QUEST_SOURCE, QUEST_COMPLETE_EVENT, QUEST_COMPLETE_EVENT]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(row: Record<string, unknown>, key: string, maximumLength: number): string {
  const value = row[key];
  if (
    typeof value !== "string" || value.length === 0 || value.length > maximumLength ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new QuestCompletionLeaderboardError(`Database row field ${key} is invalid.`);
  }
  return value;
}

function requireInteger(
  row: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number
): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new QuestCompletionLeaderboardError(`Database row field ${key} is invalid.`);
  }
  return value;
}

function requireDatabaseSafeInteger(value: unknown, key: string): number {
  const parsed = typeof value === "bigint"
    ? Number(value)
    : typeof value === "string" && /^\d+$/u.test(value)
      ? Number(value)
      : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new QuestCompletionLeaderboardError(`Database row field ${key} is invalid.`);
  }
  return parsed;
}

function requireBotFlag(value: unknown): boolean {
  if (value === 0 || value === false) return false;
  if (value === 1 || value === true) return true;
  throw new QuestCompletionLeaderboardError("Database row field isBot is invalid.");
}

function requireUtcTimestamp(value: unknown): string {
  let timestamp: Date;
  if (value instanceof Date) {
    timestamp = value;
  } else if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z?$/u.exec(value);
    if (!match) {
      throw new QuestCompletionLeaderboardError("Database row field firstRecordedAt is invalid.");
    }
    const normalized = `${match[1]}T${match[2]}.${(match[3] ?? "").padEnd(3, "0").slice(0, 3)}Z`;
    timestamp = new Date(normalized);
    if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== normalized) {
      throw new QuestCompletionLeaderboardError("Database row field firstRecordedAt is invalid.");
    }
  } else {
    throw new QuestCompletionLeaderboardError("Database row field firstRecordedAt is invalid.");
  }
  if (!Number.isFinite(timestamp.getTime())) {
    throw new QuestCompletionLeaderboardError("Database row field firstRecordedAt is invalid.");
  }
  return timestamp.toISOString();
}

export function mapQuestCompletionLeaderboardRows(rows: unknown): QuestCompletionLeaderboardEntry[] {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) {
    throw new QuestCompletionLeaderboardError("Quest completion leaderboard database result is invalid.");
  }
  return rows.map((value) => {
    if (!isRecord(value)) {
      throw new QuestCompletionLeaderboardError("Quest completion leaderboard contains an invalid row.");
    }
    const raceId = requireInteger(value, "raceId", 0, 255);
    const classId = requireInteger(value, "classId", 0, 255);
    return {
      characterName: requireString(value, "characterName", 128),
      race: getRaceName(raceId),
      class: getClassName(classId),
      level: requireInteger(value, "level", 1, 255),
      accountLogin: value.accountLogin === null
        ? "Unknown account"
        : requireString(value, "accountLogin", 128),
      isBot: requireBotFlag(value.isBot),
      questCompletions: requireDatabaseSafeInteger(value.questCompletions, "questCompletions")
    };
  });
}

function isEmptyRow(row: Record<string, unknown>): boolean {
  if (row.characterName !== null) return false;
  for (const key of ["raceId", "classId", "level", "accountLogin", "isBot", "questCompletions"] as const) {
    if (row[key] !== null) {
      throw new QuestCompletionLeaderboardError("Empty quest completion leaderboard row is malformed.");
    }
  }
  return true;
}

export function mapQuestCompletionQueryRows(rows: unknown): MappedQuestCompletionRows {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) {
    throw new QuestCompletionLeaderboardError("Quest completion leaderboard database result is invalid.");
  }
  const records = rows.map((value) => {
    if (!isRecord(value)) {
      throw new QuestCompletionLeaderboardError("Quest completion leaderboard contains an invalid row.");
    }
    return value;
  });
  const first = records[0]!;
  if (requireDatabaseSafeInteger(first.hasInvalidEvent, "hasInvalidEvent") !== 0) {
    throw new QuestCompletionContractIntegrityError();
  }
  const firstRecordedAt = first.firstRecordedAt === null
    ? null
    : requireUtcTimestamp(first.firstRecordedAt);

  for (const record of records.slice(1)) {
    if (requireDatabaseSafeInteger(record.hasInvalidEvent, "hasInvalidEvent") !== 0) {
      throw new QuestCompletionContractIntegrityError();
    }
    const rowTimestamp = record.firstRecordedAt === null ? null : requireUtcTimestamp(record.firstRecordedAt);
    if (rowTimestamp !== firstRecordedAt) {
      throw new QuestCompletionLeaderboardError("Quest completion coverage metadata is inconsistent.");
    }
  }

  if (isEmptyRow(first)) {
    if (records.length !== 1) {
      throw new QuestCompletionLeaderboardError("Empty quest completion leaderboard result is invalid.");
    }
    return { coverage: { firstRecordedAt }, entries: [] };
  }
  if (firstRecordedAt === null) {
    throw new QuestCompletionLeaderboardError("Quest completion coverage metadata is inconsistent.");
  }
  return {
    coverage: { firstRecordedAt },
    entries: mapQuestCompletionLeaderboardRows(records)
  };
}

export type QueryQuestCompletionRows = (population: StatsPopulation) => Promise<unknown>;

export async function queryQuestCompletionRows(population: StatsPopulation): Promise<unknown> {
  const { pool, config } = getStatsDatabase();
  const query = buildQuestCompletionLeaderboardQuery(config, population);
  const [rows] = await pool.execute({
    sql: query.sql,
    values: [...query.values],
    timeout: QUERY_TIMEOUT_MS
  });
  return rows;
}

export class QuestCompletionLeaderboardService {
  private readonly cache = new Map<StatsPopulation, {
    value: QuestCompletionLeaderboardResponse;
    expiresAt: number;
  }>();
  private readonly inFlight = new Map<StatsPopulation, Promise<QuestCompletionLeaderboardResponse>>();

  constructor(
    private readonly queryRows: QueryQuestCompletionRows = queryQuestCompletionRows,
    private readonly now: () => number = Date.now
  ) {}

  async getLeaderboard(population: StatsPopulation): Promise<QuestCompletionLeaderboardResponse> {
    const now = this.now();
    const cached = this.cache.get(population);
    if (cached && now < cached.expiresAt) return cached.value;
    const active = this.inFlight.get(population);
    if (active) return active;

    const refresh = this.refresh(population);
    const tracked = refresh.finally(() => {
      if (this.inFlight.get(population) === tracked) this.inFlight.delete(population);
    });
    this.inFlight.set(population, tracked);
    return tracked;
  }

  private async refresh(population: StatsPopulation): Promise<QuestCompletionLeaderboardResponse> {
    const mapped = mapQuestCompletionQueryRows(await this.queryRows(population));
    const generatedAt = this.now();
    const response: QuestCompletionLeaderboardResponse = {
      generatedAt: new Date(generatedAt).toISOString(),
      population,
      coverage: mapped.coverage,
      count: mapped.entries.length,
      entries: mapped.entries
    };
    this.cache.set(population, { value: response, expiresAt: generatedAt + CACHE_TTL_MS });
    return response;
  }
}

const questCompletionLeaderboardService = new QuestCompletionLeaderboardService();

export function getQuestCompletionLeaderboard(
  population: StatsPopulation
): Promise<QuestCompletionLeaderboardResponse> {
  return questCompletionLeaderboardService.getLeaderboard(population);
}
