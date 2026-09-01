import type { SoapResult } from "./azerothcore.js";
import { executeAzerothCoreCommand } from "./azerothcore.js";
import {
  readArcaneTomeBoostConfig,
  type ArcaneTomeBoostConfig
} from "./boost-config.js";
import {
  arcaneTomeBoostRepository,
  ArcaneTomeBoostRepository,
  type ArcaneTomeBoostRecord,
  type ArcaneTomeMailMatch,
  type ReserveArcaneTomeBoostResult
} from "./arcane-tome-boost-repository.js";
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

export const ARCANE_TOME_BOOST_KEY = "arcane-tome-displacement-v1";
export const ARCANE_TOME_ITEM_ENTRY = 900_001;
export const ARCANE_TOME_ITEM_COUNT = 1;
export const ARCANE_TOME_BOOST_NAME = "Tomeward Bound";
export const ARCANE_TOME_ITEM_NAME = "Arcane Tome of Displacement";
const MAIL_SUBJECT = ARCANE_TOME_BOOST_NAME;
const MAIL_BODY_PREFIX = "One Arcane Tome of Displacement requested through the portal. Request ID: ";
const PENDING_STALE_MS = 15_000;

export interface ArcaneTomeMetadata {
  enabled: boolean;
  name: typeof ARCANE_TOME_BOOST_NAME;
  itemName: typeof ARCANE_TOME_ITEM_NAME;
  itemCount: typeof ARCANE_TOME_ITEM_COUNT;
  repeatable: true;
}

export interface ArcaneTomeInput {
  requestId: string;
  characterId: string;
}

export interface ArcaneTomeSuccess {
  requestId: string;
  status: "sent";
  message: string;
  created: boolean;
}

export function arcaneTomeMetadata(config: ArcaneTomeBoostConfig): ArcaneTomeMetadata {
  return {
    enabled: config.enabled,
    name: ARCANE_TOME_BOOST_NAME,
    itemName: ARCANE_TOME_ITEM_NAME,
    itemCount: ARCANE_TOME_ITEM_COUNT,
    repeatable: true
  };
}

export function parseArcaneTomeInput(body: unknown): ArcaneTomeInput | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const source = body as Record<string, unknown>;
  if (
    Object.keys(source).some((key) => !["requestId", "characterId"].includes(key)) ||
    !isValidBoostRequestId(source.requestId) ||
    typeof source.characterId !== "string" ||
    parseBoostCharacterId(source.characterId) === undefined
  ) return undefined;
  return { requestId: source.requestId, characterId: source.characterId };
}

export function arcaneTomeMailBody(requestId: string): string {
  if (!isValidBoostRequestId(requestId)) {
    throw new BoostDataError("Arcane Tome boost request ID is invalid.");
  }
  return `${MAIL_BODY_PREFIX}${requestId}`;
}

export function buildSendArcaneTomeCommand(characterName: string, requestId: string): string {
  if (!isSafeBoostCharacterName(characterName)) {
    throw new BoostDataError("Boost character name is not safe for the compatible command parser.");
  }
  return `send items ${characterName} "${MAIL_SUBJECT}" "${arcaneTomeMailBody(requestId)}" ${ARCANE_TOME_ITEM_ENTRY}:${ARCANE_TOME_ITEM_COUNT}`;
}

export type ArcaneTomeCommandOutcome = "sent" | "failed" | "unknown";

export function classifyArcaneTomeCommandResult(
  result: SoapResult,
  characterName: string
): ArcaneTomeCommandOutcome {
  if (!result.ok) return "unknown";
  const output = result.output.trim();
  if (output === `Mail sent to ${characterName}`) return "sent";
  if (
    output === "Incorrect syntax." ||
    output === `Character '${characterName}' does not exist.` ||
    output === `'${characterName}' is not a valid character name.` ||
    output === `Item '${ARCANE_TOME_ITEM_ENTRY}' not found in database.` ||
    output === `Invalid item count (${ARCANE_TOME_ITEM_COUNT}) for item ${ARCANE_TOME_ITEM_ENTRY}`
  ) return "failed";
  return "unknown";
}

export interface ArcaneTomeBoostServiceDependencies {
  queryCharacters?: QueryOwnedCharacters;
  repository?: ArcaneTomeBoostRepository;
  executeCommand?: (command: string) => Promise<SoapResult>;
  getConfig?: () => ArcaneTomeBoostConfig;
  now?: () => Date;
}

function sentResult(record: ArcaneTomeBoostRecord, created: boolean): ArcaneTomeSuccess {
  return {
    requestId: record.requestId,
    status: "sent",
    message: `An Arcane Tome of Displacement was sent to ${record.characterName} by in-game mail.`,
    created
  };
}

