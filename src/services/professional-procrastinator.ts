import { getClassName, getRaceName } from "../domain/wotlk.js";
import { buildAccountExclusionClause, type AccountVisibilityScope } from "./account-visibility.js";
import type { StatsPopulation } from "./death-leaderboard.js";
import { getStatsDatabase, type StatsDatabaseConfig, validateStatsDatabaseIdentifier } from "./stats-database.js";

const CACHE_TTL_MS = 60_000;
const QUERY_TIMEOUT_MS = 8_000;
const MAX_ROWS = 25;

export type { StatsPopulation };
export type ProfessionalProcrastinatorType = "Player" | "Bot";

export interface ProfessionalProcrastinatorEntry {
  characterName: string;
  race: string;
  class: string;
  level: number;
  accountLogin: string;
  type: ProfessionalProcrastinatorType;
  fromLevel: number;
  toLevel: number;
  startedAt: string;
  endedAt: string;
  durationMilliseconds: number;
}

export interface ProfessionalProcrastinatorResponse {
  generatedAt: string;
  population: StatsPopulation;
  coverage: { firstRecordedAt: string | null };
  count: number;
  entries: ProfessionalProcrastinatorEntry[];
}

export interface ProfessionalProcrastinatorQuery {
  contractSql: string;
  contractValues: readonly string[];
  sql: string;
  values: readonly (string | number)[];
}

export type LevelIntervalRanking = "shortest" | "longest";

export class ProfessionalProcrastinatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfessionalProcrastinatorError";
  }
}

export class ProfessionalProcrastinatorContractIntegrityError extends ProfessionalProcrastinatorError {
  constructor() {
    super("Professional Procrastinator provider contract integrity check failed.");
    this.name = "ProfessionalProcrastinatorContractIntegrityError";
  }
}

function qualified(database: string, table: string): string {
  return `\`${database}\`.\`${table}\``;
}

