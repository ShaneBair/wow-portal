import type { AccountVisibilityScope } from "./account-visibility.js";
import type { StatsPopulation } from "./death-leaderboard.js";
import {
  buildLevelIntervalQuery,
  mapProfessionalProcrastinatorRows,
  type ProfessionalProcrastinatorEntry,
  type ProfessionalProcrastinatorQuery
} from "./professional-procrastinator.js";
import { getStatsDatabase, type StatsDatabaseConfig } from "./stats-database.js";

const CACHE_TTL_MS = 60_000;
const QUERY_TIMEOUT_MS = 8_000;

export type { StatsPopulation };
export type DingDongDashEntry = ProfessionalProcrastinatorEntry;
export type DingDongDashQuery = ProfessionalProcrastinatorQuery;

export interface DingDongDashResponse {
  generatedAt: string;
  population: StatsPopulation;
  coverage: { firstRecordedAt: string | null };
  count: number;
  entries: DingDongDashEntry[];
}

export function buildDingDongDashQuery(
  config: Pick<StatsDatabaseConfig, "charactersDatabase" | "authDatabase">,
  population: StatsPopulation,
  visibility: AccountVisibilityScope
): DingDongDashQuery {
  return buildLevelIntervalQuery(config, population, visibility, "shortest");
}

export type QueryDingDongDashRows = (
  population: StatsPopulation,
  visibility: AccountVisibilityScope
) => Promise<{ contractRows: unknown; leaderboardRows: unknown }>;

export async function queryDingDongDashRows(
  population: StatsPopulation,
  visibility: AccountVisibilityScope
): Promise<{ contractRows: unknown; leaderboardRows: unknown }> {
  const { pool, config } = getStatsDatabase();
  const query = buildDingDongDashQuery(config, population, visibility);
  const [contract, leaderboard] = await Promise.all([
    pool.execute({ sql: query.contractSql, values: [...query.contractValues], timeout: QUERY_TIMEOUT_MS }),
    pool.execute({ sql: query.sql, values: [...query.values], timeout: QUERY_TIMEOUT_MS })
  ]);
  return { contractRows: contract[0], leaderboardRows: leaderboard[0] };
}

export class DingDongDashService {
  private readonly cache = new Map<string, { value: DingDongDashResponse; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<DingDongDashResponse>>();

  constructor(
    private readonly queryRows: QueryDingDongDashRows = queryDingDongDashRows,
    private readonly now: () => number = Date.now
  ) {}

  async getLeaderboard(population: StatsPopulation, visibility: AccountVisibilityScope): Promise<DingDongDashResponse> {
    const cacheKey = `${population}:${visibility.cacheKey}`;
    const now = this.now();
    const cached = this.cache.get(cacheKey);
    if (cached && now < cached.expiresAt) return cached.value;
    const active = this.inFlight.get(cacheKey);
    if (active) return active;
    const refresh = this.refresh(population, visibility, cacheKey);
    const tracked = refresh.finally(() => {
      if (this.inFlight.get(cacheKey) === tracked) this.inFlight.delete(cacheKey);
    });
    this.inFlight.set(cacheKey, tracked);
    return tracked;
  }

  private async refresh(population: StatsPopulation, visibility: AccountVisibilityScope, cacheKey: string) {
    const rows = await this.queryRows(population, visibility);
    const mapped = mapProfessionalProcrastinatorRows(rows.contractRows, rows.leaderboardRows);
    const generatedAt = this.now();
    const response: DingDongDashResponse = {
      generatedAt: new Date(generatedAt).toISOString(), population,
      coverage: mapped.coverage, count: mapped.entries.length, entries: mapped.entries
    };
    this.cache.set(cacheKey, { value: response, expiresAt: generatedAt + CACHE_TTL_MS });
    return response;
  }
}

const service = new DingDongDashService();

export function getDingDongDash(population: StatsPopulation, visibility: AccountVisibilityScope) {
  return service.getLeaderboard(population, visibility);
}
