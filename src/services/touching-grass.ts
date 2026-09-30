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

const CACHE_TTL_MS = 60_000;
const QUERY_TIMEOUT_MS = 8_000;
const MAX_ROWS = 25;

const ACTIVITY_EVENTS = Object.freeze([
  "CREATURE_KILL",
  "CREATURE_KILL_PET",
  "PLAYER_DEATH",
  "PLAYER_KILLED_BY_CREATURE",
  "PVP_KILL",
  "LEVEL_CHANGE",
  "QUEST_COMPLETE",
  "ACHIEVEMENT"
] as const);

const EVENT_CONTRACTS = Object.freeze([
  ["CREATURE_KILL", "direct", 2, "creature"],
  ["CREATURE_KILL_PET", "pet", 2, "creature"],
  ["PLAYER_DEATH", "canonical", 0, "none"],
  ["PLAYER_KILLED_BY_CREATURE", "creature", 2, "creature"],
  ["PVP_KILL", "player", 1, "player"],
  ["LEVEL_CHANGE", "level", 0, "level"],
  ["QUEST_COMPLETE", "quest", 4, "entry"],
  ["ACHIEVEMENT", "achievement", 5, "entry"]
] as const);

export type { StatsPopulation };
export type TouchingGrassType = "Player" | "Bot";

export interface TouchingGrassEntry {
  characterName: string;
  race: string;
  class: string;
  level: number;
  accountLogin: string;
  type: TouchingGrassType;
  zonesVisited: number;
  mapsVisited: number;
  firstRecordedAt: string;
  lastRecordedAt: string;
}

export interface TouchingGrassResponse {
  generatedAt: string;
  population: StatsPopulation;
  coverage: { firstRecordedAt: string | null };
  count: number;
  entries: TouchingGrassEntry[];
}

export interface TouchingGrassQuery {
  sql: string;
  values: readonly (string | number)[];
}

export interface MappedTouchingGrassRows {
  coverage: { firstRecordedAt: string | null };
  entries: TouchingGrassEntry[];
}

export class TouchingGrassError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TouchingGrassError";
  }
}

export class TouchingGrassContractIntegrityError extends TouchingGrassError {
  constructor() {
    super("Activity event provider contract integrity check failed.");
    this.name = "TouchingGrassContractIntegrityError";
  }
}

