import type { RowDataPacket } from "mysql2";
import { AZEROTHCORE_SRP6_LENGTH, verifyAzerothCorePassword } from "./azerothcore-srp6.js";
import {
  getPortalDatabase,
  type PortalDatabaseConfig,
  validatePortalDatabaseIdentifier
} from "./portal-database.js";

const QUERY_TIMEOUT_MS = 8_000;
const DUMMY_SALT = Buffer.alloc(AZEROTHCORE_SRP6_LENGTH, 0x5a);
const DUMMY_VERIFIER = Buffer.alloc(AZEROTHCORE_SRP6_LENGTH, 0xa5);

export interface PortalAccount {
  accountId: number;
  username: string;
}

interface PortalAccountMaterial extends PortalAccount {
  salt: Buffer;
  verifier: Buffer;
  banned: boolean;
  hasTotp: boolean;
}

export interface PortalAccountQuery {
  sql: string;
  values: readonly [string];
}

export class PortalAuthenticationDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortalAuthenticationDataError";
  }
}

function qualified(database: string, table: string): string {
  return `\`${database}\`.\`${table}\``;
}

export function buildPortalAccountQuery(
  config: Pick<PortalDatabaseConfig, "authDatabase">,
  username: string
): PortalAccountQuery {
  const authDatabase = validatePortalDatabaseIdentifier(
    config.authDatabase,
    "PORTAL_AUTH_DATABASE"
  );
  const accounts = qualified(authDatabase, "account");
  const bans = qualified(authDatabase, "account_banned");

  return {
    sql: `SELECT
    a.id AS accountId,
    a.username AS username,
    a.salt AS salt,
    a.verifier AS verifier,
    CASE WHEN a.totp_secret IS NULL OR OCTET_LENGTH(a.totp_secret) = 0 THEN 0 ELSE 1 END AS hasTotp,
    EXISTS (
        SELECT 1
        FROM ${bans} b
        WHERE b.id = a.id
          AND b.active = 1
          AND (b.unbandate > UNIX_TIMESTAMP() OR b.unbandate = b.bandate)
    ) AS isBanned
FROM ${accounts} a
WHERE a.username = ?
LIMIT 2`,
    values: [username]
  };
}

function readSafeAccountId(value: unknown): number {
  const accountId = typeof value === "bigint" || typeof value === "string"
    ? Number(value)
    : value;
  if (typeof accountId !== "number" || !Number.isSafeInteger(accountId) || accountId < 1) {
    throw new PortalAuthenticationDataError("Authentication account ID is invalid.");
  }
  return accountId;
}

function readFlag(value: unknown, key: string): boolean {
  if (value === 0 || value === false || value === "0") {
    return false;
  }
  if (value === 1 || value === true || value === "1") {
    return true;
  }
  throw new PortalAuthenticationDataError(`Authentication field ${key} is invalid.`);
}

function readBinary(value: unknown, key: string): Buffer {
  if (!(value instanceof Uint8Array) || value.byteLength !== AZEROTHCORE_SRP6_LENGTH) {
    throw new PortalAuthenticationDataError(`Authentication field ${key} is invalid.`);
  }
  return Buffer.from(value);
}

export function mapPortalAccountRows(rows: unknown, requestedUsername: string): PortalAccountMaterial | undefined {
  if (!Array.isArray(rows) || rows.length > 1) {
    throw new PortalAuthenticationDataError("Authentication account result is invalid.");
  }
  if (rows.length === 0) {
    return undefined;
  }

  const row = rows[0];
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new PortalAuthenticationDataError("Authentication account row is invalid.");
  }
  const source = row as Record<string, unknown>;
  if (
    typeof source.username !== "string" ||
    source.username !== requestedUsername ||
    !/^[A-Z0-9_]{3,16}$/u.test(source.username)
  ) {
    throw new PortalAuthenticationDataError("Authentication account name is invalid.");
  }

  return {
    accountId: readSafeAccountId(source.accountId),
    username: source.username,
    salt: readBinary(source.salt, "salt"),
    verifier: readBinary(source.verifier, "verifier"),
    banned: readFlag(source.isBanned, "isBanned"),
    hasTotp: readFlag(source.hasTotp, "hasTotp")
  };
}

export type QueryPortalAccount = (username: string) => Promise<unknown>;

export async function queryPortalAccount(username: string): Promise<unknown> {
  const { pool, config } = getPortalDatabase();
  const query = buildPortalAccountQuery(config, username);
  const [rows] = await pool.execute<RowDataPacket[]>({
    sql: query.sql,
    values: [...query.values],
    timeout: QUERY_TIMEOUT_MS
  });
  return rows;
}

export class PortalAuthenticationService {
  constructor(private readonly queryAccount: QueryPortalAccount = queryPortalAccount) {}

  async authenticate(username: string, normalizedPassword: string): Promise<PortalAccount | undefined> {
    const account = mapPortalAccountRows(await this.queryAccount(username), username);
    const material = account ?? {
      accountId: 1,
      username,
      salt: DUMMY_SALT,
      verifier: DUMMY_VERIFIER,
      banned: false,
      hasTotp: false
    };
    const passwordMatches = verifyAzerothCorePassword(
      material.username,
      normalizedPassword,
      material.salt,
      material.verifier
    );

    if (!account || !passwordMatches || account.banned || account.hasTotp) {
      return undefined;
    }
    return { accountId: account.accountId, username: account.username };
  }
}

export const portalAuthenticationService = new PortalAuthenticationService();
