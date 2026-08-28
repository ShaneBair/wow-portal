import type { StatsPopulation } from "../stats/stats-population.js";
import { PortalApiError } from "./portal.js";

const MAX_ENTRIES = 25;
const UNAVAILABLE_MESSAGE = "Quest completion statistics are temporarily unavailable.";

export interface QuestCompletionLeaderboardEntry {
  characterName: string;
  race: string;
  class: string;
  level: number;
  accountLogin: string;
  isBot: boolean;
  questCompletions: number;
}

export interface QuestCompletionLeaderboardResponse {
  generatedAt: string;
  population: StatsPopulation;
  coverage: { firstRecordedAt: string | null };
  count: number;
  entries: QuestCompletionLeaderboardEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 && value.length <= 128 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
    ? value
    : undefined;
}

function isUtcIsoTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  ) {
    return false;
  }
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
}

function parseEntry(value: unknown): QuestCompletionLeaderboardEntry | undefined {
  if (!isRecord(value)) return undefined;
  const characterName = readString(value, "characterName");
  const race = readString(value, "race");
  const playerClass = readString(value, "class");
  const accountLogin = readString(value, "accountLogin");
  if (
    !characterName || !race || !playerClass || !accountLogin ||
    typeof value.level !== "number" || !Number.isInteger(value.level) ||
    value.level < 1 || value.level > 255 ||
    typeof value.isBot !== "boolean" ||
    typeof value.questCompletions !== "number" ||
    !Number.isSafeInteger(value.questCompletions) || value.questCompletions < 0
  ) {
    return undefined;
  }
  return {
    characterName,
    race,
    class: playerClass,
    level: value.level,
    accountLogin,
    isBot: value.isBot,
    questCompletions: value.questCompletions
  };
}

export function parseQuestCompletionLeaderboardResponse(
  value: unknown,
  expectedPopulation: StatsPopulation
): QuestCompletionLeaderboardResponse {
  if (
    !isRecord(value) || !isUtcIsoTimestamp(value.generatedAt) ||
    value.population !== expectedPopulation || !isRecord(value.coverage) ||
    !(value.coverage.firstRecordedAt === null || isUtcIsoTimestamp(value.coverage.firstRecordedAt)) ||
    typeof value.count !== "number" || !Number.isInteger(value.count) ||
    value.count < 0 || value.count > MAX_ENTRIES || !Array.isArray(value.entries) ||
    value.entries.length !== value.count
  ) {
    throw new PortalApiError(UNAVAILABLE_MESSAGE);
  }
  const entries = value.entries.map(parseEntry);
  if (entries.some((entry) => entry === undefined)) {
    throw new PortalApiError(UNAVAILABLE_MESSAGE);
  }
  if (entries.length > 0 && value.coverage.firstRecordedAt === null) {
    throw new PortalApiError(UNAVAILABLE_MESSAGE);
  }
  return {
    generatedAt: value.generatedAt,
    population: expectedPopulation,
    coverage: { firstRecordedAt: value.coverage.firstRecordedAt },
    count: value.count,
    entries: entries as QuestCompletionLeaderboardEntry[]
  };
}

export async function getQuestCompletionLeaderboard(
  population: StatsPopulation,
  signal?: AbortSignal
): Promise<QuestCompletionLeaderboardResponse> {
  const query = new URLSearchParams({ population });
  const response = await fetch(`/api/stats/quest-completions?${query.toString()}`, {
    cache: "no-store",
    signal
  });
  if (!response.ok) throw new PortalApiError(UNAVAILABLE_MESSAGE);
  let body: unknown;
  try {
    body = await response.json() as unknown;
  } catch {
    throw new PortalApiError(UNAVAILABLE_MESSAGE);
  }
  return parseQuestCompletionLeaderboardResponse(body, population);
}