function qualified(database: string, table: string): string {
  return `\`${database}\`.\`${table}\``;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function contractClause(kind: typeof EVENT_CONTRACTS[number][3]): string {
  if (kind === "creature") {
    return `e.target_entry > 0 AND e.target_guid > 0 AND e.target_is_bot = 0
                AND e.value1 > 0 AND e.value2 = 0`;
  }
  if (kind === "player") {
    return `e.target_entry = 0 AND e.target_guid > 0 AND e.target_is_bot IN (0, 1)
                AND e.value1 > 0 AND e.value2 > 0`;
  }
  if (kind === "level") {
    return `e.target_entry = 0 AND e.target_guid = 0 AND e.target_is_bot = 0
                AND e.value1 > 0 AND e.value2 > 0`;
  }
  if (kind === "entry") {
    return `e.target_entry > 0 AND e.target_guid = 0 AND e.target_is_bot = 0
                AND e.value1 = 0 AND e.value2 = 0`;
  }
  return `e.target_entry = 0 AND e.target_guid = 0 AND e.target_is_bot = 0
                AND e.value1 = 0 AND e.value2 = 0`;
}

function buildContractBranches(): { sql: string; values: readonly (string | number)[] } {
  const values: (string | number)[] = [];
  const branches = EVENT_CONTRACTS.map(([eventType, source, targetType, kind]) => {
    values.push(eventType, targetType, source);
    return `(e.event_type = ? AND e.target_type = ? AND e.source = ?
                AND ${contractClause(kind)})`;
  });
  return { sql: branches.join("\n            OR "), values };
}

export function buildTouchingGrassQuery(
  config: Pick<StatsDatabaseConfig, "charactersDatabase" | "authDatabase">,
  population: StatsPopulation,
  visibility: AccountVisibilityScope
): TouchingGrassQuery {
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
  const eventList = placeholders(ACTIVITY_EVENTS.length);
  const contracts = buildContractBranches();
  const populationClause = population === "players" ? "      AND e.actor_is_bot = 0\n" : "";
  const accountExclusion = buildAccountExclusionClause(visibility, "c.account", "      ");

  return {
    sql: `WITH activity_contract AS (
    SELECT
        MIN(e.event_time) AS firstRecordedAt,
        COALESCE(MAX(
            e.event_time IS NULL
            OR e.realm_id IS NULL OR e.realm_id = 0
            OR e.actor_account_id IS NULL OR e.actor_account_id = 0
            OR e.actor_guid IS NULL OR e.actor_guid = 0
            OR e.actor_is_bot IS NULL OR e.actor_is_bot NOT IN (0, 1)
            OR e.zone_id IS NULL OR e.map_id IS NULL
            OR e.target_type IS NULL OR e.target_entry IS NULL OR e.target_guid IS NULL
            OR e.target_is_bot IS NULL OR e.value1 IS NULL OR e.value2 IS NULL
            OR e.source IS NULL
            OR NOT (
                ${contracts.sql}
            )
        ), 0) AS hasInvalidEvent
    FROM ${eventsTable} e
    WHERE e.event_type IN (${eventList})
),
character_activity AS (
    SELECT
        e.realm_id,
        e.actor_guid,
        e.actor_is_bot,
        c.name AS characterName,
        c.race AS raceId,
        c.class AS classId,
        c.level,
        a.username AS accountLogin,
        COUNT(DISTINCT CASE WHEN e.zone_id > 0 THEN e.zone_id END) AS zonesVisited,
        COUNT(DISTINCT CASE WHEN e.map_id > 0 THEN e.map_id END) AS mapsVisited,
        MIN(e.event_time) AS characterFirstRecordedAt,
        MAX(e.event_time) AS characterLastRecordedAt
    FROM ${eventsTable} e
    JOIN ${charactersTable} c
      ON c.guid = e.actor_guid
     AND c.account = e.actor_account_id
    LEFT JOIN ${accountsTable} a ON a.id = c.account
    WHERE e.event_type IN (${eventList})
      AND c.deleteDate IS NULL
${populationClause}${accountExclusion.clause}    GROUP BY
        e.realm_id, e.actor_guid, e.actor_is_bot,
        c.name, c.race, c.class, c.level, a.username
    HAVING zonesVisited > 0
    ORDER BY zonesVisited DESC, mapsVisited DESC, characterLastRecordedAt ASC,
             c.name ASC, e.actor_guid ASC, e.actor_is_bot ASC
    LIMIT 25
)
SELECT
    ac.firstRecordedAt,
    ac.hasInvalidEvent,
    ca.characterName,
    ca.raceId,
    ca.classId,
    ca.level,
    ca.accountLogin,
    ca.actor_is_bot AS isBot,
    ca.zonesVisited,
    ca.mapsVisited,
    ca.characterFirstRecordedAt,
    ca.characterLastRecordedAt
FROM activity_contract ac
LEFT JOIN character_activity ca ON TRUE
ORDER BY ca.zonesVisited DESC, ca.mapsVisited DESC, ca.characterLastRecordedAt ASC,
         ca.characterName ASC, ca.actor_guid ASC, ca.actor_is_bot ASC`,
    values: [
      ...contracts.values,
      ...ACTIVITY_EVENTS,
      ...ACTIVITY_EVENTS,
      ...accountExclusion.values
    ]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireSafeInteger(value: unknown, key: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  const parsed = typeof value === "bigint"
    ? Number(value)
    : typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (
    typeof parsed !== "number" || !Number.isSafeInteger(parsed) ||
    parsed < minimum || parsed > maximum
  ) throw new TouchingGrassError(`Database row field ${key} is invalid.`);
  return parsed;
}

function requireString(value: unknown, key: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > 128 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) throw new TouchingGrassError(`Database row field ${key} is invalid.`);
  return value;
}

function requireUtcTimestamp(value: unknown, key: string): string {
  let timestamp: Date;
  if (value instanceof Date) {
    timestamp = value;
  } else if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z?$/u.exec(value);
    if (!match) throw new TouchingGrassError(`Database row field ${key} is invalid.`);
    const normalized = `${match[1]}T${match[2]}.${(match[3] ?? "").padEnd(3, "0").slice(0, 3)}Z`;
    timestamp = new Date(normalized);
    if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== normalized) {
      throw new TouchingGrassError(`Database row field ${key} is invalid.`);
    }
  } else {
    throw new TouchingGrassError(`Database row field ${key} is invalid.`);
  }
  if (!Number.isFinite(timestamp.getTime())) {
    throw new TouchingGrassError(`Database row field ${key} is invalid.`);
  }
  return timestamp.toISOString();
}

function requireBotType(value: unknown): TouchingGrassType {
  if (value === 0 || value === false) return "Player";
  if (value === 1 || value === true) return "Bot";
  throw new TouchingGrassError("Database row field isBot is invalid.");
}

