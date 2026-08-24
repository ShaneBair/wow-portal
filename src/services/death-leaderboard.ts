import { getClassName, getRaceName } from "../domain/wotlk.js";
import {
  getStatsDatabase,
  type StatsDatabaseConfig,
  validateStatsDatabaseIdentifier
} from "./stats-database.js";

const CREATURE_DEATH_EVENT = "PLAYER_KILLED_BY_CREATURE";
const PVP_KILL_EVENT = "PVP_KILL";
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

export interface DeathLeaderboardResponse {
  generatedAt: string;
  population: StatsPopulation;
  count: number;
  entries: DeathLeaderboardEntry[];
}

export interface DeathLeaderboardQuery {
  sql: string;
  values: readonly [string, string];
}

export class DeathLeaderboardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeathLeaderboardError";
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
  const charactersTable = qualified(charactersDatabase, "characters");
  const accountsTable = qualified(authDatabase, "account");
  const populationClause = population === "players" ? "    WHERE is_bot = 0\n" : "";

  return {
    sql: `WITH recorded_deaths AS (
    SELECT e.actor_guid AS character_guid, e.actor_is_bot AS is_bot
    FROM ${eventsTable} e
    WHERE e.event_type = ?

    UNION ALL

    SELECT e.target_guid AS character_guid, e.target_is_bot AS is_bot
    FROM ${eventsTable} e
    WHERE e.event_type = ?
),
death_totals AS (
    SELECT character_guid, is_bot, COUNT(*) AS deaths
    FROM recorded_deaths
${populationClause}    GROUP BY character_guid, is_bot
)
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
LIMIT 25`,
    values: [CREATURE_DEATH_EVENT, PVP_KILL_EVENT]
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

function requireDeaths(value: unknown): number {
  let deaths: number;

  if (typeof value === "bigint") {
    deaths = Number(value);
  } else if (typeof value === "string" && /^\d+$/u.test(value)) {
    deaths = Number(value);
  } else if (typeof value === "number") {
    deaths = value;
  } else {
    throw new DeathLeaderboardError("Database row field deaths is invalid.");
  }

  if (!Number.isSafeInteger(deaths) || deaths < 0) {
    throw new DeathLeaderboardError("Database row field deaths is invalid.");
  }

  return deaths;
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
    const entries = mapDeathLeaderboardRows(await this.queryRows(population));
    const generatedAt = this.now();
    const response: DeathLeaderboardResponse = {
      generatedAt: new Date(generatedAt).toISOString(),
      population,
      count: entries.length,
      entries
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
