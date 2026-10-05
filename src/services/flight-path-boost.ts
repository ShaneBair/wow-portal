import { readFlightPathsBoostConfig, type FlightPathsBoostConfig } from "./boost-config.js";
import {
  flightPathBoostRepository,
  FlightPathCharacterConflictError,
  type FlightPathBoostRecord,
  type FlightPathBoostRepositoryPort,
  type FlightPathFaction,
  type LockedFlightPathCharacter
} from "./flight-path-boost-repository.js";
import {
  FLIGHT_PATH_GRANT_ARTIFACT,
  FLIGHT_PATH_MASK_REVISION,
  FLIGHT_PATH_MASK_WORDS,
  validateFlightPathGrantArtifact,
  type FlightPathGrantArtifact
} from "./flight-path-masks.js";
import { BoostDataError, BoostRequestError, isValidBoostRequestId, parseBoostCharacterId } from "./player-boosts.js";

export const FLIGHT_PATH_BOOST_KEY = "flight-paths-v1";
export const FLIGHT_PATH_BOOST_NAME = "Flight Risk";
const DEATH_KNIGHT_CLASS_ID = 6;
const SUPPORTED_CLASSES = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11]);
const ALLIANCE_RACES = new Set([1, 3, 4, 7, 11]);
const HORDE_RACES = new Set([2, 5, 6, 8, 10]);

export interface FlightPathsMetadata {
  enabled: boolean;
  name: typeof FLIGHT_PATH_BOOST_NAME;
  requiresOffline: true;
}

export interface FlightPathInput { requestId: string; characterId: string; }

export interface FlightPathSuccess {
  requestId: string;
  status: "applied";
  result: "learned" | "already-known";
  message: string;
  created: boolean;
}

export function flightPathsMetadata(config: FlightPathsBoostConfig): FlightPathsMetadata {
  return { enabled: config.enabled, name: FLIGHT_PATH_BOOST_NAME, requiresOffline: true };
}

export function parseFlightPathInput(body: unknown): FlightPathInput | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const value = body as Record<string, unknown>;
  if (
    Object.keys(value).length !== 2 || Object.keys(value).some((key) => !["requestId", "characterId"].includes(key)) ||
    !isValidBoostRequestId(value.requestId) || parseBoostCharacterId(value.characterId) === undefined
  ) return undefined;
  return { requestId: value.requestId, characterId: value.characterId as string };
}

export function parseTaxiMask(value: string): number[] {
  if (!/^(?:\d+(?: \d+){0,13} ?)?$/u.test(value)) throw new BoostDataError("Stored taxi mask is malformed.");
  const tokens = value.trim() === "" ? [] : value.trim().split(" ");
  const words = tokens.map((token) => {
    const word = Number(token);
    if (!Number.isSafeInteger(word) || word < 0 || word > 0xffff_ffff) {
      throw new BoostDataError("Stored taxi mask is malformed.");
    }
    return word;
  });
  return [...words, ...Array<number>(FLIGHT_PATH_MASK_WORDS - words.length).fill(0)];
}

export function serializeTaxiMask(words: readonly number[]): string {
  if (words.length !== FLIGHT_PATH_MASK_WORDS || words.some((word) => !Number.isSafeInteger(word) || word < 0 || word > 0xffff_ffff)) {
    throw new BoostDataError("Taxi mask result is invalid.");
  }
  return `${words.join(" ")} `;
}

export function factionForRace(raceId: number): FlightPathFaction {
  if (ALLIANCE_RACES.has(raceId)) return "alliance";
  if (HORDE_RACES.has(raceId)) return "horde";
  throw new BoostDataError("Character race is not supported for Flight Risk.");
}

