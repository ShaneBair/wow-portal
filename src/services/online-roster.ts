import { getClassName, getRaceName, isKnownClass, isKnownRace } from "../domain/wotlk.js";
import {
  executeAzerothCoreCommand,
  type SoapResult
} from "./azerothcore.js";

const COMMAND = "playerstats online";
const MARKER = "PLAYERSTATS_ONLINE_V1 ";
const MARKER_PREFIX = "PLAYERSTATS_ONLINE_";
const CACHE_TTL_MS = 10_000;
const MAX_COMMAND_OUTPUT_BYTES = 512 * 1024;
const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_UINT32 = 0xffff_ffff;
const MAX_UNIX_SECONDS_FOR_ISO = 253_402_300_799;

type ProviderPlayer = {
  accountId: number;
  accountLogin: string;
  characterGuid: number;
  characterName: string;
  raceId: number;
  classId: number;
  level: number;
  mapId: number;
  zoneId: number;
  areaId: number;
  location: string;
};

export type OnlinePlayer = {
  accountLogin: string;
  characterName: string;
  race: string;
  class: string;
  level: number;
  location: string;
};

export type OnlinePlayersResponse = {
  generatedAt: string;
  count: number;
  players: OnlinePlayer[];
};

export class OnlineRosterError extends Error {
  constructor(
    message: string,
    public readonly code: "command_failed" | "payload_invalid" | "unsupported_version"
  ) {
    super(message);
    this.name = "OnlineRosterError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  source: Record<string, unknown>,
  key: string,
  maxLength: number
): string {
  const value = source[key];

  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new OnlineRosterError(`Online roster field ${key} is invalid.`, "payload_invalid");
  }

  return value;
}

function requireInteger(
  source: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number
): number {
  const value = source[key];

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new OnlineRosterError(`Online roster field ${key} is invalid.`, "payload_invalid");
  }

  return value;
}

function validateProviderPlayer(value: unknown): ProviderPlayer {
  if (!isRecord(value)) {
    throw new OnlineRosterError("Online roster contains an invalid player.", "payload_invalid");
  }

  return {
    accountId: requireInteger(value, "accountId", 0, MAX_UINT32),
    accountLogin: requireString(value, "accountLogin", 128),
    characterGuid: requireInteger(value, "characterGuid", 0, MAX_UINT32),
    characterName: requireString(value, "characterName", 128),
    raceId: requireInteger(value, "raceId", 0, 255),
    classId: requireInteger(value, "classId", 0, 255),
    level: requireInteger(value, "level", 1, 255),
    mapId: requireInteger(value, "mapId", 0, MAX_UINT32),
    zoneId: requireInteger(value, "zoneId", 0, MAX_UINT32),
    areaId: requireInteger(value, "areaId", 0, MAX_UINT32),
    location: requireString(value, "location", 512)
  };
}

function extractPayloadJson(output: string): string {
  if (Buffer.byteLength(output, "utf8") > MAX_COMMAND_OUTPUT_BYTES) {
    throw new OnlineRosterError("Online roster command output is too large.", "payload_invalid");
  }

  const markerLines = output
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(MARKER_PREFIX));

  if (markerLines.length === 0) {
    throw new OnlineRosterError("Online roster marker is missing.", "command_failed");
  }

  if (markerLines.length !== 1) {
    throw new OnlineRosterError("Online roster marker is duplicated.", "payload_invalid");
  }

  const markerLine = markerLines[0];

  if (!markerLine.startsWith(MARKER)) {
    const version = markerLine.slice(MARKER_PREFIX.length).split(/\s/u, 1)[0] || "unknown";
    console.warn(`Unsupported online roster provider version: ${version}.`);
    throw new OnlineRosterError("Online roster version is unsupported.", "unsupported_version");
  }

  const payloadJson = markerLine.slice(MARKER.length);

  if (
    payloadJson.length === 0 ||
    Buffer.byteLength(payloadJson, "utf8") > MAX_PAYLOAD_BYTES
  ) {
    throw new OnlineRosterError("Online roster payload size is invalid.", "payload_invalid");
  }

  return payloadJson;
}

export function parseOnlineRosterOutput(output: string): OnlinePlayersResponse {
  const payloadJson = extractPayloadJson(output);
  let payload: unknown;

  try {
    payload = JSON.parse(payloadJson);
  } catch {
    throw new OnlineRosterError("Online roster payload is not valid JSON.", "payload_invalid");
  }

  if (!isRecord(payload) || !Array.isArray(payload.players)) {
    throw new OnlineRosterError("Online roster payload has an invalid shape.", "payload_invalid");
  }

  const generatedAt = requireInteger(
    payload,
    "generatedAt",
    0,
    MAX_UNIX_SECONDS_FOR_ISO
  );
  const providerPlayers = payload.players.map(validateProviderPlayer);
  const unknownRaceIds = new Set<number>();
  const unknownClassIds = new Set<number>();

  const players = providerPlayers.map<OnlinePlayer>((player) => {
    if (!isKnownRace(player.raceId)) {
      unknownRaceIds.add(player.raceId);
    }

    if (!isKnownClass(player.classId)) {
      unknownClassIds.add(player.classId);
    }

    return {
      accountLogin: player.accountLogin,
      characterName: player.characterName,
      race: getRaceName(player.raceId),
      class: getClassName(player.classId),
      level: player.level,
      location: player.location
    };
  });

  for (const raceId of unknownRaceIds) {
    console.warn(`Unknown WotLK race ID received from online roster: ${raceId}.`);
  }

  for (const classId of unknownClassIds) {
    console.warn(`Unknown WotLK class ID received from online roster: ${classId}.`);
  }

  players.sort((left, right) => {
    const characterOrder = left.characterName.localeCompare(right.characterName, undefined, {
      sensitivity: "base"
    });

    if (characterOrder !== 0) {
      return characterOrder;
    }

    return left.accountLogin.localeCompare(right.accountLogin, undefined, { sensitivity: "base" });
  });

  return {
    generatedAt: new Date(generatedAt * 1000).toISOString(),
    count: players.length,
    players
  };
}

type ExecuteCommand = (command: string) => Promise<SoapResult>;

export class OnlineRosterService {
  private cached: { value: OnlinePlayersResponse; expiresAt: number } | undefined;
  private inFlight: Promise<OnlinePlayersResponse> | undefined;

  constructor(
    private readonly executeCommand: ExecuteCommand = executeAzerothCoreCommand,
    private readonly now: () => number = Date.now
  ) {}

  async getOnlinePlayers(): Promise<OnlinePlayersResponse> {
    const now = this.now();

    if (this.cached && now < this.cached.expiresAt) {
      return this.cached.value;
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    const refresh = this.refresh();
    const trackedRefresh = refresh.finally(() => {
      if (this.inFlight === trackedRefresh) {
        this.inFlight = undefined;
      }
    });
    this.inFlight = trackedRefresh;
    return trackedRefresh;
  }

  private async refresh(): Promise<OnlinePlayersResponse> {
    const result = await this.executeCommand(COMMAND);

    if (!result.ok) {
      throw new OnlineRosterError("Online roster command failed.", "command_failed");
    }

    const roster = parseOnlineRosterOutput(result.output);
    this.cached = { value: roster, expiresAt: this.now() + CACHE_TTL_MS };
    return roster;
  }
}

const onlineRosterService = new OnlineRosterService();

export function getOnlinePlayers(): Promise<OnlinePlayersResponse> {
  return onlineRosterService.getOnlinePlayers();
}
