import { Router, type RequestHandler } from "express";
import {
  BossKillContractIntegrityError,
  getBossKillLeaderboard,
  type BossKillLeaderboardResponse,
  type StatsPopulation
} from "../services/boss-kill-leaderboard.js";
import { StatsDatabaseConfigurationError } from "../services/stats-database.js";
import { parseStatsPopulation, statsReadLimiter } from "../services/stats-http.js";

const INVALID_POPULATION_MESSAGE = "Invalid population filter.";
const UNAVAILABLE_MESSAGE = "Boss kill statistics are temporarily unavailable.";

type LoadLeaderboard = (population: StatsPopulation) => Promise<BossKillLeaderboardResponse>;

export function createStatsBossKillsRouter(
  loadLeaderboard: LoadLeaderboard = getBossKillLeaderboard,
  limiter: RequestHandler = statsReadLimiter
): Router {
  const router = Router();
  router.get(
    "/api/stats/boss-kills",
    (_request, response, next) => {
      response.set("Cache-Control", "no-store");
      next();
    },
    limiter,
    async (request, response) => {
      const population = parseStatsPopulation(request.query.population);
      if (!population) return response.status(400).json({ error: INVALID_POPULATION_MESSAGE });
      try {
        return response.json(await loadLeaderboard(population));
      } catch (error) {
        if (error instanceof BossKillContractIntegrityError) {
          console.error("Boss kill statistics provider contract integrity check failed.");
        } else if (error instanceof StatsDatabaseConfigurationError) {
          console.error("Boss kill statistics database configuration is unavailable.");
        } else {
          const errorKind = error instanceof Error ? error.name : "UnknownError";
          console.error(`Boss kill statistics request failed (${errorKind}).`);
        }
        return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
      }
    }
  );
  return router;
}

export default createStatsBossKillsRouter();
