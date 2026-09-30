import { getClassName, getRaceName } from "../domain/wotlk.js";
import {
  buildAccountExclusionClause,
  type AccountVisibilityScope
} from "./account-visibility.js";
import type { StatsPopulation } from "./death-leaderboard.js";
import {
  getStatsDatabase,
  type StatsDatabaseConfig,
  validateStatsDatabaseIdentifier
} from "./stats-database.js";

const CREATURE_KILL_EVENT = "CREATURE_KILL";
const CREATURE_KILL_PET_EVENT = "CREATURE_KILL_PET";
const DIRECT_SOURCE = "direct";
const PET_SOURCE = "pet";
const TARGET_TYPE_CREATURE = 2;
const CACHE_TTL_MS = 60_000;
const QUERY_TIMEOUT_MS = 8_000;
const MAX_ROWS = 25;

export type { StatsPopulation };
export type GottaKillEmAllType = "Player" | "Bot";

export interface GottaKillEmAllEntry {
  characterName: string;
  race: string;
  class: string;
  level: number;
  accountName: string;
  type: GottaKillEmAllType;
  uniqueCreatures: number;
  totalKills: number;
}

export interface GottaKillEmAllResponse {
  generatedAt: string;
  population: StatsPopulation;
  coverage: { firstRecordedAt: string | null };
  count: number;
  entries: GottaKillEmAllEntry[];
}

export interface GottaKillEmAllQuery {
  sql: string;
  values: readonly (string | number)[];
}

export interface MappedGottaKillEmAllRows {
  coverage: { firstRecordedAt: string | null };
  entries: GottaKillEmAllEntry[];
}

export class GottaKillEmAllError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GottaKillEmAllError";
  }
}

export class GottaKillEmAllContractIntegrityError extends GottaKillEmAllError {
  constructor() {
    super("Creature kill provider contract integrity check failed.");
    this.name = "GottaKillEmAllContractIntegrityError";
  }
}

function qualified(database: string, table: string): string {
  return `\`${database}\`.\`${table}\``;
}

