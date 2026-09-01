import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPortalDatabase, validatePortalDatabaseIdentifier } from "./portal-database.js";

const QUERY_TIMEOUT_MS = 8_000;
const LOCK_TIMEOUT_SECONDS = 2;
const STALE_BATCH_SIZE = 20;

export type CharacterLevelBoostStatus = "pending" | "applied" | "failed" | "unknown";

export interface CharacterLevelBoostRecord {
  requestId: string;
  boostKey: string;
  accountId: number;
  characterGuid: number;
  characterName: string;
  startingLevel: number;
  targetLevel: number;
  resultingLevel?: number;
  status: CharacterLevelBoostStatus;
  createdAt: Date;
}

export interface ReserveCharacterLevelBoostInput {
  requestId: string;
  boostKey: string;
  accountId: number;
  characterGuid: number;
  characterName: string;
  startingLevel: number;
  targetLevel: number;
}

export type ReserveCharacterLevelBoostResult =
  | { kind: "inserted"; record: CharacterLevelBoostRecord }
  | { kind: "existing"; record: CharacterLevelBoostRecord }
  | { kind: "conflict" };

export class CharacterLevelBoostRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CharacterLevelBoostRepositoryError";
  }
}

function requestsTable(): string {
  const database = validatePortalDatabaseIdentifier(
    getPortalDatabase().config.stateDatabase,
    "PORTAL_STATE_DATABASE"
  );
  return `\`${database}\`.\`character_level_boost_requests\``;
}

function readInteger(value: unknown, key: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  const parsed = typeof value === "string" || typeof value === "bigint" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new CharacterLevelBoostRepositoryError(`Character level boost ${key} is invalid.`);
  }
  return parsed;
}

function readDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new CharacterLevelBoostRepositoryError("Character level boost timestamp is invalid.");
  }
  return date;
}

function mapRecord(row: unknown): CharacterLevelBoostRecord {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new CharacterLevelBoostRepositoryError("Character level boost request row is invalid.");
  }
  const source = row as Record<string, unknown>;
  if (
    typeof source.requestId !== "string" || typeof source.boostKey !== "string" ||
    typeof source.characterName !== "string" ||
    !["pending", "applied", "failed", "unknown"].includes(String(source.status))
  ) {
    throw new CharacterLevelBoostRepositoryError("Character level boost request material is invalid.");
  }
  const resultingLevel = source.resultingLevel === null || source.resultingLevel === undefined
    ? undefined
    : readInteger(source.resultingLevel, "resulting level", 1, 80);
  return {
    requestId: source.requestId,
    boostKey: source.boostKey,
    accountId: readInteger(source.accountId, "account ID"),
    characterGuid: readInteger(source.characterGuid, "character GUID", 1, 0xffff_ffff),
    characterName: source.characterName,
    startingLevel: readInteger(source.startingLevel, "starting level", 1, 79),
    targetLevel: readInteger(source.targetLevel, "target level", 2, 80),
    resultingLevel,
    status: source.status as CharacterLevelBoostStatus,
    createdAt: readDate(source.createdAt)
  };
}

function selectColumns(): string {
  return `request_id AS requestId, boost_key AS boostKey, account_id AS accountId,
       character_guid AS characterGuid, character_name AS characterName,
       starting_level AS startingLevel, target_level AS targetLevel,
       resulting_level AS resultingLevel, status, created_at AS createdAt`;
}

async function acquireLock(connection: PoolConnection, key: string): Promise<void> {
  const [rows] = await connection.execute<RowDataPacket[]>({
    sql: "SELECT GET_LOCK(?, ?) AS acquired",
    values: [key, LOCK_TIMEOUT_SECONDS],
    timeout: QUERY_TIMEOUT_MS
  });
  if (readInteger(rows[0]?.acquired, "lock") !== 1) {
    throw new CharacterLevelBoostRepositoryError("Character level boost lock is unavailable.");
  }
}

async function releaseLock(connection: PoolConnection, key: string): Promise<void> {
  try {
    await connection.execute({ sql: "SELECT RELEASE_LOCK(?) AS released", values: [key], timeout: QUERY_TIMEOUT_MS });
  } catch {
    // Releasing the connection also releases its named locks.
  }
}

export class CharacterLevelBoostRepository {
  async withCharacterLock<T>(characterGuid: number, operation: () => Promise<T>): Promise<T> {
    const { pool } = getPortalDatabase();
    const connection = await pool.getConnection();
    const key = `wow_portal_level_char_${characterGuid}`;
    try {
      await acquireLock(connection, key);
      return await operation();
    } finally {
      await releaseLock(connection, key);
      connection.release();
    }
  }

