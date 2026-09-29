import { WOTLK_ZONE_CATALOG } from "../data/wotlk-area-zones.js";
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

const CANONICAL_DEATH_EVENT = "PLAYER_DEATH";
const CANONICAL_DEATH_MIGRATION = "canonical_player_death_v1";
const CANONICAL_SOURCE = "canonical";
const CACHE_TTL_MS = 60_000;
const QUERY_TIMEOUT_MS = 8_000;
const MAX_ROWS = 25;

export type { StatsPopulation };
export type ZoneCatalog = readonly (readonly [zoneId: number, zoneName: string])[];

export interface BadNeighborhoodEntry {
  zoneId: number;
  zoneName: string;
  deaths: number;
  uniqueVictims: number;
}

export interface BadNeighborhoodResponse {
  generatedAt: string;
  population: StatsPopulation;
  coverage: { comprehensiveSince: string };
  omittedUnknownZoneDeaths: number;
  entries: BadNeighborhoodEntry[];
}

export interface BadNeighborhoodQuery {
  sql: string;
  values: readonly (string | number)[];
}

export interface MappedBadNeighborhoodRows {
  coverage: { comprehensiveSince: string };
  omittedUnknownZoneDeaths: number;
  entries: BadNeighborhoodEntry[];
}

export class BadNeighborhoodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadNeighborhoodError";
  }
}

export class BadNeighborhoodContractIntegrityError extends BadNeighborhoodError {
  constructor() {
    super("Canonical death provider contract integrity check failed.");
    this.name = "BadNeighborhoodContractIntegrityError";
  }
}

export class BadNeighborhoodCatalogError extends BadNeighborhoodError {
  constructor() {
    super("WotLK zone catalog integrity check failed.");
    this.name = "BadNeighborhoodCatalogError";
  }
}

function validatedCatalog(catalog: ZoneCatalog): ReadonlyMap<number, string> {
  const zones = new Map<number, string>();
  let previousId = 0;
  for (const entry of catalog) {
    const [zoneId, zoneName] = entry;
    if (
      !Number.isSafeInteger(zoneId) || zoneId <= previousId || zoneId > 0xffff_ffff ||
      typeof zoneName !== "string" || zoneName.length === 0 || zoneName.length > 128 ||
      /[\u0000-\u001f\u007f]/u.test(zoneName)
    ) {
      throw new BadNeighborhoodCatalogError();
    }
    zones.set(zoneId, zoneName);
    previousId = zoneId;
  }
  if (zones.size === 0) throw new BadNeighborhoodCatalogError();
  return zones;
}

