import type { RowDataPacket } from "mysql2/promise";
import type { SoapResult } from "./azerothcore.js";
import { executeAzerothCoreCommand } from "./azerothcore.js";
import {
  readItemDeliveryBoostConfig,
  type ItemDeliveryBoostConfig
} from "./boost-config.js";
import {
  itemDeliveryRepository,
  ItemDeliveryRepository,
  type ItemDeliveryMailMatch,
  type ItemDeliveryRecord,
  type ReserveItemDeliveryResult
} from "./item-delivery-repository.js";
import {
  BoostDataError,
  BoostRequestError,
  isSafeBoostCharacterName,
  isValidBoostRequestId,
  mapOwnedCharacterRows,
  parseBoostCharacterId,
  queryOwnedCharacters,
  type OwnedBoostCharacter,
  type QueryOwnedCharacters
} from "./player-boosts.js";
import { getPortalDatabase, validatePortalDatabaseIdentifier } from "./portal-database.js";

const QUERY_TIMEOUT_MS = 8_000;
const MAX_ITEM_ENTRY = 0xffff_ffff;
const MAX_MAIL_ATTACHMENTS = 12;
const DEFAULT_MAXIMUM_QUANTITY = 200;
const PENDING_STALE_MS = 15_000;
export const ITEM_DELIVERY_BOOST_KEY = "item-delivery-v1";
export const ITEM_DELIVERY_NAME = "Item Delivery Service";
const MAIL_SUBJECT = ITEM_DELIVERY_NAME;
const MAIL_BODY_PREFIX = "Items requested through the portal. Request ID: ";

export interface ItemDeliveryMetadata {
  enabled: boolean;
  name: typeof ITEM_DELIVERY_NAME;
  defaultQuantity: 1;
  maximumQuantity: number;
  deliveryMethod: "mail";
}

export interface ItemTemplate {
  id: number;
  name: string;
  quality: number;
  stackSize: number;
  maxCount: number;
}

export interface ItemDeliveryPreview {
  id: number;
  name: string;
  quality: number;
  maximumQuantity: number;
}

export interface ItemDeliveryInput {
  requestId: string;
  characterId: string;
  itemId: number;
  quantity: number;
}

export interface ItemDeliverySuccess {
  requestId: string;
  status: "sent";
  item: { id: number; name: string; quantity: number };
  message: string;
  created: boolean;
}

export type QueryItemTemplate = (itemId: number) => Promise<unknown>;

export function readPortalWorldDatabase(environment: NodeJS.ProcessEnv = process.env): string {
  const value = environment.PORTAL_WORLD_DATABASE?.trim();
  if (!value) throw new BoostDataError("PORTAL_WORLD_DATABASE is required.");
  return validatePortalDatabaseIdentifier(value, "PORTAL_WORLD_DATABASE");
}

export function buildItemTemplateQuery(worldDatabase: string, itemId: number) {
  const database = validatePortalDatabaseIdentifier(worldDatabase, "PORTAL_WORLD_DATABASE");
  if (!Number.isInteger(itemId) || itemId < 1 || itemId > MAX_ITEM_ENTRY) {
    throw new BoostDataError("Item entry is invalid.");
  }
  return {
    sql: `SELECT entry AS id, name, Quality AS quality, stackable AS stackSize, maxcount AS maxCount
FROM \`${database}\`.\`item_template\`
WHERE entry = ?
LIMIT 2`,
    values: [itemId] as const
  };
}

export async function queryItemTemplate(itemId: number): Promise<unknown> {
  const { pool } = getPortalDatabase();
  const query = buildItemTemplateQuery(readPortalWorldDatabase(), itemId);
  const [rows] = await pool.execute<RowDataPacket[]>({
    sql: query.sql,
    values: [...query.values],
    timeout: QUERY_TIMEOUT_MS
  });
  return rows;
}

function readInteger(value: unknown, key: string, minimum: number, maximum: number): number {
  const parsed = typeof value === "string" || typeof value === "bigint" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new BoostDataError(`Item template ${key} is invalid.`);
  }
  return parsed;
}

