import { PortalApiError } from "./portal.js";

const MAX_ENTRIES = 25;
const MAX_UNSIGNED_BIGINT = 18_446_744_073_709_551_615n;
const UNAVAILABLE_MESSAGE = "Vendor Trash Magnate statistics are temporarily unavailable.";

export interface VendorTrashMagnateEntry {
  characterName: string;
  race: string;
  class: string;
  level: number;
  accountLogin: string;
  copper: string;
  displayMoney: string;
}

export interface VendorTrashMagnateResponse {
  generatedAt: string;
  population: "all-characters";
  coverage: { kind: "azerothcore-lifetime-counter" };
  count: number;
  entries: VendorTrashMagnateEntry[];
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

function unit(value: bigint, name: string): string {
  return `${value} ${name}`;
}

function expectedMoney(copper: string): string | undefined {
  if (!/^[1-9]\d{0,19}$/u.test(copper)) return undefined;
  const total = BigInt(copper);
  if (total > MAX_UNSIGNED_BIGINT) return undefined;
  const gold = total / 10_000n;
  const silver = total % 10_000n / 100n;
  const remainder = total % 100n;
  return `${unit(gold, "gold")}, ${unit(silver, "silver")}, ${unit(remainder, "copper")}`;
}

function parseEntry(value: unknown): VendorTrashMagnateEntry | undefined {
  if (!isRecord(value)) return undefined;
  const characterName = readString(value.characterName);
  const race = readString(value.race);
  const playerClass = readString(value.class);
  const accountLogin = readString(value.accountLogin);
  const displayMoney = typeof value.copper === "string" ? expectedMoney(value.copper) : undefined;
  if (
    !characterName || !race || !playerClass || !accountLogin ||
    typeof value.level !== "number" || !Number.isSafeInteger(value.level) ||
    value.level < 1 || value.level > 255 || !displayMoney || value.displayMoney !== displayMoney
  ) return undefined;
  return {
    characterName,
    race,
    class: playerClass,
    level: value.level,
    accountLogin,
    copper: value.copper as string,
    displayMoney
  };
}

export function parseVendorTrashMagnateResponse(value: unknown): VendorTrashMagnateResponse {
  if (
    !isRecord(value) || !isUtcIsoTimestamp(value.generatedAt) ||
    value.population !== "all-characters" || !isRecord(value.coverage) ||
    value.coverage.kind !== "azerothcore-lifetime-counter" ||
    typeof value.count !== "number" || !Number.isInteger(value.count) ||
    value.count < 0 || value.count > MAX_ENTRIES || !Array.isArray(value.entries) ||
    value.entries.length !== value.count
  ) throw new PortalApiError(UNAVAILABLE_MESSAGE);
  const entries = value.entries.map(parseEntry);
  if (entries.some((entry) => entry === undefined)) throw new PortalApiError(UNAVAILABLE_MESSAGE);
  return {
    generatedAt: value.generatedAt,
    population: "all-characters",
    coverage: { kind: "azerothcore-lifetime-counter" },
    count: value.count,
    entries: entries as VendorTrashMagnateEntry[]
  };
}

export async function getVendorTrashMagnate(
  signal?: AbortSignal
): Promise<VendorTrashMagnateResponse> {
  const response = await fetch("/api/stats/vendor-trash-magnate", {
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
  return parseVendorTrashMagnateResponse(body);
}
