import type { StatsPopulation } from "../stats/stats-population.js";
import { PortalApiError } from "./portal.js";

const MAX_ENTRIES = 25;
const UNAVAILABLE_MESSAGE = "Punching Up statistics are temporarily unavailable.";

export type PunchingUpType = "Player" | "Bot";
export type PunchingUpKillMethod = "direct" | "pet";

export interface PunchingUpEntry {
  characterName: string;
  race: string;
  class: string;
  level: number;
  accountLogin: string;
  type: PunchingUpType;
  actorLevelAtKill: number;
  creatureEntry: number;
  creatureName: string;
  creatureLevel: number;
  levelDelta: number;
  killMethod: PunchingUpKillMethod;
  occurredAt: string;
}

export interface PunchingUpResponse {
  generatedAt: string;
  population: StatsPopulation;
  coverage: { firstRecordedAt: string | null };
  count: number;
  entries: PunchingUpEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUtcIsoTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  ) return false;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 128 &&
    !/[\u0000-\u001f\u007f]/u.test(value) ? value : undefined;
}

function readInteger(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value >= minimum && value <= maximum ? value : undefined;
}

function parseEntry(value: unknown): PunchingUpEntry | undefined {
  if (!isRecord(value)) return undefined;
  const characterName = readString(value.characterName);
  const race = readString(value.race);
  const playerClass = readString(value.class);
  const accountLogin = readString(value.accountLogin);
  const creatureName = readString(value.creatureName);
  const level = readInteger(value.level, 1, 255);
  const actorLevelAtKill = readInteger(value.actorLevelAtKill, 1, 80);
  const creatureEntry = readInteger(value.creatureEntry, 1, 0xffff_ffff);
  const creatureLevel = readInteger(value.creatureLevel, 1, 255);
  const levelDelta = readInteger(value.levelDelta, 1, 254);
  if (
    !characterName || !race || !playerClass || !accountLogin || !creatureName ||
    level === undefined || actorLevelAtKill === undefined || creatureEntry === undefined ||
    creatureLevel === undefined || levelDelta === undefined ||
    creatureLevel - actorLevelAtKill !== levelDelta ||
    (value.type !== "Player" && value.type !== "Bot") ||
    (value.killMethod !== "direct" && value.killMethod !== "pet") ||
    !isUtcIsoTimestamp(value.occurredAt)
  ) return undefined;
  return {
    characterName,
    race,
    class: playerClass,
    level,
    accountLogin,
    type: value.type,
    actorLevelAtKill,
    creatureEntry,
    creatureName,
    creatureLevel,
    levelDelta,
    killMethod: value.killMethod,
    occurredAt: value.occurredAt
  };
}

export function parsePunchingUpResponse(
  value: unknown,
  expectedPopulation: StatsPopulation
): PunchingUpResponse {
  if (
    !isRecord(value) || !isUtcIsoTimestamp(value.generatedAt) ||
    value.population !== expectedPopulation || !isRecord(value.coverage) ||
    !(value.coverage.firstRecordedAt === null || isUtcIsoTimestamp(value.coverage.firstRecordedAt)) ||
    typeof value.count !== "number" || !Number.isInteger(value.count) ||
    value.count < 0 || value.count > MAX_ENTRIES || !Array.isArray(value.entries) ||
    value.entries.length !== value.count
  ) throw new PortalApiError(UNAVAILABLE_MESSAGE);
  const entries = value.entries.map(parseEntry);
  const firstRecordedAt = value.coverage.firstRecordedAt;
  if (
    entries.some((entry) => entry === undefined) ||
    (entries.length > 0 && firstRecordedAt === null) ||
    entries.some((entry) => entry !== undefined && firstRecordedAt !== null &&
      Date.parse(entry.occurredAt) < Date.parse(firstRecordedAt))
  ) throw new PortalApiError(UNAVAILABLE_MESSAGE);
  return {
    generatedAt: value.generatedAt,
    population: expectedPopulation,
    coverage: { firstRecordedAt },
    count: value.count,
    entries: entries as PunchingUpEntry[]
  };
}

export async function getPunchingUp(
  population: StatsPopulation,
  signal?: AbortSignal
): Promise<PunchingUpResponse> {
  const query = new URLSearchParams({ population });
  const response = await fetch(`/api/stats/punching-up?${query.toString()}`, {
    cache: "no-store",
    credentials: "same-origin",
    signal
  });
  if (!response.ok) throw new PortalApiError(UNAVAILABLE_MESSAGE);
  let body: unknown;
  try {
    body = await response.json() as unknown;
  } catch {
    throw new PortalApiError(UNAVAILABLE_MESSAGE);
  }
  return parsePunchingUpResponse(body, population);
}
