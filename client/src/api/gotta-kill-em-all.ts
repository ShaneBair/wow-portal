import type { StatsPopulation } from "../stats/stats-population.js";
import { PortalApiError } from "./portal.js";

const MAX_ENTRIES = 25;
const UNAVAILABLE_MESSAGE = "Creature variety statistics are temporarily unavailable.";

export type GottaKillEmAllType = "Player" | "Bot";

export interface GottaKillEmAllEntry {
  characterName: string;
  race: string;
  class: string;
  level: number;
  accountName: string;
  type: GottaKillEmAllType;
  uniqueCreatures: number;
  totalKills: number;
}

export interface GottaKillEmAllResponse {
  generatedAt: string;
  population: StatsPopulation;
  coverage: { firstRecordedAt: string | null };
  count: number;
  entries: GottaKillEmAllEntry[];
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

function parseEntry(value: unknown): GottaKillEmAllEntry | undefined {
  if (!isRecord(value)) return undefined;
  const characterName = readString(value.characterName);
  const race = readString(value.race);
  const playerClass = readString(value.class);
  const accountName = readString(value.accountName);
  const level = readInteger(value.level, 1, 255);
  const uniqueCreatures = readInteger(value.uniqueCreatures, 1);
  const totalKills = readInteger(value.totalKills, 1);
  if (
    !characterName || !race || !playerClass || !accountName || accountName !== accountName.toUpperCase() ||
    level === undefined || uniqueCreatures === undefined || totalKills === undefined ||
    uniqueCreatures > totalKills || (value.type !== "Player" && value.type !== "Bot")
  ) return undefined;
  return {
    characterName,
    race,
    class: playerClass,
    level,
    accountName,
    type: value.type,
    uniqueCreatures,
    totalKills
  };
}

export function parseGottaKillEmAllResponse(
  value: unknown,
  expectedPopulation: StatsPopulation
): GottaKillEmAllResponse {
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
    entries: entries as GottaKillEmAllEntry[]
  };
}

export async function getGottaKillEmAll(
  population: StatsPopulation,
  signal?: AbortSignal
): Promise<GottaKillEmAllResponse> {
  const query = new URLSearchParams({ population });
  const response = await fetch(`/api/stats/gotta-kill-em-all?${query.toString()}`, {
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
  return parseGottaKillEmAllResponse(body, population);
}
