import type { StatsPopulation } from "../stats/stats-population.js";
import { PortalApiError } from "./portal.js";

const MAX_ENTRIES = 25;
const UNAVAILABLE_MESSAGE = "Bad Neighborhood statistics are temporarily unavailable.";

export interface BadNeighborhoodEntry {
  zoneId: number;
  zoneName: string;
  deaths: number;
  uniqueVictims: number;
}

export interface BadNeighborhoodResponse {
  generatedAt: string;
  population: StatsPopulation;
  coverage: { comprehensiveSince: string };
  omittedUnknownZoneDeaths: number;
  entries: BadNeighborhoodEntry[];
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

function parseEntry(value: unknown): BadNeighborhoodEntry | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isSafeInteger(value.zoneId, 1) || value.zoneId > 0xffff_ffff ||
    typeof value.zoneName !== "string" || value.zoneName.length === 0 ||
    value.zoneName.length > 128 || /[\u0000-\u001f\u007f]/u.test(value.zoneName) ||
    !isSafeInteger(value.deaths, 1) || !isSafeInteger(value.uniqueVictims, 1) ||
    value.uniqueVictims > value.deaths
  ) return undefined;
  return {
    zoneId: value.zoneId,
    zoneName: value.zoneName,
    deaths: value.deaths,
    uniqueVictims: value.uniqueVictims
  };
}

export function parseBadNeighborhoodResponse(
  value: unknown,
  expectedPopulation: StatsPopulation
): BadNeighborhoodResponse {
  if (
    !isRecord(value) || !isUtcIsoTimestamp(value.generatedAt) ||
    value.population !== expectedPopulation || !isRecord(value.coverage) ||
    !isUtcIsoTimestamp(value.coverage.comprehensiveSince) ||
    !isSafeInteger(value.omittedUnknownZoneDeaths) ||
    !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES
  ) throw new PortalApiError(UNAVAILABLE_MESSAGE);
  const entries = value.entries.map(parseEntry);
  if (entries.some((entry) => entry === undefined)) {
    throw new PortalApiError(UNAVAILABLE_MESSAGE);
  }
  return {
    generatedAt: value.generatedAt,
    population: expectedPopulation,
    coverage: { comprehensiveSince: value.coverage.comprehensiveSince },
    omittedUnknownZoneDeaths: value.omittedUnknownZoneDeaths,
    entries: entries as BadNeighborhoodEntry[]
  };
}

export async function getBadNeighborhood(
  population: StatsPopulation,
  signal?: AbortSignal
): Promise<BadNeighborhoodResponse> {
  const query = new URLSearchParams({ population });
  const response = await fetch(`/api/stats/bad-neighborhood?${query.toString()}`, {
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
  return parseBadNeighborhoodResponse(body, population);
}