function isEmptyRow(row: Record<string, unknown>): boolean {
  if (row.characterName !== null) return false;
  for (const key of [
    "raceId", "classId", "level", "accountLogin", "isBot", "zonesVisited", "mapsVisited",
    "characterFirstRecordedAt", "characterLastRecordedAt"
  ] as const) {
    if (row[key] !== null) throw new TouchingGrassError("Empty Touching Grass row is malformed.");
  }
  return true;
}

export function mapTouchingGrassQueryRows(rows: unknown): MappedTouchingGrassRows {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) {
    throw new TouchingGrassError("Touching Grass database result is invalid.");
  }
  const records = rows.map((row) => {
    if (!isRecord(row)) throw new TouchingGrassError("Touching Grass contains an invalid row.");
    return row;
  });
  const first = records[0]!;
  if (requireSafeInteger(first.hasInvalidEvent, "hasInvalidEvent") !== 0) {
    throw new TouchingGrassContractIntegrityError();
  }
  const coverageTimestamp = first.firstRecordedAt === null
    ? null
    : requireUtcTimestamp(first.firstRecordedAt, "firstRecordedAt");
  for (const row of records.slice(1)) {
    if (requireSafeInteger(row.hasInvalidEvent, "hasInvalidEvent") !== 0) {
      throw new TouchingGrassContractIntegrityError();
    }
    const timestamp = row.firstRecordedAt === null
      ? null
      : requireUtcTimestamp(row.firstRecordedAt, "firstRecordedAt");
    if (timestamp !== coverageTimestamp) {
      throw new TouchingGrassError("Touching Grass coverage metadata is inconsistent.");
    }
  }
  if (isEmptyRow(first)) {
    if (records.length !== 1) throw new TouchingGrassError("Empty Touching Grass result is invalid.");
    return { coverage: { firstRecordedAt: coverageTimestamp }, entries: [] };
  }
  if (coverageTimestamp === null) {
    throw new TouchingGrassError("Touching Grass coverage metadata is inconsistent.");
  }

  const entries = records.map((row) => {
    const firstRecordedAt = requireUtcTimestamp(row.characterFirstRecordedAt, "characterFirstRecordedAt");
    const lastRecordedAt = requireUtcTimestamp(row.characterLastRecordedAt, "characterLastRecordedAt");
    if (Date.parse(firstRecordedAt) > Date.parse(lastRecordedAt)) {
      throw new TouchingGrassError("Touching Grass activity span is invalid.");
    }
    const accountLogin = row.accountLogin === null
      ? "Unknown account"
      : requireString(row.accountLogin, "accountLogin");
    return {
      characterName: requireString(row.characterName, "characterName"),
      race: getRaceName(requireSafeInteger(row.raceId, "raceId", 0, 255)),
      class: getClassName(requireSafeInteger(row.classId, "classId", 0, 255)),
      level: requireSafeInteger(row.level, "level", 1, 255),
      accountLogin,
      type: requireBotType(row.isBot),
      zonesVisited: requireSafeInteger(row.zonesVisited, "zonesVisited", 1, 0xffff_ffff),
      mapsVisited: requireSafeInteger(row.mapsVisited, "mapsVisited", 0, 0xffff_ffff),
      firstRecordedAt,
      lastRecordedAt
    };
  });
  return { coverage: { firstRecordedAt: coverageTimestamp }, entries };
}

export type QueryTouchingGrassRows = (
  population: StatsPopulation,
  visibility: AccountVisibilityScope
) => Promise<unknown>;

export async function queryTouchingGrassRows(
  population: StatsPopulation,
  visibility: AccountVisibilityScope
): Promise<unknown> {
  const { pool, config } = getStatsDatabase();
  const query = buildTouchingGrassQuery(config, population, visibility);
  const [rows] = await pool.execute({
    sql: query.sql,
    values: [...query.values],
    timeout: QUERY_TIMEOUT_MS
  });
  return rows;
}

export class TouchingGrassService {
  private readonly cache = new Map<string, { value: TouchingGrassResponse; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<TouchingGrassResponse>>();

  constructor(
    private readonly queryRows: QueryTouchingGrassRows = queryTouchingGrassRows,
    private readonly now: () => number = Date.now
  ) {}

  async getLeaderboard(
    population: StatsPopulation,
    visibility: AccountVisibilityScope
  ): Promise<TouchingGrassResponse> {
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
  ): Promise<TouchingGrassResponse> {
    const mapped = mapTouchingGrassQueryRows(await this.queryRows(population, visibility));
    const generatedAt = this.now();
    const response: TouchingGrassResponse = {
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

const touchingGrassService = new TouchingGrassService();

export function getTouchingGrass(
  population: StatsPopulation,
  visibility: AccountVisibilityScope
): Promise<TouchingGrassResponse> {
  return touchingGrassService.getLeaderboard(population, visibility);
}
