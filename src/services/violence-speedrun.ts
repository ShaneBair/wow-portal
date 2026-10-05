import { getClassName, getRaceName } from "../domain/wotlk.js";
import { buildAccountExclusionClause, type AccountVisibilityScope } from "./account-visibility.js";
import type { StatsPopulation } from "./death-leaderboard.js";
import {
  getStatsDatabase,
  type StatsDatabaseConfig,
  validateStatsDatabaseIdentifier
} from "./stats-database.js";

const CACHE_TTL_MS = 60_000;
const QUERY_TIMEOUT_MS = 8_000;
const MAX_ROWS = 25;
const TARGET_TYPE_CREATURE = 2;

export type { StatsPopulation };
export type ViolenceSpeedrunType = "Player" | "Bot";

export interface ViolenceSpeedrunEntry {
  characterName: string;
  race: string;
  class: string;
  level: number;
  accountLogin: string;
  type: ViolenceSpeedrunType;
  bucketStart: string;
  bucketEnd: string;
  kills: number;
  directKills: number;
  petKills: number;
}

export interface ViolenceSpeedrunResponse {
  generatedAt: string;
  population: StatsPopulation;
  coverage: { firstRecordedAt: string | null };
  count: number;
  entries: ViolenceSpeedrunEntry[];
}

export interface ViolenceSpeedrunQuery {
  contractSql: string;
  contractValues: readonly (string | number)[];
  sql: string;
  values: readonly (string | number | Date)[];
}

export interface MappedViolenceSpeedrunRows {
  coverage: { firstRecordedAt: string | null };
  entries: ViolenceSpeedrunEntry[];
}

export class ViolenceSpeedrunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ViolenceSpeedrunError";
  }
}

export class ViolenceSpeedrunContractIntegrityError extends ViolenceSpeedrunError {
  constructor() {
    super("Violence Speedrun provider contract integrity check failed.");
    this.name = "ViolenceSpeedrunContractIntegrityError";
  }
}

function qualified(database: string, table: string): string {
  return `\`${database}\`.\`${table}\``;
}

export function completedUtcHour(now: number): Date {
  if (!Number.isFinite(now)) throw new ViolenceSpeedrunError("Current time is invalid.");
  const value = new Date(now);
  value.setUTCMinutes(0, 0, 0);
  return value;
}

