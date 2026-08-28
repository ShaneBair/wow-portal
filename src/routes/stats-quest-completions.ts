import { Router, type RequestHandler } from "express";
import {
  createAccountVisibilityMiddleware,
  type AccountVisibilityLocals
} from "../middleware/account-visibility.js";
import type { AccountVisibilityScope } from "../services/account-visibility.js";
import {
  getQuestCompletionLeaderboard,
  QuestCompletionContractIntegrityError,
  type QuestCompletionLeaderboardResponse,
  type StatsPopulation
} from "../services/quest-completion-leaderboard.js";
import { StatsDatabaseConfigurationError } from "../services/stats-database.js";
import { parseStatsPopulation, statsReadLimiter } from "../services/stats-http.js";

const INVALID_POPULATION_MESSAGE = "Invalid population filter.";
const UNAVAILABLE_MESSAGE = "Quest completion statistics are temporarily unavailable.";

type LoadLeaderboard = (
  population: StatsPopulation,
  visibility: AccountVisibilityScope
) => Promise<QuestCompletionLeaderboardResponse>;

export function createStatsQuestCompletionsRouter(
  loadLeaderboard: LoadLeaderboard = getQuestCompletionLeaderboard,
  limiter: RequestHandler = statsReadLimiter,
  visibility: RequestHandler = createAccountVisibilityMiddleware({
    unavailableMessage: UNAVAILABLE_MESSAGE,
    logLabel: "Quest completion statistics"
  })
): Router {
  const router = Router();
  router.get(
    "/api/stats/quest-completions",
    (_request, response, next) => {
      response.set("Cache-Control", "no-store");
      response.vary("Cookie");
      next();
    },
    limiter,
    visibility,
    async (request, response) => {
      const population = parseStatsPopulation(request.query.population);
      if (!population) {
        return response.status(400).json({ error: INVALID_POPULATION_MESSAGE });
      }
      try {
        const locals = response.locals as AccountVisibilityLocals;
        return response.json(await loadLeaderboard(population, locals.accountVisibilityScope));
      } catch (error) {
        if (error instanceof QuestCompletionContractIntegrityError) {
          console.error("Quest completion statistics provider contract integrity check failed.");
        } else if (error instanceof StatsDatabaseConfigurationError) {
          console.error(
            "Quest completion statistics database is not configured; set the required STATS_DB_* environment variables."
          );
        } else {
          const errorKind = error instanceof Error ? error.name : "UnknownError";
          console.error(`Quest completion statistics request failed (${errorKind}).`);
        }
        return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
      }
    }
  );
  return router;
}

export default createStatsQuestCompletionsRouter();
