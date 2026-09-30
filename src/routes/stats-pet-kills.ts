import { Router, type RequestHandler } from "express";
import {
  createAccountVisibilityMiddleware,
  type AccountVisibilityLocals
} from "../middleware/account-visibility.js";
import type { AccountVisibilityScope } from "../services/account-visibility.js";
import {
  getPetKills,
  PetKillContractIntegrityError,
  type PetKillResponse,
  type StatsPopulation
} from "../services/pet-kills.js";
import { StatsDatabaseConfigurationError } from "../services/stats-database.js";
import { parseStatsPopulation, statsReadLimiter } from "../services/stats-http.js";

const INVALID_POPULATION_MESSAGE = "Invalid population filter.";
const UNAVAILABLE_MESSAGE = "Pet kill statistics are temporarily unavailable.";

type LoadLeaderboard = (
  population: StatsPopulation,
  visibility: AccountVisibilityScope
) => Promise<PetKillResponse>;

export function createStatsPetKillsRouter(
  loadLeaderboard: LoadLeaderboard = getPetKills,
  limiter: RequestHandler = statsReadLimiter,
  visibility: RequestHandler = createAccountVisibilityMiddleware({
    unavailableMessage: UNAVAILABLE_MESSAGE,
    logLabel: "Pet kill statistics"
  })
): Router {
  const router = Router();
  router.get(
    "/api/stats/pet-kills",
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
        if (error instanceof PetKillContractIntegrityError) {
          console.error("Pet kill provider contract integrity check failed.");
        } else if (error instanceof StatsDatabaseConfigurationError) {
          console.error("Pet kill statistics database is not configured.");
        } else {
          const kind = error instanceof Error ? error.name : "UnknownError";
          console.error(`Pet kill statistics request failed (${kind}).`);
        }
        return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
      }
    }
  );
  return router;
}

export default createStatsPetKillsRouter();
