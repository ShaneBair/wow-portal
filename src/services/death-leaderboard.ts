import { getClassName, getRaceName } from "../domain/wotlk.js";
import {
  getStatsDatabase,
  type StatsDatabaseConfig,
  validateStatsDatabaseIdentifier
} from "./stats-database.js";

const CREATURE_DEATH_EVENT = "PLAYER_KILLED_BY_CREATURE";
const PVP_KILL_EVENT = "PVP_KILL";
const CANONICAL_DEATH_EVENT = "PLAYER_DEATH";
const CANONICAL_DEATH_MIGRATION = "canonical_player_death_v1";
const CACHE_TTL_MS = 60_000;
const QUERY_TIMEOUT_MS = 8_000;
const MAX_ROWS = 25;

export type StatsPopulation = "players" | "all";

export interface DeathLeaderboardEntry {
  characterName: string;
  race: string;
  class: string;
  level: number;
  accountLogin: string;
  isBot: boolean;
  deaths: number;
}

export interface DeathLeaderboardCoverage {
  comprehensiveSince: string;
}

export interface DeathLeaderboardResponse {
  generatedAt: string;
  population: StatsPopulation;
  coverage: DeathLeaderboardCoverage;
  count: number;
  entries: DeathLeaderboardEntry[];
}

export interface DeathLeaderboardQuery {
  sql: string;
  values: readonly [string, string, string, string, string];
}

export interface MappedDeathLeaderboardRows {
  coverage: DeathLeaderboardCoverage;
  entries: DeathLeaderboardEntry[];
}

export class DeathLeaderboardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeathLeaderboardError";
  }
}

export class DeathLeaderboardContractIntegrityError extends DeathLeaderboardError {
  constructor() {
    super("Canonical death provider contract integrity check failed.");
    this.name = "DeathLeaderboardContractIntegrityError";
  }
}

function qualified(database: string, table: string): string {
  return `\`${database}\`.\`${table}\``;
}

export function buildDeathLeaderboardQuery(
  config: Pick<StatsDatabaseConfig, "charactersDatabase" | "authDatabase">,
  population: StatsPopulation
): DeathLeaderboardQuery {
  const charactersDatabase = validateStatsDatabaseIdentifier(
    config.charactersDatabase,
    "STATS_CHARACTERS_DATABASE"
  );
  const authDatabase = validateStatsDatabaseIdentifier(
    config.authDatabase,
    "STATS_AUTH_DATABASE"
  );
  const eventsTable = qualified(charactersDatabase, "mod_player_stats_events");
  const migrationsTable = qualified(charactersDatabase, "mod_player_stats_migrations");
  const charactersTable = qualified(charactersDatabase, "characters");
  const accountsTable = qualified(authDatabase, "account");
  const populationClause = population === "players" ? "    WHERE is_bot = 0\n" : "";

  return {
    sql: `WITH cutover_rows AS (
    SELECT cutoff_event_id, applied_at
    FROM ${migrationsTable}
    WHERE migration_key = ?
),
cutover AS (
    SELECT
        COUNT(*) AS cutover_count,
        MAX(cutoff_event_id) AS cutoff_event_id,
        MAX(applied_at) AS applied_at
    FROM cutover_rows
),
integrity AS (
    SELECT EXISTS (
        SELECT 1
        FROM ${eventsTable} e
        CROSS JOIN cutover x
        WHERE x.cutover_count = 1
          AND e.event_type = ?
          AND e.id <= x.cutoff_event_id
    ) AS has_invalid_canonical
),
recorded_deaths AS (
    SELECT e.actor_guid AS character_guid, e.actor_is_bot AS is_bot
    FROM ${eventsTable} e
    CROSS JOIN cutover x
    WHERE x.cutover_count = 1
      AND e.event_type = ?
      AND e.id <= x.cutoff_event_id

    UNION ALL

    SELECT e.target_guid AS character_guid, e.target_is_bot AS is_bot
    FROM ${eventsTable} e
    CROSS JOIN cutover x
    WHERE x.cutover_count = 1
      AND e.event_type = ?
      AND e.id <= x.cutoff_event_id

    UNION ALL

    SELECT e.actor_guid AS character_guid, e.actor_is_bot AS is_bot
    FROM ${eventsTable} e
    CROSS JOIN cutover x
    WHERE x.cutover_count = 1
      AND e.event_type = ?
      AND e.id > x.cutoff_event_id
),
death_totals AS (
    SELECT character_guid, is_bot, COUNT(*) AS deaths
    FROM recorded_deaths
${populationClause}    GROUP BY character_guid, is_bot
),
leaderboard AS (
    SELECT
        c.name AS characterName,
        c.race AS raceId,
        c.class AS classId,
        c.level AS level,
        a.username AS accountLogin,
        d.is_bot AS isBot,
        d.deaths AS deaths
    FROM death_totals d
    JOIN ${charactersTable} c ON c.guid = d.character_guid
    LEFT JOIN ${accountsTable} a ON a.id = c.account
    WHERE c.deleteDate IS NULL
    ORDER BY d.deaths DESC, c.name ASC, d.is_bot ASC
    LIMIT 25
)
SELECT
    x.cutover_count AS cutoverCount,
    x.cutoff_event_id AS cutoffEventId,
    x.applied_at AS comprehensiveSince,
    i.has_invalid_canonical AS hasInvalidCanonical,
    l.characterName,
    l.raceId,
    l.classId,
    l.level,
    l.accountLogin,
    l.isBot,
    l.deaths
FROM cutover x
CROSS JOIN integrity i
LEFT JOIN leaderboard l ON TRUE
ORDER BY l.deaths DESC, l.characterName ASC, l.isBot ASC`,
    values: [
      CANONICAL_DEATH_MIGRATION,
      CANONICAL_DEATH_EVENT,
      CREATURE_DEATH_EVENT,
      PVP_KILL_EVENT,
      CANONICAL_DEATH_EVENT
    ]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  row: Record<string, unknown>,
  key: string,
  maximumLength: number
): string {
  const value = row[key];

  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new DeathLeaderboardError(`Database row field ${key} is invalid.`);
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

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new DeathLeaderboardError(`Database row field ${key} is invalid.`);
  }

  return value;
}

