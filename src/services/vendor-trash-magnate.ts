import { getClassName, getRaceName } from "../domain/wotlk.js";
import {
  buildAccountExclusionClause,
  type AccountVisibilityScope
} from "./account-visibility.js";
import {
  getStatsDatabase,
  StatsDatabaseConfigurationError,
  type StatsDatabaseConfig,
  validateStatsDatabaseIdentifier
} from "./stats-database.js";

const CACHE_TTL_MS = 60_000;
const QUERY_TIMEOUT_MS = 8_000;
const MAX_ROWS = 25;
const MAX_UNSIGNED_BIGINT = 18_446_744_073_709_551_615n;
const VERIFIED_VENDOR_MONEY_CRITERIA_ID = 3361;

export type VendorTrashMagnatePopulation = "all-characters";

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
  population: VendorTrashMagnatePopulation;
  coverage: { kind: "azerothcore-lifetime-counter" };
  count: number;
  entries: VendorTrashMagnateEntry[];
}

export interface VendorTrashMagnateQuery {
  sql: string;
  values: readonly number[];
}

export class VendorTrashMagnateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VendorTrashMagnateError";
  }
}

export function readVendorMoneyCriteriaId(
  environment: NodeJS.ProcessEnv = process.env
): number {
  const raw = environment.STATS_VENDOR_MONEY_CRITERIA_ID?.trim();
  if (!raw || !/^\d+$/u.test(raw)) {
    throw new StatsDatabaseConfigurationError(
      "STATS_VENDOR_MONEY_CRITERIA_ID must be the verified positive criterion ID."
    );
  }
  const criterionId = Number(raw);
  if (
    !Number.isSafeInteger(criterionId) || criterionId < 1 || criterionId > 0xffff_ffff ||
    criterionId !== VERIFIED_VENDOR_MONEY_CRITERIA_ID
  ) {
    throw new StatsDatabaseConfigurationError(
      "STATS_VENDOR_MONEY_CRITERIA_ID does not match the verified criterion ID."
    );
  }
  return criterionId;
}

function qualified(database: string, table: string): string {
  return `\`${database}\`.\`${table}\``;
}

export function buildVendorTrashMagnateQuery(
  config: Pick<StatsDatabaseConfig, "charactersDatabase" | "authDatabase">,
  criterionId: number,
  visibility: AccountVisibilityScope
): VendorTrashMagnateQuery {
  if (!Number.isSafeInteger(criterionId) || criterionId < 1 || criterionId > 0xffff_ffff) {
    throw new StatsDatabaseConfigurationError(
      "STATS_VENDOR_MONEY_CRITERIA_ID must be the verified positive criterion ID."
    );
  }
  const charactersDatabase = validateStatsDatabaseIdentifier(
    config.charactersDatabase,
    "STATS_CHARACTERS_DATABASE"
  );
  const authDatabase = validateStatsDatabaseIdentifier(
    config.authDatabase,
    "STATS_AUTH_DATABASE"
  );
  const progressTable = qualified(charactersDatabase, "character_achievement_progress");
  const charactersTable = qualified(charactersDatabase, "characters");
  const accountsTable = qualified(authDatabase, "account");
  const accountExclusion = buildAccountExclusionClause(visibility, "c.account", "  ");

  return {
    sql: `SELECT
    c.name AS characterName,
    c.race AS raceId,
    c.class AS classId,
    c.level,
    a.username AS accountLogin,
    CAST(p.counter AS CHAR) AS copper
FROM ${progressTable} p
JOIN ${charactersTable} c ON c.guid = p.guid
LEFT JOIN ${accountsTable} a ON a.id = c.account
WHERE p.criteria = ?
  AND p.counter > 0
  AND c.deleteDate IS NULL
${accountExclusion.clause}ORDER BY p.counter DESC, c.name ASC, c.guid ASC
LIMIT 25`,
    values: [criterionId, ...accountExclusion.values]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireSafeInteger(
  value: unknown,
  key: string,
  minimum: number,
  maximum: number
): number {
  if (
    typeof value !== "number" || !Number.isSafeInteger(value) ||
    value < minimum || value > maximum
  ) throw new VendorTrashMagnateError(`Database row field ${key} is invalid.`);
  return value;
}

function requireString(value: unknown, key: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > 128 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) throw new VendorTrashMagnateError(`Database row field ${key} is invalid.`);
  return value;
}

function requireCopperString(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) {
    throw new VendorTrashMagnateError("Database row field copper is invalid.");
  }
  const copper = BigInt(value);
  if (copper > MAX_UNSIGNED_BIGINT) {
    throw new VendorTrashMagnateError("Database row field copper is invalid.");
  }
  return value;
}

