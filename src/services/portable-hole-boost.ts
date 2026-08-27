import type { SoapResult } from "./azerothcore.js";
import { executeAzerothCoreCommand } from "./azerothcore.js";
import {
  readPortableHolesBoostConfig,
  type PortableHolesBoostConfig
} from "./boost-config.js";
import {
  portableHoleBoostRepository,
  PortableHoleBoostRepository,
  type PortableHoleBoostRecord,
  type PortableHoleMailMatch,
  type ReservePortableHoleBoostResult
} from "./portable-hole-boost-repository.js";
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

export const PORTABLE_HOLE_BOOST_KEY = "portable-holes-v1";
export const PORTABLE_HOLE_ITEM_ENTRY = 51_809;
export const PORTABLE_HOLE_ITEM_COUNT = 4;
export const PORTABLE_HOLE_SLOTS = 24;
export const PORTABLE_HOLE_BOOST_NAME = "Hole Lotta Storage";
export const PORTABLE_HOLE_ITEM_NAME = "Portable Hole";
const MAIL_SUBJECT = PORTABLE_HOLE_BOOST_NAME;
const MAIL_BODY_PREFIX = "Four Portable Holes requested through the portal. Request ID: ";
const PENDING_STALE_MS = 15_000;

export interface PortableHolesMetadata {
  enabled: boolean;
  name: typeof PORTABLE_HOLE_BOOST_NAME;
  itemName: typeof PORTABLE_HOLE_ITEM_NAME;
  itemCount: typeof PORTABLE_HOLE_ITEM_COUNT;
  slotsPerBag: typeof PORTABLE_HOLE_SLOTS;
  repeatable: true;
}

export interface PortableHolesInput {
  requestId: string;
  characterId: string;
}

export interface PortableHolesSuccess {
  requestId: string;
  status: "sent";
  message: string;
  created: boolean;
}

export function portableHolesMetadata(config: PortableHolesBoostConfig): PortableHolesMetadata {
  return {
    enabled: config.enabled,
    name: PORTABLE_HOLE_BOOST_NAME,
    itemName: PORTABLE_HOLE_ITEM_NAME,
    itemCount: PORTABLE_HOLE_ITEM_COUNT,
    slotsPerBag: PORTABLE_HOLE_SLOTS,
    repeatable: true
  };
}

export function parsePortableHolesInput(body: unknown): PortableHolesInput | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const source = body as Record<string, unknown>;
  if (
    Object.keys(source).some((key) => !["requestId", "characterId"].includes(key)) ||
    !isValidBoostRequestId(source.requestId) ||
    typeof source.characterId !== "string" ||
    parseBoostCharacterId(source.characterId) === undefined
  ) {
    return undefined;
  }
  return { requestId: source.requestId, characterId: source.characterId };
}

export function portableHolesMailBody(requestId: string): string {
  if (!isValidBoostRequestId(requestId)) {
    throw new BoostDataError("Portable Hole boost request ID is invalid.");
  }
  return `${MAIL_BODY_PREFIX}${requestId}`;
}

export function buildSendPortableHolesCommand(characterName: string, requestId: string): string {
  if (!isSafeBoostCharacterName(characterName)) {
    throw new BoostDataError("Boost character name is not safe for the compatible command parser.");
  }
  return `send items ${characterName} "${MAIL_SUBJECT}" "${portableHolesMailBody(requestId)}" ${PORTABLE_HOLE_ITEM_ENTRY}:${PORTABLE_HOLE_ITEM_COUNT}`;
}

export type PortableHolesCommandOutcome = "sent" | "failed" | "unknown";

export function classifyPortableHolesCommandResult(
  result: SoapResult,
  characterName: string
): PortableHolesCommandOutcome {
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
    output === `'${characterName}' is not a valid character name.` ||
    output === `Item '${PORTABLE_HOLE_ITEM_ENTRY}' not found in database.` ||
    output === `Invalid item count (${PORTABLE_HOLE_ITEM_COUNT}) for item ${PORTABLE_HOLE_ITEM_ENTRY}`
  ) {
    return "failed";
  }
  return "unknown";
}

export interface PortableHoleBoostServiceDependencies {
  queryCharacters?: QueryOwnedCharacters;
  repository?: PortableHoleBoostRepository;
  executeCommand?: (command: string) => Promise<SoapResult>;
  getConfig?: () => PortableHolesBoostConfig;
  now?: () => Date;
}

function sentResult(record: PortableHoleBoostRecord, created: boolean): PortableHolesSuccess {
  return {
    requestId: record.requestId,
    status: "sent",
    message: `Four Portable Holes were sent to ${record.characterName} by in-game mail.`,
    created
  };
}

export class PortableHoleBoostService {
  private readonly queryCharacters: QueryOwnedCharacters;
  private readonly repository: PortableHoleBoostRepository;
  private readonly executeCommand: (command: string) => Promise<SoapResult>;
  private readonly getConfig: () => PortableHolesBoostConfig;
  private readonly now: () => Date;

