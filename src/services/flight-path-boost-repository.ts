import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPortalDatabase, validatePortalDatabaseIdentifier } from "./portal-database.js";

const QUERY_TIMEOUT_MS = 8_000;

export type FlightPathFaction = "alliance" | "horde";
export type FlightPathResult = "learned" | "already-known";

export interface LockedFlightPathCharacter {
  guid: number;
  accountId: number;
  name: string;
  raceId: number;
  classId: number;
  online: boolean;
  taxiMask: string;
}

export interface FlightPathBoostRecord {
  requestId: string;
  boostKey: string;
  accountId: number;
  characterGuid: number;
  characterName: string;
  faction: FlightPathFaction;
  classId: number;
  maskRevision: string;
  result: FlightPathResult;
  status: "applied";
}

export interface ApplyFlightPathInput {
  requestId: string;
  boostKey: string;
  accountId: number;
  characterGuid: number;
  maskRevision: string;
}

export interface FlightPathDecision {
  faction: FlightPathFaction;
  result: FlightPathResult;
  newMask: string;
}

export type ApplyFlightPathResult =
  | { kind: "applied"; record: FlightPathBoostRecord; created: boolean }
  | { kind: "conflict" }
  | { kind: "processing"; requestId: string }
  | { kind: "ownership" };

export interface FlightPathBoostRepositoryPort {
  apply(
    input: ApplyFlightPathInput,
    decide: (character: LockedFlightPathCharacter) => FlightPathDecision
  ): Promise<ApplyFlightPathResult>;
}

export class FlightPathBoostRepositoryError extends Error {
  constructor(message: string) { super(message); this.name = "FlightPathBoostRepositoryError"; }
}

export class FlightPathCharacterConflictError extends FlightPathBoostRepositoryError {
  constructor() { super("Flight path character update conflicted."); this.name = "FlightPathCharacterConflictError"; }
}

function qualified(database: string, table: string): string { return `\`${database}\`.\`${table}\``; }

function readInteger(value: unknown, key: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  const parsed = typeof value === "string" || typeof value === "bigint" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new FlightPathBoostRepositoryError(`Flight path ${key} is invalid.`);
  }
  return parsed;
}

function mapRecord(row: unknown): FlightPathBoostRecord {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new FlightPathBoostRepositoryError("Flight path request row is invalid.");
  }
  const value = row as Record<string, unknown>;
  if (
    typeof value.requestId !== "string" || typeof value.boostKey !== "string" ||
    typeof value.characterName !== "string" || !["alliance", "horde"].includes(String(value.faction)) ||
    typeof value.maskRevision !== "string" || !["learned", "already-known"].includes(String(value.result)) ||
    value.status !== "applied"
  ) throw new FlightPathBoostRepositoryError("Flight path request material is invalid.");
  return {
    requestId: value.requestId, boostKey: value.boostKey,
    accountId: readInteger(value.accountId, "account ID"),
    characterGuid: readInteger(value.characterGuid, "character GUID", 1, 0xffff_ffff),
    characterName: value.characterName, faction: value.faction as FlightPathFaction,
    classId: readInteger(value.classId, "class", 1, 255), maskRevision: value.maskRevision,
    result: value.result as FlightPathResult, status: "applied"
  };
}

function requestColumns(): string {
  return `request_id AS requestId, boost_key AS boostKey, account_id AS accountId,
    character_guid AS characterGuid, character_name AS characterName, faction,
    class_id AS classId, mask_revision AS maskRevision, result, status`;
}

export class FlightPathBoostRepository implements FlightPathBoostRepositoryPort {
  constructor(private readonly getDatabase: typeof getPortalDatabase = getPortalDatabase) {}

