import { getClassName, getRaceName } from "../domain/wotlk.js";
import {
  buildAccountExclusionClause,
  type AccountVisibilityScope
} from "./account-visibility.js";
import {
  getStatsDatabase,
  type StatsDatabaseConfig,
  validateStatsDatabaseIdentifier
} from "./stats-database.js";

const PVP_KILL_EVENT = "PVP_KILL";
const PLAYER_TARGET_TYPE = 1;
const PLAYER_SOURCE = "player";
const HUMAN_ACTOR_FLAG = 0;
const BOT_TARGET_FLAG = 1;
const CACHE_TTL_MS = 60_000;
const QUERY_TIMEOUT_MS = 8_000;
const MAX_ROWS = 25;

export type BotWranglerPopulation = "human-vs-bot";

export interface BotWranglerEntry {
  characterName: string;
  race: string;
  class: string;
  level: number;
  accountLogin: string;
  botKills: number;
  uniqueBotVictims: number;
  lastBotKillAt: string;
}

export interface BotWranglerResponse {
  generatedAt: string;
  population: BotWranglerPopulation;
  coverage: { firstRecordedAt: string | null };
  count: number;
  entries: BotWranglerEntry[];
}

export interface BotWranglerQuery {
  sql: string;
  values: readonly (string | number)[];
}

export interface MappedBotWranglerRows {
  coverage: { firstRecordedAt: string | null };
  entries: BotWranglerEntry[];
}

export class BotWranglerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BotWranglerError";
  }
}

export class BotWranglerContractIntegrityError extends BotWranglerError {
  constructor() {
    super("PvP kill provider contract integrity check failed.");
    this.name = "BotWranglerContractIntegrityError";
  }
}

export function isBotWranglerMatch(actorIsBot: 0 | 1, targetIsBot: 0 | 1): boolean {
  return actorIsBot === HUMAN_ACTOR_FLAG && targetIsBot === BOT_TARGET_FLAG;
}

function qualified(database: string, table: string): string {
  return `\`${database}\`.\`${table}\``;
}

export function buildBotWranglerQuery(
  config: Pick<StatsDatabaseConfig, "charactersDatabase" | "authDatabase">,
  visibility: AccountVisibilityScope
): BotWranglerQuery {
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
  const killerExclusion = buildAccountExclusionClause(
    visibility,
    "e.actor_account_id",
    "      "
  );
  const victimExclusion = buildAccountExclusionClause(visibility, "e.value2", "      ");

  return {
    sql: `WITH pvp_contract AS (
    SELECT
        MIN(e.event_time) AS firstRecordedAt,
        COALESCE(MAX(
            e.event_time IS NULL
            OR e.target_type IS NULL OR e.target_type <> ?
            OR e.target_entry IS NULL OR e.target_entry <> 0
            OR e.target_guid IS NULL OR e.target_guid = 0
            OR e.target_is_bot IS NULL OR e.target_is_bot NOT IN (0, 1)
            OR e.value1 IS NULL OR e.value1 <= 0
            OR e.value2 IS NULL OR e.value2 <= 0
            OR e.source IS NULL OR e.source <> ?
            OR e.realm_id IS NULL OR e.realm_id = 0
            OR e.actor_account_id IS NULL OR e.actor_account_id = 0
            OR e.actor_guid IS NULL OR e.actor_guid = 0
            OR e.actor_is_bot IS NULL OR e.actor_is_bot NOT IN (0, 1)
        ), 0) AS hasInvalidEvent
    FROM ${eventsTable} e
    WHERE e.event_type = ?
),
eligible_killers AS (
    SELECT
        e.realm_id,
        e.actor_guid,
        c.name AS characterName,
        c.race AS raceId,
        c.class AS classId,
        c.level,
        a.username AS accountLogin,
        COUNT(*) AS botKills,
        COUNT(DISTINCT e.target_guid) AS uniqueBotVictims,
        MAX(e.event_time) AS lastBotKillAt
    FROM ${eventsTable} e
    JOIN ${charactersTable} c
      ON c.guid = e.actor_guid
     AND c.account = e.actor_account_id
    LEFT JOIN ${accountsTable} a ON a.id = c.account
    WHERE e.event_type = ?
      AND e.actor_is_bot = ?
      AND e.target_is_bot = ?
      AND c.deleteDate IS NULL
${killerExclusion.clause}${victimExclusion.clause}    GROUP BY
        e.realm_id, e.actor_guid, c.name, c.race, c.class, c.level, a.username
    ORDER BY botKills DESC, uniqueBotVictims DESC, c.name ASC, e.actor_guid ASC
    LIMIT 25
)
SELECT
    pc.firstRecordedAt,
    pc.hasInvalidEvent,
    k.characterName,
    k.raceId,
    k.classId,
    k.level,
    k.accountLogin,
    k.botKills,
    k.uniqueBotVictims,
    k.lastBotKillAt
FROM pvp_contract pc
LEFT JOIN eligible_killers k ON TRUE
ORDER BY k.botKills DESC, k.uniqueBotVictims DESC, k.characterName ASC, k.actor_guid ASC`,
    values: [
      PLAYER_TARGET_TYPE,
      PLAYER_SOURCE,
      PVP_KILL_EVENT,
      PVP_KILL_EVENT,
      HUMAN_ACTOR_FLAG,
      BOT_TARGET_FLAG,
      ...killerExclusion.values,
      ...victimExclusion.values
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
  ) throw new BotWranglerError(`Database row field ${key} is invalid.`);
  return parsed;
}

function requireString(value: unknown, key: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > 128 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) throw new BotWranglerError(`Database row field ${key} is invalid.`);
  return value;
}