export function resolveWotlkZoneName(
  zoneId: number,
  catalog: ZoneCatalog = WOTLK_ZONE_CATALOG
): string {
  if (!Number.isSafeInteger(zoneId) || zoneId <= 0 || zoneId > 0xffff_ffff) {
    throw new BadNeighborhoodCatalogError();
  }
  return validatedCatalog(catalog).get(zoneId) ?? `Unknown zone #${zoneId}`;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function zoneNameSql(column: string, catalog: ZoneCatalog): string {
  const zones = validatedCatalog(catalog);
  const cases = [...zones].map(([zoneId, zoneName]) =>
    `        WHEN ${zoneId} THEN ${sqlString(zoneName)}`
  ).join("\n");
  return `CASE ${column}\n${cases}\n        ELSE CONCAT('Unknown zone #', ${column})\n    END`;
}

function qualified(database: string, table: string): string {
  return `\`${database}\`.\`${table}\``;
}

export function buildBadNeighborhoodQuery(
  config: Pick<StatsDatabaseConfig, "charactersDatabase">,
  population: StatsPopulation,
  visibility: AccountVisibilityScope,
  catalog: ZoneCatalog = WOTLK_ZONE_CATALOG
): BadNeighborhoodQuery {
  const charactersDatabase = validateStatsDatabaseIdentifier(
    config.charactersDatabase,
    "STATS_CHARACTERS_DATABASE"
  );
  const eventsTable = qualified(charactersDatabase, "mod_player_stats_events");
  const migrationsTable = qualified(charactersDatabase, "mod_player_stats_migrations");
  const populationClause = population === "players" ? "      AND e.actor_is_bot = 0\n" : "";
  const accountExclusion = buildAccountExclusionClause(
    visibility,
    "e.actor_account_id",
    "      "
  );
  const nameExpression = zoneNameSql("z.zoneId", catalog);

  return {
    sql: `WITH cutover_rows AS (
    SELECT cutoff_event_id, applied_at
    FROM ${migrationsTable}
    WHERE migration_key = ?
),
cutover AS (
    SELECT COUNT(*) AS cutoverCount,
           MAX(cutoff_event_id) AS cutoffEventId,
           MAX(applied_at) AS comprehensiveSince
    FROM cutover_rows
),
death_contract AS (
    SELECT COALESCE(MAX(
        e.id <= x.cutoffEventId
        OR e.source IS NULL OR e.source <> ?
        OR e.target_type IS NULL OR e.target_type <> 0
        OR e.target_entry IS NULL OR e.target_entry <> 0
        OR e.target_guid IS NULL OR e.target_guid <> 0
        OR e.target_is_bot IS NULL OR e.target_is_bot <> 0
        OR e.value1 IS NULL OR e.value1 <> 0
        OR e.value2 IS NULL OR e.value2 <> 0
        OR e.realm_id IS NULL OR e.realm_id = 0
        OR e.actor_account_id IS NULL OR e.actor_account_id = 0
        OR e.actor_guid IS NULL OR e.actor_guid = 0
        OR e.actor_is_bot IS NULL OR e.actor_is_bot NOT IN (0, 1)
    ), 0) AS hasInvalidCanonical
    FROM ${eventsTable} e
    CROSS JOIN cutover x
    WHERE e.event_type = ?
      AND x.cutoverCount = 1
),
eligible_deaths AS (
    SELECT e.realm_id, e.actor_guid, e.zone_id
    FROM ${eventsTable} e
    CROSS JOIN cutover x
    WHERE x.cutoverCount = 1
      AND e.event_type = ?
      AND e.id > x.cutoffEventId
${populationClause}${accountExclusion.clause}),
zone_totals AS (
    SELECT zone_id AS zoneId,
           COUNT(*) AS deaths,
           COUNT(DISTINCT realm_id, actor_guid) AS uniqueVictims
    FROM eligible_deaths
    WHERE zone_id > 0
    GROUP BY zone_id
),
omitted AS (
    SELECT COALESCE(SUM(zone_id = 0), 0) AS omittedUnknownZoneDeaths
    FROM eligible_deaths
),
leaderboard AS (
    SELECT z.zoneId, z.deaths, z.uniqueVictims
    FROM zone_totals z
    ORDER BY z.deaths DESC, z.uniqueVictims DESC, ${nameExpression} ASC, z.zoneId ASC
    LIMIT 25
)
SELECT x.cutoverCount, x.cutoffEventId, x.comprehensiveSince,
       c.hasInvalidCanonical, o.omittedUnknownZoneDeaths,
       l.zoneId, l.deaths, l.uniqueVictims
FROM cutover x
CROSS JOIN death_contract c
CROSS JOIN omitted o
LEFT JOIN leaderboard l ON TRUE
ORDER BY l.deaths DESC, l.uniqueVictims DESC, ${nameExpression.replaceAll("z.zoneId", "l.zoneId")} ASC, l.zoneId ASC`,
    values: [
      CANONICAL_DEATH_MIGRATION,
      CANONICAL_SOURCE,
      CANONICAL_DEATH_EVENT,
      CANONICAL_DEATH_EVENT,
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
    throw new BadNeighborhoodError(`Database row field ${key} is invalid.`);
  }
  return parsed;
}

function requireUtcTimestamp(value: unknown): string {
  let timestamp: Date;
  if (value instanceof Date) {
    timestamp = value;
  } else if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z?$/u.exec(value);
    if (!match) throw new BadNeighborhoodError("Database row field comprehensiveSince is invalid.");
    const normalized = `${match[1]}T${match[2]}.${(match[3] ?? "").padEnd(3, "0").slice(0, 3)}Z`;
    timestamp = new Date(normalized);
    if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== normalized) {
      throw new BadNeighborhoodError("Database row field comprehensiveSince is invalid.");
    }
  } else {
    throw new BadNeighborhoodError("Database row field comprehensiveSince is invalid.");
  }
  if (!Number.isFinite(timestamp.getTime())) {
    throw new BadNeighborhoodError("Database row field comprehensiveSince is invalid.");
  }
  return timestamp.toISOString();
}

function isEmptyRow(row: Record<string, unknown>): boolean {
  if (row.zoneId !== null) return false;
  if (row.deaths !== null || row.uniqueVictims !== null) {
    throw new BadNeighborhoodError("Empty Bad Neighborhood row is malformed.");
  }
  return true;
}

