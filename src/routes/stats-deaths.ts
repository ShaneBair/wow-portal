import { Router, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import {
  DeathLeaderboardContractIntegrityError,
  getDeathLeaderboard,
  type DeathLeaderboardResponse,
  type StatsPopulation
} from "../services/death-leaderboard.js";
import { StatsDatabaseConfigurationError } from "../services/stats-database.js";

const INVALID_POPULATION_MESSAGE = "Invalid population filter.";
const UNAVAILABLE_MESSAGE = "Death statistics are temporarily unavailable.";

const statsDeathsLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many statistics requests. Try again shortly." });
  }
});

export function parseStatsPopulation(value: unknown): StatsPopulation | undefined {
  if (value === undefined) {
    return "players";
  }

  if (value === "players" || value === "all") {
    return value;
  }

  return undefined;
}

type LoadLeaderboard = (population: StatsPopulation) => Promise<DeathLeaderboardResponse>;

export function createStatsDeathsRouter(
  loadLeaderboard: LoadLeaderboard = getDeathLeaderboard,
  limiter: RequestHandler = statsDeathsLimiter
): Router {
  const router = Router();

  router.get(
    "/api/stats/deaths",
    (_req, res, next) => {
      res.set("Cache-Control", "no-store");
      next();
    },
    limiter,
    async (req, res) => {
      const population = parseStatsPopulation(req.query.population);

      if (!population) {
        return res.status(400).json({ error: INVALID_POPULATION_MESSAGE });
      }

      try {
        return res.json(await loadLeaderboard(population));
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