export function buildGottaKillEmAllQuery(
  config: Pick<StatsDatabaseConfig, "charactersDatabase" | "authDatabase">,
  population: StatsPopulation,
  visibility: AccountVisibilityScope
): GottaKillEmAllQuery {
  const charactersDatabase = validateStatsDatabaseIdentifier(
    config.charactersDatabase,
    "STATS_CHARACTERS_DATABASE"
  );
  const authDatabase = validateStatsDatabaseIdentifier(
    config.authDatabase,
    "STATS_AUTH_DATABASE"
  );
  const eventsTable = qualified(charactersDatabase, "mod_player_stats_events");
  const charactersTable = qualified(charactersDatabase, "characters");
  const accountsTable = qualified(authDatabase, "account");
  const populationClause = population === "players" ? "      AND e.actor_is_bot = 0\n" : "";
  const accountExclusion = buildAccountExclusionClause(visibility, "c.account", "      ");

  return {
    sql: `WITH kill_contract AS (
    SELECT
        MIN(e.event_time) AS firstRecordedAt,
        COALESCE(MAX(
            e.event_time IS NULL
            OR e.target_type IS NULL OR e.target_type <> ?
            OR e.target_entry IS NULL OR e.target_entry = 0
            OR e.target_guid IS NULL OR e.target_guid = 0
            OR e.target_is_bot IS NULL OR e.target_is_bot <> 0
            OR e.value1 IS NULL OR e.value1 <= 0
            OR e.value2 IS NULL OR e.value2 <> 0
            OR e.realm_id IS NULL OR e.realm_id = 0
            OR e.actor_account_id IS NULL OR e.actor_account_id = 0
            OR e.actor_guid IS NULL OR e.actor_guid = 0
            OR e.actor_is_bot IS NULL OR e.actor_is_bot NOT IN (0, 1)
            OR e.source IS NULL
            OR NOT (
                (e.event_type = ? AND e.source = ?)
                OR (e.event_type = ? AND e.source = ?)
            )
        ), 0) AS hasInvalidEvent
    FROM ${eventsTable} e
    WHERE e.event_type IN (?, ?)
),
character_kills AS (
    SELECT
        e.realm_id,
        e.actor_guid,
        e.actor_is_bot,
        c.name AS characterName,
        c.race AS raceId,
        c.class AS classId,
        c.level,
        UPPER(a.username) AS accountName,
        COUNT(DISTINCT e.target_entry) AS uniqueCreatures,
        COUNT(*) AS totalKills
    FROM ${eventsTable} e
    JOIN ${charactersTable} c
      ON c.guid = e.actor_guid
     AND c.account = e.actor_account_id
    JOIN ${accountsTable} a ON a.id = c.account
    WHERE e.event_type IN (?, ?)
      AND c.deleteDate IS NULL
${populationClause}${accountExclusion.clause}    GROUP BY
        e.realm_id, e.actor_guid, e.actor_is_bot,
        c.name, c.race, c.class, c.level, a.username
    ORDER BY uniqueCreatures DESC, totalKills DESC, c.name ASC, e.actor_guid ASC, e.actor_is_bot ASC
    LIMIT 25
)
SELECT
    kc.firstRecordedAt,
    kc.hasInvalidEvent,
    ck.characterName,
    ck.raceId,
    ck.classId,
    ck.level,
    ck.accountName,
    ck.actor_is_bot AS isBot,
    ck.uniqueCreatures,
    ck.totalKills
FROM kill_contract kc
LEFT JOIN character_kills ck ON TRUE
ORDER BY ck.uniqueCreatures DESC, ck.totalKills DESC,
         ck.characterName ASC, ck.actor_guid ASC, ck.actor_is_bot ASC`,
    values: [
      TARGET_TYPE_CREATURE,
      CREATURE_KILL_EVENT,
      DIRECT_SOURCE,
      CREATURE_KILL_PET_EVENT,
      PET_SOURCE,
      CREATURE_KILL_EVENT,
      CREATURE_KILL_PET_EVENT,
      CREATURE_KILL_EVENT,
      CREATURE_KILL_PET_EVENT,
      ...accountExclusion.values
    ]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireSafeInteger(
  value: unknown,
  key: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  const parsed = typeof value === "bigint"
    ? Number(value)
    : typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (
    typeof parsed !== "number" || !Number.isSafeInteger(parsed) ||
    parsed < minimum || parsed > maximum
  ) throw new GottaKillEmAllError(`Database row field ${key} is invalid.`);
  return parsed;
}

function requireString(value: unknown, key: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > 128 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) throw new GottaKillEmAllError(`Database row field ${key} is invalid.`);
  return value;
}

function requireUtcTimestamp(value: unknown): string {
  let timestamp: Date;
  if (value instanceof Date) {
    timestamp = value;
  } else if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z?$/u.exec(value);
    if (!match) throw new GottaKillEmAllError("Database row field firstRecordedAt is invalid.");
    const normalized = `${match[1]}T${match[2]}.${(match[3] ?? "").padEnd(3, "0").slice(0, 3)}Z`;
    timestamp = new Date(normalized);
    if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== normalized) {
      throw new GottaKillEmAllError("Database row field firstRecordedAt is invalid.");
    }
  } else {
    throw new GottaKillEmAllError("Database row field firstRecordedAt is invalid.");
  }
  if (!Number.isFinite(timestamp.getTime())) {
    throw new GottaKillEmAllError("Database row field firstRecordedAt is invalid.");
  }
  return timestamp.toISOString();
}

function requireBotType(value: unknown): GottaKillEmAllType {
  if (value === 0 || value === false) return "Player";
  if (value === 1 || value === true) return "Bot";
  throw new GottaKillEmAllError("Database row field isBot is invalid.");
}

function isEmptyRow(row: Record<string, unknown>): boolean {
  if (row.characterName !== null) return false;
  for (const key of [
    "raceId", "classId", "level", "accountName", "isBot", "uniqueCreatures", "totalKills"
  ] as const) {
    if (row[key] !== null) throw new GottaKillEmAllError("Empty Gotta Kill 'Em All row is malformed.");
  }
  return true;
}

