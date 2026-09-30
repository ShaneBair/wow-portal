import { getClassName, getRaceName } from "../domain/wotlk.js";
import {
  buildAccountExclusionClause,
  type AccountVisibilityScope
} from "./account-visibility.js";
import type { StatsPopulation } from "./death-leaderboard.js";
import {
  getStatsDatabase,
  readStatsWorldDatabaseConfig,
  type StatsDatabaseConfig,
  type StatsWorldDatabaseConfig,
  validateStatsDatabaseIdentifier
} from "./stats-database.js";

const CREATURE_KILL_EVENT = "CREATURE_KILL";
const CREATURE_KILL_PET_EVENT = "CREATURE_KILL_PET";
const DIRECT_SOURCE = "direct";
const PET_SOURCE = "pet";
const TARGET_TYPE_CREATURE = 2;
const MAX_ACTOR_LEVEL = 80;
const MAX_CREATURE_LEVEL = 255;
const CACHE_TTL_MS = 60_000;
const QUERY_TIMEOUT_MS = 8_000;
const MAX_ROWS = 25;

export type { StatsPopulation };
export type PunchingUpType = "Player" | "Bot";
export type PunchingUpKillMethod = "direct" | "pet";

export interface PunchingUpEntry {
  characterName: string;
  race: string;
  class: string;
  level: number;
  accountLogin: string;
  type: PunchingUpType;
  actorLevelAtKill: number;
  creatureEntry: number;
  creatureName: string;
  creatureLevel: number;
  levelDelta: number;
  killMethod: PunchingUpKillMethod;
  occurredAt: string;
}

export interface PunchingUpResponse {
  generatedAt: string;
  population: StatsPopulation;
  coverage: { firstRecordedAt: string | null };
  count: number;
  entries: PunchingUpEntry[];
}

export interface PunchingUpQuery {
  sql: string;
  values: readonly (string | number)[];
}

export interface MappedPunchingUpRows {
  coverage: { firstRecordedAt: string | null };
  entries: PunchingUpEntry[];
}

export class PunchingUpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PunchingUpError";
  }
}

export class PunchingUpContractIntegrityError extends PunchingUpError {
  constructor() {
    super("Creature kill provider contract integrity check failed.");
    this.name = "PunchingUpContractIntegrityError";
  }
}

function qualified(database: string, table: string): string {
  return `\`${database}\`.\`${table}\``;
}

type PunchingUpDatabaseConfig = Pick<StatsDatabaseConfig, "charactersDatabase" | "authDatabase"> &
  StatsWorldDatabaseConfig;