function requireDatabaseSafeInteger(value: unknown, key: string): number {
  let integer: number;

  if (typeof value === "bigint") {
    integer = Number(value);
  } else if (typeof value === "string" && /^\d+$/u.test(value)) {
    integer = Number(value);
  } else if (typeof value === "number") {
    integer = value;
  } else {
    throw new DeathLeaderboardError(`Database row field ${key} is invalid.`);
  }

  if (!Number.isSafeInteger(integer) || integer < 0) {
    throw new DeathLeaderboardError(`Database row field ${key} is invalid.`);
  }

  return integer;
}

function requireDeaths(value: unknown): number {
  return requireDatabaseSafeInteger(value, "deaths");
}

function requireBotFlag(value: unknown): boolean {
  if (value === 0 || value === false) {
    return false;
  }

  if (value === 1 || value === true) {
    return true;
  }

  throw new DeathLeaderboardError("Database row field isBot is invalid.");
}

function requireUtcTimestamp(value: unknown): string {
  let timestamp: Date;

  if (value instanceof Date) {
    timestamp = value;
  } else if (typeof value === "string") {
    const databaseTimestamp = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z?$/u.exec(value);
    if (!databaseTimestamp) {
      throw new DeathLeaderboardError("Database row field comprehensiveSince is invalid.");
    }

    const fraction = (databaseTimestamp[3] ?? "").padEnd(3, "0").slice(0, 3);
    const normalized = `${databaseTimestamp[1]}T${databaseTimestamp[2]}.${fraction}Z`;
    timestamp = new Date(normalized);
    if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== normalized) {
      throw new DeathLeaderboardError("Database row field comprehensiveSince is invalid.");
    }
  } else {
    throw new DeathLeaderboardError("Database row field comprehensiveSince is invalid.");
  }

  if (!Number.isFinite(timestamp.getTime())) {
    throw new DeathLeaderboardError("Database row field comprehensiveSince is invalid.");
  }

  return timestamp.toISOString();
}

export function mapDeathLeaderboardRows(rows: unknown): DeathLeaderboardEntry[] {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) {
    throw new DeathLeaderboardError("Death leaderboard database result is invalid.");
  }

  return rows.map((value) => {
    if (!isRecord(value)) {
      throw new DeathLeaderboardError("Death leaderboard contains an invalid row.");
    }

    const accountValue = value.accountLogin;
    const accountLogin = accountValue === null
      ? "Unknown account"
      : requireString(value, "accountLogin", 128);
    const raceId = requireInteger(value, "raceId", 0, 255);
    const classId = requireInteger(value, "classId", 0, 255);

    return {
      characterName: requireString(value, "characterName", 128),
      race: getRaceName(raceId),
      class: getClassName(classId),
      level: requireInteger(value, "level", 1, 255),
      accountLogin,
      isBot: requireBotFlag(value.isBot),
      deaths: requireDeaths(value.deaths)
    };
  });
}

