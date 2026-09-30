import { PortalApiError } from "./portal.js";

const MAX_ENTRIES = 25;
const UNAVAILABLE_MESSAGE = "Bot Wrangler statistics are temporarily unavailable.";

export interface BotWranglerEntry {
  characterName: string;
  race: string;
  class: string;
  level: number;
  accountLogin: string;
  botKills: number;
  uniqueBotVictims: number;
  lastBotKillAt: string;
}

export interface BotWranglerResponse {
  generatedAt: string;
  population: "human-vs-bot";
  coverage: { firstRecordedAt: string | null };
  count: number;
  entries: BotWranglerEntry[];
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

function parseEntry(value: unknown): BotWranglerEntry | undefined {
  if (!isRecord(value)) return undefined;
  const characterName = readString(value.characterName);
  const race = readString(value.race);
  const playerClass = readString(value.class);
  const accountLogin = readString(value.accountLogin);
  const level = readInteger(value.level, 1, 255);
  const botKills = readInteger(value.botKills, 1);
  const uniqueBotVictims = readInteger(value.uniqueBotVictims, 1);
  if (
    !characterName || !race || !playerClass || !accountLogin || level === undefined ||
    botKills === undefined || uniqueBotVictims === undefined || uniqueBotVictims > botKills ||
    !isUtcIsoTimestamp(value.lastBotKillAt)
  ) return undefined;
  return {
    characterName,
    race,
    class: playerClass,
    level,
    accountLogin,
    botKills,
    uniqueBotVictims,
    lastBotKillAt: value.lastBotKillAt
  };
}

export function parseBotWranglerResponse(value: unknown): BotWranglerResponse {
  if (
    !isRecord(value) || !isUtcIsoTimestamp(value.generatedAt) ||
    value.population !== "human-vs-bot" || !isRecord(value.coverage) ||
    !(value.coverage.firstRecordedAt === null || isUtcIsoTimestamp(value.coverage.firstRecordedAt)) ||
    typeof value.count !== "number" || !Number.isInteger(value.count) ||
    value.count < 0 || value.count > MAX_ENTRIES || !Array.isArray(value.entries) ||
    value.entries.length !== value.count
  ) throw new PortalApiError(UNAVAILABLE_MESSAGE);
  const firstRecordedAt = value.coverage.firstRecordedAt;
  const entries = value.entries.map(parseEntry);
  if (
    entries.some((entry) => entry === undefined) ||
    (entries.length > 0 && firstRecordedAt === null) ||
    entries.some((entry) => entry !== undefined && firstRecordedAt !== null &&
      Date.parse(entry.lastBotKillAt) < Date.parse(firstRecordedAt))
  ) throw new PortalApiError(UNAVAILABLE_MESSAGE);
  return {
    generatedAt: value.generatedAt,
    population: "human-vs-bot",
    coverage: { firstRecordedAt },
    count: value.count,
    entries: entries as BotWranglerEntry[]
  };
}

export async function getBotWrangler(signal?: AbortSignal): Promise<BotWranglerResponse> {
  const response = await fetch("/api/stats/bot-wrangler", {
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
  return parseBotWranglerResponse(body);
}