export function buildPunchingUpQuery(
  config: PunchingUpDatabaseConfig,
  population: StatsPopulation,
  visibility: AccountVisibilityScope
): PunchingUpQuery {
  const charactersDatabase = validateStatsDatabaseIdentifier(
    config.charactersDatabase,
    "STATS_CHARACTERS_DATABASE"
  );
  const authDatabase = validateStatsDatabaseIdentifier(
    config.authDatabase,
    "STATS_AUTH_DATABASE"
  );
  const worldDatabase = validateStatsDatabaseIdentifier(
    config.worldDatabase,
    "STATS_WORLD_DATABASE"
  );
  const eventsTable = qualified(charactersDatabase, "mod_player_stats_events");
  const charactersTable = qualified(charactersDatabase, "characters");
  const accountsTable = qualified(authDatabase, "account");
  const creaturesTable = qualified(worldDatabase, "creature_template");
  const populationClause = population === "players" ? "      AND e.actor_is_bot = 0\n" : "";
  const accountExclusion = buildAccountExclusionClause(visibility, "c.account", "      ");

  return {
    sql: `WITH kill_contract AS (
    SELECT
        MIN(e.event_time) AS firstRecordedAt,
        COALESCE(MAX(
            e.id IS NULL OR e.id = 0
            OR e.event_time IS NULL
            OR e.target_type IS NULL OR e.target_type <> ?
            OR e.target_entry IS NULL OR e.target_entry = 0
            OR e.target_guid IS NULL OR e.target_guid = 0
            OR e.target_is_bot IS NULL OR e.target_is_bot <> 0
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
eligible_kills AS (
    SELECT
        e.id AS eventId,
        e.realm_id,
        e.actor_guid,
        e.actor_is_bot,
        e.event_time AS occurredAt,
        e.actor_level AS actorLevelAtKill,
        e.target_entry AS creatureEntry,
        e.value1 AS creatureLevel,
        e.value1 - e.actor_level AS levelDelta,
        e.source AS killMethod,
        c.name AS characterName,
        c.race AS raceId,
        c.class AS classId,
        c.level,
        a.username AS accountLogin
    FROM ${eventsTable} e
    JOIN ${charactersTable} c
      ON c.guid = e.actor_guid
     AND c.account = e.actor_account_id
    LEFT JOIN ${accountsTable} a ON a.id = c.account
    WHERE e.event_type IN (?, ?)
      AND e.target_type = ?
      AND e.target_entry > 0
      AND e.target_guid > 0
      AND e.target_is_bot = 0
      AND e.value2 = 0
      AND (
          (e.event_type = ? AND e.source = ?)
          OR (e.event_type = ? AND e.source = ?)
      )
      AND e.actor_level BETWEEN 1 AND ?
      AND e.value1 BETWEEN 1 AND ?
      AND e.value1 > e.actor_level
      AND c.deleteDate IS NULL
${populationClause}${accountExclusion.clause}),
personal_records AS (
    SELECT
        ek.*,
        ROW_NUMBER() OVER (
            PARTITION BY ek.realm_id, ek.actor_guid, ek.actor_is_bot
            ORDER BY ek.levelDelta DESC, ek.creatureLevel DESC,
                     ek.occurredAt ASC, ek.eventId ASC
        ) AS personalRank
    FROM eligible_kills ek
),
leaderboard AS (
    SELECT *
    FROM personal_records
    WHERE personalRank = 1
    ORDER BY levelDelta DESC, creatureLevel DESC, occurredAt ASC,
             characterName ASC, actor_guid ASC, actor_is_bot ASC
    LIMIT 25
)
SELECT
    kc.firstRecordedAt,
    kc.hasInvalidEvent,
    l.characterName,
    l.raceId,
    l.classId,
    l.level,
    l.accountLogin,
    l.actor_is_bot AS isBot,
    l.actorLevelAtKill,
    l.creatureEntry,
    COALESCE(NULLIF(ct.name, ''), CONCAT('Unknown creature #', l.creatureEntry)) AS creatureName,
    l.creatureLevel,
    l.levelDelta,
    l.killMethod,
    l.occurredAt
FROM kill_contract kc
LEFT JOIN leaderboard l ON TRUE
LEFT JOIN ${creaturesTable} ct ON ct.entry = l.creatureEntry
ORDER BY l.levelDelta DESC, l.creatureLevel DESC, l.occurredAt ASC,
         l.characterName ASC, l.actor_guid ASC, l.actor_is_bot ASC`,
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
      TARGET_TYPE_CREATURE,
      CREATURE_KILL_EVENT,
      DIRECT_SOURCE,
      CREATURE_KILL_PET_EVENT,
      PET_SOURCE,
      MAX_ACTOR_LEVEL,
      MAX_CREATURE_LEVEL,
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
  ) throw new PunchingUpError(`Database row field ${key} is invalid.`);
  return parsed;
}

function requireString(value: unknown, key: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > 128 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) throw new PunchingUpError(`Database row field ${key} is invalid.`);
  return value;
}

function requireUtcTimestamp(value: unknown, key: string): string {
  let timestamp: Date;
  if (value instanceof Date) {
    timestamp = value;
  } else if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z?$/u.exec(value);
    if (!match) throw new PunchingUpError(`Database row field ${key} is invalid.`);
    const normalized = `${match[1]}T${match[2]}.${(match[3] ?? "").padEnd(3, "0").slice(0, 3)}Z`;
    timestamp = new Date(normalized);
    if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== normalized) {
      throw new PunchingUpError(`Database row field ${key} is invalid.`);
    }
  } else {
    throw new PunchingUpError(`Database row field ${key} is invalid.`);
  }
  if (!Number.isFinite(timestamp.getTime())) {
    throw new PunchingUpError(`Database row field ${key} is invalid.`);
  }
  return timestamp.toISOString();
}

function requireBotType(value: unknown): PunchingUpType {
  if (value === 0 || value === false) return "Player";
  if (value === 1 || value === true) return "Bot";
  throw new PunchingUpError("Database row field isBot is invalid.");
}

function requireKillMethod(value: unknown): PunchingUpKillMethod {
  if (value === DIRECT_SOURCE || value === PET_SOURCE) return value;
  throw new PunchingUpError("Database row field killMethod is invalid.");
}

function isEmptyRow(row: Record<string, unknown>): boolean {
  if (row.characterName !== null) return false;
  for (const key of [
    "raceId", "classId", "level", "accountLogin", "isBot", "actorLevelAtKill",
    "creatureEntry", "creatureName", "creatureLevel", "levelDelta", "killMethod", "occurredAt"
  ] as const) {
    if (row[key] !== null) throw new PunchingUpError("Empty Punching Up row is malformed.");
  }
  return true;
}

