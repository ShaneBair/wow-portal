import { PortalApiError } from "./portal.js";
import type { StatsPopulation } from "../stats/stats-population.js";

const MAX_ENTRIES = 25;

export interface DeathLeaderboardEntry {
  characterName: string;
  race: string;
  class: string;
  level: number;
  accountLogin: string;
  isBot: boolean;
  deaths: number;
}

export interface DeathLeaderboardResponse {
  generatedAt: string;
  population: StatsPopulation;
  coverage: {
    comprehensiveSince: string;
  };
  count: number;
  entries: DeathLeaderboardEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  source: Record<string, unknown>,
  key: string,
  maximumLength: number
): string | undefined {
  const value = source[key];

  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return undefined;
  }

  return value;
}

function parseEntry(value: unknown): DeathLeaderboardEntry | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const characterName = readString(value, "characterName", 128);
  const race = readString(value, "race", 128);
  const playerClass = readString(value, "class", 128);
  const accountLogin = readString(value, "accountLogin", 128);

  if (
    !characterName ||
    !race ||
    !playerClass ||
    !accountLogin ||
    typeof value.level !== "number" ||
    !Number.isInteger(value.level) ||
    value.level < 1 ||
    value.level > 255 ||
    typeof value.isBot !== "boolean" ||
    typeof value.deaths !== "number" ||
    !Number.isSafeInteger(value.deaths) ||
    value.deaths < 0
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
    deaths: value.deaths
  };
}

function isUtcIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value));
}

export function parseDeathLeaderboardResponse(
  value: unknown,
  expectedPopulation: StatsPopulation
): DeathLeaderboardResponse {
  if (
    !isRecord(value) ||
    !isUtcIsoTimestamp(value.generatedAt) ||
    value.population !== expectedPopulation ||
    !isRecord(value.coverage) ||
    !isUtcIsoTimestamp(value.coverage.comprehensiveSince) ||
    typeof value.count !== "number" ||
    !Number.isInteger(value.count) ||
    value.count < 0 ||
    value.count > MAX_ENTRIES ||
    !Array.isArray(value.entries) ||
    value.entries.length !== value.count
  ) {
    throw new PortalApiError("Death statistics are temporarily unavailable.");
  }

  const entries = value.entries.map(parseEntry);
  if (entries.some((entry) => entry === undefined)) {
    throw new PortalApiError("Death statistics are temporarily unavailable.");
  }

  return {
    generatedAt: value.generatedAt,
    population: expectedPopulation,
    coverage: {
      comprehensiveSince: value.coverage.comprehensiveSince
    },
    count: value.count,
    entries: entries as DeathLeaderboardEntry[]
  };
}

export async function getDeathLeaderboard(
  population: StatsPopulation,
  signal?: AbortSignal
): Promise<DeathLeaderboardResponse> {
  const query = new URLSearchParams({ population });
  const response = await fetch(`/api/stats/deaths?${query.toString()}`, {
    cache: "no-store",
    credentials: "same-origin",
    signal
  });

  if (!response.ok) {
    throw new PortalApiError("Death statistics are temporarily unavailable.");
  }

  let body: unknown;
  try {
    body = await response.json() as unknown;
  } catch {
    throw new PortalApiError("Death statistics are temporarily unavailable.");
  }

  return parseDeathLeaderboardResponse(body, population);
}