export function mapBadNeighborhoodQueryRows(
  rows: unknown,
  catalog: ZoneCatalog = WOTLK_ZONE_CATALOG
): MappedBadNeighborhoodRows {
  validatedCatalog(catalog);
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) {
    throw new BadNeighborhoodError("Bad Neighborhood database result is invalid.");
  }
  const records = rows.map((row) => {
    if (!isRecord(row)) throw new BadNeighborhoodError("Bad Neighborhood contains an invalid row.");
    return row;
  });
  const first = records[0]!;
  if (requireSafeInteger(first.cutoverCount, "cutoverCount") !== 1) {
    throw new BadNeighborhoodError("Canonical death cutover metadata is invalid.");
  }
  const cutoff = requireSafeInteger(first.cutoffEventId, "cutoffEventId");
  const comprehensiveSince = requireUtcTimestamp(first.comprehensiveSince);
  const omittedUnknownZoneDeaths = requireSafeInteger(
    first.omittedUnknownZoneDeaths,
    "omittedUnknownZoneDeaths"
  );
  if (requireSafeInteger(first.hasInvalidCanonical, "hasInvalidCanonical") !== 0) {
    throw new BadNeighborhoodContractIntegrityError();
  }

  for (const row of records.slice(1)) {
    if (
      requireSafeInteger(row.cutoverCount, "cutoverCount") !== 1 ||
      requireSafeInteger(row.cutoffEventId, "cutoffEventId") !== cutoff ||
      requireUtcTimestamp(row.comprehensiveSince) !== comprehensiveSince ||
      requireSafeInteger(row.omittedUnknownZoneDeaths, "omittedUnknownZoneDeaths") !== omittedUnknownZoneDeaths
    ) {
      throw new BadNeighborhoodError("Bad Neighborhood metadata is inconsistent.");
    }
    if (requireSafeInteger(row.hasInvalidCanonical, "hasInvalidCanonical") !== 0) {
      throw new BadNeighborhoodContractIntegrityError();
    }
  }

  if (isEmptyRow(first)) {
    if (records.length !== 1) throw new BadNeighborhoodError("Empty Bad Neighborhood result is invalid.");
    return { coverage: { comprehensiveSince }, omittedUnknownZoneDeaths, entries: [] };
  }

  const entries = records.map((row) => {
    const zoneId = requireSafeInteger(row.zoneId, "zoneId", 1);
    const deaths = requireSafeInteger(row.deaths, "deaths", 1);
    const uniqueVictims = requireSafeInteger(row.uniqueVictims, "uniqueVictims", 1);
    if (uniqueVictims > deaths) {
      throw new BadNeighborhoodError("Database row field uniqueVictims is invalid.");
    }
    return {
      zoneId,
      zoneName: resolveWotlkZoneName(zoneId, catalog),
      deaths,
      uniqueVictims
    };
  });
  return { coverage: { comprehensiveSince }, omittedUnknownZoneDeaths, entries };
}

export type QueryBadNeighborhoodRows = (
  population: StatsPopulation,
  visibility: AccountVisibilityScope
) => Promise<unknown>;

export async function queryBadNeighborhoodRows(
  population: StatsPopulation,
  visibility: AccountVisibilityScope
): Promise<unknown> {
  const { pool, config } = getStatsDatabase();
  const query = buildBadNeighborhoodQuery(config, population, visibility);
  const [rows] = await pool.execute({
    sql: query.sql,
    values: [...query.values],
    timeout: QUERY_TIMEOUT_MS
  });
  return rows;
}

export class BadNeighborhoodService {
  private readonly cache = new Map<string, { value: BadNeighborhoodResponse; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<BadNeighborhoodResponse>>();

  constructor(
    private readonly queryRows: QueryBadNeighborhoodRows = queryBadNeighborhoodRows,
    private readonly now: () => number = Date.now,
    private readonly catalog: ZoneCatalog = WOTLK_ZONE_CATALOG
  ) {}

  async getLeaderboard(
    population: StatsPopulation,
    visibility: AccountVisibilityScope
  ): Promise<BadNeighborhoodResponse> {
    validatedCatalog(this.catalog);
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
  ): Promise<BadNeighborhoodResponse> {
    const mapped = mapBadNeighborhoodQueryRows(
      await this.queryRows(population, visibility),
      this.catalog
    );
    const generatedAt = this.now();
    const response: BadNeighborhoodResponse = {
      generatedAt: new Date(generatedAt).toISOString(),
      population,
      coverage: mapped.coverage,
      omittedUnknownZoneDeaths: mapped.omittedUnknownZoneDeaths,
      entries: mapped.entries
    };
    this.cache.set(cacheKey, { value: response, expiresAt: generatedAt + CACHE_TTL_MS });
    return response;
  }
}

const badNeighborhoodService = new BadNeighborhoodService();

export function getBadNeighborhood(
  population: StatsPopulation,
  visibility: AccountVisibilityScope
): Promise<BadNeighborhoodResponse> {
  return badNeighborhoodService.getLeaderboard(population, visibility);
}
