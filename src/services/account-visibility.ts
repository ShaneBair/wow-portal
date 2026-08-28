import {
  getPortalDatabase,
  validatePortalDatabaseIdentifier
} from "./portal-database.js";
import type { AuthenticatedPrincipal } from "./portal-sessions.js";

const ACCOUNT_LOGIN_PATTERN = /^[A-Z0-9_]{3,16}$/u;
const MAX_CONFIG_BYTES = 2_048;
const MAX_ACCOUNTS_PER_LIST = 100;
const QUERY_TIMEOUT_MS = 5_000;
const FAILURE_BACKOFF_MS = 3_000;

export type AccountVisibilityCacheKey = "standard" | "full";

export interface AccountVisibilityScope {
  cacheKey: AccountVisibilityCacheKey;
  excludedAccountIds: readonly number[];
}

export interface AccountVisibilityConfig {
  hiddenAccountLogins: readonly string[];
  hiddenAccountViewerLogins: readonly string[];
}

export interface ResolvedAccountVisibilityPolicy {
  hiddenAccountIds: readonly number[];
  hiddenAccountViewerIds: ReadonlySet<number>;
  standardScope: AccountVisibilityScope;
  fullScope: AccountVisibilityScope;
}

export interface AccountVisibilityResolutionQuery {
  sql: string;
  values: readonly string[];
}

export class AccountVisibilityConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountVisibilityConfigurationError";
  }
}

export class AccountVisibilityDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountVisibilityDataError";
  }
}

function hasEnvironmentKey(environment: NodeJS.ProcessEnv, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(environment, key);
}

function parseAccountList(environment: NodeJS.ProcessEnv, key: string): readonly string[] {
  if (!hasEnvironmentKey(environment, key)) {
    throw new AccountVisibilityConfigurationError(`${key} is required.`);
  }

  const raw = environment[key] ?? "";
  if (Buffer.byteLength(raw, "utf8") > MAX_CONFIG_BYTES) {
    throw new AccountVisibilityConfigurationError(`${key} is too large.`);
  }
  if (raw.trim() === "") {
    return Object.freeze([]);
  }

  const values = raw.split(",");
  if (values.length > MAX_ACCOUNTS_PER_LIST) {
    throw new AccountVisibilityConfigurationError(`${key} contains too many accounts.`);
  }

  const normalized = new Set<string>();
  for (const value of values) {
    const login = value.trim().toUpperCase();
    if (!ACCOUNT_LOGIN_PATTERN.test(login)) {
      throw new AccountVisibilityConfigurationError(`${key} contains an invalid account login.`);
    }
    normalized.add(login);
  }

  return Object.freeze([...normalized]);
}

export function readAccountVisibilityConfig(
  environment: NodeJS.ProcessEnv = process.env
): AccountVisibilityConfig {
  return Object.freeze({
    hiddenAccountLogins: parseAccountList(environment, "PORTAL_HIDDEN_ACCOUNTS"),
    hiddenAccountViewerLogins: parseAccountList(
      environment,
      "PORTAL_HIDDEN_ACCOUNT_VIEWERS"
    )
  });
}

function qualified(database: string, table: string): string {
  return `\`${database}\`.\`${table}\``;
}

export function buildAccountVisibilityResolutionQuery(
  authDatabase: string,
  accountLogins: readonly string[]
): AccountVisibilityResolutionQuery {
  const database = validatePortalDatabaseIdentifier(authDatabase, "PORTAL_AUTH_DATABASE");
  if (accountLogins.length === 0 || accountLogins.length > MAX_ACCOUNTS_PER_LIST * 2) {
    throw new AccountVisibilityConfigurationError(
      "Account visibility resolution requires a bounded non-empty login list."
    );
  }
  for (const login of accountLogins) {
    if (!ACCOUNT_LOGIN_PATTERN.test(login)) {
      throw new AccountVisibilityConfigurationError(
        "Account visibility resolution received an invalid account login."
      );
    }
  }

  const placeholders = accountLogins.map(() => "?").join(", ");
  return {
    sql: `SELECT id AS accountId, username
FROM ${qualified(database, "account")}
WHERE username IN (${placeholders})
LIMIT ${accountLogins.length + 1}`,
    values: [...accountLogins]
  };
}

