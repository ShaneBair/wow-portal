import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPortalDatabase, validatePortalDatabaseIdentifier } from "./portal-database.js";

const QUERY_TIMEOUT_MS = 8_000;
const LOCK_TIMEOUT_SECONDS = 2;
const STALE_BATCH_SIZE = 20;

export type ItemDeliveryStatus = "pending" | "sent" | "failed" | "unknown";
export type ItemDeliveryMailMatch = "exact" | "absent" | "ambiguous";

export interface ItemDeliveryRecord {
  requestId: string;
  boostKey: string;
  accountId: number;
  characterGuid: number;
  characterName: string;
  itemEntry: number;
  itemName: string;
  itemQuantity: number;
  itemStackSize: number;
  status: ItemDeliveryStatus;
  createdAt: Date;
}

export interface ReserveItemDeliveryInput {
  requestId: string;
  boostKey: string;
  accountId: number;
  characterGuid: number;
  characterName: string;
  itemEntry: number;
  itemName: string;
  itemQuantity: number;
  itemStackSize: number;
}

export type ReserveItemDeliveryResult =
  | { kind: "inserted"; record: ItemDeliveryRecord }
  | { kind: "existing"; record: ItemDeliveryRecord }
  | { kind: "conflict" };

export class ItemDeliveryRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ItemDeliveryRepositoryError";
  }
}

function qualified(database: string, table: string): string {
  return `\`${database}\`.\`${table}\``;
}

function tableNames() {
  const { config } = getPortalDatabase();
  const stateDatabase = validatePortalDatabaseIdentifier(config.stateDatabase, "PORTAL_STATE_DATABASE");
  const charactersDatabase = validatePortalDatabaseIdentifier(
    config.charactersDatabase,
    "PORTAL_CHARACTERS_DATABASE"
  );
  return {
    requests: qualified(stateDatabase, "item_delivery_requests"),
    mail: qualified(charactersDatabase, "mail"),
    mailItems: qualified(charactersDatabase, "mail_items"),
    itemInstances: qualified(charactersDatabase, "item_instance")
  };
}

function readInteger(value: unknown, key: string, minimum = 0): number {
  const parsed = typeof value === "string" || typeof value === "bigint" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new ItemDeliveryRepositoryError(`Item delivery ${key} is invalid.`);
  }
  return parsed;
}

function readDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new ItemDeliveryRepositoryError("Item delivery creation timestamp is invalid.");
  }
  return date;
}

function mapRecord(row: unknown): ItemDeliveryRecord {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new ItemDeliveryRepositoryError("Item delivery request row is invalid.");
  }
  const source = row as Record<string, unknown>;
  if (
    typeof source.requestId !== "string" || typeof source.boostKey !== "string" ||
    typeof source.characterName !== "string" || typeof source.itemName !== "string" ||
    !["pending", "sent", "failed", "unknown"].includes(String(source.status))
  ) {
    throw new ItemDeliveryRepositoryError("Item delivery request material is invalid.");
  }
  return {
    requestId: source.requestId,
    boostKey: source.boostKey,
    accountId: readInteger(source.accountId, "account ID", 1),
    characterGuid: readInteger(source.characterGuid, "character GUID", 1),
    characterName: source.characterName,
    itemEntry: readInteger(source.itemEntry, "item entry", 1),
    itemName: source.itemName,
    itemQuantity: readInteger(source.itemQuantity, "item quantity", 1),
    itemStackSize: readInteger(source.itemStackSize, "item stack size", 1),
    status: source.status as ItemDeliveryStatus,
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
       item_name AS itemName,
       item_quantity AS itemQuantity,
       item_stack_size AS itemStackSize,
       status,
       created_at AS createdAt`;
}

function requestLockKey(requestId: string): string {
  return `wow_portal_item_${requestId}`;
}

async function acquireLock(connection: PoolConnection, key: string): Promise<void> {
  const [rows] = await connection.execute<RowDataPacket[]>({
    sql: "SELECT GET_LOCK(?, ?) AS acquired",
    values: [key, LOCK_TIMEOUT_SECONDS],
    timeout: QUERY_TIMEOUT_MS
  });
  if (readInteger(rows[0]?.acquired, "request lock") !== 1) {
    throw new ItemDeliveryRepositoryError("Item delivery request lock is unavailable.");
  }
}

async function releaseLock(connection: PoolConnection, key: string): Promise<void> {
  try {
    await connection.execute({ sql: "SELECT RELEASE_LOCK(?) AS released", values: [key], timeout: QUERY_TIMEOUT_MS });
  } catch {
    // Releasing the connection also releases its named locks.
  }
}

export class ItemDeliveryRepository {
  async reserve(input: ReserveItemDeliveryInput): Promise<ReserveItemDeliveryResult> {
    const { pool } = getPortalDatabase();
    const { requests } = tableNames();
    const connection = await pool.getConnection();
    const requestLock = requestLockKey(input.requestId);
    let transactionOpen = false;
    try {
      await acquireLock(connection, requestLock);
      await connection.beginTransaction();
      transactionOpen = true;
      const [existingRows] = await connection.execute<RowDataPacket[]>({
        sql: `SELECT ${selectColumns()} FROM ${requests} WHERE request_id = ? FOR UPDATE`,
        values: [input.requestId],
        timeout: QUERY_TIMEOUT_MS
      });
      if (existingRows.length > 1) throw new ItemDeliveryRepositoryError("Item delivery request ID is ambiguous.");
      if (existingRows.length === 1) {
        const record = mapRecord(existingRows[0]);
        await connection.commit();
        transactionOpen = false;
        if (
          record.boostKey !== input.boostKey || record.accountId !== input.accountId ||
          record.characterGuid !== input.characterGuid || record.itemEntry !== input.itemEntry ||
          record.itemQuantity !== input.itemQuantity
        ) return { kind: "conflict" };
        return { kind: "existing", record };
      }

      await connection.execute<ResultSetHeader>({
        sql: `INSERT INTO ${requests} (
  request_id, boost_key, account_id, character_guid, character_name,
  item_entry, item_name, item_quantity, item_stack_size, status, result_category,
  created_at, updated_at, completed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'reserved', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), NULL)`,
        values: [
          input.requestId, input.boostKey, input.accountId, input.characterGuid, input.characterName,
          input.itemEntry, input.itemName, input.itemQuantity, input.itemStackSize
        ],
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
      await releaseLock(connection, requestLock);
      connection.release();
    }
  }

  async mark(
    requestId: string,
    status: Exclude<ItemDeliveryStatus, "pending">,
    resultCategory: string
  ): Promise<void> {
    if (!/^[a-z_]{1,32}$/u.test(resultCategory)) {
      throw new ItemDeliveryRepositoryError("Item delivery result category is invalid.");
    }
    const { pool } = getPortalDatabase();
    const { requests } = tableNames();
    const [result] = await pool.execute<ResultSetHeader>({
      sql: `UPDATE ${requests}