function isEmptyLeaderboardRow(row: Record<string, unknown>): boolean {
  if (row.characterName !== null) {
    return false;
  }

  for (const key of ["raceId", "classId", "level", "accountLogin", "isBot", "deaths"] as const) {
    if (row[key] !== null) {
      throw new DeathLeaderboardError("Empty death leaderboard row is malformed.");
    }
  }

  return true;
}

export function mapDeathLeaderboardQueryRows(rows: unknown): MappedDeathLeaderboardRows {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) {
    throw new DeathLeaderboardError("Death leaderboard database result is invalid.");
  }

  const records = rows.map((row) => {
    if (!isRecord(row)) {
      throw new DeathLeaderboardError("Death leaderboard contains an invalid row.");
    }
    return row;
  });
  const first = records[0]!;

  if (requireDatabaseSafeInteger(first.cutoverCount, "cutoverCount") !== 1) {
    throw new DeathLeaderboardError("Canonical death cutover metadata is invalid.");
  }

  const cutoffEventId = requireDatabaseSafeInteger(first.cutoffEventId, "cutoffEventId");
  const comprehensiveSince = requireUtcTimestamp(first.comprehensiveSince);

  if (requireDatabaseSafeInteger(first.hasInvalidCanonical, "hasInvalidCanonical") !== 0) {
    throw new DeathLeaderboardContractIntegrityError();
  }

  for (const record of records.slice(1)) {
    if (requireDatabaseSafeInteger(record.hasInvalidCanonical, "hasInvalidCanonical") !== 0) {
      throw new DeathLeaderboardContractIntegrityError();
    }

    if (
      requireDatabaseSafeInteger(record.cutoverCount, "cutoverCount") !== 1 ||
      requireDatabaseSafeInteger(record.cutoffEventId, "cutoffEventId") !== cutoffEventId ||
      requireUtcTimestamp(record.comprehensiveSince) !== comprehensiveSince
    ) {
      throw new DeathLeaderboardError("Canonical death cutover metadata is inconsistent.");
    }
  }

  if (isEmptyLeaderboardRow(first)) {
    if (records.length !== 1) {
      throw new DeathLeaderboardError("Empty death leaderboard result is invalid.");
    }
    return { coverage: { comprehensiveSince }, entries: [] };
  }

  return {
    coverage: { comprehensiveSince },
    entries: mapDeathLeaderboardRows(records)
  };
}

export type QueryDeathRows = (population: StatsPopulation) => Promise<unknown>;

export async function queryDeathRows(population: StatsPopulation): Promise<unknown> {
  const { pool, config } = getStatsDatabase();
  const query = buildDeathLeaderboardQuery(config, population);
  const [rows] = await pool.execute({
    sql: query.sql,
    values: [...query.values],
    timeout: QUERY_TIMEOUT_MS
  });
  return rows;
}

export class DeathLeaderboardService {
  private readonly cache = new Map<
    StatsPopulation,
    { value: DeathLeaderboardResponse; expiresAt: number }
  >();
  private readonly inFlight = new Map<StatsPopulation, Promise<DeathLeaderboardResponse>>();

  constructor(
    private readonly queryRows: QueryDeathRows = queryDeathRows,
    private readonly now: () => number = Date.now
  ) {}

  async getLeaderboard(population: StatsPopulation): Promise<DeathLeaderboardResponse> {
    const now = this.now();
    const cached = this.cache.get(population);

    if (cached && now < cached.expiresAt) {
      return cached.value;
    }

    const activeRefresh = this.inFlight.get(population);
    if (activeRefresh) {
      return activeRefresh;
    }

    const refresh = this.refresh(population);
    const trackedRefresh = refresh.finally(() => {
      if (this.inFlight.get(population) === trackedRefresh) {
        this.inFlight.delete(population);
      }
    });
    this.inFlight.set(population, trackedRefresh);
    return trackedRefresh;
  }

  private async refresh(population: StatsPopulation): Promise<DeathLeaderboardResponse> {
    const result = mapDeathLeaderboardQueryRows(await this.queryRows(population));
    const generatedAt = this.now();
    const response: DeathLeaderboardResponse = {
      generatedAt: new Date(generatedAt).toISOString(),
      population,
      coverage: result.coverage,
      count: result.entries.length,
      entries: result.entries
    };
    this.cache.set(population, {
      value: response,
      expiresAt: generatedAt + CACHE_TTL_MS
    });
    return response;
  }
}

const deathLeaderboardService = new DeathLeaderboardService();

export function getDeathLeaderboard(
  population: StatsPopulation
): Promise<DeathLeaderboardResponse> {
  return deathLeaderboardService.getLeaderboard(population);
}