  async apply(
    input: ApplyFlightPathInput,
    decide: (character: LockedFlightPathCharacter) => FlightPathDecision
  ): Promise<ApplyFlightPathResult> {
    const { pool, config } = this.getDatabase();
    const stateDatabase = validatePortalDatabaseIdentifier(config.stateDatabase, "PORTAL_STATE_DATABASE");
    const charactersDatabase = validatePortalDatabaseIdentifier(config.charactersDatabase, "PORTAL_CHARACTERS_DATABASE");
    const requests = qualified(stateDatabase, "flight_path_boost_requests");
    const characters = qualified(charactersDatabase, "characters");
    const connection = await pool.getConnection();
    let transactionOpen = false;
    try {
      await connection.beginTransaction(); transactionOpen = true;
      const [requestRows] = await connection.execute<RowDataPacket[]>({
        sql: `SELECT ${requestColumns()} FROM ${requests} WHERE request_id = ? FOR UPDATE`,
        values: [input.requestId], timeout: QUERY_TIMEOUT_MS
      });
      if (requestRows.length > 1) throw new FlightPathBoostRepositoryError("Flight path request ID is ambiguous.");
      if (requestRows.length === 1) {
        const raw = requestRows[0] as Record<string, unknown>;
        const samePayload = raw.boostKey === input.boostKey &&
          readInteger(raw.accountId, "account ID") === input.accountId &&
          readInteger(raw.characterGuid, "character GUID", 1, 0xffff_ffff) === input.characterGuid &&
          raw.maskRevision === input.maskRevision;
        if (!samePayload) {
          await connection.commit(); transactionOpen = false;
          return { kind: "conflict" };
        }
        if (raw.status === "pending") {
          await connection.commit(); transactionOpen = false;
          return { kind: "processing", requestId: input.requestId };
        }
        const record = mapRecord(raw);
        await connection.commit(); transactionOpen = false;
        return { kind: "applied", record, created: false };
      }

      const [characterRows] = await connection.execute<RowDataPacket[]>({
        sql: `SELECT guid, account AS accountId, name, race AS raceId, class AS classId, online, taximask AS taxiMask
FROM ${characters}
WHERE guid = ? AND account = ? AND deleteInfos_Name IS NULL
FOR UPDATE`,
        values: [input.characterGuid, input.accountId], timeout: QUERY_TIMEOUT_MS
      });
      if (characterRows.length !== 1) {
        await connection.rollback(); transactionOpen = false;
        return { kind: "ownership" };
      }
      const rawCharacter = characterRows[0] as Record<string, unknown>;
      if (
        typeof rawCharacter.name !== "string" || Array.from(rawCharacter.name).length < 2 ||
        Array.from(rawCharacter.name).length > 12 || /[\u0000-\u001f\u007f]/u.test(rawCharacter.name) ||
        typeof rawCharacter.taxiMask !== "string"
      ) {
        throw new FlightPathBoostRepositoryError("Flight path character material is invalid.");
      }
      const character: LockedFlightPathCharacter = {
        guid: readInteger(rawCharacter.guid, "character GUID", 1, 0xffff_ffff),
        accountId: readInteger(rawCharacter.accountId, "account ID"), name: rawCharacter.name,
        raceId: readInteger(rawCharacter.raceId, "race", 1, 255),
        classId: readInteger(rawCharacter.classId, "class", 1, 255),
        online: readInteger(rawCharacter.online, "online", 0, 1) === 1,
        taxiMask: rawCharacter.taxiMask
      };
      const decision = decide(character);
      const now = new Date();
      await connection.execute({
        sql: `INSERT INTO ${requests} (
  request_id, boost_key, account_id, character_guid, character_name, faction,
  class_id, mask_revision, result, status, result_category, created_at, updated_at, completed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', 'processing', ?, ?, NULL)`,
        values: [input.requestId, input.boostKey, input.accountId, character.guid, character.name,
          decision.faction, character.classId, input.maskRevision, now, now], timeout: QUERY_TIMEOUT_MS
      });
      if (decision.result === "learned") {
        const [updated] = await connection.execute<ResultSetHeader>({
          sql: `UPDATE ${characters}
SET taximask = ?
WHERE guid = ? AND account = ? AND deleteInfos_Name IS NULL AND online = 0 AND taximask = ?`,
          values: [decision.newMask, character.guid, input.accountId, character.taxiMask], timeout: QUERY_TIMEOUT_MS
        });
        if (updated.affectedRows !== 1) throw new FlightPathCharacterConflictError();
      }
      const [completed] = await connection.execute<ResultSetHeader>({
        sql: `UPDATE ${requests}
SET result = ?, status = 'applied', result_category = ?, updated_at = ?, completed_at = ?
WHERE request_id = ? AND status = 'pending'`,
        values: [decision.result, decision.result === "learned" ? "mask_updated" : "already_known",
          now, now, input.requestId], timeout: QUERY_TIMEOUT_MS
      });
      if (completed.affectedRows !== 1) throw new FlightPathBoostRepositoryError("Flight path audit update conflicted.");
      const record: FlightPathBoostRecord = {
        requestId: input.requestId, boostKey: input.boostKey, accountId: input.accountId,
        characterGuid: character.guid, characterName: character.name, faction: decision.faction,
        classId: character.classId, maskRevision: input.maskRevision, result: decision.result, status: "applied"
      };
      try {
        await connection.commit(); transactionOpen = false;
        return { kind: "applied", record, created: true };
      } catch {
        transactionOpen = false;
        return await this.reconcileAfterAmbiguousCommit(input, record);
      }
    } catch (error) {
      if (transactionOpen) { try { await connection.rollback(); } catch { /* release closes the transaction */ } }
      throw error;
    } finally { connection.release(); }
  }

  private async reconcileAfterAmbiguousCommit(
    input: ApplyFlightPathInput,
    expected: FlightPathBoostRecord
  ): Promise<ApplyFlightPathResult> {
    const { pool, config } = this.getDatabase();
    const table = qualified(validatePortalDatabaseIdentifier(config.stateDatabase, "PORTAL_STATE_DATABASE"), "flight_path_boost_requests");
    const [rows] = await pool.execute<RowDataPacket[]>({
      sql: `SELECT ${requestColumns()} FROM ${table} WHERE request_id = ? LIMIT 2`,
      values: [input.requestId], timeout: QUERY_TIMEOUT_MS
    });
    if (rows.length !== 1) throw new FlightPathBoostRepositoryError("Flight path commit could not be confirmed.");
    const record = mapRecord(rows[0]);
    if (
      record.boostKey !== expected.boostKey || record.accountId !== expected.accountId ||
      record.characterGuid !== expected.characterGuid || record.maskRevision !== expected.maskRevision
    ) return { kind: "conflict" };
    return { kind: "applied", record, created: true };
  }
}

export const flightPathBoostRepository = new FlightPathBoostRepository();
