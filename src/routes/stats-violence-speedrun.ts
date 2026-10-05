import { Router, type RequestHandler } from "express";
import { createAccountVisibilityMiddleware, type AccountVisibilityLocals } from "../middleware/account-visibility.js";
import type { AccountVisibilityScope } from "../services/account-visibility.js";
import { StatsDatabaseConfigurationError } from "../services/stats-database.js";
import { parseStatsPopulation, statsReadLimiter } from "../services/stats-http.js";
import {
  getViolenceSpeedrun,
  ViolenceSpeedrunContractIntegrityError,
  type StatsPopulation,
  type ViolenceSpeedrunResponse
} from "../services/violence-speedrun.js";

const UNAVAILABLE_MESSAGE = "Violence Speedrun statistics are temporarily unavailable.";
type Load = (population: StatsPopulation, visibility: AccountVisibilityScope) => Promise<ViolenceSpeedrunResponse>;

export function createStatsViolenceSpeedrunRouter(
  load: Load = getViolenceSpeedrun,
  limiter: RequestHandler = statsReadLimiter,
  visibility: RequestHandler = createAccountVisibilityMiddleware({
    unavailableMessage: UNAVAILABLE_MESSAGE,
    logLabel: "Violence Speedrun statistics"
  })
): Router {
  const router = Router();
  router.get("/api/stats/violence-speedrun",
    (_request, response, next) => {
      response.set("Cache-Control", "no-store");
      response.vary("Cookie");
      next();
    },
    limiter,
    visibility,
    async (request, response) => {
      const population = parseStatsPopulation(request.query.population);
      if (!population) return response.status(400).json({ error: "Invalid population filter." });
      try {
        const locals = response.locals as AccountVisibilityLocals;
        return response.json(await load(population, locals.accountVisibilityScope));
      } catch (error) {
        if (error instanceof ViolenceSpeedrunContractIntegrityError) {
          console.error("Violence Speedrun provider contract integrity check failed.");
        } else if (error instanceof StatsDatabaseConfigurationError) {
          console.error("Violence Speedrun statistics database is not configured.");
        } else {
          console.error(`Violence Speedrun statistics request failed (${error instanceof Error ? error.name : "UnknownError"}).`);
        }
        return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
      }
    }
  );
  return router;
}

export default createStatsViolenceSpeedrunRouter();
