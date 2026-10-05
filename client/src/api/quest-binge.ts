import type { StatsPopulation } from "../stats/stats-population.js";
import { PortalApiError } from "./portal.js";

const UNAVAILABLE_MESSAGE = "Quest Binge statistics are temporarily unavailable.";

export interface QuestBingeEntry {
  characterName: string;
  race: string;
  class: string;
  level: number;
  accountLogin: string;
  type: "Player" | "Bot";
  day: string;
  questsCompleted: number;
  uniqueQuests: number;
}

export interface QuestBingeResponse {
  generatedAt: string;
  population: StatsPopulation;
  coverage: { firstRecordedAt: string | null };
  count: number;
  entries: QuestBingeEntry[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function date(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(value);
}

function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function parseEntry(value: unknown): QuestBingeEntry | undefined {
  if (!record(value) || !text(value.characterName) || !text(value.race) || !text(value.class) ||
      !text(value.accountLogin) || !integer(value.level, 1, 255) ||
      (value.type !== "Player" && value.type !== "Bot") || !date(value.day) ||
      !integer(value.questsCompleted, 1) || !integer(value.uniqueQuests, 1) ||
      value.uniqueQuests > value.questsCompleted) return undefined;
  return value as unknown as QuestBingeEntry;
}

export function parseQuestBingeResponse(value: unknown, population: StatsPopulation): QuestBingeResponse {
  if (!record(value) || !timestamp(value.generatedAt) || value.population !== population || !record(value.coverage) ||
      !(value.coverage.firstRecordedAt === null || timestamp(value.coverage.firstRecordedAt)) ||
      !integer(value.count, 0, 25) || !Array.isArray(value.entries) || value.entries.length !== value.count) {
    throw new PortalApiError(UNAVAILABLE_MESSAGE);
  }
  const entries = value.entries.map(parseEntry);
  if (entries.some((entry) => entry === undefined) || (entries.length > 0 && value.coverage.firstRecordedAt === null)) {
    throw new PortalApiError(UNAVAILABLE_MESSAGE);
  }
  return {
    generatedAt: value.generatedAt as string, population,
    coverage: { firstRecordedAt: value.coverage.firstRecordedAt as string | null },
    count: value.count as number, entries: entries as QuestBingeEntry[]
  };
}

export async function getQuestBinge(population: StatsPopulation, signal?: AbortSignal) {
  const query = new URLSearchParams({ population });
  const response = await fetch(`/api/stats/quest-binge?${query.toString()}`, {
    cache: "no-store", credentials: "same-origin", signal
  });
  if (!response.ok) throw new PortalApiError(UNAVAILABLE_MESSAGE);
  let body: unknown;
  try { body = await response.json() as unknown; }
  catch { throw new PortalApiError(UNAVAILABLE_MESSAGE); }
  return parseQuestBingeResponse(body, population);
}
