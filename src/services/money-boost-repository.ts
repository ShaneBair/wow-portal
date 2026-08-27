import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket
} from "mysql2/promise";
import {
  getPortalDatabase,
  type PortalDatabaseConfig,
  validatePortalDatabaseIdentifier
} from "./portal-database.js";

const QUERY_TIMEOUT_MS = 8_000;
const LOCK_TIMEOUT_SECONDS = 2;
const STALE_BATCH_SIZE = 20;

export type MoneyBoostStatus = "pending" | "sent" | "failed" | "unknown";

export interface MoneyBoostRecord {
  requestId: string;
  accountId: number;
  characterGuid: number;
  characterName: string;
  gold: number;
  copper: number;
  status: MoneyBoostStatus;
  createdAt: Date;
}

export interface ReserveMoneyBoostInput {
  requestId: string;
  accountId: number;
  characterGuid: number;
  characterName: string;
  gold: number;
  copper: number;
  dailyGoldLimit: number;
  dailyRequestLimit: number;
}

export type ReserveMoneyBoostResult =
  | { kind: "inserted"; record: MoneyBoostRecord }
  | { kind: "existing"; record: MoneyBoostRecord }
  | { kind: "conflict" }
  | { kind: "limit" };

export class MoneyBoostRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyBoostRepositoryError";
  }
}

function qualified(database: string, table: string): string {
  return `\`${database}\`.\`${table}\``;
}

function tableNames(config: Pick<PortalDatabaseConfig, "charactersDatabase" | "stateDatabase">) {
  const stateDatabase = validatePortalDatabaseIdentifier(config.stateDatabase, "PORTAL_STATE_DATABASE");
  const charactersDatabase = validatePortalDatabaseIdentifier(
    config.charactersDatabase,
    "PORTAL_CHARACTERS_DATABASE"
  );
  return {
    requests: qualified(stateDatabase, "money_boost_requests"),
    mail: qualified(charactersDatabase, "mail")
  };
}

function readInteger(value: unknown, key: string): number {
  const parsed = typeof value === "string" || typeof value === "bigint" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new MoneyBoostRepositoryError(`Money boost ${key} is invalid.`);
  }
  return parsed;
}

function readDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new MoneyBoostRepositoryError("Money boost creation timestamp is invalid.");
  }
  return date;
}

function mapRecord(row: unknown): MoneyBoostRecord {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new MoneyBoostRepositoryError("Money boost request row is invalid.");
  }
  const source = row as Record<string, unknown>;
  if (
    typeof source.requestId !== "string" ||
    typeof source.characterName !== "string" ||
    !["pending", "sent", "failed", "unknown"].includes(String(source.status))
  ) {
    throw new MoneyBoostRepositoryError("Money boost request material is invalid.");
  }
  return {
    requestId: source.requestId,
    accountId: readInteger(source.accountId, "account ID"),
    characterGuid: readInteger(source.characterGuid, "character GUID"),
    characterName: source.characterName,
    gold: readInteger(source.gold, "gold"),
    copper: readInteger(source.copper, "copper"),
    status: source.status as MoneyBoostStatus,
    createdAt: readDate(source.createdAt)
  };
}

function selectColumns(): string {
  return `request_id AS requestId,
       account_id AS accountId,
       character_guid AS characterGuid,
       character_name AS characterName,
       gold,
       copper,
       status,
       created_at AS createdAt`;
}

function lockKey(accountId: number): string {
  return `wow_portal_money_${accountId}`;
}

function requestLockKey(requestId: string): string {
  return `wow_portal_request_${requestId}`;
}

async function acquireLock(connection: PoolConnection, key: string): Promise<void> {
  const [rows] = await connection.execute<RowDataPacket[]>({
    sql: "SELECT GET_LOCK(?, ?) AS acquired",
    values: [key, LOCK_TIMEOUT_SECONDS],
    timeout: QUERY_TIMEOUT_MS
  });
  if (readInteger(rows[0]?.acquired, "named lock") !== 1) {
    throw new MoneyBoostRepositoryError("Money boost lock is unavailable.");
  }
}

async function releaseAccountLock(connection: PoolConnection, key: string): Promise<void> {
  try {
    await connection.execute({
      sql: "SELECT RELEASE_LOCK(?) AS released",
      values: [key],
      timeout: QUERY_TIMEOUT_MS
    });
  } catch {
    // Releasing the connection also releases its named locks.
  }
}

