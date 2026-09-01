import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  getPortalDatabase,
  type PortalDatabaseConfig,
  validatePortalDatabaseIdentifier
} from "./portal-database.js";

const QUERY_TIMEOUT_MS = 8_000;
const LOCK_TIMEOUT_SECONDS = 2;
const STALE_BATCH_SIZE = 20;

export type ArcaneTomeBoostStatus = "pending" | "sent" | "failed" | "unknown";

export interface ArcaneTomeBoostRecord {
  requestId: string;
  boostKey: string;
  accountId: number;
  characterGuid: number;
  characterName: string;
  itemEntry: number;
  itemCount: number;
  status: ArcaneTomeBoostStatus;
  createdAt: Date;
}

export interface ReserveArcaneTomeBoostInput {
  requestId: string;
  boostKey: string;
  accountId: number;
  characterGuid: number;
  characterName: string;
  itemEntry: number;
  itemCount: number;
}

export type ReserveArcaneTomeBoostResult =
  | { kind: "inserted"; record: ArcaneTomeBoostRecord }
  | { kind: "existing"; record: ArcaneTomeBoostRecord }
  | { kind: "conflict" };

export type ArcaneTomeMailMatch = "exact" | "absent" | "ambiguous";

export class ArcaneTomeBoostRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArcaneTomeBoostRepositoryError";
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
    requests: qualified(stateDatabase, "arcane_tome_boost_requests"),
    mail: qualified(charactersDatabase, "mail"),
    mailItems: qualified(charactersDatabase, "mail_items"),
    itemInstances: qualified(charactersDatabase, "item_instance")
  };
}

function readInteger(value: unknown, key: string): number {
  const parsed = typeof value === "string" || typeof value === "bigint" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ArcaneTomeBoostRepositoryError(`Arcane Tome boost ${key} is invalid.`);
  }
  return parsed;
}

function readDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new ArcaneTomeBoostRepositoryError("Arcane Tome boost creation timestamp is invalid.");
  }
  return date;
}

function mapRecord(row: unknown): ArcaneTomeBoostRecord {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new ArcaneTomeBoostRepositoryError("Arcane Tome boost request row is invalid.");
  }
  const source = row as Record<string, unknown>;
  if (
    typeof source.requestId !== "string" ||
    typeof source.boostKey !== "string" ||
    typeof source.characterName !== "string" ||
    !["pending", "sent", "failed", "unknown"].includes(String(source.status))
  ) {
    throw new ArcaneTomeBoostRepositoryError("Arcane Tome boost request material is invalid.");
  }
  return {
    requestId: source.requestId,
    boostKey: source.boostKey,
    accountId: readInteger(source.accountId, "account ID"),
    characterGuid: readInteger(source.characterGuid, "character GUID"),
    characterName: source.characterName,
    itemEntry: readInteger(source.itemEntry, "item entry"),
    itemCount: readInteger(source.itemCount, "item count"),
    status: source.status as ArcaneTomeBoostStatus,
    createdAt: readDate(source.createdAt)
  };
}

function selectColumns(): string {
  return `request_id AS requestId,
       boost_key AS boostKey,
       account_id AS accountId,
       character_guid AS characterGuid,
       character_name AS characterName,
       item_entry AS itemEntry,
       item_count AS itemCount,
       status,
       created_at AS createdAt`;
}

function requestLockKey(requestId: string): string {
  return `wow_portal_tome_${requestId}`;
}

async function acquireLock(connection: PoolConnection, key: string): Promise<void> {
  const [rows] = await connection.execute<RowDataPacket[]>({
    sql: "SELECT GET_LOCK(?, ?) AS acquired",
    values: [key, LOCK_TIMEOUT_SECONDS],
    timeout: QUERY_TIMEOUT_MS
  });
  if (readInteger(rows[0]?.acquired, "request lock") !== 1) {
    throw new ArcaneTomeBoostRepositoryError("Arcane Tome boost request lock is unavailable.");
  }
}