SET status = ?, result_category = ?, updated_at = UTC_TIMESTAMP(3), completed_at = UTC_TIMESTAMP(3)
WHERE request_id = ? AND status IN ('pending', 'unknown')`,
      values: [status, resultCategory, requestId],
      timeout: QUERY_TIMEOUT_MS
    });
    if (result.affectedRows > 1) {
      throw new ItemDeliveryRepositoryError("Item delivery update affected an invalid number of rows.");
    }
  }

  async inspectMatchingMail(
    record: ItemDeliveryRecord,
    subject: string,
    body: string
  ): Promise<ItemDeliveryMailMatch> {
    const { pool } = getPortalDatabase();
    const { mail, mailItems, itemInstances } = tableNames();
    const [rows] = await pool.execute<RowDataPacket[]>({
      sql: `SELECT
    m.id AS mailId,
    COUNT(mi.item_guid) AS attachmentCount,
    COALESCE(SUM(CASE WHEN ii.itemEntry = ? THEN ii.count ELSE 0 END), 0) AS matchingQuantity,
    COALESCE(SUM(CASE WHEN ii.itemEntry <> ? OR ii.itemEntry IS NULL THEN 1 ELSE 0 END), 0) AS unexpectedCount
FROM ${mail} m
LEFT JOIN ${mailItems} mi ON mi.mail_id = m.id
LEFT JOIN ${itemInstances} ii ON ii.guid = mi.item_guid
WHERE m.receiver = ? AND m.subject = ? AND m.body = ? AND m.has_items = 1 AND m.money = 0
GROUP BY m.id ORDER BY m.id LIMIT 2`,
      values: [record.itemEntry, record.itemEntry, record.characterGuid, subject, body],
      timeout: QUERY_TIMEOUT_MS
    });
    if (rows.length === 0) return "absent";
    if (rows.length !== 1) return "ambiguous";
    const attachmentCount = readInteger(rows[0]?.attachmentCount, "mail attachment count");
    const matchingQuantity = readInteger(rows[0]?.matchingQuantity, "matching item quantity");
    const unexpectedCount = readInteger(rows[0]?.unexpectedCount, "unexpected attachment count");
    const expectedStacks = Math.ceil(record.itemQuantity / record.itemStackSize);
    return attachmentCount === expectedStacks && matchingQuantity === record.itemQuantity && unexpectedCount === 0
      ? "exact"
      : "ambiguous";
  }

  async findStalePending(accountId: number, staleAfterMs: number): Promise<ItemDeliveryRecord[]> {
    const { pool } = getPortalDatabase();
    const { requests } = tableNames();
    const [rows] = await pool.execute<RowDataPacket[]>({
      sql: `SELECT ${selectColumns()} FROM ${requests}
WHERE account_id = ? AND status = 'pending'
  AND created_at < TIMESTAMPADD(MICROSECOND, -?, UTC_TIMESTAMP(3))
ORDER BY created_at LIMIT ${STALE_BATCH_SIZE}`,
      values: [accountId, staleAfterMs * 1_000],
      timeout: QUERY_TIMEOUT_MS
    });
    return rows.map(mapRecord);
  }
}

export const itemDeliveryRepository = new ItemDeliveryRepository();