export function buildViolenceSpeedrunQuery(
  config: Pick<StatsDatabaseConfig, "charactersDatabase" | "authDatabase">,
  population: StatsPopulation,
  visibility: AccountVisibilityScope,
  completedBefore: Date
): ViolenceSpeedrunQuery {
  if (!Number.isFinite(completedBefore.getTime()) ||
      completedBefore.getUTCMinutes() !== 0 || completedBefore.getUTCSeconds() !== 0 ||
      completedBefore.getUTCMilliseconds() !== 0) {
    throw new ViolenceSpeedrunError("Completed-hour cutoff is invalid.");
  }
  const charactersDatabase = validateStatsDatabaseIdentifier(config.charactersDatabase, "STATS_CHARACTERS_DATABASE");
  const authDatabase = validateStatsDatabaseIdentifier(config.authDatabase, "STATS_AUTH_DATABASE");
  const eventsTable = qualified(charactersDatabase, "mod_player_stats_events");
  const charactersTable = qualified(charactersDatabase, "characters");
  const accountsTable = qualified(authDatabase, "account");
  const populationClause = population === "players" ? "      AND e.actor_is_bot = 0\n" : "";
  const eventIndexHint = population === "all" ? " FORCE INDEX (idx_event_type_time)" : "";
  const exclusion = buildAccountExclusionClause(visibility, "c.account", "      ");

  return {
    contractSql: `SELECT
        MIN(e.event_time) AS firstRecordedAt,
        COALESCE(MAX(
            e.event_time IS NULL
            OR e.target_type IS NULL OR e.target_type <> ?
            OR e.target_entry IS NULL OR e.target_entry <= 0
            OR e.value1 IS NULL OR e.value1 <= 0
            OR e.value2 IS NULL OR e.value2 <> 0
            OR e.realm_id IS NULL OR e.realm_id = 0
            OR e.actor_account_id IS NULL OR e.actor_account_id = 0
            OR e.actor_guid IS NULL OR e.actor_guid = 0
            OR e.actor_is_bot IS NULL OR e.actor_is_bot NOT IN (0, 1)
            OR e.source IS NULL
            OR NOT ((e.event_type = ? AND e.source = ?) OR (e.event_type = ? AND e.source = ?))
        ), 0) AS hasInvalidEvent
FROM ${eventsTable} e
WHERE e.event_type IN (?, ?)`,
    contractValues: [
      TARGET_TYPE_CREATURE,
      "CREATURE_KILL", "direct", "CREATURE_KILL_PET", "pet",
      "CREATURE_KILL", "CREATURE_KILL_PET"
    ],
    sql: `WITH eligible_events AS (
    SELECT
        e.realm_id, e.actor_guid, e.actor_is_bot,
        c.name AS characterName, c.race AS raceId, c.class AS classId, c.level,
        a.username AS accountLogin,
        DATE_FORMAT(CONVERT_TZ(e.event_time, '+00:00', '+00:00'), '%Y-%m-%d %H:00:00') AS bucketStart,
        e.event_type
    FROM ${eventsTable} e${eventIndexHint}
    JOIN ${charactersTable} c
      ON c.guid = e.actor_guid
     AND c.account = e.actor_account_id
    LEFT JOIN ${accountsTable} a ON a.id = c.account
    WHERE e.event_type IN (?, ?)
      AND ((e.event_type = ? AND e.source = ?) OR (e.event_type = ? AND e.source = ?))
      AND e.event_time IS NOT NULL AND e.event_time < ?
      AND e.target_type = ? AND e.target_entry > 0
      AND e.value1 > 0 AND e.value2 = 0
      AND e.realm_id > 0 AND e.actor_account_id > 0 AND e.actor_guid > 0
      AND e.actor_is_bot IN (0, 1)
      AND c.deleteDate IS NULL
${populationClause}${exclusion.clause}),
hourly AS (
    SELECT
        realm_id, actor_guid, actor_is_bot,
        characterName, raceId, classId, level, accountLogin, bucketStart,
        COUNT(*) AS kills,
        SUM(event_type = ?) AS directKills,
        SUM(event_type = ?) AS petKills
    FROM eligible_events
    GROUP BY realm_id, actor_guid, actor_is_bot,
             characterName, raceId, classId, level, accountLogin, bucketStart
),
personal_records AS (
    SELECT hourly.*,
        ROW_NUMBER() OVER (
            PARTITION BY realm_id, actor_guid, actor_is_bot
            ORDER BY kills DESC, bucketStart ASC
        ) AS personalRank
    FROM hourly
),
leaders AS (
    SELECT * FROM personal_records
    WHERE personalRank = 1
    ORDER BY kills DESC, bucketStart ASC, characterName ASC, actor_guid ASC, actor_is_bot ASC
    LIMIT 25
)
SELECT
    l.characterName, l.raceId, l.classId, l.level, l.accountLogin,
    l.actor_is_bot AS isBot, l.bucketStart,
    TIMESTAMPADD(HOUR, 1, l.bucketStart) AS bucketEnd,
    l.kills, l.directKills, l.petKills
FROM leaders l
ORDER BY l.kills DESC, l.bucketStart ASC, l.characterName ASC, l.actor_guid ASC, l.actor_is_bot ASC`,
    values: [
      "CREATURE_KILL", "CREATURE_KILL_PET",
      "CREATURE_KILL", "direct", "CREATURE_KILL_PET", "pet",
      completedBefore, TARGET_TYPE_CREATURE,
      ...exclusion.values,
      "CREATURE_KILL", "CREATURE_KILL_PET"
    ]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown, key: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  const parsed = typeof value === "bigint" ? Number(value) :
    typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ViolenceSpeedrunError(`Database row field ${key} is invalid.`);
  }
  return parsed;
}

function text(value: unknown, key: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ViolenceSpeedrunError(`Database row field ${key} is invalid.`);
  }
  return value;
}

function timestamp(value: unknown, key: string): string {
  let parsed: Date;
  if (value instanceof Date) parsed = value;
  else if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z?$/u.exec(value);
    if (!match) throw new ViolenceSpeedrunError(`Database row field ${key} is invalid.`);
    parsed = new Date(`${match[1]}T${match[2]}.${(match[3] ?? "").padEnd(3, "0").slice(0, 3)}Z`);
  } else throw new ViolenceSpeedrunError(`Database row field ${key} is invalid.`);
  if (!Number.isFinite(parsed.getTime())) throw new ViolenceSpeedrunError(`Database row field ${key} is invalid.`);
  return parsed.toISOString();
}

function type(value: unknown): ViolenceSpeedrunType {
  if (value === 0 || value === false) return "Player";
  if (value === 1 || value === true) return "Bot";
  throw new ViolenceSpeedrunError("Database row field isBot is invalid.");
}

