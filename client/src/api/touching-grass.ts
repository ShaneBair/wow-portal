import type { StatsPopulation } from "../stats/stats-population.js";
import { PortalApiError } from "./portal.js";

const MAX_ENTRIES = 25;
const UNAVAILABLE_MESSAGE = "Touching Grass statistics are temporarily unavailable.";

export type TouchingGrassType = "Player" | "Bot";

export interface TouchingGrassEntry {
  characterName: string;
  race: string;
  class: string;
  level: number;
  accountLogin: string;
  type: TouchingGrassType;
  zonesVisited: number;
  mapsVisited: number;
  firstRecordedAt: string;
  lastRecordedAt: string;
}

export interface TouchingGrassResponse {
  generatedAt: string;
  population: StatsPopulation;
  coverage: { firstRecordedAt: string | null };
  count: number;
  entries: TouchingGrassEntry[];
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

function parseEntry(value: unknown): TouchingGrassEntry | undefined {
  if (!isRecord(value)) return undefined;
  const characterName = readString(value.characterName);
  const race = readString(value.race);
  const playerClass = readString(value.class);
  const accountLogin = readString(value.accountLogin);
  const level = readInteger(value.level, 1, 255);
  const zonesVisited = readInteger(value.zonesVisited, 1, 0xffff_ffff);
  const mapsVisited = readInteger(value.mapsVisited, 0, 0xffff_ffff);
  if (
    !characterName || !race || !playerClass || !accountLogin || level === undefined ||
    zonesVisited === undefined || mapsVisited === undefined ||
    (value.type !== "Player" && value.type !== "Bot") ||
    !isUtcIsoTimestamp(value.firstRecordedAt) || !isUtcIsoTimestamp(value.lastRecordedAt) ||
    Date.parse(value.firstRecordedAt) > Date.parse(value.lastRecordedAt)
  ) return undefined;
  return {
    characterName,
    race,
    class: playerClass,
    level,
    accountLogin,
    type: value.type,
    zonesVisited,
    mapsVisited,
    firstRecordedAt: value.firstRecordedAt,
    lastRecordedAt: value.lastRecordedAt
  };
}

export function parseTouchingGrassResponse(
  value: unknown,
  expectedPopulation: StatsPopulation
): TouchingGrassResponse {
  if (
    !isRecord(value) || !isUtcIsoTimestamp(value.generatedAt) ||
    value.population !== expectedPopulation || !isRecord(value.coverage) ||
    !(value.coverage.firstRecordedAt === null || isUtcIsoTimestamp(value.coverage.firstRecordedAt)) ||
    typeof value.count !== "number" || !Number.isInteger(value.count) ||
    value.count < 0 || value.count > MAX_ENTRIES || !Array.isArray(value.entries) ||
    value.entries.length !== value.count
  ) throw new PortalApiError(UNAVAILABLE_MESSAGE);
  const entries = value.entries.map(parseEntry);
  if (entries.some((entry) => entry === undefined) ||
      (entries.length > 0 && value.coverage.firstRecordedAt === null)) {
    throw new PortalApiError(UNAVAILABLE_MESSAGE);
  }
  return {
    generatedAt: value.generatedAt,
    population: expectedPopulation,
    coverage: { firstRecordedAt: value.coverage.firstRecordedAt },
    count: value.count,
    entries: entries as TouchingGrassEntry[]
  };
}

export async function getTouchingGrass(
  population: StatsPopulation,
  signal?: AbortSignal
): Promise<TouchingGrassResponse> {
  const query = new URLSearchParams({ population });
  const response = await fetch(`/api/stats/touching-grass?${query.toString()}`, {
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
  return parseTouchingGrassResponse(body, population);
}