function requireUtcTimestamp(value: unknown, key: string): string {
  let timestamp: Date;
  if (value instanceof Date) {
    timestamp = value;
  } else if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z?$/u.exec(value);
    if (!match) throw new BotWranglerError(`Database row field ${key} is invalid.`);
    const normalized = `${match[1]}T${match[2]}.${(match[3] ?? "").padEnd(3, "0").slice(0, 3)}Z`;
    timestamp = new Date(normalized);
    if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== normalized) {
      throw new BotWranglerError(`Database row field ${key} is invalid.`);
    }
  } else {
    throw new BotWranglerError(`Database row field ${key} is invalid.`);
  }
  if (!Number.isFinite(timestamp.getTime())) {
    throw new BotWranglerError(`Database row field ${key} is invalid.`);
  }
  return timestamp.toISOString();
}

function isEmptyRow(row: Record<string, unknown>): boolean {
  if (row.characterName !== null) return false;
  for (const key of [
    "raceId", "classId", "level", "accountLogin", "botKills", "uniqueBotVictims", "lastBotKillAt"
  ] as const) {
    if (row[key] !== null) throw new BotWranglerError("Empty Bot Wrangler row is malformed.");
  }
  return true;
}

export function mapBotWranglerQueryRows(rows: unknown): MappedBotWranglerRows {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) {
    throw new BotWranglerError("Bot Wrangler database result is invalid.");
  }
  const records = rows.map((row) => {
    if (!isRecord(row)) throw new BotWranglerError("Bot Wrangler contains an invalid row.");
    return row;
  });
  const first = records[0]!;
  if (requireSafeInteger(first.hasInvalidEvent, "hasInvalidEvent") !== 0) {
    throw new BotWranglerContractIntegrityError();
  }
  const firstRecordedAt = first.firstRecordedAt === null
    ? null
    : requireUtcTimestamp(first.firstRecordedAt, "firstRecordedAt");
  for (const row of records.slice(1)) {
    if (requireSafeInteger(row.hasInvalidEvent, "hasInvalidEvent") !== 0) {
      throw new BotWranglerContractIntegrityError();
    }
    const timestamp = row.firstRecordedAt === null
      ? null
      : requireUtcTimestamp(row.firstRecordedAt, "firstRecordedAt");
    if (timestamp !== firstRecordedAt) {
      throw new BotWranglerError("Bot Wrangler coverage metadata is inconsistent.");
    }
  }

  if (isEmptyRow(first)) {
    if (records.length !== 1) throw new BotWranglerError("Empty Bot Wrangler result is invalid.");
    return { coverage: { firstRecordedAt }, entries: [] };
  }
  if (firstRecordedAt === null) {
    throw new BotWranglerError("Bot Wrangler coverage metadata is inconsistent.");
  }

  const entries = records.map((row) => {
    const botKills = requireSafeInteger(row.botKills, "botKills", 1);
    const uniqueBotVictims = requireSafeInteger(row.uniqueBotVictims, "uniqueBotVictims", 1);
    if (uniqueBotVictims > botKills) {
      throw new BotWranglerError("Database row field uniqueBotVictims is invalid.");
    }
    const lastBotKillAt = requireUtcTimestamp(row.lastBotKillAt, "lastBotKillAt");
    if (Date.parse(lastBotKillAt) < Date.parse(firstRecordedAt)) {
      throw new BotWranglerError("Bot Wrangler kill timestamp is inconsistent.");
    }
    return {
      characterName: requireString(row.characterName, "characterName"),
      race: getRaceName(requireSafeInteger(row.raceId, "raceId", 0, 255)),
      class: getClassName(requireSafeInteger(row.classId, "classId", 0, 255)),
      level: requireSafeInteger(row.level, "level", 1, 255),
      accountLogin: row.accountLogin === null
        ? "Unknown account"
        : requireString(row.accountLogin, "accountLogin"),
      botKills,
      uniqueBotVictims,
      lastBotKillAt
    };
  });
  return { coverage: { firstRecordedAt }, entries };
}

