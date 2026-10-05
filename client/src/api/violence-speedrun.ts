import type { StatsPopulation } from "../stats/stats-population.js";
import { PortalApiError } from "./portal.js";

const UNAVAILABLE_MESSAGE = "Violence Speedrun statistics are temporarily unavailable.";
const MAX_ENTRIES = 25;

export interface ViolenceSpeedrunEntry {
  characterName: string;
  race: string;
  class: string;
  level: number;
  accountLogin: string;
  type: "Player" | "Bot";
  bucketStart: string;
  bucketEnd: string;
  kills: number;
  directKills: number;
  petKills: number;
}

export interface ViolenceSpeedrunResponse {
  generatedAt: string;
  population: StatsPopulation;
  coverage: { firstRecordedAt: string | null };
  count: number;
  entries: ViolenceSpeedrunEntry[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(value);
}

function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function entry(value: unknown): ViolenceSpeedrunEntry | undefined {
  if (!record(value) || !text(value.characterName) || !text(value.race) || !text(value.class) ||
      !text(value.accountLogin) || !integer(value.level, 1, 255) ||
      (value.type !== "Player" && value.type !== "Bot") ||
      !timestamp(value.bucketStart) || !timestamp(value.bucketEnd) ||
      !integer(value.kills, 1) || !integer(value.directKills, 0) || !integer(value.petKills, 0) ||
      value.directKills + value.petKills !== value.kills ||
      new Date(value.bucketStart).getUTCMinutes() !== 0 ||
      new Date(value.bucketEnd).getTime() - new Date(value.bucketStart).getTime() !== 3_600_000) return undefined;
  return value as unknown as ViolenceSpeedrunEntry;
}

export function parseViolenceSpeedrunResponse(value: unknown, population: StatsPopulation): ViolenceSpeedrunResponse {
  if (!record(value) || !timestamp(value.generatedAt) || value.population !== population || !record(value.coverage) ||
      !(value.coverage.firstRecordedAt === null || timestamp(value.coverage.firstRecordedAt)) ||
      !integer(value.count, 0, MAX_ENTRIES) || !Array.isArray(value.entries) || value.entries.length !== value.count) {
    throw new PortalApiError(UNAVAILABLE_MESSAGE);
  }
  const entries = value.entries.map(entry);
  if (entries.some((item) => item === undefined) || (entries.length > 0 && value.coverage.firstRecordedAt === null)) {
    throw new PortalApiError(UNAVAILABLE_MESSAGE);
  }
  return {
    generatedAt: value.generatedAt as string,
    population,
    coverage: { firstRecordedAt: value.coverage.firstRecordedAt as string | null },
    count: value.count as number,
    entries: entries as ViolenceSpeedrunEntry[]
  };
}

export async function getViolenceSpeedrun(population: StatsPopulation, signal?: AbortSignal) {
  const query = new URLSearchParams({ population });
  const response = await fetch(`/api/stats/violence-speedrun?${query.toString()}`, {
    cache: "no-store", credentials: "same-origin", signal
  });
  if (!response.ok) throw new PortalApiError(UNAVAILABLE_MESSAGE);
  let body: unknown;
  try { body = await response.json() as unknown; }
  catch { throw new PortalApiError(UNAVAILABLE_MESSAGE); }
  return parseViolenceSpeedrunResponse(body, population);
}
