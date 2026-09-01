import type { SoapResult } from "./azerothcore.js";
import { executeAzerothCoreCommand } from "./azerothcore.js";
import {
  readCharacterLevelBoostConfig,
  type CharacterLevelBoostConfig
} from "./boost-config.js";
import {
  characterLevelBoostRepository,
  CharacterLevelBoostRepository,
  type CharacterLevelBoostRecord,
  type ReserveCharacterLevelBoostResult
} from "./character-level-boost-repository.js";
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

export const CHARACTER_LEVEL_BOOST_KEY = "character-level-raise-v1";
export const CHARACTER_LEVEL_BOOST_NAME = "Level Up, Buttercup";
export const CHARACTER_LEVEL_MAXIMUM = 80;
const PENDING_STALE_MS = 15_000;
const CONFIRMATION_RETRY_DELAYS_MS = [50, 100, 200, 400, 800] as const;

type Sleep = (milliseconds: number) => Promise<void>;

export interface CharacterLevelMetadata {
  enabled: boolean;
  name: typeof CHARACTER_LEVEL_BOOST_NAME;
  maximumLevel: typeof CHARACTER_LEVEL_MAXIMUM;
  xpWillReset: true;
}

export interface CharacterLevelInput {
  requestId: string;
  characterId: string;
  targetLevel: number;
}

export interface CharacterLevelSuccess {
  requestId: string;
  status: "applied";
  character: { id: string; name: string; level: number };
  message: string;
  created: boolean;
}

export function characterLevelMetadata(config: CharacterLevelBoostConfig): CharacterLevelMetadata {
  return {
    enabled: config.enabled,
    name: CHARACTER_LEVEL_BOOST_NAME,
    maximumLevel: CHARACTER_LEVEL_MAXIMUM,
    xpWillReset: true
  };
}

export function parseCharacterLevelInput(body: unknown): CharacterLevelInput | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const source = body as Record<string, unknown>;
  if (
    Object.keys(source).some((key) => !["requestId", "characterId", "targetLevel"].includes(key)) ||
    !isValidBoostRequestId(source.requestId) ||
    typeof source.characterId !== "string" || parseBoostCharacterId(source.characterId) === undefined ||
    typeof source.targetLevel !== "number" || !Number.isInteger(source.targetLevel) ||
    source.targetLevel < 2 || source.targetLevel > CHARACTER_LEVEL_MAXIMUM
  ) return undefined;
  return { requestId: source.requestId, characterId: source.characterId, targetLevel: source.targetLevel };
}

export function buildCharacterLevelCommand(characterName: string, targetLevel: number): string {
  if (!isSafeBoostCharacterName(characterName)) {
    throw new BoostDataError("Boost character name is not safe for the compatible command parser.");
  }
  if (!Number.isInteger(targetLevel) || targetLevel < 2 || targetLevel > CHARACTER_LEVEL_MAXIMUM) {
    throw new BoostDataError("Character level boost target is invalid.");
  }
  return `character level ${characterName} ${targetLevel}`;
}

export type CharacterLevelCommandOutcome = "accepted" | "failed" | "unknown";

export function classifyCharacterLevelCommandResult(
  result: SoapResult,
  characterName: string,
  targetLevel: number
): CharacterLevelCommandOutcome {
  if (!result.ok) return "unknown";
  const output = result.output.trim();
  if (output === `You changed level of ${characterName} to ${targetLevel}.`) return "accepted";
  if (
    output === "Incorrect syntax." ||
    output === `Character '${characterName}' does not exist.` ||
    output === `'${characterName}' is not a valid character name.`
  ) return "failed";
  return "unknown";
}

export interface CharacterLevelBoostServiceDependencies {
  queryCharacters?: QueryOwnedCharacters;
  repository?: CharacterLevelBoostRepository;
  executeCommand?: (command: string) => Promise<SoapResult>;
  getConfig?: () => CharacterLevelBoostConfig;
  now?: () => Date;
  sleep?: Sleep;
}

