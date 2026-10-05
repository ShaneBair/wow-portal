import { getClassName, getRaceName } from "../domain/wotlk.js";
import { buildAccountExclusionClause, type AccountVisibilityScope } from "./account-visibility.js";
import type { StatsPopulation } from "./death-leaderboard.js";
import { getStatsDatabase, type StatsDatabaseConfig, validateStatsDatabaseIdentifier } from "./stats-database.js";

const CACHE_TTL_MS = 60_000;
const QUERY_TIMEOUT_MS = 8_000;
const MAX_ROWS = 25;
const QUEST_TARGET_TYPE = 4;

export type { StatsPopulation };
export type QuestBingeType = "Player" | "Bot";

export interface QuestBingeEntry {
  characterName: string;
  race: string;
  class: string;
  level: number;
  accountLogin: string;
  type: QuestBingeType;
  day: string;
  questsCompleted: number;
  uniqueQuests: number;
}

export interface QuestBingeResponse {
  generatedAt: string;
  population: StatsPopulation;
  coverage: { firstRecordedAt: string | null };
  count: number;
  entries: QuestBingeEntry[];
}

export interface QuestBingeQuery {
  contractSql: string;
  contractValues: readonly (string | number)[];
  sql: string;
  values: readonly (string | number | Date)[];
}

export class QuestBingeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestBingeError";
  }
}

export class QuestBingeContractIntegrityError extends QuestBingeError {
  constructor() {
    super("Quest Binge provider contract integrity check failed.");
    this.name = "QuestBingeContractIntegrityError";
  }
}

function qualified(database: string, table: string): string {
  return `\`${database}\`.\`${table}\``;
}