  async find(requestId: string): Promise<CharacterLevelBoostRecord | undefined> {
    const { pool } = getPortalDatabase();
    const [rows] = await pool.execute<RowDataPacket[]>({
      sql: `SELECT ${selectColumns()} FROM ${requestsTable()} WHERE request_id = ? LIMIT 2`,
      values: [requestId],
      timeout: QUERY_TIMEOUT_MS
    });
    if (rows.length > 1) {
      throw new CharacterLevelBoostRepositoryError("Character level boost request ID is ambiguous.");
    }
    return rows.length === 1 ? mapRecord(rows[0]) : undefined;
  }

  async reserve(input: ReserveCharacterLevelBoostInput): Promise<ReserveCharacterLevelBoostResult> {
    const { pool } = getPortalDatabase();
    const table = requestsTable();
    const connection = await pool.getConnection();
    const key = `wow_portal_level_req_${input.requestId}`;
    let transactionOpen = false;
    try {
      await acquireLock(connection, key);
      await connection.beginTransaction();
      transactionOpen = true;
      const [rows] = await connection.execute<RowDataPacket[]>({
        sql: `SELECT ${selectColumns()} FROM ${table} WHERE request_id = ? FOR UPDATE`,
        values: [input.requestId],
        timeout: QUERY_TIMEOUT_MS
      });
      if (rows.length > 1) {
        throw new CharacterLevelBoostRepositoryError("Character level boost request ID is ambiguous.");
      }
      if (rows.length === 1) {
        const record = mapRecord(rows[0]);
        await connection.commit();
        transactionOpen = false;
        if (
          record.boostKey !== input.boostKey || record.accountId !== input.accountId ||
          record.characterGuid !== input.characterGuid || record.targetLevel !== input.targetLevel
        ) return { kind: "conflict" };
        return { kind: "existing", record };
      }
      await connection.execute<ResultSetHeader>({
        sql: `INSERT INTO ${table} (
  request_id, boost_key, account_id, character_guid, character_name,
  starting_level, target_level, resulting_level, status, result_category,
  created_at, updated_at, completed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'pending', 'reserved', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), NULL)`,
        values: [input.requestId, input.boostKey, input.accountId, input.characterGuid,
          input.characterName, input.startingLevel, input.targetLevel],
        timeout: QUERY_TIMEOUT_MS
      });
      await connection.commit();
      transactionOpen = false;
      return { kind: "inserted", record: { ...input, status: "pending", createdAt: new Date() } };
    } catch (error) {
      if (transactionOpen) {
        try { await connection.rollback(); } catch { /* Preserve the original failure. */ }
      }
      throw error;
    } finally {
      await releaseLock(connection, key);
      connection.release();
    }
  }

  async mark(
    requestId: string,
    status: Exclude<CharacterLevelBoostStatus, "pending">,
    resultCategory: string,
    resultingLevel?: number
  ): Promise<void> {
    if (!/^[a-z_]{1,32}$/u.test(resultCategory)) {
      throw new CharacterLevelBoostRepositoryError("Character level boost result category is invalid.");
    }
    if (resultingLevel !== undefined) readInteger(resultingLevel, "resulting level", 1, 80);
    const { pool } = getPortalDatabase();
    const [result] = await pool.execute<ResultSetHeader>({
      sql: `UPDATE ${requestsTable()}
SET status = ?, result_category = ?, resulting_level = ?,
    updated_at = UTC_TIMESTAMP(3), completed_at = UTC_TIMESTAMP(3)
WHERE request_id = ? AND status IN ('pending', 'unknown')`,
      values: [status, resultCategory, resultingLevel ?? null, requestId],
      timeout: QUERY_TIMEOUT_MS
    });
    if (result.affectedRows > 1) {
      throw new CharacterLevelBoostRepositoryError("Character level boost update affected an invalid number of rows.");
    }
  }

  async findStalePending(accountId: number, staleAfterMs: number): Promise<CharacterLevelBoostRecord[]> {
    const { pool } = getPortalDatabase();
    const [rows] = await pool.execute<RowDataPacket[]>({
      sql: `SELECT ${selectColumns()} FROM ${requestsTable()}
WHERE account_id = ? AND status = 'pending'
  AND created_at < TIMESTAMPADD(MICROSECOND, -?, UTC_TIMESTAMP(3))
ORDER BY created_at LIMIT ${STALE_BATCH_SIZE}`,
      values: [accountId, staleAfterMs * 1_000],
      timeout: QUERY_TIMEOUT_MS
    });
    return rows.map(mapRecord);
  }
}

export const characterLevelBoostRepository = new CharacterLevelBoostRepository();