export function mapItemTemplateRows(rows: unknown, expectedItemId: number): ItemTemplate | undefined {
  if (!Array.isArray(rows) || rows.length > 1) throw new BoostDataError("Item template result is invalid.");
  if (rows.length === 0) return undefined;
  const row = rows[0];
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new BoostDataError("Item template row is invalid.");
  }
  const source = row as Record<string, unknown>;
  const id = readInteger(source.id, "entry", 1, MAX_ITEM_ENTRY);
  if (id !== expectedItemId || typeof source.name !== "string" ||
      Array.from(source.name).length < 1 || Array.from(source.name).length > 255 ||
      /[\u0000-\u001f\u007f]/u.test(source.name)) {
    throw new BoostDataError("Item template identity is invalid.");
  }
  return {
    id,
    name: source.name,
    quality: readInteger(source.quality, "quality", 0, 7),
    stackSize: readInteger(source.stackSize, "stack size", 1, MAX_ITEM_ENTRY),
    maxCount: readInteger(source.maxCount, "maximum count", 0, MAX_ITEM_ENTRY)
  };
}

export function calculateItemMaximum(
  item: Pick<ItemTemplate, "stackSize" | "maxCount">,
  configuredMaximum: number
): number {
  if (!Number.isSafeInteger(configuredMaximum) || configuredMaximum < 1) {
    throw new BoostDataError("Item delivery maximum is invalid.");
  }
  const attachmentMaximum = Math.min(Number.MAX_SAFE_INTEGER, item.stackSize * MAX_MAIL_ATTACHMENTS);
  return Math.min(configuredMaximum, attachmentMaximum, item.maxCount > 0 ? item.maxCount : Number.MAX_SAFE_INTEGER);
}

export function parseItemId(value: unknown): number | undefined {
  if (typeof value === "string") {
    if (!/^[1-9]\d{0,9}$/u.test(value)) return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed <= MAX_ITEM_ENTRY ? parsed : undefined;
  }
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_ITEM_ENTRY
    ? value
    : undefined;
}

export function parseItemDeliveryInput(
  body: unknown,
  config: ItemDeliveryBoostConfig
): ItemDeliveryInput | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const source = body as Record<string, unknown>;
  if (
    Object.keys(source).length !== 4 ||
    Object.keys(source).some((key) => !["requestId", "characterId", "itemId", "quantity"].includes(key)) ||
    !isValidBoostRequestId(source.requestId) || parseBoostCharacterId(source.characterId) === undefined ||
    typeof source.itemId !== "number" || parseItemId(source.itemId) === undefined ||
    typeof source.quantity !== "number" || !Number.isInteger(source.quantity) ||
    source.quantity < 1 || source.quantity > config.maximumQuantity
  ) return undefined;
  return {
    requestId: source.requestId,
    characterId: source.characterId as string,
    itemId: source.itemId,
    quantity: source.quantity
  };
}

export function isCanonicalItemDeliveryJson(rawBody: string | undefined): boolean {
  if (!rawBody) return false;
  const propertyNames = [...rawBody.matchAll(/"([^"\\]+)"\s*:/gu)].map((match) => match[1]);
  if (
    propertyNames.length !== 4 ||
    !["requestId", "characterId", "itemId", "quantity"].every(
      (name) => propertyNames.filter((candidate) => candidate === name).length === 1
    )
  ) return false;
  return /"itemId"\s*:\s*(?:0|[1-9]\d*)(?=\s*[,}])/u.test(rawBody) &&
    /"quantity"\s*:\s*(?:0|[1-9]\d*)(?=\s*[,}])/u.test(rawBody);
}

export function itemDeliveryMailBody(requestId: string): string {
  if (!isValidBoostRequestId(requestId)) throw new BoostDataError("Item delivery request ID is invalid.");
  return `${MAIL_BODY_PREFIX}${requestId}`;
}

export function buildSendItemDeliveryCommand(
  characterName: string,
  requestId: string,
  itemId: number,
  quantity: number
): string {
  if (!isSafeBoostCharacterName(characterName)) {
    throw new BoostDataError("Boost character name is not safe for the compatible command parser.");
  }
  if (parseItemId(itemId) === undefined || !Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) {
    throw new BoostDataError("Item delivery command values are invalid.");
  }
  return `send items ${characterName} "${MAIL_SUBJECT}" "${itemDeliveryMailBody(requestId)}" ${itemId}:${quantity}`;
}

export type ItemDeliveryCommandOutcome = "sent" | "failed" | "unknown";

export function classifyItemDeliveryCommandResult(
  result: SoapResult,
  characterName: string,
  itemId: number,
  quantity: number
): ItemDeliveryCommandOutcome {
  if (!result.ok) return "unknown";
  const output = result.output.trim();
  if (output === `Mail sent to ${characterName}`) return "sent";
  if ([
    "Incorrect syntax.",
    `Character '${characterName}' does not exist.`,
    `'${characterName}' is not a valid character name.`,
    `Item '${itemId}' not found in database.`,
    `Invalid item count (${quantity}) for item ${itemId}`,
    "You can send at most 12 item stacks by mail."
  ].includes(output)) return "failed";
  return "unknown";
}

