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

const CREATURE_DEATH_EVENT = "PLAYER_KILLED_BY_CREATURE";
const TARGET_TYPE_CREATURE = 2;
const CREATURE_SOURCE = "creature";
const CACHE_TTL_MS = 60_000;
const QUERY_TIMEOUT_MS = 8_000;
const MAX_ROWS = 25;

export type { StatsPopulation };

export interface RealRaidBossEntry {
  creatureEntry: number;
  creatureName: string;
  characterKills: number;
  uniqueVictims: number;
}

export interface RealRaidBossResponse {
  generatedAt: string;
  population: StatsPopulation;
  coverage: { firstRecordedAt: string | null };
  entries: RealRaidBossEntry[];
}

export interface RealRaidBossQuery {
  sql: string;
  values: readonly (string | number)[];
}

export interface MappedRealRaidBossRows {
  coverage: { firstRecordedAt: string | null };
  entries: RealRaidBossEntry[];
}

export class RealRaidBossError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealRaidBossError";
  }
}

export class RealRaidBossContractIntegrityError extends RealRaidBossError {
  constructor() {
    super("Creature death provider contract integrity check failed.");
    this.name = "RealRaidBossContractIntegrityError";
  }
}

function qualified(database: string, table: string): string {
  return `\`${database}\`.\`${table}\``;
}

type RealRaidBossDatabaseConfig = Pick<StatsDatabaseConfig, "charactersDatabase"> &
  StatsWorldDatabaseConfig;

export function buildRealRaidBossQuery(
  config: RealRaidBossDatabaseConfig,
  population: StatsPopulation,
  visibility: AccountVisibilityScope
): RealRaidBossQuery {
  const charactersDatabase = validateStatsDatabaseIdentifier(
    config.charactersDatabase,
    "STATS_CHARACTERS_DATABASE"
  );
  const worldDatabase = validateStatsDatabaseIdentifier(
    config.worldDatabase,
    "STATS_WORLD_DATABASE"
  );
  const eventsTable = qualified(charactersDatabase, "mod_player_stats_events");
  const creaturesTable = qualified(worldDatabase, "creature_template");
  const populationClause = population === "players" ? "      AND e.actor_is_bot = 0\n" : "";
  const accountExclusion = buildAccountExclusionClause(
    visibility,
    "e.actor_account_id",
    "      "
  );

  return {
    sql: `WITH death_contract AS (
    SELECT
        MIN(e.event_time) AS firstRecordedAt,
        COALESCE(MAX(
            e.event_time IS NULL
            OR e.target_type IS NULL OR e.target_type <> ?
            OR e.target_entry IS NULL OR e.target_entry = 0
            OR e.source IS NULL OR e.source <> ?
            OR e.value1 IS NULL OR e.value1 <= 0
            OR e.value2 IS NULL OR e.value2 <> 0
            OR e.realm_id IS NULL OR e.realm_id = 0
            OR e.actor_account_id IS NULL OR e.actor_account_id = 0
            OR e.actor_guid IS NULL OR e.actor_guid = 0
            OR e.actor_is_bot IS NULL OR e.actor_is_bot NOT IN (0, 1)
        ), 0) AS hasInvalidEvent
    FROM ${eventsTable} e
    WHERE e.event_type = ?
),
creature_totals AS (
    SELECT
        e.target_entry AS creatureEntry,
        COUNT(*) AS characterKills,
        COUNT(DISTINCT e.realm_id, e.actor_guid) AS uniqueVictims
    FROM ${eventsTable} e
    WHERE e.event_type = ?
${populationClause}${accountExclusion.clause}    GROUP BY e.target_entry
),
leaderboard AS (
    SELECT
        t.creatureEntry,
        COALESCE(NULLIF(c.name, ''), CONCAT('Unknown creature #', t.creatureEntry)) AS creatureName,
        t.characterKills,
        t.uniqueVictims
    FROM creature_totals t
    LEFT JOIN ${creaturesTable} c ON c.entry = t.creatureEntry
    ORDER BY t.characterKills DESC, t.uniqueVictims DESC, creatureName ASC, t.creatureEntry ASC
    LIMIT 25
)
SELECT
    d.firstRecordedAt,
    d.hasInvalidEvent,
    l.creatureEntry,
    l.creatureName,
    l.characterKills,
    l.uniqueVictims
FROM death_contract d
LEFT JOIN leaderboard l ON TRUE
ORDER BY l.characterKills DESC, l.uniqueVictims DESC, l.creatureName ASC, l.creatureEntry ASC`,
    values: [
      TARGET_TYPE_CREATURE,
      CREATURE_SOURCE,
      CREATURE_DEATH_EVENT,
      CREATURE_DEATH_EVENT,
      ...accountExclusion.values
    ]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireSafeInteger(value: unknown, key: string, minimum = 0): number {
  const parsed = typeof value === "bigint"
    ? Number(value)
    : typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new RealRaidBossError(`Database row field ${key} is invalid.`);
  }
  return parsed;
}

function requireString(value: unknown, key: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > 128 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new RealRaidBossError(`Database row field ${key} is invalid.`);
  }
  return value;
}

