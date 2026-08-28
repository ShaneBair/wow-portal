import { getClassName, getRaceName } from "../domain/wotlk.js";
import type { StatsPopulation } from "./death-leaderboard.js";
import {
  getStatsDatabase,
  readStatsWorldDatabaseConfig,
  type StatsDatabaseConfig,
  type StatsWorldDatabaseConfig,
  validateStatsDatabaseIdentifier
} from "./stats-database.js";

export const ENCOUNTER_CREDIT_KILL_CREATURE = 0;
export const CREATURE_ELITE_WORLDBOSS = 3;
export const CREATURE_TYPE_FLAG_BOSS_MOB = 0x00000004;
export const TARGET_TYPE_CREATURE = 2;
const CREATURE_KILL_EVENT = "CREATURE_KILL";
const CREATURE_KILL_PET_EVENT = "CREATURE_KILL_PET";
const DIRECT_SOURCE = "direct";
const PET_SOURCE = "pet";
const CACHE_TTL_MS = 60_000;
const QUERY_TIMEOUT_MS = 8_000;
const MAX_ROWS = 25;

export type { StatsPopulation };

export interface BossKillLeaderboardEntry {
  characterName: string;
  race: string;
  class: string;
  level: number;
  accountLogin: string;
  isBot: boolean;
  bossKills: number;
}

export interface BossKillLeaderboardResponse {
  generatedAt: string;
  population: StatsPopulation;
  coverage: { firstRecordedAt: string | null };
  count: number;
  entries: BossKillLeaderboardEntry[];
}

export interface BossKillLeaderboardQuery {
  sql: string;
  values: readonly [number, number, number, number, string, string, string, string, string, string, string, string];
}

export interface MappedBossKillRows {
  coverage: { firstRecordedAt: string | null };
  entries: BossKillLeaderboardEntry[];
}

export class BossKillLeaderboardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BossKillLeaderboardError";
  }
}

export class BossKillContractIntegrityError extends BossKillLeaderboardError {
  constructor() {
    super("Boss kill provider contract integrity check failed.");
    this.name = "BossKillContractIntegrityError";
  }
}

function qualified(database: string, table: string): string {
  return `\`${database}\`.\`${table}\``;
}

type BossDatabaseConfig = Pick<StatsDatabaseConfig, "charactersDatabase" | "authDatabase"> &
  StatsWorldDatabaseConfig;