function unit(value: bigint, name: string): string {
  return `${value} ${name}`;
}

export function formatCopper(copper: string): string {
  const validated = requireCopperString(copper);
  const total = BigInt(validated);
  const gold = total / 10_000n;
  const silver = total % 10_000n / 100n;
  const remainder = total % 100n;
  return `${unit(gold, "gold")}, ${unit(silver, "silver")}, ${unit(remainder, "copper")}`;
}

export function mapVendorTrashMagnateRows(rows: unknown): VendorTrashMagnateEntry[] {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) {
    throw new VendorTrashMagnateError("Vendor Trash Magnate database result is invalid.");
  }
  return rows.map((row) => {
    if (!isRecord(row)) {
      throw new VendorTrashMagnateError("Vendor Trash Magnate contains an invalid row.");
    }
    const copper = requireCopperString(row.copper);
    return {
      characterName: requireString(row.characterName, "characterName"),
      race: getRaceName(requireSafeInteger(row.raceId, "raceId", 0, 255)),
      class: getClassName(requireSafeInteger(row.classId, "classId", 0, 255)),
      level: requireSafeInteger(row.level, "level", 1, 255),
      accountLogin: row.accountLogin === null
        ? "Unknown account"
        : requireString(row.accountLogin, "accountLogin"),
      copper,
      displayMoney: formatCopper(copper)
    };
  });
}

export type QueryVendorTrashMagnateRows = (
  criterionId: number,
  visibility: AccountVisibilityScope
) => Promise<unknown>;

export async function queryVendorTrashMagnateRows(
  criterionId: number,
  visibility: AccountVisibilityScope
): Promise<unknown> {
  const { pool, config } = getStatsDatabase();
  const query = buildVendorTrashMagnateQuery(config, criterionId, visibility);
  const [rows] = await pool.execute({
    sql: query.sql,
    values: [...query.values],
    timeout: QUERY_TIMEOUT_MS
  });
  return rows;
}

export class VendorTrashMagnateService {
  private readonly cache = new Map<string, {
    value: VendorTrashMagnateResponse;
    expiresAt: number;
  }>();
  private readonly inFlight = new Map<string, Promise<VendorTrashMagnateResponse>>();

  constructor(
    private readonly queryRows: QueryVendorTrashMagnateRows = queryVendorTrashMagnateRows,
    private readonly now: () => number = Date.now,
    private readonly readCriterionId: () => number = readVendorMoneyCriteriaId
  ) {}

  async getLeaderboard(visibility: AccountVisibilityScope): Promise<VendorTrashMagnateResponse> {
    const criterionId = this.readCriterionId();
    const cacheKey = `${visibility.cacheKey}:${criterionId}`;
    const now = this.now();
    const cached = this.cache.get(cacheKey);
    if (cached && now < cached.expiresAt) return cached.value;
    const active = this.inFlight.get(cacheKey);
    if (active) return active;
    const refresh = this.refresh(criterionId, visibility, cacheKey);
    const tracked = refresh.finally(() => {
      if (this.inFlight.get(cacheKey) === tracked) this.inFlight.delete(cacheKey);
    });
    this.inFlight.set(cacheKey, tracked);
    return tracked;
  }

  private async refresh(
    criterionId: number,
    visibility: AccountVisibilityScope,
    cacheKey: string
  ): Promise<VendorTrashMagnateResponse> {
    const entries = mapVendorTrashMagnateRows(await this.queryRows(criterionId, visibility));
    const generatedAt = this.now();
    const response: VendorTrashMagnateResponse = {
      generatedAt: new Date(generatedAt).toISOString(),
      population: "all-characters",
      coverage: { kind: "azerothcore-lifetime-counter" },
      count: entries.length,
      entries
    };
    this.cache.set(cacheKey, { value: response, expiresAt: generatedAt + CACHE_TTL_MS });
    return response;
  }
}

const vendorTrashMagnateService = new VendorTrashMagnateService();

export function getVendorTrashMagnate(
  visibility: AccountVisibilityScope
): Promise<VendorTrashMagnateResponse> {
  return vendorTrashMagnateService.getLeaderboard(visibility);
}