export function buildLevelIntervalQuery(
  config: Pick<StatsDatabaseConfig, "charactersDatabase" | "authDatabase">,
  population: StatsPopulation,
  visibility: AccountVisibilityScope,
  ranking: LevelIntervalRanking
): ProfessionalProcrastinatorQuery {
  const charactersDatabase = validateStatsDatabaseIdentifier(config.charactersDatabase, "STATS_CHARACTERS_DATABASE");
  const authDatabase = validateStatsDatabaseIdentifier(config.authDatabase, "STATS_AUTH_DATABASE");
  const events = qualified(charactersDatabase, "mod_player_stats_events");
  const characters = qualified(charactersDatabase, "characters");
  const accounts = qualified(authDatabase, "account");
  const populationClause = population === "players"
    ? "      AND actor_is_bot = 0 AND previousActorIsBot = 0\n"
    : "";
  const exclusion = buildAccountExclusionClause(visibility, "c.account", "      ");
  const personalOrder = ranking === "shortest"
    ? "durationMilliseconds ASC, toLevel DESC, endedAt ASC, endEventId ASC"
    : "durationMilliseconds DESC, endedAt ASC, endEventId ASC";
  const globalOrder = ranking === "shortest"
    ? "durationMilliseconds ASC, toLevel DESC, endedAt ASC, characterName ASC, actor_guid ASC, actor_is_bot ASC"
    : "durationMilliseconds DESC, endedAt ASC, characterName ASC, actor_guid ASC, actor_is_bot ASC";

  return {
    contractSql: `WITH ordered_level_events AS (
    SELECT
        e.id,
        e.event_time,
        e.realm_id,
        e.actor_account_id,
        e.actor_guid,
        e.actor_is_bot,
        e.source,
        e.target_type,
        e.target_entry,
        e.target_guid,
        e.target_is_bot,
        e.value1,
        e.value2,
        LAG(e.id) OVER (
            PARTITION BY e.realm_id, e.actor_guid
            ORDER BY e.event_time, e.id
        ) AS previousEventId
    FROM ${events} e
    WHERE e.event_type = ?
)
SELECT
    MIN(event_time) AS firstRecordedAt,
    COALESCE(MAX(
        id IS NULL OR id = 0
        OR event_time IS NULL
        OR realm_id IS NULL OR realm_id = 0
        OR actor_account_id IS NULL OR actor_account_id = 0
        OR actor_guid IS NULL OR actor_guid = 0
        OR actor_is_bot IS NULL OR actor_is_bot NOT IN (0, 1)
        OR source IS NULL OR source <> ?
        OR target_type IS NULL OR target_type <> 0
        OR target_entry IS NULL OR target_entry <> 0
        OR target_guid IS NULL OR target_guid <> 0
        OR target_is_bot IS NULL OR target_is_bot <> 0
        OR value1 IS NULL OR value1 < 1 OR value1 > 80
        OR value2 IS NULL OR value2 < 1 OR value2 > 80
        OR (previousEventId IS NOT NULL AND previousEventId >= id)
    ), 0) AS hasInvalidEvent
FROM ordered_level_events`,
    contractValues: ["LEVEL_CHANGE", "level"],
    sql: `WITH ordered_events AS (
    SELECT
        e.id AS endEventId,
        e.realm_id,
        e.actor_guid,
        e.actor_account_id,
        e.actor_is_bot,
        e.event_time AS endedAt,
        e.value1,
        e.value2,
        LAG(e.id) OVER event_order AS previousEventId,
        LAG(e.actor_account_id) OVER event_order AS previousActorAccountId,
        LAG(e.actor_is_bot) OVER event_order AS previousActorIsBot,
        LAG(e.event_time) OVER event_order AS startedAt,
        LAG(e.value1) OVER event_order AS previousValue1,
        LAG(e.value2) OVER event_order AS previousValue2
    FROM ${events} e
    WHERE e.event_type = ?
    WINDOW event_order AS (
        PARTITION BY e.realm_id, e.actor_guid
        ORDER BY e.event_time, e.id
    )
),
candidate_intervals AS (
    SELECT
        *,
        previousValue2 AS fromLevel,
        value2 AS toLevel,
        TIMESTAMPDIFF(MICROSECOND, startedAt, endedAt) DIV 1000 AS durationMilliseconds
    FROM ordered_events
    WHERE previousEventId IS NOT NULL
      AND previousEventId < endEventId
      AND previousActorAccountId = actor_account_id
      AND previousActorIsBot = actor_is_bot
      AND previousValue2 = previousValue1 + 1
      AND value2 = value1 + 1
      AND previousValue2 = value1
      AND startedAt <= endedAt
${populationClause}),
eligible_intervals AS (
    SELECT
        ci.*,
        c.name AS characterName,
        c.race AS raceId,
        c.class AS classId,
        c.level,
        a.username AS accountLogin
    FROM candidate_intervals ci
    JOIN ${characters} c
      ON c.guid = ci.actor_guid
     AND c.account = ci.actor_account_id
    LEFT JOIN ${accounts} a ON a.id = c.account
    WHERE c.deleteDate IS NULL
${exclusion.clause}),
personal_records AS (
    SELECT
        eligible_intervals.*,
        ROW_NUMBER() OVER (
            PARTITION BY realm_id, actor_guid, actor_is_bot
            ORDER BY ${personalOrder}
        ) AS personalRank
    FROM eligible_intervals
),
leaders AS (
    SELECT *
    FROM personal_records
    WHERE personalRank = 1
    ORDER BY ${globalOrder}
    LIMIT 25
)
SELECT
    characterName, raceId, classId, level, accountLogin,
    actor_is_bot AS isBot, fromLevel, toLevel, startedAt, endedAt,
    durationMilliseconds
FROM leaders
ORDER BY ${globalOrder}`,
    values: ["LEVEL_CHANGE", ...exclusion.values]
  };
}

export function buildProfessionalProcrastinatorQuery(
  config: Pick<StatsDatabaseConfig, "charactersDatabase" | "authDatabase">,
  population: StatsPopulation,
  visibility: AccountVisibilityScope
): ProfessionalProcrastinatorQuery {
  return buildLevelIntervalQuery(config, population, visibility, "longest");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown, key: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  const parsed = typeof value === "bigint" ? Number(value) :
    typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ProfessionalProcrastinatorError(`Database row field ${key} is invalid.`);
  }
  return parsed;
}

function text(value: unknown, key: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ProfessionalProcrastinatorError(`Database row field ${key} is invalid.`);
  }
  return value;
}

function timestamp(value: unknown, key: string): string {
  let parsed: Date;
  if (value instanceof Date) parsed = value;
  else if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z?$/u.exec(value);
    if (!match) throw new ProfessionalProcrastinatorError(`Database row field ${key} is invalid.`);
    const normalized = `${match[1]}T${match[2]}.${(match[3] ?? "").padEnd(3, "0").slice(0, 3)}Z`;
    parsed = new Date(normalized);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== normalized) {
      throw new ProfessionalProcrastinatorError(`Database row field ${key} is invalid.`);
    }
  } else throw new ProfessionalProcrastinatorError(`Database row field ${key} is invalid.`);
  if (!Number.isFinite(parsed.getTime())) throw new ProfessionalProcrastinatorError(`Database row field ${key} is invalid.`);
  return parsed.toISOString();
}

function controlType(value: unknown): ProfessionalProcrastinatorType {
  if (value === 0 || value === false) return "Player";
  if (value === 1 || value === true) return "Bot";
  throw new ProfessionalProcrastinatorError("Database row field isBot is invalid.");
}