  constructor(dependencies: PortableHoleBoostServiceDependencies = {}) {
    this.queryCharacters = dependencies.queryCharacters ?? queryOwnedCharacters;
    this.repository = dependencies.repository ?? portableHoleBoostRepository;
    this.executeCommand = dependencies.executeCommand ?? executeAzerothCoreCommand;
    this.getConfig = dependencies.getConfig ?? readPortableHolesBoostConfig;
    this.now = dependencies.now ?? (() => new Date());
  }

  readConfig(): PortableHolesBoostConfig {
    return this.getConfig();
  }

  async getMetadata(accountId: number): Promise<PortableHolesMetadata> {
    const config = this.getConfig();
    if (!config.enabled) {
      return portableHolesMetadata(config);
    }
    await this.reconcileStaleRequests(accountId);
    return portableHolesMetadata(config);
  }

  async requestPortableHoles(
    accountId: number,
    input: PortableHolesInput
  ): Promise<PortableHolesSuccess> {
    const config = this.getConfig();
    if (!config.enabled) {
      throw new BoostRequestError("disabled", "This boost is currently unavailable.");
    }
    const validatedInput = parsePortableHolesInput(input);
    if (!validatedInput) {
      throw new BoostRequestError("invalid", "Enter a valid character and request ID.");
    }
    const characterGuid = parseBoostCharacterId(validatedInput.characterId)!;
    const characters = mapOwnedCharacterRows(await this.queryCharacters(accountId, characterGuid));
    const character = characters.length === 1 ? characters[0] : undefined;
    if (!character || character.guid !== characterGuid) {
      throw new BoostRequestError("ownership", "That character is not available for this account.");
    }
    if (!isSafeBoostCharacterName(character.name)) {
      throw new BoostRequestError("failed", "Bags cannot be sent to this character through the portal.");
    }
    const reservation = await this.repository.reserve({
      requestId: validatedInput.requestId,
      boostKey: PORTABLE_HOLE_BOOST_KEY,
      accountId,
      characterGuid,
      characterName: character.name,
      itemEntry: PORTABLE_HOLE_ITEM_ENTRY,
      itemCount: PORTABLE_HOLE_ITEM_COUNT
    });
    return this.handleReservation(reservation, character);
  }

  private async handleReservation(
    reservation: ReservePortableHoleBoostResult,
    character: OwnedBoostCharacter
  ): Promise<PortableHolesSuccess> {
    if (reservation.kind === "conflict") {
      throw new BoostRequestError("conflict", "That request ID was already used for different details.");
    }
    const record = reservation.record;
    if (reservation.kind === "existing") {
      if (record.status === "sent") {
        return sentResult(record, false);
      }
      if (record.status === "failed") {
        throw new BoostRequestError("failed", "Bags could not be sent. Start a new request later.");
      }
      if (record.status === "pending" && this.now().getTime() - record.createdAt.getTime() < PENDING_STALE_MS) {
        throw new BoostRequestError("processing", "That bag request is still processing.", record.requestId);
      }
      return this.reconcileOrUnknown(record);
    }

    const command = buildSendPortableHolesCommand(character.name, record.requestId);
    let outcome: PortableHolesCommandOutcome = "unknown";
    try {
      outcome = classifyPortableHolesCommandResult(await this.executeCommand(command), character.name);
    } catch {
      outcome = "unknown";
    }
    if (outcome === "sent") {
      await this.repository.mark(record.requestId, "sent", "command_confirmed");
      return sentResult(record, true);
    }
    if (outcome === "failed") {
      await this.repository.mark(record.requestId, "failed", "command_rejected");
      throw new BoostRequestError("failed", "Bags could not be sent. Start a new request later.");
    }
    return this.reconcileOrUnknown(record);
  }

  private async reconcileOrUnknown(record: PortableHoleBoostRecord): Promise<PortableHolesSuccess> {
    const match = await this.repository.inspectMatchingMail(
      record,
      MAIL_SUBJECT,
      portableHolesMailBody(record.requestId)
    );
    if (match === "exact") {
      await this.repository.mark(record.requestId, "sent", "mail_reconciled");
      return sentResult(record, false);
    }
    await this.markUnknown(record.requestId, match);
    throw new BoostRequestError(
      "unknown",
      "Delivery could not be confirmed and may already have arrived. Check your mail before sending another bundle.",
      record.requestId
    );
  }

  private async markUnknown(requestId: string, match: PortableHoleMailMatch): Promise<void> {
    await this.repository.mark(
      requestId,
      "unknown",
      match === "ambiguous" ? "mail_ambiguous" : "confirmation_missing"
    );
  }

  private async reconcileStaleRequests(accountId: number): Promise<void> {
    const stale = await this.repository.findStalePending(accountId, PENDING_STALE_MS);
    for (const record of stale) {
      const match = await this.repository.inspectMatchingMail(
        record,
        MAIL_SUBJECT,
        portableHolesMailBody(record.requestId)
      );
      if (match === "exact") {
        await this.repository.mark(record.requestId, "sent", "mail_reconciled");
      } else {
        await this.repository.mark(
          record.requestId,
          "unknown",
          match === "ambiguous" ? "mail_ambiguous" : "stale_pending"
        );
      }
    }
  }
}

export const portableHoleBoostService = new PortableHoleBoostService();
