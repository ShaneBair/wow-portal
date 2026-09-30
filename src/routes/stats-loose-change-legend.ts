import { Router, type RequestHandler } from "express";
import {
  createAccountVisibilityMiddleware,
  type AccountVisibilityLocals
} from "../middleware/account-visibility.js";
import type { AccountVisibilityScope } from "../services/account-visibility.js";
import {
  getLooseChangeLegend,
  type LooseChangeLegendResponse
} from "../services/loose-change-legend.js";
import { StatsDatabaseConfigurationError } from "../services/stats-database.js";
import { statsReadLimiter } from "../services/stats-http.js";

const INVALID_POPULATION_MESSAGE = "Loose Change Legend does not accept a population filter.";
const UNAVAILABLE_MESSAGE = "Loose Change Legend statistics are temporarily unavailable.";

type LoadLeaderboard = (
  visibility: AccountVisibilityScope
) => Promise<LooseChangeLegendResponse>;

export function createStatsLooseChangeLegendRouter(
  loadLeaderboard: LoadLeaderboard = getLooseChangeLegend,
  limiter: RequestHandler = statsReadLimiter,
  visibility: RequestHandler = createAccountVisibilityMiddleware({
    unavailableMessage: UNAVAILABLE_MESSAGE,
    logLabel: "Loose Change Legend statistics"
  })
): Router {
  const router = Router();
  router.get(
    "/api/stats/loose-change-legend",
    (_request, response, next) => {
      response.set("Cache-Control", "no-store");
      response.vary("Cookie");
      next();
    },
    limiter,
    visibility,
    async (request, response) => {
      if (request.query.population !== undefined) {
        return response.status(400).json({ error: INVALID_POPULATION_MESSAGE });
      }
      try {
        const locals = response.locals as AccountVisibilityLocals;
        return response.json(await loadLeaderboard(locals.accountVisibilityScope));
      } catch (error) {
        if (error instanceof StatsDatabaseConfigurationError) {
          console.error("Loose Change Legend statistics configuration is invalid.");
        } else {
          const kind = error instanceof Error ? error.name : "UnknownError";
          console.error(`Loose Change Legend statistics request failed (${kind}).`);
        }
        return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
      }
    }
  );
  return router;
}

export default createStatsLooseChangeLegendRouter();