export function calculateFlightPathGrant(
  character: Pick<LockedFlightPathCharacter, "raceId" | "classId" | "online" | "taxiMask">,
  artifact: FlightPathGrantArtifact = FLIGHT_PATH_GRANT_ARTIFACT
): { faction: FlightPathFaction; result: "learned" | "already-known"; newMask: string } {
  validateFlightPathGrantArtifact(artifact);
  if (character.online) throw new BoostRequestError("conflict", "Log out of this character before applying Flight Risk.");
  if (!SUPPORTED_CLASSES.has(character.classId)) throw new BoostDataError("Character class is not supported for Flight Risk.");
  const faction = factionForRace(character.raceId);
  const current = parseTaxiMask(character.taxiMask);
  const factionMask = artifact[faction];
  const resultWords = current.map((word, index) => {
    const grant = character.classId === DEATH_KNIGHT_CLASS_ID
      ? (factionMask[index]! | artifact.deathKnight[index]!) >>> 0
      : factionMask[index]!;
    return (word | grant) >>> 0;
  });
  const changed = resultWords.some((word, index) => word !== current[index]);
  return { faction, result: changed ? "learned" : "already-known", newMask: serializeTaxiMask(resultWords) };
}

function success(record: FlightPathBoostRecord, created: boolean): FlightPathSuccess {
  const faction = record.faction === "alliance" ? "Alliance" : "Horde";
  return {
    requestId: record.requestId, status: "applied", result: record.result, created,
    message: record.result === "learned"
      ? `${record.characterName} learned all available ${faction} flight paths.`
      : `${record.characterName} already knows all available ${faction} flight paths.`
  };
}

export interface FlightPathBoostServiceDependencies {
  repository?: FlightPathBoostRepositoryPort;
  getConfig?: () => FlightPathsBoostConfig;
  artifact?: FlightPathGrantArtifact;
}

export class FlightPathBoostService {
  private readonly repository: FlightPathBoostRepositoryPort;
  private readonly getConfig: () => FlightPathsBoostConfig;
  private readonly artifact: FlightPathGrantArtifact;

  constructor(dependencies: FlightPathBoostServiceDependencies = {}) {
    this.repository = dependencies.repository ?? flightPathBoostRepository;
    this.getConfig = dependencies.getConfig ?? readFlightPathsBoostConfig;
    this.artifact = dependencies.artifact ?? FLIGHT_PATH_GRANT_ARTIFACT;
  }

  readConfig(): FlightPathsBoostConfig { return this.getConfig(); }

  getMetadata(): FlightPathsMetadata {
    try {
      const config = this.getConfig();
      validateFlightPathGrantArtifact(this.artifact);
      return flightPathsMetadata(config);
    } catch { return flightPathsMetadata({ enabled: false }); }
  }

  async requestFlightPaths(accountId: number, input: FlightPathInput): Promise<FlightPathSuccess> {
    if (!this.getConfig().enabled) throw new BoostRequestError("disabled", "This boost is currently unavailable.");
    validateFlightPathGrantArtifact(this.artifact);
    const validated = parseFlightPathInput(input);
    if (!validated) throw new BoostRequestError("invalid", "Enter a valid character and request ID.");
    let result;
    try {
      result = await this.repository.apply({
        requestId: validated.requestId, boostKey: FLIGHT_PATH_BOOST_KEY, accountId,
        characterGuid: parseBoostCharacterId(validated.characterId)!, maskRevision: FLIGHT_PATH_MASK_REVISION
      }, (character) => calculateFlightPathGrant(character, this.artifact));
    } catch (error) {
      if (error instanceof FlightPathCharacterConflictError) {
        throw new BoostRequestError("conflict", "The character changed while Flight Risk was being applied. Log out and try again.");
      }
      throw error;
    }
    if (result.kind === "ownership") throw new BoostRequestError("ownership", "That character is not available for this account.");
    if (result.kind === "conflict") throw new BoostRequestError("conflict", "That request ID was already used for different details.");
    if (result.kind === "processing") throw new BoostRequestError("processing", "That flight-path request is still processing.", result.requestId);
    return success(result.record, result.created);
  }
}

export const flightPathBoostService = new FlightPathBoostService();
