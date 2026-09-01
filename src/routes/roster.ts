import { Router, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import {
  createAccountVisibilityMiddleware,
  type AccountVisibilityLocals
} from "../middleware/account-visibility.js";
import { createRequirePortalSession } from "../middleware/portal-auth.js";
import type { PortalHttpSecurityConfig } from "../services/auth-http.js";
import {
  accountRosterService,
  type AccountRosterResponse
} from "../services/account-roster.js";
import type { AccountVisibilityScope } from "../services/account-visibility.js";
import type { PortalSessionStore } from "../services/portal-sessions.js";

const UNAVAILABLE_MESSAGE = "The roster is temporarily unavailable.";

const rosterLimiter = rateLimit({
  windowMs: 5 * 60_000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({ error: "Too many roster requests. Try again later." });
  }
});

export interface RosterRouterDependencies {
  loadRoster?: (visibility: AccountVisibilityScope) => Promise<AccountRosterResponse>;
  limiter?: RequestHandler;
  visibility?: RequestHandler;
  sessions?: PortalSessionStore;
  getSecurityConfig?: () => PortalHttpSecurityConfig;
}

export function createRosterRouter(dependencies: RosterRouterDependencies = {}): Router {
  const router = Router();
  const authDependencies = {
    sessions: dependencies.sessions,
    getSecurityConfig: dependencies.getSecurityConfig
  };
  const requireSession = createRequirePortalSession(authDependencies);
  const visibility = dependencies.visibility ?? createAccountVisibilityMiddleware({
    unavailableMessage: UNAVAILABLE_MESSAGE,
    logLabel: "Account roster",
    ...authDependencies
  });
  const limiter = dependencies.limiter ?? rosterLimiter;
  const loadRoster = dependencies.loadRoster ?? ((scope) => accountRosterService.getRoster(scope));

  router.get(
    "/api/roster",
    (_request, response, next) => {
      response.set("Cache-Control", "no-store");
      next();
    },
    requireSession,
    visibility,
    limiter,
    async (_request, response) => {
      try {
        const locals = response.locals as unknown as AccountVisibilityLocals;
        return response.json(await loadRoster(locals.accountVisibilityScope));
      } catch (error) {
        const errorKind = error instanceof Error ? error.name : "UnknownError";
        console.error(`Account roster request failed (${errorKind}).`);
        return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
      }
    }
  );
  return router;
}

export default createRosterRouter();