function appliedResult(record: CharacterLevelBoostRecord, created: boolean): CharacterLevelSuccess {
  return {
    requestId: record.requestId,
    status: "applied",
    character: { id: String(record.characterGuid), name: record.characterName, level: record.targetLevel },
    message: `${record.characterName} is now level ${record.targetLevel}.`,
    created
  };
}

export class CharacterLevelBoostService {
  private readonly queryCharacters: QueryOwnedCharacters;
  private readonly repository: CharacterLevelBoostRepository;
  private readonly executeCommand: (command: string) => Promise<SoapResult>;
  private readonly getConfig: () => CharacterLevelBoostConfig;
  private readonly now: () => Date;
  private readonly sleep: Sleep;

  constructor(dependencies: CharacterLevelBoostServiceDependencies = {}) {
    this.queryCharacters = dependencies.queryCharacters ?? queryOwnedCharacters;
    this.repository = dependencies.repository ?? characterLevelBoostRepository;
    this.executeCommand = dependencies.executeCommand ?? executeAzerothCoreCommand;
    this.getConfig = dependencies.getConfig ?? readCharacterLevelBoostConfig;
    this.now = dependencies.now ?? (() => new Date());
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    }));
  }

  readConfig(): CharacterLevelBoostConfig { return this.getConfig(); }

  async getMetadata(accountId: number): Promise<CharacterLevelMetadata> {
    let config: CharacterLevelBoostConfig;
    try {
      config = this.getConfig();
    } catch {
      return characterLevelMetadata({ enabled: false });
    }
    if (config.enabled) await this.reconcileStaleRequests(accountId);
    return characterLevelMetadata(config);
  }

  async requestCharacterLevel(accountId: number, input: CharacterLevelInput): Promise<CharacterLevelSuccess> {
    if (!this.getConfig().enabled) {
      throw new BoostRequestError("disabled", "This boost is currently unavailable.");
    }
    const validated = parseCharacterLevelInput(input);
    if (!validated) {
      throw new BoostRequestError("invalid", "Enter a valid character, request ID, and target level.");
    }
    const characterGuid = parseBoostCharacterId(validated.characterId)!;
    return this.repository.withCharacterLock(characterGuid, async () => {
      const character = await this.readOwnedCharacter(accountId, characterGuid);
      if (!character) {
        throw new BoostRequestError("ownership", "That character is not available for this account.");
      }
      if (!isSafeBoostCharacterName(character.name)) {
        throw new BoostRequestError("failed", "This character cannot be leveled through the portal.");
      }

      const existing = await this.repository.find(validated.requestId);
      if (existing) {
        return this.handleExisting(existing, accountId, characterGuid, validated.targetLevel);
      }
      if (validated.targetLevel <= character.level) {
        throw new BoostRequestError(
          "conflict",
          "Choose a target above the character's current level. Refresh the page and try again."
        );
      }
      const reservation = await this.repository.reserve({
        requestId: validated.requestId,
        boostKey: CHARACTER_LEVEL_BOOST_KEY,
        accountId,
        characterGuid,
        characterName: character.name,
        startingLevel: character.level,
        targetLevel: validated.targetLevel
      });
      return this.handleReservation(reservation, accountId, characterGuid, validated.targetLevel);
    });
  }

  private async readOwnedCharacter(accountId: number, characterGuid: number): Promise<OwnedBoostCharacter | undefined> {
    const characters = mapOwnedCharacterRows(await this.queryCharacters(accountId, characterGuid));
    const character = characters.length === 1 ? characters[0] : undefined;
    return character?.guid === characterGuid ? character : undefined;
  }

  private async handleExisting(
    record: CharacterLevelBoostRecord,
    accountId: number,
    characterGuid: number,
    targetLevel: number
  ): Promise<CharacterLevelSuccess> {
    if (
      record.boostKey !== CHARACTER_LEVEL_BOOST_KEY || record.accountId !== accountId ||
      record.characterGuid !== characterGuid || record.targetLevel !== targetLevel
    ) throw new BoostRequestError("conflict", "That request ID was already used for different details.");
    if (record.status === "applied") return appliedResult(record, false);
    if (record.status === "failed") {
      throw new BoostRequestError("failed", "The character level could not be changed. Start a new request later.");
    }
    if (record.status === "pending" && this.now().getTime() - record.createdAt.getTime() < PENDING_STALE_MS) {
      throw new BoostRequestError("processing", "That level request is still processing.", record.requestId);
    }
    return this.reconcileOrUnknown(record, accountId);
  }

  private async handleReservation(
    reservation: ReserveCharacterLevelBoostResult,
    accountId: number,
    characterGuid: number,
    targetLevel: number
  ): Promise<CharacterLevelSuccess> {
    if (reservation.kind === "conflict") {
      throw new BoostRequestError("conflict", "That request ID was already used for different details.");
    }
    if (reservation.kind === "existing") {
      return this.handleExisting(
        reservation.record,
        accountId,
        characterGuid,
        targetLevel
      );
    }
    const record = reservation.record;
    let outcome: CharacterLevelCommandOutcome = "unknown";
    try {
      outcome = classifyCharacterLevelCommandResult(
        await this.executeCommand(buildCharacterLevelCommand(record.characterName, record.targetLevel)),
        record.characterName,
        record.targetLevel
      );
    } catch {
      outcome = "unknown";
    }
    if (outcome === "failed") {
      await this.repository.mark(record.requestId, "failed", "command_rejected");
      throw new BoostRequestError("failed", "The character level could not be changed. Start a new request later.");
    }
    return this.reconcileOrUnknown(record, accountId, reservation.kind === "inserted");
  }

  private async reconcileOrUnknown(
    record: CharacterLevelBoostRecord,
    accountId: number,
    created = false
  ): Promise<CharacterLevelSuccess> {
    const resultingLevel = await this.readLevelAfterCommand(record, accountId);
    if (resultingLevel === record.targetLevel) {
      await this.repository.mark(record.requestId, "applied", "level_confirmed", resultingLevel);
      return appliedResult(record, created);
    }
    await this.repository.mark(
      record.requestId,
      "unknown",
      resultingLevel === undefined ? "confirmation_missing" : "level_mismatch",
      resultingLevel
    );
    throw new BoostRequestError(
      "unknown",
      "The level change could not be confirmed. Do not submit it again; give this request ID to an administrator.",
      record.requestId
    );
  }

  private async readLevelAfterCommand(
    record: CharacterLevelBoostRecord,
    accountId: number
  ): Promise<number | undefined> {
    let resultingLevel: number | undefined;
    for (let attempt = 0; attempt <= CONFIRMATION_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        resultingLevel = (await this.readOwnedCharacter(accountId, record.characterGuid))?.level;
      } catch {
        return undefined;
      }
      if (resultingLevel === record.targetLevel) return resultingLevel;
      const delay = CONFIRMATION_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      await this.sleep(delay);
    }
    return resultingLevel;
  }

  private async reconcileStaleRequests(accountId: number): Promise<void> {
    for (const record of await this.repository.findStalePending(accountId, PENDING_STALE_MS)) {
      await this.repository.withCharacterLock(record.characterGuid, async () => {
        let level: number | undefined;
        try { level = (await this.readOwnedCharacter(accountId, record.characterGuid))?.level; } catch { level = undefined; }
        await this.repository.mark(
          record.requestId,
          level === record.targetLevel ? "applied" : "unknown",
          level === record.targetLevel ? "level_confirmed" : level === undefined ? "stale_unavailable" : "level_mismatch",
          level
        );
      });
    }
  }
}

export const characterLevelBoostService = new CharacterLevelBoostService();