function readAccountId(value: unknown): number {
  const accountId = typeof value === "bigint" || typeof value === "string"
    ? Number(value)
    : value;
  if (
    typeof accountId !== "number" ||
    !Number.isSafeInteger(accountId) ||
    accountId < 1 ||
    accountId > 0xffff_ffff
  ) {
    throw new AccountVisibilityDataError("Account visibility account ID is invalid.");
  }
  return accountId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mapAccountVisibilityRows(
  rows: unknown,
  expectedLogins: readonly string[]
): ReadonlyMap<string, number> {
  if (!Array.isArray(rows) || rows.length > expectedLogins.length) {
    throw new AccountVisibilityDataError("Account visibility database result is invalid.");
  }

  const expected = new Set(expectedLogins);
  const accountIds = new Set<number>();
  const resolved = new Map<string, number>();

  for (const value of rows) {
    if (!isRecord(value) || typeof value.username !== "string") {
      throw new AccountVisibilityDataError("Account visibility database row is invalid.");
    }
    const username = value.username;
    const accountId = readAccountId(value.accountId);
    if (
      !expected.has(username) ||
      resolved.has(username) ||
      accountIds.has(accountId)
    ) {
      throw new AccountVisibilityDataError("Account visibility database row is inconsistent.");
    }
    resolved.set(username, accountId);
    accountIds.add(accountId);
  }

  if (resolved.size !== expected.size) {
    throw new AccountVisibilityDataError("A configured account visibility login was not found.");
  }

  return resolved;
}

function immutableIds(values: Iterable<number>): readonly number[] {
  return Object.freeze([...new Set(values)].sort((left, right) => left - right));
}

function createPolicy(
  config: AccountVisibilityConfig,
  resolved: ReadonlyMap<string, number>
): ResolvedAccountVisibilityPolicy {
  const hiddenAccountIds = immutableIds(
    config.hiddenAccountLogins.map((login) => resolved.get(login)!)
  );
  const hiddenAccountViewerIds = new Set(
    config.hiddenAccountViewerLogins.map((login) => resolved.get(login)!)
  );
  const fullScope = Object.freeze<AccountVisibilityScope>({
    cacheKey: "full",
    excludedAccountIds: Object.freeze([])
  });
  const standardScope = Object.freeze<AccountVisibilityScope>({
    cacheKey: "standard",
    excludedAccountIds: hiddenAccountIds
  });

  return Object.freeze({
    hiddenAccountIds,
    hiddenAccountViewerIds,
    standardScope,
    fullScope
  });
}

export function scopeForPrincipal(
  policy: ResolvedAccountVisibilityPolicy,
  principal?: AuthenticatedPrincipal
): AccountVisibilityScope {
  return principal && policy.hiddenAccountViewerIds.has(principal.accountId)
    ? policy.fullScope
    : policy.standardScope;
}

export function buildAccountExclusionClause(
  scope: AccountVisibilityScope,
  column: "c.account" | "a.id",
  indentation = "    "
): { clause: string; values: readonly number[] } {
  const accountIds = immutableIds(scope.excludedAccountIds);
  for (const accountId of accountIds) {
    readAccountId(accountId);
  }
  if (accountIds.length > MAX_ACCOUNTS_PER_LIST) {
    throw new AccountVisibilityDataError("Account visibility scope is too large.");
  }
  if (accountIds.length === 0) {
    return { clause: "", values: accountIds };
  }
  const placeholders = accountIds.map(() => "?").join(", ");
  return {
    clause: `${indentation}AND ${column} NOT IN (${placeholders})\n`,
    values: accountIds
  };
}

type QueryAccountRows = (accountLogins: readonly string[]) => Promise<unknown>;

async function queryAccountRows(accountLogins: readonly string[]): Promise<unknown> {
  const { pool, config } = getPortalDatabase();
  const statsAuthDatabase = process.env.STATS_AUTH_DATABASE?.trim();
  if (
    statsAuthDatabase &&
    validatePortalDatabaseIdentifier(statsAuthDatabase, "STATS_AUTH_DATABASE") !==
      config.authDatabase
  ) {
    throw new AccountVisibilityConfigurationError(
      "Portal and statistics authentication databases must share one account namespace."
    );
  }
  const query = buildAccountVisibilityResolutionQuery(config.authDatabase, accountLogins);
  const [rows] = await pool.execute({
    sql: query.sql,
    values: [...query.values],
    timeout: QUERY_TIMEOUT_MS
  });
  return rows;
}

export class AccountVisibilityService {
  private policy: ResolvedAccountVisibilityPolicy | undefined;
  private inFlight: Promise<ResolvedAccountVisibilityPolicy> | undefined;
  private retryAfter = 0;

  constructor(
    private readonly readConfig: () => AccountVisibilityConfig = readAccountVisibilityConfig,
    private readonly queryRows: QueryAccountRows = queryAccountRows,
    private readonly now: () => number = Date.now
  ) {}

  async getScope(principal?: AuthenticatedPrincipal): Promise<AccountVisibilityScope> {
    return scopeForPrincipal(await this.getPolicy(), principal);
  }

  async getPolicy(): Promise<ResolvedAccountVisibilityPolicy> {
    if (this.policy) {
      return this.policy;
    }
    if (this.inFlight) {
      return this.inFlight;
    }
    if (this.now() < this.retryAfter) {
      throw new AccountVisibilityDataError("Account visibility is temporarily unavailable.");
    }

    const refresh = this.resolvePolicy();
    const tracked = refresh.finally(() => {
      if (this.inFlight === tracked) {
        this.inFlight = undefined;
      }
    });
    this.inFlight = tracked;
    return tracked;
  }

  private async resolvePolicy(): Promise<ResolvedAccountVisibilityPolicy> {
    try {
      const config = this.readConfig();
      const accountLogins = Object.freeze([
        ...new Set([
          ...config.hiddenAccountLogins,
          ...config.hiddenAccountViewerLogins
        ])
      ]);
      const resolved = accountLogins.length === 0
        ? new Map<string, number>()
        : mapAccountVisibilityRows(await this.queryRows(accountLogins), accountLogins);
      const policy = createPolicy(config, resolved);
      this.policy = policy;
      this.retryAfter = 0;
      return policy;
    } catch (error) {
      this.retryAfter = this.now() + FAILURE_BACKOFF_MS;
      throw error;
    }
  }
}

export const accountVisibilityService = new AccountVisibilityService();