export function itemDeliveryMetadata(config: ItemDeliveryBoostConfig): ItemDeliveryMetadata {
  return {
    enabled: config.enabled,
    name: ITEM_DELIVERY_NAME,
    defaultQuantity: 1,
    maximumQuantity: config.maximumQuantity,
    deliveryMethod: "mail"
  };
}

function unavailableMetadata(): ItemDeliveryMetadata {
  return itemDeliveryMetadata({ enabled: false, maximumQuantity: DEFAULT_MAXIMUM_QUANTITY });
}

function pluralizedItemName(name: string, quantity: number): string {
  return quantity === 1 || name.endsWith("s") ? name : `${name}s`;
}

function sentResult(record: ItemDeliveryRecord, created: boolean): ItemDeliverySuccess {
  return {
    requestId: record.requestId,
    status: "sent",
    item: { id: record.itemEntry, name: record.itemName, quantity: record.itemQuantity },
    message: `${record.itemQuantity.toLocaleString("en-US")} ${pluralizedItemName(record.itemName, record.itemQuantity)} ${record.itemQuantity === 1 ? "was" : "were"} sent to ${record.characterName} by in-game mail.`,
    created
  };
}

export interface ItemDeliveryServiceDependencies {
  queryCharacters?: QueryOwnedCharacters;
  queryItem?: QueryItemTemplate;
  repository?: ItemDeliveryRepository;
  executeCommand?: (command: string) => Promise<SoapResult>;
  getConfig?: () => ItemDeliveryBoostConfig;
  getWorldDatabase?: () => string;
  now?: () => Date;
}

export class ItemDeliveryService {
  private readonly queryCharacters: QueryOwnedCharacters;
  private readonly queryItem: QueryItemTemplate;
  private readonly repository: ItemDeliveryRepository;
  private readonly executeCommand: (command: string) => Promise<SoapResult>;
  private readonly getConfig: () => ItemDeliveryBoostConfig;
  private readonly getWorldDatabase: () => string;
  private readonly now: () => Date;

  constructor(dependencies: ItemDeliveryServiceDependencies = {}) {
    this.queryCharacters = dependencies.queryCharacters ?? queryOwnedCharacters;
    this.queryItem = dependencies.queryItem ?? queryItemTemplate;
    this.repository = dependencies.repository ?? itemDeliveryRepository;
    this.executeCommand = dependencies.executeCommand ?? executeAzerothCoreCommand;
    this.getConfig = dependencies.getConfig ?? readItemDeliveryBoostConfig;
    this.getWorldDatabase = dependencies.getWorldDatabase ?? readPortalWorldDatabase;
    this.now = dependencies.now ?? (() => new Date());
  }

  readConfig(): ItemDeliveryBoostConfig { return this.getConfig(); }

  async getMetadata(accountId: number): Promise<ItemDeliveryMetadata> {
    try {
      const config = this.getConfig();
      this.getWorldDatabase();
      if (config.enabled) await this.reconcileStaleRequests(accountId);
      return itemDeliveryMetadata(config);
    } catch {
      return unavailableMetadata();
    }
  }

  async lookupItem(itemId: number): Promise<ItemDeliveryPreview | undefined> {
    const config = this.getConfig();
    this.getWorldDatabase();
    if (!config.enabled) throw new BoostRequestError("disabled", "This boost is currently unavailable.");
    const parsedItemId = parseItemId(itemId);
    if (parsedItemId === undefined) throw new BoostRequestError("invalid", "Enter a valid item ID.");
    const item = mapItemTemplateRows(await this.queryItem(parsedItemId), parsedItemId);
    return item ? {
      id: item.id,
      name: item.name,
      quality: item.quality,
      maximumQuantity: calculateItemMaximum(item, config.maximumQuantity)
    } : undefined;
  }

