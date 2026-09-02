import { randomBytes } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import {
  AZEROTHCORE_SRP6_LENGTH,
  calculateAzerothCoreVerifier,
  upperBasicLatin,
  verifyAzerothCorePassword
} from "./azerothcore-srp6.js";
import {
  getPortalDatabase,
  type PortalDatabaseConfig,
  validatePortalDatabaseIdentifier
} from "./portal-database.js";

const QUERY_TIMEOUT_MS = 8_000;

export interface AccountPasswordInput {
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
}

export type AccountPasswordFailureKind =
  | "incorrect-current"
  | "conflict"
  | "ambiguous-update"
  | "unavailable";

export class AccountPasswordChangeError extends Error {
  constructor(readonly kind: AccountPasswordFailureKind) {
    super(kind);
    this.name = "AccountPasswordChangeError";
  }
}

export interface AccountPasswordMaterial {
  username: string;
  salt: Buffer;
  verifier: Buffer;
}

export interface AccountPasswordQueries {
  selectSql: string;
  selectValues: readonly [number];
  updateSql: string;
}

function qualified(database: string, table: string): string {
  return `\`${database}\`.\`${table}\``;
}

export function buildAccountPasswordQueries(
  config: Pick<PortalDatabaseConfig, "authDatabase">,
  accountId: number
): AccountPasswordQueries {
  const authDatabase = validatePortalDatabaseIdentifier(
    config.authDatabase,
    "PORTAL_AUTH_DATABASE"
  );
  const account = qualified(authDatabase, "account");
  return {
    selectSql: `SELECT username, salt, verifier FROM ${account} WHERE id = ? LIMIT 2`,
    selectValues: [accountId],
    updateSql: `UPDATE ${account}
SET salt = ?, verifier = ?
WHERE id = ? AND salt = ? AND verifier = ?`
  };
}

function binary(value: unknown): Buffer | undefined {
  return value instanceof Uint8Array && value.byteLength === AZEROTHCORE_SRP6_LENGTH
    ? Buffer.from(value)
    : undefined;
}

export function mapAccountPasswordMaterial(
  rows: unknown,
  expectedUsername: string
): AccountPasswordMaterial {
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new AccountPasswordChangeError("unavailable");
  }
  const row = rows[0];
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new AccountPasswordChangeError("unavailable");
  }
  const source = row as Record<string, unknown>;
  const salt = binary(source.salt);
  const verifier = binary(source.verifier);
  if (source.username !== expectedUsername || !salt || !verifier) {
    throw new AccountPasswordChangeError("unavailable");
  }
  return { username: expectedUsername, salt, verifier };
}

export type ReadAccountPassword = (accountId: number) => Promise<unknown>;
export type UpdateAccountPassword = (
  accountId: number,
  salt: Buffer,
  verifier: Buffer,
  previousSalt: Buffer,
  previousVerifier: Buffer
) => Promise<number>;

async function readAccountPassword(accountId: number): Promise<unknown> {
  const { pool, config } = getPortalDatabase();
  const query = buildAccountPasswordQueries(config, accountId);
  const [rows] = await pool.execute<RowDataPacket[]>({
    sql: query.selectSql,
    values: [...query.selectValues],
    timeout: QUERY_TIMEOUT_MS
  });
  return rows;
}

async function updateAccountPassword(
  accountId: number,
  salt: Buffer,
  verifier: Buffer,
  previousSalt: Buffer,
  previousVerifier: Buffer
): Promise<number> {
  const { pool, config } = getPortalDatabase();
  const query = buildAccountPasswordQueries(config, accountId);
  const [result] = await pool.execute<ResultSetHeader>({
    sql: query.updateSql,
    values: [salt, verifier, accountId, previousSalt, previousVerifier],
    timeout: QUERY_TIMEOUT_MS
  });
  return result.affectedRows;
}

export class AccountPasswordService {
  constructor(
    private readonly readMaterial: ReadAccountPassword = readAccountPassword,
    private readonly updateMaterial: UpdateAccountPassword = updateAccountPassword,
    private readonly makeRandomBytes: (size: number) => Buffer = randomBytes
  ) {}

  async change(accountId: number, sessionUsername: string, input: AccountPasswordInput): Promise<void> {
    let material: AccountPasswordMaterial;
    try {
      material = mapAccountPasswordMaterial(await this.readMaterial(accountId), sessionUsername);
    } catch (error) {
      if (error instanceof AccountPasswordChangeError) throw error;
      throw new AccountPasswordChangeError("unavailable");
    }

    if (!verifyAzerothCorePassword(
      material.username,
      input.currentPassword,
      material.salt,
      material.verifier
    )) {
      throw new AccountPasswordChangeError("incorrect-current");
    }

    const salt = this.makeRandomBytes(AZEROTHCORE_SRP6_LENGTH);
    if (salt.byteLength !== AZEROTHCORE_SRP6_LENGTH) {
      throw new AccountPasswordChangeError("unavailable");
    }
    const verifier = calculateAzerothCoreVerifier(
      upperBasicLatin(material.username),
      upperBasicLatin(input.newPassword),
      salt
    );

    let affectedRows: number;
    try {
      affectedRows = await this.updateMaterial(
        accountId,
        salt,
        verifier,
        material.salt,
        material.verifier
      );
    } catch {
      throw new AccountPasswordChangeError("ambiguous-update");
    }
    if (affectedRows === 0) throw new AccountPasswordChangeError("conflict");
    if (affectedRows !== 1) throw new AccountPasswordChangeError("unavailable");
  }
}

export const accountPasswordService = new AccountPasswordService();
