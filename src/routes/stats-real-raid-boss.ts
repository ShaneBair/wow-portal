import { Router, type RequestHandler } from "express";
import {
  createAccountVisibilityMiddleware,
  type AccountVisibilityLocals
} from "../middleware/account-visibility.js";
import type { AccountVisibilityScope } from "../services/account-visibility.js";
import {
  getRealRaidBoss,
  RealRaidBossContractIntegrityError,
  type RealRaidBossResponse,
  type StatsPopulation
} from "../services/real-raid-boss.js";
import { StatsDatabaseConfigurationError } from "../services/stats-database.js";
import { parseStatsPopulation, statsReadLimiter } from "../services/stats-http.js";

const INVALID_POPULATION_MESSAGE = "Invalid population filter.";
const UNAVAILABLE_MESSAGE = "Real Raid Boss statistics are temporarily unavailable.";

type LoadLeaderboard = (
  population: StatsPopulation,
  visibility: AccountVisibilityScope
) => Promise<RealRaidBossResponse>;

export function createStatsRealRaidBossRouter(
  loadLeaderboard: LoadLeaderboard = getRealRaidBoss,
  limiter: RequestHandler = statsReadLimiter,
  visibility: RequestHandler = createAccountVisibilityMiddleware({
    unavailableMessage: UNAVAILABLE_MESSAGE,
    logLabel: "Real Raid Boss statistics"
  })
): Router {
  const router = Router();
  router.get(
    "/api/stats/real-raid-boss",
    (_request, response, next) => {
      response.set("Cache-Control", "no-store");
      response.vary("Cookie");
      next();
    },
    limiter,
    visibility,
    async (request, response) => {
      const population = parseStatsPopulation(request.query.population);
      if (!population) return response.status(400).json({ error: INVALID_POPULATION_MESSAGE });
      try {
        const locals = response.locals as AccountVisibilityLocals;
        return response.json(await loadLeaderboard(population, locals.accountVisibilityScope));
      } catch (error) {
        if (error instanceof RealRaidBossContractIntegrityError) {
          console.error("Real Raid Boss provider contract integrity check failed.");
        } else if (error instanceof StatsDatabaseConfigurationError) {
          console.error("Real Raid Boss statistics database is not configured.");
        } else {
          const kind = error instanceof Error ? error.name : "UnknownError";
          console.error(`Real Raid Boss statistics request failed (${kind}).`);
        }
        return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
      }
    }
  );
  return router;
}

export default createStatsRealRaidBossRouter();
