import type { RowDataPacket } from "mysql2/promise";
import { getClassName, getRaceName, isKnownClass, isKnownRace } from "../domain/wotlk.js";
import {
  buildAccountExclusionClause,
  type AccountVisibilityScope
} from "./account-visibility.js";
import {
  getPortalDatabase,
  type PortalDatabaseConfig,
  validatePortalDatabaseIdentifier
} from "./portal-database.js";

const QUERY_TIMEOUT_MS = 8_000;
const QUERY_LIMIT = 2_501;
const MAX_CHARACTERS = 2_500;
const MAX_ACCOUNTS = 250;
const MAX_UINT32 = 0xffff_ffff;

export interface AccountRosterConfig {
  authDatabase: string;
  charactersDatabase: string;
  playerbotsDatabase: string;
}

export interface AccountRosterQuery {
  sql: string;
  values: readonly number[];
}

export interface RosterCharacter {
  characterName: string;
  level: number;
  class: string;
  race: string;
  totalPlayedSeconds: number;
}

export interface RosterAccount {
  accountLogin: string;
  characters: RosterCharacter[];
}

export interface AccountRosterResponse {
  generatedAt: string;
  accountCount: number;
  characterCount: number;
  accounts: RosterAccount[];
}

interface InternalRosterRow {
  accountId: number;
  accountLogin: string;
  characterGuid: number;
  characterName: string;
  level: number;
  raceId: number;
  classId: number;
  totalPlayedSeconds: number;
}

export class AccountRosterConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountRosterConfigurationError";
  }
}

export class AccountRosterDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountRosterDataError";
  }
}

function qualified(database: string, table: string): string {
  return `\`${database}\`.\`${table}\``;
}

export function readAccountRosterConfig(
  portalConfig: Pick<PortalDatabaseConfig, "authDatabase" | "charactersDatabase">,
  environment: NodeJS.ProcessEnv = process.env
): AccountRosterConfig {
  const playerbotsDatabase = environment.PORTAL_PLAYERBOTS_DATABASE?.trim();
  if (!playerbotsDatabase) {
    throw new AccountRosterConfigurationError("PORTAL_PLAYERBOTS_DATABASE is required.");
  }
  return {
    authDatabase: validatePortalDatabaseIdentifier(portalConfig.authDatabase, "PORTAL_AUTH_DATABASE"),
    charactersDatabase: validatePortalDatabaseIdentifier(
      portalConfig.charactersDatabase,
      "PORTAL_CHARACTERS_DATABASE"
    ),
    playerbotsDatabase: validatePortalDatabaseIdentifier(
      playerbotsDatabase,
      "PORTAL_PLAYERBOTS_DATABASE"
    )
  };
}

export function buildAccountRosterQuery(
  config: AccountRosterConfig,
  visibility: AccountVisibilityScope
): AccountRosterQuery {
  const auth = validatePortalDatabaseIdentifier(config.authDatabase, "PORTAL_AUTH_DATABASE");
  const characters = validatePortalDatabaseIdentifier(
    config.charactersDatabase,
    "PORTAL_CHARACTERS_DATABASE"
  );
  const playerbots = validatePortalDatabaseIdentifier(
    config.playerbotsDatabase,
    "PORTAL_PLAYERBOTS_DATABASE"
  );
  const exclusion = buildAccountExclusionClause(visibility, "a.id", "  ");
  return {
    sql: `SELECT
  a.id AS accountId,
  a.username AS accountLogin,
  c.guid AS characterGuid,
  c.name AS characterName,
  c.level,
  c.race AS raceId,
  c.class AS classId,
  c.totaltime AS totalPlayedSeconds
FROM ${qualified(auth, "account")} a
INNER JOIN ${qualified(characters, "characters")} c ON c.account = a.id
LEFT JOIN ${qualified(playerbots, "playerbots_account_type")} p ON p.account_id = a.id
WHERE p.account_id IS NULL
  AND c.deleteInfos_Name IS NULL
${exclusion.clause}ORDER BY LOWER(a.username), a.id, LOWER(c.name), c.guid
LIMIT ${QUERY_LIMIT}`,
    values: exclusion.values
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readInteger(value: unknown, key: string, minimum: number, maximum: number): number {
  const parsed = typeof value === "string" || typeof value === "bigint" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new AccountRosterDataError(`Roster ${key} is invalid.`);
  }
  return parsed;
}

function readText(value: unknown, key: string, maximumLength: number): string {
  if (
    typeof value !== "string" || value.trim().length === 0 ||
    Array.from(value).length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value)
  ) throw new AccountRosterDataError(`Roster ${key} is invalid.`);
  return value;
}