export function buildBossKillLeaderboardQuery(
  config: BossDatabaseConfig,
  population: StatsPopulation
): BossKillLeaderboardQuery {
  const charactersDatabase = validateStatsDatabaseIdentifier(
    config.charactersDatabase,
    "STATS_CHARACTERS_DATABASE"
  );
  const authDatabase = validateStatsDatabaseIdentifier(config.authDatabase, "STATS_AUTH_DATABASE");
  const worldDatabase = validateStatsDatabaseIdentifier(config.worldDatabase, "STATS_WORLD_DATABASE");
  const eventsTable = qualified(charactersDatabase, "mod_player_stats_events");
  const charactersTable = qualified(charactersDatabase, "characters");
  const accountsTable = qualified(authDatabase, "account");
  const encountersTable = qualified(worldDatabase, "instance_encounters");
  const creaturesTable = qualified(worldDatabase, "creature_template");
  const populationClause = population === "players" ? "      AND e.actor_is_bot = 0\n" : "";

  return {
    sql: `WITH boss_entries AS (
    SELECT creditEntry AS entry
    FROM ${encountersTable}
    WHERE creditType = ?
      AND creditEntry <> 0

    UNION

    SELECT entry
    FROM ${creaturesTable}
    WHERE \`rank\` = ?
       OR (type_flags & ?) <> 0
),
kill_contract AS (
    SELECT
        MIN(event_time) AS firstRecordedAt,
        COALESCE(MAX(
            event_time IS NULL
            OR target_type IS NULL OR target_type <> ?
            OR target_entry IS NULL OR target_entry = 0
            OR target_guid IS NULL OR target_guid = 0
            OR target_is_bot IS NULL OR target_is_bot <> 0
            OR value1 IS NULL
            OR value2 IS NULL OR value2 <> 0
            OR actor_guid IS NULL OR actor_guid = 0
            OR actor_is_bot IS NULL OR actor_is_bot NOT IN (0, 1)
            OR (event_type = ? AND (source IS NULL OR source <> ?))
            OR (event_type = ? AND (source IS NULL OR source <> ?))
        ), 0) AS hasInvalidEvent
    FROM ${eventsTable}
    WHERE event_type IN (?, ?)
),
boss_totals AS (
    SELECT
        e.actor_guid,
        e.actor_is_bot,
        COUNT(*) AS bossKills
    FROM ${eventsTable} e
    JOIN boss_entries b ON b.entry = e.target_entry
    WHERE e.event_type IN (?, ?)
${populationClause}    GROUP BY e.actor_guid, e.actor_is_bot
),
eligible_totals AS (
    SELECT
        c.name AS characterName,
        c.race AS raceId,
        c.class AS classId,
        c.level,
        a.username AS accountLogin,
        b.actor_is_bot AS isBot,
        b.bossKills
    FROM boss_totals b
    JOIN ${charactersTable} c ON c.guid = b.actor_guid
    LEFT JOIN ${accountsTable} a ON a.id = c.account
    WHERE c.deleteDate IS NULL
    ORDER BY b.bossKills DESC, c.name ASC, b.actor_is_bot ASC
    LIMIT 25
)
SELECT
    kc.firstRecordedAt,
    kc.hasInvalidEvent,
    e.characterName,
    e.raceId,
    e.classId,
    e.level,
    e.accountLogin,
    e.isBot,
    e.bossKills
FROM kill_contract kc
LEFT JOIN eligible_totals e ON TRUE
ORDER BY e.bossKills DESC, e.characterName ASC, e.isBot ASC`,
    values: [
      ENCOUNTER_CREDIT_KILL_CREATURE,
      CREATURE_ELITE_WORLDBOSS,
      CREATURE_TYPE_FLAG_BOSS_MOB,
      TARGET_TYPE_CREATURE,
      CREATURE_KILL_EVENT,
      DIRECT_SOURCE,
      CREATURE_KILL_PET_EVENT,
      PET_SOURCE,
      CREATURE_KILL_EVENT,
      CREATURE_KILL_PET_EVENT,
      CREATURE_KILL_EVENT,
      CREATURE_KILL_PET_EVENT
    ]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (
    typeof value !== "string" || value.length === 0 || value.length > 128 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new BossKillLeaderboardError(`Database row field ${key} is invalid.`);
  }
  return value;
}

function requireInteger(row: Record<string, unknown>, key: string, minimum: number, maximum: number): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new BossKillLeaderboardError(`Database row field ${key} is invalid.`);
  }
  return value;
}

function requireSafeInteger(value: unknown, key: string): number {
  const parsed = typeof value === "bigint"
    ? Number(value)
    : typeof value === "string" && /^\d+$/u.test(value)
      ? Number(value)
      : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new BossKillLeaderboardError(`Database row field ${key} is invalid.`);
  }
  return parsed;
}

function requireBotFlag(value: unknown): boolean {
  if (value === 0 || value === false) return false;
  if (value === 1 || value === true) return true;
  throw new BossKillLeaderboardError("Database row field isBot is invalid.");
}

function requireUtcTimestamp(value: unknown): string {
  let timestamp: Date;
  if (value instanceof Date) {
    timestamp = value;
  } else if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z?$/u.exec(value);
    if (!match) throw new BossKillLeaderboardError("Database row field firstRecordedAt is invalid.");
    const normalized = `${match[1]}T${match[2]}.${(match[3] ?? "").padEnd(3, "0").slice(0, 3)}Z`;
    timestamp = new Date(normalized);
    if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== normalized) {
      throw new BossKillLeaderboardError("Database row field firstRecordedAt is invalid.");
    }
  } else {
    throw new BossKillLeaderboardError("Database row field firstRecordedAt is invalid.");
  }
  if (!Number.isFinite(timestamp.getTime())) {
    throw new BossKillLeaderboardError("Database row field firstRecordedAt is invalid.");
  }
  return timestamp.toISOString();
}