  async requestItem(accountId: number, input: ItemDeliveryInput): Promise<ItemDeliverySuccess> {
    const config = this.getConfig();
    this.getWorldDatabase();
    if (!config.enabled) throw new BoostRequestError("disabled", "This boost is currently unavailable.");
    const validated = parseItemDeliveryInput(input, config);
    if (!validated) throw new BoostRequestError("invalid", "Enter a valid character, request ID, item ID, and quantity.");
    const item = mapItemTemplateRows(await this.queryItem(validated.itemId), validated.itemId);
    if (!item) throw new BoostRequestError("not-found", "That item could not be found.");
    const maximumQuantity = calculateItemMaximum(item, config.maximumQuantity);
    if (validated.quantity > maximumQuantity) {
      throw new BoostRequestError("invalid", `Enter a quantity from 1 through ${maximumQuantity}.`);
    }
    const characterGuid = parseBoostCharacterId(validated.characterId)!;
    const characters = mapOwnedCharacterRows(await this.queryCharacters(accountId, characterGuid));
    const character = characters.length === 1 ? characters[0] : undefined;
    if (!character || character.guid !== characterGuid) {
      throw new BoostRequestError("ownership", "That character is not available for this account.");
    }
    if (!isSafeBoostCharacterName(character.name)) {
      throw new BoostRequestError("failed", "Items cannot be sent to this character through the portal.");
    }
    const reservation = await this.repository.reserve({
      requestId: validated.requestId,
      boostKey: ITEM_DELIVERY_BOOST_KEY,
      accountId,
      characterGuid,
      characterName: character.name,
      itemEntry: item.id,
      itemName: item.name,
      itemQuantity: validated.quantity,
      itemStackSize: item.stackSize
    });
    return this.handleReservation(reservation, character);
  }

  private async handleReservation(
    reservation: ReserveItemDeliveryResult,
    character: OwnedBoostCharacter
  ): Promise<ItemDeliverySuccess> {
    if (reservation.kind === "conflict") {
      throw new BoostRequestError("conflict", "That request ID was already used for different details.");
    }
    const record = reservation.record;
    if (reservation.kind === "existing") {
      if (record.status === "sent") return sentResult(record, false);
      if (record.status === "failed") throw new BoostRequestError("failed", "Items could not be sent. Start a new request later.");
      if (record.status === "pending" && this.now().getTime() - record.createdAt.getTime() < PENDING_STALE_MS) {
        throw new BoostRequestError("processing", "That item request is still processing.", record.requestId);
      }
      return this.reconcileOrUnknown(record);
    }

    const command = buildSendItemDeliveryCommand(
      character.name,
      record.requestId,
      record.itemEntry,
      record.itemQuantity
    );
    let outcome: ItemDeliveryCommandOutcome = "unknown";
    try {
      outcome = classifyItemDeliveryCommandResult(
        await this.executeCommand(command), character.name, record.itemEntry, record.itemQuantity
      );
    } catch { outcome = "unknown"; }
    if (outcome === "sent") {
      await this.repository.mark(record.requestId, "sent", "command_confirmed");
      return sentResult(record, true);
    }
    if (outcome === "failed") {
      await this.repository.mark(record.requestId, "failed", "command_rejected");
      throw new BoostRequestError("failed", "Items could not be sent. Start a new request later.");
    }
    return this.reconcileOrUnknown(record);
  }

  private async reconcileOrUnknown(record: ItemDeliveryRecord): Promise<ItemDeliverySuccess> {
    const match = await this.repository.inspectMatchingMail(record, MAIL_SUBJECT, itemDeliveryMailBody(record.requestId));
    if (match === "exact") {
      await this.repository.mark(record.requestId, "sent", "mail_reconciled");
      return sentResult(record, false);
    }
    await this.markUnknown(record.requestId, match, false);
    throw new BoostRequestError(
      "unknown",
      "Delivery could not be confirmed. Do not send it again; give this request ID to an administrator.",
      record.requestId
    );
  }

  private async markUnknown(requestId: string, match: ItemDeliveryMailMatch, stale: boolean): Promise<void> {
    await this.repository.mark(
      requestId,
      "unknown",
      match === "ambiguous" ? "mail_ambiguous" : stale ? "stale_pending" : "confirmation_missing"
    );
  }

  private async reconcileStaleRequests(accountId: number): Promise<void> {
    const stale = await this.repository.findStalePending(accountId, PENDING_STALE_MS);
    for (const record of stale) {
      const match = await this.repository.inspectMatchingMail(record, MAIL_SUBJECT, itemDeliveryMailBody(record.requestId));
      if (match === "exact") await this.repository.mark(record.requestId, "sent", "mail_reconciled");
      else await this.markUnknown(record.requestId, match, true);
    }
  }
}

export const itemDeliveryService = new ItemDeliveryService();
