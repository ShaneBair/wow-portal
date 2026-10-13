import { Router, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import {
  createAccountVisibilityMiddleware,
  type AccountVisibilityLocals
} from "../middleware/account-visibility.js";
import { createRequirePortalSession } from "../middleware/portal-auth.js";
import {
  armoryService,
  type ArmoryCharacterDetail,
  type ArmoryCharacterSummary
} from "../services/armory.js";
import type { AccountVisibilityScope } from "../services/account-visibility.js";
import type { PortalHttpSecurityConfig } from "../services/auth-http.js";
import type { PortalSessionStore } from "../services/portal-sessions.js";

const UNAVAILABLE_MESSAGE = "The armory is temporarily unavailable.";
const CHARACTER_ID = /^[1-9]\d{0,9}$/u;

const armoryLimiter = rateLimit({
  windowMs: 5 * 60_000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({ error: "Too many armory requests. Try again later." });
  }
});

export interface ArmoryRouterDependencies {
  listCharacters?: (visibility: AccountVisibilityScope) => Promise<{ characters: ArmoryCharacterSummary[] }>;
  loadCharacter?: (characterGuid: number, visibility: AccountVisibilityScope) => Promise<ArmoryCharacterDetail | undefined>;
  limiter?: RequestHandler;
  visibility?: RequestHandler;
  sessions?: PortalSessionStore;
  getSecurityConfig?: () => PortalHttpSecurityConfig;
}

function parseCharacterId(value: string): number | undefined {
  if (!CHARACTER_ID.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= 0xffff_ffff ? parsed : undefined;
}

export function createArmoryRouter(dependencies: ArmoryRouterDependencies = {}): Router {
  const router = Router();
  const authDependencies = { sessions: dependencies.sessions, getSecurityConfig: dependencies.getSecurityConfig };
  const requireSession = createRequirePortalSession(authDependencies);
  const visibility = dependencies.visibility ?? createAccountVisibilityMiddleware({
    unavailableMessage: UNAVAILABLE_MESSAGE,
    logLabel: "Armory",
    ...authDependencies
  });
  const limiter = dependencies.limiter ?? armoryLimiter;
  const listCharacters = dependencies.listCharacters ?? ((scope) => armoryService.getCharacters(scope));
  const loadCharacter = dependencies.loadCharacter ?? ((guid, scope) => armoryService.getCharacter(guid, scope));

  router.use("/api/armory", (_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });

  router.get("/api/armory", requireSession, visibility, limiter, async (_request, response) => {
    try {
      const locals = response.locals as unknown as AccountVisibilityLocals;
      return response.json(await listCharacters(locals.accountVisibilityScope));
    } catch (error) {
      const errorKind = error instanceof Error ? error.name : "UnknownError";
      console.error(`Armory character list failed (${errorKind}).`);
      return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
    }
  });

  router.get("/api/armory/:characterId", requireSession, visibility, limiter, async (request, response) => {
    const characterGuid = parseCharacterId(request.params.characterId);
    if (characterGuid === undefined) return response.status(400).json({ error: "Choose a valid character." });
    try {
      const locals = response.locals as unknown as AccountVisibilityLocals;
      const character = await loadCharacter(characterGuid, locals.accountVisibilityScope);
      return character
        ? response.json({ character })
        : response.status(404).json({ error: "That character is not available in the armory." });
    } catch (error) {
      const errorKind = error instanceof Error ? error.name : "UnknownError";
      console.error(`Armory character request failed (${errorKind}).`);
      return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
    }
  });

  return router;
}

export default createArmoryRouter();