export function currentUtcDayStart(now: number): Date {
  if (!Number.isFinite(now)) throw new QuestBingeError("Current time is invalid.");
  const date = new Date(now);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function buildQuestBingeQuery(
  config: Pick<StatsDatabaseConfig, "charactersDatabase" | "authDatabase">,
  population: StatsPopulation,
  visibility: AccountVisibilityScope,
  completedBefore: Date
): QuestBingeQuery {
  if (!Number.isFinite(completedBefore.getTime()) || completedBefore.getUTCHours() !== 0 ||
      completedBefore.getUTCMinutes() !== 0 || completedBefore.getUTCSeconds() !== 0 ||
      completedBefore.getUTCMilliseconds() !== 0) {
    throw new QuestBingeError("Completed-day cutoff is invalid.");
  }
  const charactersDatabase = validateStatsDatabaseIdentifier(config.charactersDatabase, "STATS_CHARACTERS_DATABASE");
  const authDatabase = validateStatsDatabaseIdentifier(config.authDatabase, "STATS_AUTH_DATABASE");
  const events = qualified(charactersDatabase, "mod_player_stats_events");
  const characters = qualified(charactersDatabase, "characters");
  const accounts = qualified(authDatabase, "account");
  const populationClause = population === "players" ? "      AND e.actor_is_bot = 0\n" : "";
  const eventIndexHint = population === "all" ? " FORCE INDEX (idx_bot_event_time)" : "";
  const exclusion = buildAccountExclusionClause(visibility, "c.account", "      ");

  return {
    contractSql: `SELECT
    MIN(e.event_time) AS firstRecordedAt,
    COALESCE(MAX(
        e.event_time IS NULL
        OR e.realm_id IS NULL OR e.realm_id = 0
        OR e.actor_account_id IS NULL OR e.actor_account_id = 0
        OR e.actor_guid IS NULL OR e.actor_guid = 0
        OR e.actor_is_bot IS NULL OR e.actor_is_bot NOT IN (0, 1)
        OR e.target_type IS NULL OR e.target_type <> ?
        OR e.target_entry IS NULL OR e.target_entry <= 0
        OR e.target_guid IS NULL OR e.target_guid <> 0
        OR e.target_is_bot IS NULL OR e.target_is_bot <> 0
        OR e.value1 IS NULL OR e.value1 <> 0
        OR e.value2 IS NULL OR e.value2 <> 0
        OR e.source IS NULL OR e.source <> ?
    ), 0) AS hasInvalidEvent
FROM ${events} e
WHERE e.event_type = ?`,
    contractValues: [QUEST_TARGET_TYPE, "quest", "QUEST_COMPLETE"],
    sql: `WITH eligible_events AS (
    SELECT
        e.realm_id,
        e.actor_guid,
        e.actor_is_bot,
        e.target_entry,
        c.name AS characterName,
        c.race AS raceId,
        c.class AS classId,
        c.level,
        a.username AS accountLogin,
        DATE(CONVERT_TZ(e.event_time, '+00:00', '+00:00')) AS day
    FROM ${events} e${eventIndexHint}
    JOIN ${characters} c
      ON c.guid = e.actor_guid
     AND c.account = e.actor_account_id
    LEFT JOIN ${accounts} a ON a.id = c.account
    WHERE e.event_type = ?
      AND e.source = ?
      AND e.event_time IS NOT NULL AND e.event_time < ?
      AND e.realm_id > 0 AND e.actor_account_id > 0 AND e.actor_guid > 0
      AND e.actor_is_bot IN (0, 1)
      AND e.target_type = ? AND e.target_entry > 0
      AND e.target_guid = 0 AND e.target_is_bot = 0
      AND e.value1 = 0 AND e.value2 = 0
      AND c.deleteDate IS NULL
${populationClause}${exclusion.clause}),
daily_totals AS (
    SELECT
        realm_id, actor_guid, actor_is_bot,
        characterName, raceId, classId, level, accountLogin, day,
        COUNT(*) AS questsCompleted,
        COUNT(DISTINCT target_entry) AS uniqueQuests
    FROM eligible_events
    GROUP BY realm_id, actor_guid, actor_is_bot,
             characterName, raceId, classId, level, accountLogin, day
),
personal_records AS (
    SELECT daily_totals.*,
        ROW_NUMBER() OVER (
            PARTITION BY realm_id, actor_guid, actor_is_bot
            ORDER BY questsCompleted DESC, uniqueQuests DESC, day ASC
        ) AS personalRank
    FROM daily_totals
),
leaders AS (
    SELECT *
    FROM personal_records
    WHERE personalRank = 1
    ORDER BY questsCompleted DESC, uniqueQuests DESC, day ASC,
             characterName ASC, actor_guid ASC, actor_is_bot ASC
    LIMIT 25
)
SELECT
    characterName, raceId, classId, level, accountLogin,
    actor_is_bot AS isBot, day, questsCompleted, uniqueQuests
FROM leaders
ORDER BY questsCompleted DESC, uniqueQuests DESC, day ASC,
         characterName ASC, actor_guid ASC, actor_is_bot ASC`,
    values: ["QUEST_COMPLETE", "quest", completedBefore, QUEST_TARGET_TYPE, ...exclusion.values]
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown, key: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  const parsed = typeof value === "bigint" ? Number(value) :
    typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new QuestBingeError(`Database row field ${key} is invalid.`);
  }
  return parsed;
}

function text(value: unknown, key: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new QuestBingeError(`Database row field ${key} is invalid.`);
  }
  return value;
}

function timestamp(value: unknown, key: string): string {
  let parsed: Date;
  if (value instanceof Date) parsed = value;
  else if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z?$/u.exec(value);
    if (!match) throw new QuestBingeError(`Database row field ${key} is invalid.`);
    const normalized = `${match[1]}T${match[2]}.${(match[3] ?? "").padEnd(3, "0").slice(0, 3)}Z`;
    parsed = new Date(normalized);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== normalized) {
      throw new QuestBingeError(`Database row field ${key} is invalid.`);
    }
  } else throw new QuestBingeError(`Database row field ${key} is invalid.`);
  return parsed.toISOString();
}

function day(value: unknown): string {
  const normalized = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  if (typeof normalized !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(normalized) ||
      new Date(`${normalized}T00:00:00.000Z`).toISOString().slice(0, 10) !== normalized) {
    throw new QuestBingeError("Database row field day is invalid.");
  }
  return normalized;
}

function controlType(value: unknown): QuestBingeType {
  if (value === 0 || value === false) return "Player";
  if (value === 1 || value === true) return "Bot";
  throw new QuestBingeError("Database row field isBot is invalid.");
}

