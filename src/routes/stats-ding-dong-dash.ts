import { Router, type RequestHandler } from "express";
import { createAccountVisibilityMiddleware, type AccountVisibilityLocals } from "../middleware/account-visibility.js";
import type { AccountVisibilityScope } from "../services/account-visibility.js";
import { getDingDongDash, type DingDongDashResponse, type StatsPopulation } from "../services/ding-dong-dash.js";
import { ProfessionalProcrastinatorContractIntegrityError } from "../services/professional-procrastinator.js";
import { StatsDatabaseConfigurationError } from "../services/stats-database.js";
import { parseStatsPopulation, statsReadLimiter } from "../services/stats-http.js";

const UNAVAILABLE_MESSAGE = "Ding Dong Dash statistics are temporarily unavailable.";
type Load = (population: StatsPopulation, visibility: AccountVisibilityScope) => Promise<DingDongDashResponse>;

export function createStatsDingDongDashRouter(
  load: Load = getDingDongDash,
  limiter: RequestHandler = statsReadLimiter,
  visibility: RequestHandler = createAccountVisibilityMiddleware({
    unavailableMessage: UNAVAILABLE_MESSAGE,
    logLabel: "Ding Dong Dash statistics"
  })
): Router {
  const router = Router();
  router.get("/api/stats/ding-dong-dash",
    (_request, response, next) => {
      response.set("Cache-Control", "no-store");
      response.vary("Cookie");
      next();
    }, limiter, visibility,
    async (request, response) => {
      const population = parseStatsPopulation(request.query.population);
      if (!population) return response.status(400).json({ error: "Invalid population filter." });
      try {
        const locals = response.locals as AccountVisibilityLocals;
        return response.json(await load(population, locals.accountVisibilityScope));
      } catch (error) {
        if (error instanceof ProfessionalProcrastinatorContractIntegrityError) {
          console.error("Ding Dong Dash provider contract integrity check failed.");
        } else if (error instanceof StatsDatabaseConfigurationError) {
          console.error("Ding Dong Dash statistics database is not configured.");
        } else {
          console.error(`Ding Dong Dash statistics request failed (${error instanceof Error ? error.name : "UnknownError"}).`);
        }
        return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
      }
    }
  );
  return router;
}

export default createStatsDingDongDashRouter();