export class ArcaneTomeBoostService {
  private readonly queryCharacters: QueryOwnedCharacters;
  private readonly repository: ArcaneTomeBoostRepository;
  private readonly executeCommand: (command: string) => Promise<SoapResult>;
  private readonly getConfig: () => ArcaneTomeBoostConfig;
  private readonly now: () => Date;

  constructor(dependencies: ArcaneTomeBoostServiceDependencies = {}) {
    this.queryCharacters = dependencies.queryCharacters ?? queryOwnedCharacters;
    this.repository = dependencies.repository ?? arcaneTomeBoostRepository;
    this.executeCommand = dependencies.executeCommand ?? executeAzerothCoreCommand;
    this.getConfig = dependencies.getConfig ?? readArcaneTomeBoostConfig;
    this.now = dependencies.now ?? (() => new Date());
  }

  readConfig(): ArcaneTomeBoostConfig {
    return this.getConfig();
  }

  async getMetadata(accountId: number): Promise<ArcaneTomeMetadata> {
    const config = this.getConfig();
    if (!config.enabled) return arcaneTomeMetadata(config);
    await this.reconcileStaleRequests(accountId);
    return arcaneTomeMetadata(config);
  }

  async requestArcaneTome(accountId: number, input: ArcaneTomeInput): Promise<ArcaneTomeSuccess> {
    const config = this.getConfig();
    if (!config.enabled) {
      throw new BoostRequestError("disabled", "This boost is currently unavailable.");
    }
    const validatedInput = parseArcaneTomeInput(input);
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
      throw new BoostRequestError("failed", "A tome cannot be sent to this character through the portal.");
    }
    const reservation = await this.repository.reserve({
      requestId: validatedInput.requestId,
      boostKey: ARCANE_TOME_BOOST_KEY,
      accountId,
      characterGuid,
      characterName: character.name,
      itemEntry: ARCANE_TOME_ITEM_ENTRY,
      itemCount: ARCANE_TOME_ITEM_COUNT
    });
    return this.handleReservation(reservation, character);
  }

  private async handleReservation(
    reservation: ReserveArcaneTomeBoostResult,
    character: OwnedBoostCharacter
  ): Promise<ArcaneTomeSuccess> {
    if (reservation.kind === "conflict") {
      throw new BoostRequestError("conflict", "That request ID was already used for different details.");
    }
    const record = reservation.record;
    if (reservation.kind === "existing") {
      if (record.status === "sent") return sentResult(record, false);
      if (record.status === "failed") {
        throw new BoostRequestError("failed", "The tome could not be sent. Start a new request later.");
      }
      if (record.status === "pending" && this.now().getTime() - record.createdAt.getTime() < PENDING_STALE_MS) {
        throw new BoostRequestError("processing", "That tome request is still processing.", record.requestId);
      }
      return this.reconcileOrUnknown(record);
    }

    let outcome: ArcaneTomeCommandOutcome = "unknown";
    try {
      outcome = classifyArcaneTomeCommandResult(
        await this.executeCommand(buildSendArcaneTomeCommand(character.name, record.requestId)),
        character.name
      );
    } catch {
      outcome = "unknown";
    }
    if (outcome === "sent") {
      await this.repository.mark(record.requestId, "sent", "command_confirmed");
      return sentResult(record, true);
    }
    if (outcome === "failed") {
      await this.repository.mark(record.requestId, "failed", "command_rejected");
      throw new BoostRequestError("failed", "The tome could not be sent. Start a new request later.");
    }
    return this.reconcileOrUnknown(record);
  }

  private async reconcileOrUnknown(record: ArcaneTomeBoostRecord): Promise<ArcaneTomeSuccess> {
    const match = await this.repository.inspectMatchingMail(
      record,
      MAIL_SUBJECT,
      arcaneTomeMailBody(record.requestId)
    );
    if (match === "exact") {
      await this.repository.mark(record.requestId, "sent", "mail_reconciled");
      return sentResult(record, false);
    }
    await this.markUnknown(record.requestId, match);
    throw new BoostRequestError(
      "unknown",
      "Delivery could not be confirmed and may already have arrived. Check your in-game mail before sending another tome.",
      record.requestId
    );
  }

  private async markUnknown(requestId: string, match: ArcaneTomeMailMatch): Promise<void> {
    await this.repository.mark(
      requestId,
      "unknown",
      match === "ambiguous" ? "mail_ambiguous" : "confirmation_missing"
    );
  }

  private async reconcileStaleRequests(accountId: number): Promise<void> {
    for (const record of await this.repository.findStalePending(accountId, PENDING_STALE_MS)) {
      const match = await this.repository.inspectMatchingMail(
        record,
        MAIL_SUBJECT,
        arcaneTomeMailBody(record.requestId)
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

export const arcaneTomeBoostService = new ArcaneTomeBoostService();
