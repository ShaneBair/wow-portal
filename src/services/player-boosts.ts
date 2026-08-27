import type { RowDataPacket } from "mysql2";
import { getClassName, getRaceName } from "../domain/wotlk.js";
import { executeAzerothCoreCommand, type SoapResult } from "./azerothcore.js";
import {
  readMoneyBoostConfig,
  type MoneyBoostConfig
} from "./boost-config.js";
import {
  MoneyBoostRepository,
  moneyBoostRepository,
  type MoneyBoostRecord,
  type ReserveMoneyBoostResult
} from "./money-boost-repository.js";
import {
  getPortalDatabase,
  type PortalDatabaseConfig,
  validatePortalDatabaseIdentifier
} from "./portal-database.js";

const QUERY_TIMEOUT_MS = 8_000;
const MAX_CHARACTER_GUID = 0xffff_ffff;
const MAX_CHARACTER_LEVEL = 80;
const MAX_RACE_OR_CLASS_ID = 255;
const MONEY_PER_GOLD = 10_000;
const MAIL_SUBJECT = "DaBoysZeroth Boost";
const MAIL_BODY_PREFIX = "Free Money requested through the portal. Request ID: ";
const PENDING_STALE_MS = 15_000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CHARACTER_ID = /^[1-9]\d{0,9}$/u;
const SAFE_COMMAND_CHARACTER_NAME = /^[A-Za-z]{2,12}$/u;

export interface BoostCharacter {
  id: string;
  name: string;
  level: number;
  race: string;
  class: string;
}

export interface BoostOverview {
  characters: BoostCharacter[];
  money: MoneyBoostConfig;
}

export interface MoneyBoostInput {
  requestId: string;
  characterId: string;
  gold: number;
}

export interface MoneyBoostSuccess {
  requestId: string;
  status: "sent";
  message: string;
  created: boolean;
}

interface OwnedCharacter extends BoostCharacter {
  guid: number;
}

export class BoostDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoostDataError";
  }
}

export type BoostFailureKind =
  | "disabled"
  | "invalid"
  | "ownership"
  | "conflict"
  | "processing"
  | "limit"
  | "failed"
  | "unknown";

export class BoostRequestError extends Error {
  constructor(
    readonly kind: BoostFailureKind,
    message: string,
    readonly requestId?: string
  ) {
    super(message);
    this.name = "BoostRequestError";
  }
}

export interface CharacterQuery {
  sql: string;
  values: readonly number[];
}

function qualified(database: string, table: string): string {
  return `\`${database}\`.\`${table}\``;
}

export function buildOwnedCharactersQuery(
  config: Pick<PortalDatabaseConfig, "charactersDatabase">,
  accountId: number,
  characterGuid?: number
): CharacterQuery {
  const charactersDatabase = validatePortalDatabaseIdentifier(
    config.charactersDatabase,
    "PORTAL_CHARACTERS_DATABASE"
  );
  const characterTable = qualified(charactersDatabase, "characters");
  const guidPredicate = characterGuid === undefined ? "" : "\n  AND guid = ?";
  return {
    sql: `SELECT guid, name, level, race, class
FROM ${characterTable}
WHERE account = ?
  AND deleteInfos_Name IS NULL${guidPredicate}
ORDER BY LOWER(name), guid`,
    values: characterGuid === undefined ? [accountId] : [accountId, characterGuid]
  };
}

function readInteger(value: unknown, key: string, minimum: number, maximum: number): number {
  const parsed = typeof value === "string" || typeof value === "bigint" ? Number(value) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new BoostDataError(`Boost character ${key} is invalid.`);
  }
  return parsed;
}

function readDisplayName(value: unknown): string {
  if (
    typeof value !== "string" ||
    Array.from(value).length < 2 ||
    Array.from(value).length > 12 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new BoostDataError("Boost character name is invalid.");
  }
  return value;
}

export function mapOwnedCharacterRows(rows: unknown): OwnedCharacter[] {
  if (!Array.isArray(rows) || rows.length > 100) {
    throw new BoostDataError("Boost character result is invalid.");
  }
  const mapped = rows.map((row): OwnedCharacter => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new BoostDataError("Boost character row is invalid.");
    }
    const source = row as Record<string, unknown>;
    const guid = readInteger(source.guid, "GUID", 1, MAX_CHARACTER_GUID);
    const raceId = readInteger(source.race, "race", 0, MAX_RACE_OR_CLASS_ID);
    const classId = readInteger(source.class, "class", 0, MAX_RACE_OR_CLASS_ID);
    return {
      guid,
      id: String(guid),
      name: readDisplayName(source.name),
      level: readInteger(source.level, "level", 1, MAX_CHARACTER_LEVEL),
      race: getRaceName(raceId),
      class: getClassName(classId)
    };
  });
  mapped.sort((left, right) =>
    left.name.localeCompare(right.name, "en", { sensitivity: "base" }) || left.guid - right.guid
  );
  return mapped;
}