export type QueryBotWranglerRows = (visibility: AccountVisibilityScope) => Promise<unknown>;

export async function queryBotWranglerRows(visibility: AccountVisibilityScope): Promise<unknown> {
  const { pool, config } = getStatsDatabase();
  const query = buildBotWranglerQuery(config, visibility);
  const [rows] = await pool.execute({
    sql: query.sql,
    values: [...query.values],
    timeout: QUERY_TIMEOUT_MS
  });
  return rows;
}

export class BotWranglerService {
  private readonly cache = new Map<string, { value: BotWranglerResponse; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<BotWranglerResponse>>();

  constructor(
    private readonly queryRows: QueryBotWranglerRows = queryBotWranglerRows,
    private readonly now: () => number = Date.now
  ) {}

  async getLeaderboard(visibility: AccountVisibilityScope): Promise<BotWranglerResponse> {
    const cacheKey = visibility.cacheKey;
    const now = this.now();
    const cached = this.cache.get(cacheKey);
    if (cached && now < cached.expiresAt) return cached.value;
    const active = this.inFlight.get(cacheKey);
    if (active) return active;
    const refresh = this.refresh(visibility, cacheKey);
    const tracked = refresh.finally(() => {
      if (this.inFlight.get(cacheKey) === tracked) this.inFlight.delete(cacheKey);
    });
    this.inFlight.set(cacheKey, tracked);
    return tracked;
  }

  private async refresh(
    visibility: AccountVisibilityScope,
    cacheKey: string
  ): Promise<BotWranglerResponse> {
    const mapped = mapBotWranglerQueryRows(await this.queryRows(visibility));
    const generatedAt = this.now();
    const response: BotWranglerResponse = {
      generatedAt: new Date(generatedAt).toISOString(),
      population: "human-vs-bot",
      coverage: mapped.coverage,
      count: mapped.entries.length,
      entries: mapped.entries
    };
    this.cache.set(cacheKey, { value: response, expiresAt: generatedAt + CACHE_TTL_MS });
    return response;
  }
}

const botWranglerService = new BotWranglerService();

export function getBotWrangler(visibility: AccountVisibilityScope): Promise<BotWranglerResponse> {
  return botWranglerService.getLeaderboard(visibility);
}