export class MoneyBoostRepository {
  async reserve(input: ReserveMoneyBoostInput): Promise<ReserveMoneyBoostResult> {
    const { pool, config } = getPortalDatabase();
    const { requests } = tableNames(config);
    const connection = await pool.getConnection();
    const accountLock = lockKey(input.accountId);
    const requestLock = requestLockKey(input.requestId);
    let transactionOpen = false;
    try {
      // Lock every request in the same order: UUID first, account second. This
      // serializes both duplicate UUIDs across accounts and distinct requests
      // that share one account's daily limits without a lock-order deadlock.
      await acquireLock(connection, requestLock);
      await acquireLock(connection, accountLock);

      await connection.beginTransaction();
      transactionOpen = true;
      const [existingRows] = await connection.execute<RowDataPacket[]>({
        sql: `SELECT ${selectColumns()}
FROM ${requests}
WHERE request_id = ?
FOR UPDATE`,
        values: [input.requestId],
        timeout: QUERY_TIMEOUT_MS
      });
      if (existingRows.length > 1) {
        throw new MoneyBoostRepositoryError("Money boost request ID is ambiguous.");
      }
      if (existingRows.length === 1) {
        const record = mapRecord(existingRows[0]);
        await connection.commit();
        transactionOpen = false;
        if (
          record.accountId !== input.accountId ||
          record.characterGuid !== input.characterGuid ||
          record.gold !== input.gold
        ) {
          return { kind: "conflict" };
        }
        return { kind: "existing", record };
      }

      const [dailyRows] = await connection.execute<RowDataPacket[]>({
        sql: `SELECT COUNT(*) AS requestCount, COALESCE(SUM(gold), 0) AS goldTotal
FROM ${requests}
WHERE account_id = ?
  AND created_at >= UTC_DATE()
  AND created_at < TIMESTAMPADD(DAY, 1, UTC_DATE())
  AND status IN ('pending', 'sent', 'unknown')`,
        values: [input.accountId],
        timeout: QUERY_TIMEOUT_MS
      });
      const requestCount = readInteger(dailyRows[0]?.requestCount, "daily request count");
      const goldTotal = readInteger(dailyRows[0]?.goldTotal, "daily gold total");
      if (
        requestCount >= input.dailyRequestLimit ||
        goldTotal + input.gold > input.dailyGoldLimit
      ) {
        await connection.rollback();
        transactionOpen = false;
        return { kind: "limit" };
      }

      await connection.execute<ResultSetHeader>({
        sql: `INSERT INTO ${requests} (
  request_id, account_id, character_guid, character_name, gold, copper,
  status, result_category, created_at, updated_at, completed_at
) VALUES (?, ?, ?, ?, ?, ?, 'pending', 'reserved', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), NULL)`,
        values: [
          input.requestId,
          input.accountId,
          input.characterGuid,
          input.characterName,
          input.gold,
          input.copper
        ],
        timeout: QUERY_TIMEOUT_MS
      });
      await connection.commit();
      transactionOpen = false;
      return {
        kind: "inserted",
        record: {
          requestId: input.requestId,
          accountId: input.accountId,
          characterGuid: input.characterGuid,
          characterName: input.characterName,
          gold: input.gold,
          copper: input.copper,
          status: "pending",
          createdAt: new Date()
        }
      };
    } catch (error) {
      if (transactionOpen) {
        try {
          await connection.rollback();
        } catch {
          // Preserve the original failure.
        }
      }
      throw error;
    } finally {
      await releaseAccountLock(connection, accountLock);
      await releaseAccountLock(connection, requestLock);
      connection.release();
    }
  }

  async mark(
    requestId: string,
    status: Exclude<MoneyBoostStatus, "pending">,
    resultCategory: string
  ): Promise<void> {
    if (!/^[a-z_]{1,32}$/u.test(resultCategory)) {
      throw new MoneyBoostRepositoryError("Money boost result category is invalid.");
    }
    const { pool, config } = getPortalDatabase();
    const { requests } = tableNames(config);
    const [result] = await pool.execute<ResultSetHeader>({
      sql: `UPDATE ${requests}
SET status = ?, result_category = ?, updated_at = UTC_TIMESTAMP(3), completed_at = UTC_TIMESTAMP(3)
WHERE request_id = ?
  AND status IN ('pending', 'unknown')`,
      values: [status, resultCategory, requestId],
      timeout: QUERY_TIMEOUT_MS
    });
    if (result.affectedRows > 1) {
      throw new MoneyBoostRepositoryError("Money boost update affected an invalid number of rows.");
    }
  }

  async countMatchingMail(
    record: MoneyBoostRecord,
    subject: string,
    body: string
  ): Promise<number> {
    const { pool, config } = getPortalDatabase();
    const { mail } = tableNames(config);
    const [rows] = await pool.execute<RowDataPacket[]>({
      sql: `SELECT id
FROM ${mail}
WHERE receiver = ?
  AND subject = ?
  AND body = ?
  AND money = ?
LIMIT 2`,
      values: [record.characterGuid, subject, body, record.copper],
      timeout: QUERY_TIMEOUT_MS
    });
    return rows.length;
  }

  async findStalePending(accountId: number, staleAfterMs: number): Promise<MoneyBoostRecord[]> {
    const { pool, config } = getPortalDatabase();
    const { requests } = tableNames(config);
    const [rows] = await pool.execute<RowDataPacket[]>({
      sql: `SELECT ${selectColumns()}
FROM ${requests}
WHERE account_id = ?
  AND status = 'pending'
  AND created_at < TIMESTAMPADD(MICROSECOND, -?, UTC_TIMESTAMP(3))
ORDER BY created_at
LIMIT ${STALE_BATCH_SIZE}`,
      values: [accountId, staleAfterMs * 1_000],
      timeout: QUERY_TIMEOUT_MS
    });
    return rows.map(mapRecord);
  }
}

export const moneyBoostRepository = new MoneyBoostRepository();
