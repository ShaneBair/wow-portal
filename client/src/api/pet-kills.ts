import type { StatsPopulation } from "../stats/stats-population.js";
import { PortalApiError } from "./portal.js";

const MAX_ENTRIES = 25;
const UNAVAILABLE_MESSAGE = "Pet kill statistics are temporarily unavailable.";

export type PetKillType = "Player" | "Bot";

export interface PetKillEntry {
  characterName: string;
  race: string;
  class: string;
  level: number;
  accountLogin: string;
  type: PetKillType;
  petKills: number;
  directKills: number;
  totalKills: number;
  petKillPercent: number;
}

export interface PetKillResponse {
  generatedAt: string;
  population: StatsPopulation;
  coverage: { firstRecordedAt: string | null };
  count: number;
  entries: PetKillEntry[];
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

function expectedPetPercent(petKills: number, totalKills: number): number {
  const tenths = (BigInt(petKills) * 1000n + BigInt(totalKills) / 2n) / BigInt(totalKills);
  return Number(tenths) / 10;
}

function parseEntry(value: unknown): PetKillEntry | undefined {
  if (!isRecord(value)) return undefined;
  const characterName = readString(value.characterName);
  const race = readString(value.race);
  const playerClass = readString(value.class);
  const accountLogin = readString(value.accountLogin);
  const level = readInteger(value.level, 1, 255);
  const petKills = readInteger(value.petKills, 1);
  const directKills = readInteger(value.directKills, 0);
  const totalKills = readInteger(value.totalKills, 1);
  if (
    !characterName || !race || !playerClass || !accountLogin || level === undefined ||
    petKills === undefined || directKills === undefined || totalKills === undefined ||
    !Number.isSafeInteger(petKills + directKills) || petKills + directKills !== totalKills ||
    (value.type !== "Player" && value.type !== "Bot") ||
    typeof value.petKillPercent !== "number" || !Number.isFinite(value.petKillPercent) ||
    value.petKillPercent !== expectedPetPercent(petKills, totalKills)
  ) return undefined;
  return {
    characterName,
    race,
    class: playerClass,
    level,
    accountLogin,
    type: value.type,
    petKills,
    directKills,
    totalKills,
    petKillPercent: value.petKillPercent
  };
}

export function parsePetKillResponse(
  value: unknown,
  expectedPopulation: StatsPopulation
): PetKillResponse {
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
    entries: entries as PetKillEntry[]
  };
}

export async function getPetKills(
  population: StatsPopulation,
  signal?: AbortSignal
): Promise<PetKillResponse> {
  const query = new URLSearchParams({ population });
  const response = await fetch(`/api/stats/pet-kills?${query.toString()}`, {
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
  return parsePetKillResponse(body, population);
}
