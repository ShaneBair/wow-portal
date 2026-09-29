import { Router, type RequestHandler } from "express";
import {
  createAccountVisibilityMiddleware,
  type AccountVisibilityLocals
} from "../middleware/account-visibility.js";
import type { AccountVisibilityScope } from "../services/account-visibility.js";
import {
  BadNeighborhoodCatalogError,
  BadNeighborhoodContractIntegrityError,
  getBadNeighborhood,
  type BadNeighborhoodResponse,
  type StatsPopulation
} from "../services/bad-neighborhood.js";
import { StatsDatabaseConfigurationError } from "../services/stats-database.js";
import { parseStatsPopulation, statsReadLimiter } from "../services/stats-http.js";

const INVALID_POPULATION_MESSAGE = "Invalid population filter.";
const UNAVAILABLE_MESSAGE = "Bad Neighborhood statistics are temporarily unavailable.";

type LoadLeaderboard = (
  population: StatsPopulation,
  visibility: AccountVisibilityScope
) => Promise<BadNeighborhoodResponse>;

export function createStatsBadNeighborhoodRouter(
  loadLeaderboard: LoadLeaderboard = getBadNeighborhood,
  limiter: RequestHandler = statsReadLimiter,
  visibility: RequestHandler = createAccountVisibilityMiddleware({
    unavailableMessage: UNAVAILABLE_MESSAGE,
    logLabel: "Bad Neighborhood statistics"
  })
): Router {
  const router = Router();
  router.get(
    "/api/stats/bad-neighborhood",
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
        if (error instanceof BadNeighborhoodContractIntegrityError) {
          console.error("Bad Neighborhood provider contract integrity check failed.");
        } else if (error instanceof BadNeighborhoodCatalogError) {
          console.error("Bad Neighborhood zone catalog integrity check failed.");
        } else if (error instanceof StatsDatabaseConfigurationError) {
          console.error("Bad Neighborhood statistics database is not configured.");
        } else {
          const kind = error instanceof Error ? error.name : "UnknownError";
          console.error(`Bad Neighborhood statistics request failed (${kind}).`);
        }
        return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
      }
    }
  );
  return router;
}

export default createStatsBadNeighborhoodRouter();