function requireUtcTimestamp(value: unknown): string {
  let timestamp: Date;
  if (value instanceof Date) {
    timestamp = value;
  } else if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z?$/u.exec(value);
    if (!match) throw new RealRaidBossError("Database row field firstRecordedAt is invalid.");
    const normalized = `${match[1]}T${match[2]}.${(match[3] ?? "").padEnd(3, "0").slice(0, 3)}Z`;
    timestamp = new Date(normalized);
    if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== normalized) {
      throw new RealRaidBossError("Database row field firstRecordedAt is invalid.");
    }
  } else {
    throw new RealRaidBossError("Database row field firstRecordedAt is invalid.");
  }
  if (!Number.isFinite(timestamp.getTime())) {
    throw new RealRaidBossError("Database row field firstRecordedAt is invalid.");
  }
  return timestamp.toISOString();
}

function isEmptyRow(row: Record<string, unknown>): boolean {
  if (row.creatureEntry !== null) return false;
  for (const key of ["creatureName", "characterKills", "uniqueVictims"] as const) {
    if (row[key] !== null) throw new RealRaidBossError("Empty Real Raid Boss row is malformed.");
  }
  return true;
}

export function mapRealRaidBossQueryRows(rows: unknown): MappedRealRaidBossRows {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) {
    throw new RealRaidBossError("Real Raid Boss database result is invalid.");
  }
  const records = rows.map((row) => {
    if (!isRecord(row)) throw new RealRaidBossError("Real Raid Boss contains an invalid row.");
    return row;
  });
  const first = records[0]!;
  if (requireSafeInteger(first.hasInvalidEvent, "hasInvalidEvent") !== 0) {
    throw new RealRaidBossContractIntegrityError();
  }
  const firstRecordedAt = first.firstRecordedAt === null
    ? null
    : requireUtcTimestamp(first.firstRecordedAt);

  for (const row of records.slice(1)) {
    if (requireSafeInteger(row.hasInvalidEvent, "hasInvalidEvent") !== 0) {
      throw new RealRaidBossContractIntegrityError();
    }
    const rowTimestamp = row.firstRecordedAt === null ? null : requireUtcTimestamp(row.firstRecordedAt);
    if (rowTimestamp !== firstRecordedAt) {
      throw new RealRaidBossError("Real Raid Boss coverage metadata is inconsistent.");
    }
  }

  if (isEmptyRow(first)) {
    if (records.length !== 1 || firstRecordedAt !== null) {
      throw new RealRaidBossError("Empty Real Raid Boss result is invalid.");
    }
    return { coverage: { firstRecordedAt }, entries: [] };
  }
  if (firstRecordedAt === null) {
    throw new RealRaidBossError("Real Raid Boss coverage metadata is inconsistent.");
  }

  const entries = records.map((row) => {
    const creatureEntry = requireSafeInteger(row.creatureEntry, "creatureEntry", 1);
    const characterKills = requireSafeInteger(row.characterKills, "characterKills", 1);
    const uniqueVictims = requireSafeInteger(row.uniqueVictims, "uniqueVictims", 1);
    if (creatureEntry > 0xffff_ffff) {
      throw new RealRaidBossError("Database row field creatureEntry is invalid.");
    }
    if (uniqueVictims > characterKills) {
      throw new RealRaidBossError("Database row field uniqueVictims is invalid.");
    }
    return {
      creatureEntry,
      creatureName: requireString(row.creatureName, "creatureName"),
      characterKills,
      uniqueVictims
    };
  });
  return { coverage: { firstRecordedAt }, entries };
}

export type QueryRealRaidBossRows = (
  population: StatsPopulation,
  visibility: AccountVisibilityScope
) => Promise<unknown>;

export async function queryRealRaidBossRows(
  population: StatsPopulation,
  visibility: AccountVisibilityScope
): Promise<unknown> {
  const { pool, config } = getStatsDatabase();
  const query = buildRealRaidBossQuery(
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

export class RealRaidBossService {
  private readonly cache = new Map<string, { value: RealRaidBossResponse; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<RealRaidBossResponse>>();

  constructor(
    private readonly queryRows: QueryRealRaidBossRows = queryRealRaidBossRows,
    private readonly now: () => number = Date.now
  ) {}

  async getLeaderboard(
    population: StatsPopulation,
    visibility: AccountVisibilityScope
  ): Promise<RealRaidBossResponse> {
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
  ): Promise<RealRaidBossResponse> {
    const mapped = mapRealRaidBossQueryRows(await this.queryRows(population, visibility));
    const generatedAt = this.now();
    const response: RealRaidBossResponse = {
      generatedAt: new Date(generatedAt).toISOString(),
      population,
      coverage: mapped.coverage,
      entries: mapped.entries
    };
    this.cache.set(cacheKey, { value: response, expiresAt: generatedAt + CACHE_TTL_MS });
    return response;
  }
}

const realRaidBossService = new RealRaidBossService();

export function getRealRaidBoss(
  population: StatsPopulation,
  visibility: AccountVisibilityScope
): Promise<RealRaidBossResponse> {
  return realRaidBossService.getLeaderboard(population, visibility);
}