export function mapViolenceSpeedrunRows(
  contractRows: unknown,
  leaderboardRows: unknown
): MappedViolenceSpeedrunRows {
  if (!Array.isArray(contractRows) || contractRows.length !== 1 || !isRecord(contractRows[0])) {
    throw new ViolenceSpeedrunError("Violence Speedrun contract result is invalid.");
  }
  if (!Array.isArray(leaderboardRows) || leaderboardRows.length > MAX_ROWS) {
    throw new ViolenceSpeedrunError("Violence Speedrun database result is invalid.");
  }
  const contract = contractRows[0];
  if (integer(contract.hasInvalidEvent, "hasInvalidEvent") !== 0) {
    throw new ViolenceSpeedrunContractIntegrityError();
  }
  const coverage = contract.firstRecordedAt === null ? null : timestamp(contract.firstRecordedAt, "firstRecordedAt");
  const records = leaderboardRows.map((row) => {
    if (!isRecord(row)) throw new ViolenceSpeedrunError("Violence Speedrun result contains an invalid row.");
    return row;
  });
  if (records.length === 0) {
    return { coverage: { firstRecordedAt: coverage }, entries: [] };
  }
  if (coverage === null) throw new ViolenceSpeedrunError("Coverage metadata is inconsistent.");
  const entries = records.map((row) => {
    const kills = integer(row.kills, "kills", 1);
    const directKills = integer(row.directKills, "directKills");
    const petKills = integer(row.petKills, "petKills");
    if (!Number.isSafeInteger(directKills + petKills) || directKills + petKills !== kills) {
      throw new ViolenceSpeedrunError("Kill totals are inconsistent.");
    }
    const bucketStart = timestamp(row.bucketStart, "bucketStart");
    const bucketEnd = timestamp(row.bucketEnd, "bucketEnd");
    if (new Date(bucketStart).getUTCMinutes() !== 0 || new Date(bucketStart).getUTCSeconds() !== 0 ||
        new Date(bucketEnd).getTime() - new Date(bucketStart).getTime() !== 3_600_000) {
      throw new ViolenceSpeedrunError("UTC hour bucket is invalid.");
    }
    return {
      characterName: text(row.characterName, "characterName"),
      race: getRaceName(integer(row.raceId, "raceId", 0, 255)),
      class: getClassName(integer(row.classId, "classId", 0, 255)),
      level: integer(row.level, "level", 1, 255),
      accountLogin: row.accountLogin === null ? "Unknown account" : text(row.accountLogin, "accountLogin"),
      type: type(row.isBot), bucketStart, bucketEnd, kills, directKills, petKills
    };
  });
  return { coverage: { firstRecordedAt: coverage }, entries };
}

export type QueryViolenceSpeedrunRows = (
  population: StatsPopulation,
  visibility: AccountVisibilityScope,
  completedBefore: Date
) => Promise<{ contractRows: unknown; leaderboardRows: unknown }>;

export async function queryViolenceSpeedrunRows(
  population: StatsPopulation,
  visibility: AccountVisibilityScope,
  completedBefore: Date
): Promise<{ contractRows: unknown; leaderboardRows: unknown }> {
  const { pool, config } = getStatsDatabase();
  const query = buildViolenceSpeedrunQuery(config, population, visibility, completedBefore);
  const [contractResult, leaderboardResult] = await Promise.all([
    pool.execute({
      sql: query.contractSql,
      values: [...query.contractValues],
      timeout: QUERY_TIMEOUT_MS
    }),
    pool.execute({ sql: query.sql, values: [...query.values], timeout: QUERY_TIMEOUT_MS })
  ]);
  return { contractRows: contractResult[0], leaderboardRows: leaderboardResult[0] };
}

export class ViolenceSpeedrunService {
  private readonly cache = new Map<string, { value: ViolenceSpeedrunResponse; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<ViolenceSpeedrunResponse>>();

  constructor(
    private readonly queryRows: QueryViolenceSpeedrunRows = queryViolenceSpeedrunRows,
    private readonly now: () => number = Date.now
  ) {}

  async getLeaderboard(population: StatsPopulation, visibility: AccountVisibilityScope): Promise<ViolenceSpeedrunResponse> {
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

  private async refresh(
    population: StatsPopulation,
    visibility: AccountVisibilityScope,
    cacheKey: string,
    generatedAt: number
  ): Promise<ViolenceSpeedrunResponse> {
    const rows = await this.queryRows(population, visibility, completedUtcHour(generatedAt));
    const mapped = mapViolenceSpeedrunRows(rows.contractRows, rows.leaderboardRows);
    const response: ViolenceSpeedrunResponse = {
      generatedAt: new Date(generatedAt).toISOString(), population,
      coverage: mapped.coverage, count: mapped.entries.length, entries: mapped.entries
    };
    this.cache.set(cacheKey, { value: response, expiresAt: generatedAt + CACHE_TTL_MS });
    return response;
  }
}

const service = new ViolenceSpeedrunService();

export function getViolenceSpeedrun(population: StatsPopulation, visibility: AccountVisibilityScope) {
  return service.getLeaderboard(population, visibility);
}
