import type { StatsPopulation } from "../stats/stats-population.js";
import { PortalApiError } from "./portal.js";

const MAX_ENTRIES = 25;
const UNAVAILABLE_MESSAGE = "Public Enemy statistics are temporarily unavailable.";

export interface PublicEnemyEntry {
  creatureEntry: number;
  creatureName: string;
  kills: number;
  directKills: number;
  petKills: number;
}

export interface PublicEnemyResponse {
  generatedAt: string;
  population: StatsPopulation;
  coverage: { firstRecordedAt: string | null };
  entries: PublicEnemyEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function isUtcIsoTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  ) return false;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
}

function parseEntry(value: unknown): PublicEnemyEntry | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isSafeInteger(value.creatureEntry, 1) || value.creatureEntry > 0xffff_ffff ||
    typeof value.creatureName !== "string" || value.creatureName.length === 0 ||
    value.creatureName.length > 128 || /[\u0000-\u001f\u007f]/u.test(value.creatureName) ||
    !isSafeInteger(value.kills, 1) || !isSafeInteger(value.directKills) ||
    !isSafeInteger(value.petKills) || value.directKills + value.petKills !== value.kills
  ) return undefined;
  return {
    creatureEntry: value.creatureEntry,
    creatureName: value.creatureName,
    kills: value.kills,
    directKills: value.directKills,
    petKills: value.petKills
  };
}

export function parsePublicEnemyResponse(
  value: unknown,
  expectedPopulation: StatsPopulation
): PublicEnemyResponse {
  if (
    !isRecord(value) || !isUtcIsoTimestamp(value.generatedAt) ||
    value.population !== expectedPopulation || !isRecord(value.coverage) ||
    !(value.coverage.firstRecordedAt === null || isUtcIsoTimestamp(value.coverage.firstRecordedAt)) ||
    !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES
  ) throw new PortalApiError(UNAVAILABLE_MESSAGE);
  const entries = value.entries.map(parseEntry);
  if (entries.some((entry) => entry === undefined) ||
      (entries.length > 0 && value.coverage.firstRecordedAt === null) ||
      new Set(entries.map((entry) => entry?.creatureEntry)).size !== entries.length) {
    throw new PortalApiError(UNAVAILABLE_MESSAGE);
  }
  return {
    generatedAt: value.generatedAt,
    population: expectedPopulation,
    coverage: { firstRecordedAt: value.coverage.firstRecordedAt },
    entries: entries as PublicEnemyEntry[]
  };
}

export async function getPublicEnemy(
  population: StatsPopulation,
  signal?: AbortSignal
): Promise<PublicEnemyResponse> {
  const query = new URLSearchParams({ population });
  const response = await fetch(`/api/stats/public-enemy?${query.toString()}`, {
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
  return parsePublicEnemyResponse(body, population);
}
