import type { StatsPopulation } from "../stats/stats-population.js";
import { PortalApiError } from "./portal.js";

const UNAVAILABLE_MESSAGE = "Boss kill statistics are temporarily unavailable.";
const MAX_ENTRIES = 25;

export interface BossKillLeaderboardEntry {
  characterName: string;
  race: string;
  class: string;
  level: number;
  accountLogin: string;
  isBot: boolean;
  bossKills: number;
}

export interface BossKillLeaderboardResponse {
  generatedAt: string;
  population: StatsPopulation;
  coverage: { firstRecordedAt: string | null };
  count: number;
  entries: BossKillLeaderboardEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(source: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(source).every((key) => allowed.has(key));
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 && value.length <= 128 &&
    !/[\u0000-\u001f\u007f]/u.test(value) ? value : undefined;
}

function isUtcIsoTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  ) return false;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
}

function parseEntry(value: unknown): BossKillLeaderboardEntry | undefined {
  if (!isRecord(value)) return undefined;
  if (!hasOnlyKeys(value, [
    "characterName", "race", "class", "level", "accountLogin", "isBot", "bossKills"
  ])) return undefined;
  const characterName = readString(value, "characterName");
  const race = readString(value, "race");
  const playerClass = readString(value, "class");
  const accountLogin = readString(value, "accountLogin");
  if (
    !characterName || !race || !playerClass || !accountLogin ||
    typeof value.level !== "number" || !Number.isInteger(value.level) ||
    value.level < 1 || value.level > 255 || typeof value.isBot !== "boolean" ||
    typeof value.bossKills !== "number" || !Number.isSafeInteger(value.bossKills) ||
    value.bossKills < 0
  ) return undefined;
  return {
    characterName,
    race,
    class: playerClass,
    level: value.level,
    accountLogin,
    isBot: value.isBot,
    bossKills: value.bossKills
  };
}

export function parseBossKillLeaderboardResponse(
  value: unknown,
  expectedPopulation: StatsPopulation
): BossKillLeaderboardResponse {
  if (
    !isRecord(value) || !hasOnlyKeys(value, [
      "generatedAt", "population", "coverage", "count", "entries"
    ]) || !isUtcIsoTimestamp(value.generatedAt) ||
    value.population !== expectedPopulation || !isRecord(value.coverage) ||
    !hasOnlyKeys(value.coverage, ["firstRecordedAt"]) ||
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
    entries: entries as BossKillLeaderboardEntry[]
  };
}

export async function getBossKillLeaderboard(
  population: StatsPopulation,
  signal?: AbortSignal
): Promise<BossKillLeaderboardResponse> {
  const query = new URLSearchParams({ population });
  const response = await fetch(`/api/stats/boss-kills?${query.toString()}`, {
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
  return parseBossKillLeaderboardResponse(body, population);
}