function mapRow(value: unknown): InternalRosterRow {
  if (!isRecord(value)) throw new AccountRosterDataError("Roster row is invalid.");
  return {
    accountId: readInteger(value.accountId, "account ID", 1, MAX_UINT32),
    accountLogin: readText(value.accountLogin, "account login", 16),
    characterGuid: readInteger(value.characterGuid, "character GUID", 1, MAX_UINT32),
    characterName: readText(value.characterName, "character name", 12),
    level: readInteger(value.level, "level", 1, 255),
    raceId: readInteger(value.raceId, "race ID", 0, 255),
    classId: readInteger(value.classId, "class ID", 0, 255),
    totalPlayedSeconds: readInteger(value.totalPlayedSeconds, "total played seconds", 0, MAX_UINT32)
  };
}

export function mapAccountRosterRows(rows: unknown, now: () => Date = () => new Date()): AccountRosterResponse {
  if (!Array.isArray(rows) || rows.length > MAX_CHARACTERS) {
    throw new AccountRosterDataError("Roster character bound was exceeded or the result was invalid.");
  }
  const mapped = rows.map(mapRow);
  const accountLogins = new Map<number, string>();
  const loginAccounts = new Map<string, number>();
  const characterGuids = new Set<number>();
  for (const row of mapped) {
    const existingLogin = accountLogins.get(row.accountId);
    const normalizedLogin = row.accountLogin.toLocaleLowerCase("en");
    const existingAccount = loginAccounts.get(normalizedLogin);
    if (
      (existingLogin !== undefined && existingLogin !== row.accountLogin) ||
      (existingAccount !== undefined && existingAccount !== row.accountId) ||
      characterGuids.has(row.characterGuid)
    ) throw new AccountRosterDataError("Roster rows are duplicated or inconsistent.");
    accountLogins.set(row.accountId, row.accountLogin);
    loginAccounts.set(normalizedLogin, row.accountId);
    characterGuids.add(row.characterGuid);
  }

  const grouped = new Map<number, InternalRosterRow[]>();
  for (const row of mapped) {
    const group = grouped.get(row.accountId) ?? [];
    group.push(row);
    grouped.set(row.accountId, group);
  }
  if (grouped.size > MAX_ACCOUNTS) {
    throw new AccountRosterDataError("Roster account bound was exceeded.");
  }
  const unknownRaces = new Set<number>();
  const unknownClasses = new Set<number>();
  const accountEntries = [...grouped.entries()].sort(([leftId, leftRows], [rightId, rightRows]) =>
    leftRows[0]!.accountLogin.localeCompare(rightRows[0]!.accountLogin, "en", { sensitivity: "base" }) ||
    leftId - rightId
  );
  const accounts = accountEntries.map(([_, accountRows]): RosterAccount => ({
    accountLogin: accountRows[0]!.accountLogin,
    characters: accountRows.sort((left, right) =>
      left.characterName.localeCompare(right.characterName, "en", { sensitivity: "base" }) ||
      left.characterGuid - right.characterGuid
    ).map((row) => {
      if (!isKnownRace(row.raceId)) unknownRaces.add(row.raceId);
      if (!isKnownClass(row.classId)) unknownClasses.add(row.classId);
      return {
        characterName: row.characterName,
        level: row.level,
        class: getClassName(row.classId),
        race: getRaceName(row.raceId),
        totalPlayedSeconds: row.totalPlayedSeconds
      };
    })
  }));
  for (const id of unknownRaces) console.warn(`Unknown WotLK race ID received from account roster: ${id}.`);
  for (const id of unknownClasses) console.warn(`Unknown WotLK class ID received from account roster: ${id}.`);
  const generatedAt = now().toISOString();
  return { generatedAt, accountCount: accounts.length, characterCount: mapped.length, accounts };
}

export type QueryAccountRosterRows = (visibility: AccountVisibilityScope) => Promise<unknown>;

export async function queryAccountRosterRows(visibility: AccountVisibilityScope): Promise<unknown> {
  const { pool, config } = getPortalDatabase();
  const query = buildAccountRosterQuery(readAccountRosterConfig(config), visibility);
  const [rows] = await pool.execute<RowDataPacket[]>({
    sql: query.sql,
    values: [...query.values],
    timeout: QUERY_TIMEOUT_MS
  });
  return rows;
}

export class AccountRosterService {
  constructor(
    private readonly queryRows: QueryAccountRosterRows = queryAccountRosterRows,
    private readonly now: () => Date = () => new Date()
  ) {}

  async getRoster(visibility: AccountVisibilityScope): Promise<AccountRosterResponse> {
    return mapAccountRosterRows(await this.queryRows(visibility), this.now);
  }
}

export const accountRosterService = new AccountRosterService();