export function parseMoneyBoostInput(body: unknown, config: MoneyBoostConfig): MoneyBoostInput | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const source = body as Record<string, unknown>;
  if (
    Object.keys(source).some((key) => !["requestId", "characterId", "gold"].includes(key)) ||
    typeof source.requestId !== "string" ||
    !UUID_V4.test(source.requestId) ||
    typeof source.characterId !== "string" ||
    !CHARACTER_ID.test(source.characterId) ||
    typeof source.gold !== "number" ||
    !Number.isSafeInteger(source.gold) ||
    source.gold < config.minimumGold ||
    source.gold > config.maximumGoldPerRequest
  ) {
    return undefined;
  }
  const characterGuid = Number(source.characterId);
  if (!Number.isSafeInteger(characterGuid) || characterGuid > MAX_CHARACTER_GUID) {
    return undefined;
  }
  return {
    requestId: source.requestId,
    characterId: source.characterId,
    gold: source.gold
  };
}

export function goldToCopper(gold: number): number {
  const copper = gold * MONEY_PER_GOLD;
  if (!Number.isSafeInteger(gold) || gold < 1 || !Number.isSafeInteger(copper) || copper > 0x7fff_ffff) {
    throw new BoostDataError("Boost gold amount cannot be represented safely.");
  }
  return copper;
}

export function moneyMailBody(requestId: string): string {
  if (!UUID_V4.test(requestId)) {
    throw new BoostDataError("Boost request ID is invalid.");
  }
  return `${MAIL_BODY_PREFIX}${requestId}`;
}

export function buildSendMoneyCommand(
  characterName: string,
  requestId: string,
  copper: number
): string {
  if (!SAFE_COMMAND_CHARACTER_NAME.test(characterName)) {
    throw new BoostDataError("Boost character name is not safe for the compatible command parser.");
  }
  if (!Number.isSafeInteger(copper) || copper < MONEY_PER_GOLD || copper > 0x7fff_ffff) {
    throw new BoostDataError("Boost copper amount is invalid.");
  }
  return `send money ${characterName} "${MAIL_SUBJECT}" "${moneyMailBody(requestId)}" ${copper}`;
}

export type MoneyCommandOutcome = "sent" | "failed" | "unknown";

export function classifyMoneyCommandResult(
  result: SoapResult,
  characterName: string
): MoneyCommandOutcome {
  if (!result.ok) {
    return "unknown";
  }
  const output = result.output.trim();
  if (output === `Mail sent to ${characterName}`) {
    return "sent";
  }
  if (
    output === "Incorrect syntax." ||
    output === `Character '${characterName}' does not exist.` ||
    output === `'${characterName}' is not a valid character name.`
  ) {
    return "failed";
  }
  return "unknown";
}

export type QueryOwnedCharacters = (
  accountId: number,
  characterGuid?: number
) => Promise<unknown>;

export async function queryOwnedCharacters(
  accountId: number,
  characterGuid?: number
): Promise<unknown> {
  const { pool, config } = getPortalDatabase();
  const query = buildOwnedCharactersQuery(config, accountId, characterGuid);
  const [rows] = await pool.execute<RowDataPacket[]>({
    sql: query.sql,
    values: [...query.values],
    timeout: QUERY_TIMEOUT_MS
  });
  return rows;
}

export interface PlayerBoostServiceDependencies {
  queryCharacters?: QueryOwnedCharacters;
  repository?: MoneyBoostRepository;
  executeCommand?: (command: string) => Promise<SoapResult>;
  getConfig?: () => MoneyBoostConfig;
  now?: () => Date;
}

function sentResult(record: MoneyBoostRecord, created: boolean): MoneyBoostSuccess {
  return {
    requestId: record.requestId,
    status: "sent",
    message: `${record.gold} gold was sent to ${record.characterName} by in-game mail.`,
    created
  };
}

export class PlayerBoostService {
  private readonly queryCharacters: QueryOwnedCharacters;
  private readonly repository: MoneyBoostRepository;
  private readonly executeCommand: (command: string) => Promise<SoapResult>;
  private readonly getConfig: () => MoneyBoostConfig;
  private readonly now: () => Date;

  constructor(dependencies: PlayerBoostServiceDependencies = {}) {
    this.queryCharacters = dependencies.queryCharacters ?? queryOwnedCharacters;
    this.repository = dependencies.repository ?? moneyBoostRepository;
    this.executeCommand = dependencies.executeCommand ?? executeAzerothCoreCommand;
    this.getConfig = dependencies.getConfig ?? readMoneyBoostConfig;
    this.now = dependencies.now ?? (() => new Date());
  }