export function mapBossKillLeaderboardRows(rows: unknown): BossKillLeaderboardEntry[] {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) {
    throw new BossKillLeaderboardError("Boss kill leaderboard database result is invalid.");
  }
  return rows.map((value) => {
    if (!isRecord(value)) throw new BossKillLeaderboardError("Boss kill leaderboard contains an invalid row.");
    const raceId = requireInteger(value, "raceId", 0, 255);
    const classId = requireInteger(value, "classId", 0, 255);
    return {
      characterName: requireString(value, "characterName"),
      race: getRaceName(raceId),
      class: getClassName(classId),
      level: requireInteger(value, "level", 1, 255),
      accountLogin: value.accountLogin === null ? "Unknown account" : requireString(value, "accountLogin"),
      isBot: requireBotFlag(value.isBot),
      bossKills: requireSafeInteger(value.bossKills, "bossKills")
    };
  });
}

function isEmptyRow(row: Record<string, unknown>): boolean {
  if (row.characterName !== null) return false;
  for (const key of ["raceId", "classId", "level", "accountLogin", "isBot", "bossKills"] as const) {
    if (row[key] !== null) throw new BossKillLeaderboardError("Empty boss kill leaderboard row is malformed.");
  }
  return true;
}

export function mapBossKillQueryRows(rows: unknown): MappedBossKillRows {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) {
    throw new BossKillLeaderboardError("Boss kill leaderboard database result is invalid.");
  }
  const records = rows.map((value) => {
    if (!isRecord(value)) throw new BossKillLeaderboardError("Boss kill leaderboard contains an invalid row.");
    return value;
  });
  const first = records[0]!;
  if (requireSafeInteger(first.hasInvalidEvent, "hasInvalidEvent") !== 0) {
    throw new BossKillContractIntegrityError();
  }
  const firstRecordedAt = first.firstRecordedAt === null ? null : requireUtcTimestamp(first.firstRecordedAt);
  for (const record of records.slice(1)) {
    if (requireSafeInteger(record.hasInvalidEvent, "hasInvalidEvent") !== 0) {
      throw new BossKillContractIntegrityError();
    }
    const timestamp = record.firstRecordedAt === null ? null : requireUtcTimestamp(record.firstRecordedAt);
    if (timestamp !== firstRecordedAt) {
      throw new BossKillLeaderboardError("Boss kill coverage metadata is inconsistent.");
    }
  }
  if (isEmptyRow(first)) {
    if (records.length !== 1) throw new BossKillLeaderboardError("Empty boss kill leaderboard result is invalid.");
    return { coverage: { firstRecordedAt }, entries: [] };
  }
  if (firstRecordedAt === null) throw new BossKillLeaderboardError("Boss kill coverage metadata is inconsistent.");
  return { coverage: { firstRecordedAt }, entries: mapBossKillLeaderboardRows(records) };
}

export type QueryBossKillRows = (population: StatsPopulation) => Promise<unknown>;

export async function queryBossKillRows(population: StatsPopulation): Promise<unknown> {
  const { pool, config } = getStatsDatabase();
  const world = readStatsWorldDatabaseConfig();
  const query = buildBossKillLeaderboardQuery({ ...config, ...world }, population);
  const [rows] = await pool.execute({ sql: query.sql, values: [...query.values], timeout: QUERY_TIMEOUT_MS });
  return rows;
}

export class BossKillLeaderboardService {
  private readonly cache = new Map<StatsPopulation, { value: BossKillLeaderboardResponse; expiresAt: number }>();
  private readonly inFlight = new Map<StatsPopulation, Promise<BossKillLeaderboardResponse>>();

  constructor(
    private readonly queryRows: QueryBossKillRows = queryBossKillRows,
    private readonly now: () => number = Date.now
  ) {}

  async getLeaderboard(population: StatsPopulation): Promise<BossKillLeaderboardResponse> {
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

  private async refresh(population: StatsPopulation): Promise<BossKillLeaderboardResponse> {
    const mapped = mapBossKillQueryRows(await this.queryRows(population));
    const generatedAt = this.now();
    const response: BossKillLeaderboardResponse = {
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

const bossKillLeaderboardService = new BossKillLeaderboardService();

export function getBossKillLeaderboard(population: StatsPopulation): Promise<BossKillLeaderboardResponse> {
  return bossKillLeaderboardService.getLeaderboard(population);
}
