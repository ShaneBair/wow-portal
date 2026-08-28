import { Router, type RequestHandler } from "express";
import {
  createAccountVisibilityMiddleware,
  type AccountVisibilityLocals
} from "../middleware/account-visibility.js";
import type { AccountVisibilityScope } from "../services/account-visibility.js";
import {
  DeathLeaderboardContractIntegrityError,
  getDeathLeaderboard,
  type DeathLeaderboardResponse,
  type StatsPopulation
} from "../services/death-leaderboard.js";
import { StatsDatabaseConfigurationError } from "../services/stats-database.js";
import { parseStatsPopulation, statsReadLimiter } from "../services/stats-http.js";

export { parseStatsPopulation } from "../services/stats-http.js";

const INVALID_POPULATION_MESSAGE = "Invalid population filter.";
const UNAVAILABLE_MESSAGE = "Death statistics are temporarily unavailable.";

type LoadLeaderboard = (
  population: StatsPopulation,
  visibility: AccountVisibilityScope
) => Promise<DeathLeaderboardResponse>;

export function createStatsDeathsRouter(
  loadLeaderboard: LoadLeaderboard = getDeathLeaderboard,
  limiter: RequestHandler = statsReadLimiter,
  visibility: RequestHandler = createAccountVisibilityMiddleware({
    unavailableMessage: UNAVAILABLE_MESSAGE,
    logLabel: "Death statistics"
  })
): Router {
  const router = Router();

  router.get(
    "/api/stats/deaths",
    (_req, res, next) => {
      res.set("Cache-Control", "no-store");
      res.vary("Cookie");
      next();
    },
    limiter,
    visibility,
    async (req, res) => {
      const population = parseStatsPopulation(req.query.population);

      if (!population) {
        return res.status(400).json({ error: INVALID_POPULATION_MESSAGE });
      }

      try {
        const locals = res.locals as AccountVisibilityLocals;
        return res.json(await loadLeaderboard(population, locals.accountVisibilityScope));
      } catch (error) {
        if (error instanceof DeathLeaderboardContractIntegrityError) {
          console.error("Death statistics provider contract integrity check failed.");
        } else if (error instanceof StatsDatabaseConfigurationError) {
          console.error(
            "Death statistics database is not configured; set the required STATS_DB_* environment variables."
          );
        } else {
          const errorKind = error instanceof Error ? error.name : "UnknownError";
          console.error(`Death statistics request failed (${errorKind}).`);
        }

        return res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      }
    }
  );

  return router;
}

export default createStatsDeathsRouter();