export function mapQuestBingeRows(
  contractRows: unknown,
  leaderboardRows: unknown
): { coverage: { firstRecordedAt: string | null }; entries: QuestBingeEntry[] } {
  if (!Array.isArray(contractRows) || contractRows.length !== 1 || !record(contractRows[0])) {
    throw new QuestBingeError("Quest Binge contract result is invalid.");
  }
  if (!Array.isArray(leaderboardRows) || leaderboardRows.length > MAX_ROWS) {
    throw new QuestBingeError("Quest Binge database result is invalid.");
  }
  const contract = contractRows[0];
  if (integer(contract.hasInvalidEvent, "hasInvalidEvent") !== 0) throw new QuestBingeContractIntegrityError();
  const firstRecordedAt = contract.firstRecordedAt === null ? null : timestamp(contract.firstRecordedAt, "firstRecordedAt");
  const entries = leaderboardRows.map((value) => {
    if (!record(value)) throw new QuestBingeError("Quest Binge row is invalid.");
    const questsCompleted = integer(value.questsCompleted, "questsCompleted", 1);
    const uniqueQuests = integer(value.uniqueQuests, "uniqueQuests", 1);
    if (uniqueQuests > questsCompleted) throw new QuestBingeError("Quest totals are inconsistent.");
    return {
      characterName: text(value.characterName, "characterName"),
      race: getRaceName(integer(value.raceId, "raceId", 0, 255)),
      class: getClassName(integer(value.classId, "classId", 0, 255)),
      level: integer(value.level, "level", 1, 255),
      accountLogin: value.accountLogin === null ? "Unknown account" : text(value.accountLogin, "accountLogin"),
      type: controlType(value.isBot), day: day(value.day), questsCompleted, uniqueQuests
    };
  });
  if (entries.length > 0 && firstRecordedAt === null) throw new QuestBingeError("Coverage metadata is inconsistent.");
  return { coverage: { firstRecordedAt }, entries };
}

export type QueryQuestBingeRows = (
  population: StatsPopulation,
  visibility: AccountVisibilityScope,
  completedBefore: Date
) => Promise<{ contractRows: unknown; leaderboardRows: unknown }>;

export async function queryQuestBingeRows(
  population: StatsPopulation,
  visibility: AccountVisibilityScope,
  completedBefore: Date
): Promise<{ contractRows: unknown; leaderboardRows: unknown }> {
  const { pool, config } = getStatsDatabase();
  const query = buildQuestBingeQuery(config, population, visibility, completedBefore);
  const [contract, leaderboard] = await Promise.all([
    pool.execute({ sql: query.contractSql, values: [...query.contractValues], timeout: QUERY_TIMEOUT_MS }),
    pool.execute({ sql: query.sql, values: [...query.values], timeout: QUERY_TIMEOUT_MS })
  ]);
  return { contractRows: contract[0], leaderboardRows: leaderboard[0] };
}

export class QuestBingeService {
  private readonly cache = new Map<string, { value: QuestBingeResponse; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<QuestBingeResponse>>();

  constructor(
    private readonly queryRows: QueryQuestBingeRows = queryQuestBingeRows,
    private readonly now: () => number = Date.now
  ) {}

  async getLeaderboard(population: StatsPopulation, visibility: AccountVisibilityScope): Promise<QuestBingeResponse> {
    const cacheKey = `${population}:${visibility.cacheKey}`;
    const now = this.now();
    const cached = this.cache.get(cacheKey);
    if (cached && now < cached.expiresAt) return cached.value;
    const active = this.inFlight.get(cacheKey);
    if (active) return active;
    const refresh = this.refresh(population, visibility, cacheKey, now);
    const tracked = refresh.finally(() => {
      if (this.inFlight.get(cacheKey) === tracked) this.inFlight.delete(cacheKey);
    });
    this.inFlight.set(cacheKey, tracked);
    return tracked;
  }

  private async refresh(population: StatsPopulation, visibility: AccountVisibilityScope, cacheKey: string, now: number) {
    const rows = await this.queryRows(population, visibility, currentUtcDayStart(now));
    const mapped = mapQuestBingeRows(rows.contractRows, rows.leaderboardRows);
    const response: QuestBingeResponse = {
      generatedAt: new Date(now).toISOString(), population,
      coverage: mapped.coverage, count: mapped.entries.length, entries: mapped.entries
    };
    this.cache.set(cacheKey, { value: response, expiresAt: now + CACHE_TTL_MS });
    return response;
  }
}

const service = new QuestBingeService();

export function getQuestBinge(population: StatsPopulation, visibility: AccountVisibilityScope) {
  return service.getLeaderboard(population, visibility);
}
