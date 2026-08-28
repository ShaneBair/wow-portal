import { Router, type RequestHandler } from "express";
import {
  createAccountVisibilityMiddleware,
  type AccountVisibilityLocals
} from "../middleware/account-visibility.js";
import type { AccountVisibilityScope } from "../services/account-visibility.js";
import rateLimit from "express-rate-limit";
import {
  getOnlinePlayers,
  type OnlinePlayersResponse
} from "../services/online-roster.js";

const UNAVAILABLE_MESSAGE = "Online player information is temporarily unavailable.";

const onlinePlayersLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many online roster requests. Try again shortly." });
  }
});

export function createOnlinePlayersRouter(
  loadOnlinePlayers: (visibility: AccountVisibilityScope) => Promise<OnlinePlayersResponse> =
    getOnlinePlayers,
  limiter: RequestHandler = onlinePlayersLimiter,
  visibility: RequestHandler = createAccountVisibilityMiddleware({
    unavailableMessage: UNAVAILABLE_MESSAGE,
    logLabel: "Online roster"
  })
): Router {
  const router = Router();

  router.get(
    "/api/online-players",
    (_req, res, next) => {
      res.set("Cache-Control", "no-store");
      res.vary("Cookie");
      next();
    },
    limiter,
    visibility,
    async (_req, res) => {
      try {
        const locals = res.locals as AccountVisibilityLocals;
        return res.json(await loadOnlinePlayers(locals.accountVisibilityScope));
      } catch (error) {
        const errorKind = error instanceof Error ? error.name : "UnknownError";
        console.error(`Online roster request failed (${errorKind}).`);
        return res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      }
    }
  );

  return router;
}

export default createOnlinePlayersRouter();