export function mapProfessionalProcrastinatorRows(
  contractRows: unknown,
  leaderboardRows: unknown
): { coverage: { firstRecordedAt: string | null }; entries: ProfessionalProcrastinatorEntry[] } {
  if (!Array.isArray(contractRows) || contractRows.length !== 1 || !record(contractRows[0])) {
    throw new ProfessionalProcrastinatorError("Professional Procrastinator contract result is invalid.");
  }
  if (!Array.isArray(leaderboardRows) || leaderboardRows.length > MAX_ROWS) {
    throw new ProfessionalProcrastinatorError("Professional Procrastinator database result is invalid.");
  }
  const contract = contractRows[0];
  if (integer(contract.hasInvalidEvent, "hasInvalidEvent") !== 0) {
    throw new ProfessionalProcrastinatorContractIntegrityError();
  }
  const firstRecordedAt = contract.firstRecordedAt === null ? null : timestamp(contract.firstRecordedAt, "firstRecordedAt");
  const entries = leaderboardRows.map((value) => {
    if (!record(value)) throw new ProfessionalProcrastinatorError("Professional Procrastinator row is invalid.");
    const fromLevel = integer(value.fromLevel, "fromLevel", 1, 79);
    const toLevel = integer(value.toLevel, "toLevel", 2, 80);
    const startedAt = timestamp(value.startedAt, "startedAt");
    const endedAt = timestamp(value.endedAt, "endedAt");
    const durationMilliseconds = integer(value.durationMilliseconds, "durationMilliseconds");
    const actualDuration = new Date(endedAt).getTime() - new Date(startedAt).getTime();
    if (toLevel !== fromLevel + 1 || actualDuration < 0 || actualDuration !== durationMilliseconds) {
      throw new ProfessionalProcrastinatorError("Level interval is inconsistent.");
    }
    return {
      characterName: text(value.characterName, "characterName"),
      race: getRaceName(integer(value.raceId, "raceId", 0, 255)),
      class: getClassName(integer(value.classId, "classId", 0, 255)),
      level: integer(value.level, "level", 1, 255),
      accountLogin: value.accountLogin === null ? "Unknown account" : text(value.accountLogin, "accountLogin"),
      type: controlType(value.isBot), fromLevel, toLevel, startedAt, endedAt, durationMilliseconds
    };
  });
  if (entries.length > 0 && firstRecordedAt === null) {
    throw new ProfessionalProcrastinatorError("Coverage metadata is inconsistent.");
  }
  return { coverage: { firstRecordedAt }, entries };
}

export type QueryProfessionalProcrastinatorRows = (
  population: StatsPopulation,
  visibility: AccountVisibilityScope
) => Promise<{ contractRows: unknown; leaderboardRows: unknown }>;

export async function queryProfessionalProcrastinatorRows(
  population: StatsPopulation,
  visibility: AccountVisibilityScope
): Promise<{ contractRows: unknown; leaderboardRows: unknown }> {
  const { pool, config } = getStatsDatabase();
  const query = buildProfessionalProcrastinatorQuery(config, population, visibility);
  const [contract, leaderboard] = await Promise.all([
    pool.execute({ sql: query.contractSql, values: [...query.contractValues], timeout: QUERY_TIMEOUT_MS }),
    pool.execute({ sql: query.sql, values: [...query.values], timeout: QUERY_TIMEOUT_MS })
  ]);
  return { contractRows: contract[0], leaderboardRows: leaderboard[0] };
}

export class ProfessionalProcrastinatorService {
  private readonly cache = new Map<string, { value: ProfessionalProcrastinatorResponse; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<ProfessionalProcrastinatorResponse>>();

  constructor(
    private readonly queryRows: QueryProfessionalProcrastinatorRows = queryProfessionalProcrastinatorRows,
    private readonly now: () => number = Date.now
  ) {}

  async getLeaderboard(population: StatsPopulation, visibility: AccountVisibilityScope): Promise<ProfessionalProcrastinatorResponse> {
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

  private async refresh(population: StatsPopulation, visibility: AccountVisibilityScope, cacheKey: string) {
    const rows = await this.queryRows(population, visibility);
    const mapped = mapProfessionalProcrastinatorRows(rows.contractRows, rows.leaderboardRows);
    const generatedAt = this.now();
    const response: ProfessionalProcrastinatorResponse = {
      generatedAt: new Date(generatedAt).toISOString(), population,
      coverage: mapped.coverage, count: mapped.entries.length, entries: mapped.entries
    };
    this.cache.set(cacheKey, { value: response, expiresAt: generatedAt + CACHE_TTL_MS });
    return response;
  }
}

const service = new ProfessionalProcrastinatorService();

export function getProfessionalProcrastinator(population: StatsPopulation, visibility: AccountVisibilityScope) {
  return service.getLeaderboard(population, visibility);
}