export function mapGottaKillEmAllQueryRows(rows: unknown): MappedGottaKillEmAllRows {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) {
    throw new GottaKillEmAllError("Gotta Kill 'Em All database result is invalid.");
  }
  const records = rows.map((row) => {
    if (!isRecord(row)) throw new GottaKillEmAllError("Gotta Kill 'Em All contains an invalid row.");
    return row;
  });
  const first = records[0]!;
  if (requireSafeInteger(first.hasInvalidEvent, "hasInvalidEvent") !== 0) {
    throw new GottaKillEmAllContractIntegrityError();
  }
  const firstRecordedAt = first.firstRecordedAt === null
    ? null
    : requireUtcTimestamp(first.firstRecordedAt);
  for (const row of records.slice(1)) {
    if (requireSafeInteger(row.hasInvalidEvent, "hasInvalidEvent") !== 0) {
      throw new GottaKillEmAllContractIntegrityError();
    }
    const timestamp = row.firstRecordedAt === null ? null : requireUtcTimestamp(row.firstRecordedAt);
    if (timestamp !== firstRecordedAt) {
      throw new GottaKillEmAllError("Gotta Kill 'Em All coverage metadata is inconsistent.");
    }
  }
  if (isEmptyRow(first)) {
    if (records.length !== 1) throw new GottaKillEmAllError("Empty Gotta Kill 'Em All result is invalid.");
    return { coverage: { firstRecordedAt }, entries: [] };
  }
  if (firstRecordedAt === null) {
    throw new GottaKillEmAllError("Gotta Kill 'Em All coverage metadata is inconsistent.");
  }

  const entries = records.map((row) => {
    const uniqueCreatures = requireSafeInteger(row.uniqueCreatures, "uniqueCreatures", 1);
    const totalKills = requireSafeInteger(row.totalKills, "totalKills", 1);
    if (uniqueCreatures > totalKills) {
      throw new GottaKillEmAllError("Gotta Kill 'Em All totals are inconsistent.");
    }
    return {
      characterName: requireString(row.characterName, "characterName"),
      race: getRaceName(requireSafeInteger(row.raceId, "raceId", 0, 255)),
      class: getClassName(requireSafeInteger(row.classId, "classId", 0, 255)),
      level: requireSafeInteger(row.level, "level", 1, 255),
      accountName: requireString(row.accountName, "accountName").toUpperCase(),
      type: requireBotType(row.isBot),
      uniqueCreatures,
      totalKills
    };
  });
  return { coverage: { firstRecordedAt }, entries };
}

export type QueryGottaKillEmAllRows = (
  population: StatsPopulation,
  visibility: AccountVisibilityScope
) => Promise<unknown>;

export async function queryGottaKillEmAllRows(
  population: StatsPopulation,
  visibility: AccountVisibilityScope
): Promise<unknown> {
  const { pool, config } = getStatsDatabase();
  const query = buildGottaKillEmAllQuery(config, population, visibility);
  const [rows] = await pool.execute({
    sql: query.sql,
    values: [...query.values],
    timeout: QUERY_TIMEOUT_MS
  });
  return rows;
}

export class GottaKillEmAllService {
  private readonly cache = new Map<string, { value: GottaKillEmAllResponse; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<GottaKillEmAllResponse>>();

  constructor(
    private readonly queryRows: QueryGottaKillEmAllRows = queryGottaKillEmAllRows,
    private readonly now: () => number = Date.now
  ) {}

  async getLeaderboard(
    population: StatsPopulation,
    visibility: AccountVisibilityScope
  ): Promise<GottaKillEmAllResponse> {
    const cacheKey = `${population}:${visibility.cacheKey}`;
    const now = this.now();
    const cached = this.cache.get(cacheKey);
    if (cached && now < cached.expiresAt) return cached.value;
    const active = this.inFlight.get(cacheKey);
    if (active) return active;
    const refresh = this.refresh(population, visibility, cacheKey);
    const tracked = refresh.finally(() => {
      if (this.inFlight.get(cacheKey) === tracked) this.inFlight.delete(cacheKey);
    });
    this.inFlight.set(cacheKey, tracked);
    return tracked;
  }

  private async refresh(
    population: StatsPopulation,
    visibility: AccountVisibilityScope,
    cacheKey: string
  ): Promise<GottaKillEmAllResponse> {
    const mapped = mapGottaKillEmAllQueryRows(await this.queryRows(population, visibility));
    const generatedAt = this.now();
    const response: GottaKillEmAllResponse = {
      generatedAt: new Date(generatedAt).toISOString(),
      population,
      coverage: mapped.coverage,
      count: mapped.entries.length,
      entries: mapped.entries
    };
    this.cache.set(cacheKey, { value: response, expiresAt: generatedAt + CACHE_TTL_MS });
    return response;
  }
}

const gottaKillEmAllService = new GottaKillEmAllService();

export function getGottaKillEmAll(
  population: StatsPopulation,
  visibility: AccountVisibilityScope
): Promise<GottaKillEmAllResponse> {
  return gottaKillEmAllService.getLeaderboard(population, visibility);
}
