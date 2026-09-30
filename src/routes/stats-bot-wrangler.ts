import { Router, type RequestHandler } from "express";
import {
  createAccountVisibilityMiddleware,
  type AccountVisibilityLocals
} from "../middleware/account-visibility.js";
import type { AccountVisibilityScope } from "../services/account-visibility.js";
import {
  BotWranglerContractIntegrityError,
  getBotWrangler,
  type BotWranglerResponse
} from "../services/bot-wrangler.js";
import { StatsDatabaseConfigurationError } from "../services/stats-database.js";
import { statsReadLimiter } from "../services/stats-http.js";

const INVALID_POPULATION_MESSAGE = "Bot Wrangler does not accept a population filter.";
const UNAVAILABLE_MESSAGE = "Bot Wrangler statistics are temporarily unavailable.";

type LoadLeaderboard = (visibility: AccountVisibilityScope) => Promise<BotWranglerResponse>;

export function createStatsBotWranglerRouter(
  loadLeaderboard: LoadLeaderboard = getBotWrangler,
  limiter: RequestHandler = statsReadLimiter,
  visibility: RequestHandler = createAccountVisibilityMiddleware({
    unavailableMessage: UNAVAILABLE_MESSAGE,
    logLabel: "Bot Wrangler statistics"
  })
): Router {
  const router = Router();
  router.get(
    "/api/stats/bot-wrangler",
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
        if (error instanceof BotWranglerContractIntegrityError) {
          console.error("Bot Wrangler provider contract integrity check failed.");
        } else if (error instanceof StatsDatabaseConfigurationError) {
          console.error("Bot Wrangler statistics database is not configured.");
        } else {
          const kind = error instanceof Error ? error.name : "UnknownError";
          console.error(`Bot Wrangler statistics request failed (${kind}).`);
        }
        return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
      }
    }
  );
  return router;
}

export default createStatsBotWranglerRouter();