  readConfig(): MoneyBoostConfig {
    return this.getConfig();
  }

  async getOverview(accountId: number): Promise<BoostOverview> {
    const config = this.getConfig();
    const characters = mapOwnedCharacterRows(await this.queryCharacters(accountId));
    await this.reconcileStaleRequests(accountId);
    return {
      characters: characters.map(({ guid: _guid, ...character }) => character),
      money: config
    };
  }

  async requestMoney(accountId: number, input: MoneyBoostInput): Promise<MoneyBoostSuccess> {
    const config = this.getConfig();
    if (!config.enabled) {
      throw new BoostRequestError("disabled", "Money boosts are currently disabled.");
    }
    const validatedInput = parseMoneyBoostInput(input, config);
    if (!validatedInput) {
      throw new BoostRequestError("invalid", "Enter a valid character, request ID, and whole-gold amount.");
    }
    const characterGuid = Number(validatedInput.characterId);
    const characters = mapOwnedCharacterRows(await this.queryCharacters(accountId, characterGuid));
    const character = characters.length === 1 ? characters[0] : undefined;
    if (!character || character.guid !== characterGuid) {
      throw new BoostRequestError("ownership", "That character is not available for this account.");
    }
    if (!SAFE_COMMAND_CHARACTER_NAME.test(character.name)) {
      throw new BoostRequestError("failed", "Gold cannot be sent to this character through the portal.");
    }
    const copper = goldToCopper(validatedInput.gold);
    const reservation = await this.repository.reserve({
      requestId: validatedInput.requestId,
      accountId,
      characterGuid,
      characterName: character.name,
      gold: validatedInput.gold,
      copper,
      dailyGoldLimit: config.dailyGoldLimit,
      dailyRequestLimit: config.dailyRequestLimit
    });
    return this.handleReservation(reservation, character);
  }

  private async handleReservation(
    reservation: ReserveMoneyBoostResult,
    character: OwnedCharacter
  ): Promise<MoneyBoostSuccess> {
    if (reservation.kind === "conflict") {
      throw new BoostRequestError("conflict", "That request ID was already used for different details.");
    }
    if (reservation.kind === "limit") {
      throw new BoostRequestError("limit", "This account has reached a daily Free Money limit.");
    }
    const record = reservation.record;
    if (reservation.kind === "existing") {
      if (record.status === "sent") {
        return sentResult(record, false);
      }
      if (record.status === "failed") {
        throw new BoostRequestError("failed", "Gold could not be sent. Try a new request later.");
      }
      if (record.status === "pending" && this.now().getTime() - record.createdAt.getTime() < PENDING_STALE_MS) {
        throw new BoostRequestError("processing", "That request is still processing.", record.requestId);
      }
      return this.reconcileOrUnknown(record);
    }

    const command = buildSendMoneyCommand(character.name, record.requestId, record.copper);
    let outcome: MoneyCommandOutcome = "unknown";
    try {
      outcome = classifyMoneyCommandResult(await this.executeCommand(command), character.name);
    } catch {
      outcome = "unknown";
    }
    if (outcome === "sent") {
      await this.repository.mark(record.requestId, "sent", "command_confirmed");
      return sentResult(record, true);
    }
    if (outcome === "failed") {
      await this.repository.mark(record.requestId, "failed", "command_rejected");
      throw new BoostRequestError("failed", "Gold could not be sent. Try a new request later.");
    }
    return this.reconcileOrUnknown(record);
  }

  private async reconcileOrUnknown(record: MoneyBoostRecord): Promise<MoneyBoostSuccess> {
    const matches = await this.repository.countMatchingMail(record, MAIL_SUBJECT, moneyMailBody(record.requestId));
    if (matches === 1) {
      await this.repository.mark(record.requestId, "sent", "mail_reconciled");
      return sentResult(record, false);
    }
    await this.repository.mark(record.requestId, "unknown", matches > 1 ? "mail_ambiguous" : "confirmation_missing");
    throw new BoostRequestError(
      "unknown",
      "Delivery could not be confirmed. Do not send again; give this request ID to an administrator.",
      record.requestId
    );
  }

  private async reconcileStaleRequests(accountId: number): Promise<void> {
    const stale = await this.repository.findStalePending(accountId, PENDING_STALE_MS);
    for (const record of stale) {
      const matches = await this.repository.countMatchingMail(record, MAIL_SUBJECT, moneyMailBody(record.requestId));
      await this.repository.mark(
        record.requestId,
        matches === 1 ? "sent" : "unknown",
        matches === 1 ? "mail_reconciled" : matches > 1 ? "mail_ambiguous" : "stale_pending"
      );
    }
  }
}

export const playerBoostService = new PlayerBoostService();