export function mapPunchingUpQueryRows(rows: unknown): MappedPunchingUpRows {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) {
    throw new PunchingUpError("Punching Up database result is invalid.");
  }
  const records = rows.map((row) => {
    if (!isRecord(row)) throw new PunchingUpError("Punching Up result contains an invalid row.");
    return row;
  });
  const first = records[0]!;
  if (requireSafeInteger(first.hasInvalidEvent, "hasInvalidEvent") !== 0) {
    throw new PunchingUpContractIntegrityError();
  }
  const firstRecordedAt = first.firstRecordedAt === null
    ? null
    : requireUtcTimestamp(first.firstRecordedAt, "firstRecordedAt");
  for (const row of records.slice(1)) {
    if (requireSafeInteger(row.hasInvalidEvent, "hasInvalidEvent") !== 0) {
      throw new PunchingUpContractIntegrityError();
    }
    const timestamp = row.firstRecordedAt === null
      ? null
      : requireUtcTimestamp(row.firstRecordedAt, "firstRecordedAt");
    if (timestamp !== firstRecordedAt) {
      throw new PunchingUpError("Punching Up coverage metadata is inconsistent.");
    }
  }
  if (isEmptyRow(first)) {
    if (records.length !== 1) throw new PunchingUpError("Empty Punching Up result is invalid.");
    return { coverage: { firstRecordedAt }, entries: [] };
  }
  if (firstRecordedAt === null) throw new PunchingUpError("Punching Up coverage metadata is inconsistent.");

  const entries = records.map((row) => {
    const actorLevelAtKill = requireSafeInteger(row.actorLevelAtKill, "actorLevelAtKill", 1, MAX_ACTOR_LEVEL);
    const creatureLevel = requireSafeInteger(row.creatureLevel, "creatureLevel", 1, MAX_CREATURE_LEVEL);
    const levelDelta = requireSafeInteger(row.levelDelta, "levelDelta", 1, MAX_CREATURE_LEVEL - 1);
    if (creatureLevel - actorLevelAtKill !== levelDelta) {
      throw new PunchingUpError("Punching Up level delta is inconsistent.");
    }
    const occurredAt = requireUtcTimestamp(row.occurredAt, "occurredAt");
    if (Date.parse(occurredAt) < Date.parse(firstRecordedAt)) {
      throw new PunchingUpError("Punching Up event timestamp is inconsistent.");
    }
    return {
      characterName: requireString(row.characterName, "characterName"),
      race: getRaceName(requireSafeInteger(row.raceId, "raceId", 0, 255)),
      class: getClassName(requireSafeInteger(row.classId, "classId", 0, 255)),
      level: requireSafeInteger(row.level, "level", 1, 255),
      accountLogin: row.accountLogin === null
        ? "Unknown account"
        : requireString(row.accountLogin, "accountLogin"),
      type: requireBotType(row.isBot),
      actorLevelAtKill,
      creatureEntry: requireSafeInteger(row.creatureEntry, "creatureEntry", 1, 0xffff_ffff),
      creatureName: requireString(row.creatureName, "creatureName"),
      creatureLevel,
      levelDelta,
      killMethod: requireKillMethod(row.killMethod),
      occurredAt
    };
  });
  return { coverage: { firstRecordedAt }, entries };
}

export type QueryPunchingUpRows = (
  population: StatsPopulation,
  visibility: AccountVisibilityScope
) => Promise<unknown>;

export async function queryPunchingUpRows(
  population: StatsPopulation,
  visibility: AccountVisibilityScope
): Promise<unknown> {
  const { pool, config } = getStatsDatabase();
  const query = buildPunchingUpQuery(
    { ...config, ...readStatsWorldDatabaseConfig() },
    population,
    visibility
  );
  const [rows] = await pool.execute({
    sql: query.sql,
    values: [...query.values],
    timeout: QUERY_TIMEOUT_MS
  });
  return rows;
}

export class PunchingUpService {
  private readonly cache = new Map<string, { value: PunchingUpResponse; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<PunchingUpResponse>>();

  constructor(
    private readonly queryRows: QueryPunchingUpRows = queryPunchingUpRows,
    private readonly now: () => number = Date.now
  ) {}

  async getLeaderboard(
    population: StatsPopulation,
    visibility: AccountVisibilityScope
  ): Promise<PunchingUpResponse> {
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
  ): Promise<PunchingUpResponse> {
    const mapped = mapPunchingUpQueryRows(await this.queryRows(population, visibility));
    const generatedAt = this.now();
    const response: PunchingUpResponse = {
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

const punchingUpService = new PunchingUpService();

export function getPunchingUp(
  population: StatsPopulation,
  visibility: AccountVisibilityScope
): Promise<PunchingUpResponse> {
  return punchingUpService.getLeaderboard(population, visibility);
}