async function releaseLock(connection: PoolConnection, key: string): Promise<void> {
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

export class ArcaneTomeBoostRepository {
  async reserve(input: ReserveArcaneTomeBoostInput): Promise<ReserveArcaneTomeBoostResult> {
    const { pool, config } = getPortalDatabase();
    const { requests } = tableNames(config);
    const connection = await pool.getConnection();
    const requestLock = requestLockKey(input.requestId);
    let transactionOpen = false;
    try {
      await acquireLock(connection, requestLock);
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
        throw new ArcaneTomeBoostRepositoryError("Arcane Tome boost request ID is ambiguous.");
      }
      if (existingRows.length === 1) {
        const record = mapRecord(existingRows[0]);
        await connection.commit();
        transactionOpen = false;
        if (
          record.boostKey !== input.boostKey ||
          record.accountId !== input.accountId ||
          record.characterGuid !== input.characterGuid ||
          record.itemEntry !== input.itemEntry ||
          record.itemCount !== input.itemCount
        ) {
          return { kind: "conflict" };
        }
        return { kind: "existing", record };
      }

      await connection.execute<ResultSetHeader>({
        sql: `INSERT INTO ${requests} (
  request_id, boost_key, account_id, character_guid, character_name,
  item_entry, item_count, status, result_category,
  created_at, updated_at, completed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'reserved', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), NULL)`,
        values: [
          input.requestId,
          input.boostKey,
          input.accountId,
          input.characterGuid,
          input.characterName,
          input.itemEntry,
          input.itemCount
        ],
        timeout: QUERY_TIMEOUT_MS
      });
      await connection.commit();
      transactionOpen = false;
      return {
        kind: "inserted",
        record: {
          requestId: input.requestId,
          boostKey: input.boostKey,
          accountId: input.accountId,
          characterGuid: input.characterGuid,
          characterName: input.characterName,
          itemEntry: input.itemEntry,
          itemCount: input.itemCount,
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
      await releaseLock(connection, requestLock);
      connection.release();
    }
  }

  async mark(
    requestId: string,
    status: Exclude<ArcaneTomeBoostStatus, "pending">,
    resultCategory: string
  ): Promise<void> {
    if (!/^[a-z_]{1,32}$/u.test(resultCategory)) {
      throw new ArcaneTomeBoostRepositoryError("Arcane Tome boost result category is invalid.");
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
      throw new ArcaneTomeBoostRepositoryError("Arcane Tome boost update affected an invalid number of rows.");
    }
  }

  async inspectMatchingMail(
    record: ArcaneTomeBoostRecord,
    subject: string,
    body: string
  ): Promise<ArcaneTomeMailMatch> {
    const { pool, config } = getPortalDatabase();
    const { mail, mailItems, itemInstances } = tableNames(config);
    const [rows] = await pool.execute<RowDataPacket[]>({
      sql: `SELECT
    m.id AS mailId,
    COUNT(mi.item_guid) AS attachmentCount,
    COALESCE(SUM(CASE
        WHEN ii.itemEntry = ? AND ii.count = 1 THEN 1
        ELSE 0
    END), 0) AS matchingAttachmentCount
FROM ${mail} m
LEFT JOIN ${mailItems} mi ON mi.mail_id = m.id
LEFT JOIN ${itemInstances} ii ON ii.guid = mi.item_guid
WHERE m.receiver = ?
  AND m.subject = ?
  AND m.body = ?
  AND m.has_items = 1
  AND m.money = 0
GROUP BY m.id
ORDER BY m.id
LIMIT 2`,
      values: [record.itemEntry, record.characterGuid, subject, body],
      timeout: QUERY_TIMEOUT_MS
    });
    if (rows.length === 0) return "absent";
    if (rows.length !== 1) return "ambiguous";
    const attachmentCount = readInteger(rows[0]?.attachmentCount, "mail attachment count");
    const matchingCount = readInteger(rows[0]?.matchingAttachmentCount, "matching attachment count");
    return attachmentCount === 1 && matchingCount === 1 ? "exact" : "ambiguous";
  }

  async findStalePending(accountId: number, staleAfterMs: number): Promise<ArcaneTomeBoostRecord[]> {
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

export const arcaneTomeBoostRepository = new ArcaneTomeBoostRepository();
