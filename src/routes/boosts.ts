import { Router } from "express";
import {
  createRequirePortalMutation,
  createRequirePortalSession,
  type PortalAuthLocals
} from "../middleware/portal-auth.js";
import {
  boostMutationLimiter,
  type BoostMutationLimiter
} from "../services/boost-mutation-limiter.js";
import type { PortalHttpSecurityConfig } from "../services/auth-http.js";
import {
  boostsService,
  type BoostsOverview
} from "../services/boosts.js";
import {
  BoostRequestError,
  parseMoneyBoostInput,
  type MoneyBoostInput,
  type MoneyBoostSuccess
} from "../services/player-boosts.js";
import {
  parsePortableHolesInput,
  type PortableHolesInput,
  type PortableHolesSuccess
} from "../services/portable-hole-boost.js";
import type { MoneyBoostConfig, PortableHolesBoostConfig } from "../services/boost-config.js";
import {
  parseArcaneTomeInput,
  type ArcaneTomeInput,
  type ArcaneTomeSuccess
} from "../services/arcane-tome-boost.js";
import type { ArcaneTomeBoostConfig } from "../services/boost-config.js";
import type { PortalSessionStore } from "../services/portal-sessions.js";

const UNAVAILABLE_MESSAGE = "Boosts are temporarily unavailable.";
const INVALID_REQUEST_MESSAGE = "Enter a valid character, request ID, and whole-gold amount.";
const INVALID_PORTABLE_HOLES_REQUEST_MESSAGE = "Enter a valid character and request ID.";
const RATE_LIMIT_MESSAGE = "Too many boost submissions. Try again later.";

export interface BoostsRouterDependencies {
  service?: {
    readMoneyConfig(): MoneyBoostConfig;
    readPortableHolesConfig(): PortableHolesBoostConfig;
    readArcaneTomeConfig(): ArcaneTomeBoostConfig;
    getOverview(accountId: number): Promise<BoostsOverview>;
    requestMoney(accountId: number, input: MoneyBoostInput): Promise<MoneyBoostSuccess>;
    requestPortableHoles(accountId: number, input: PortableHolesInput): Promise<PortableHolesSuccess>;
    requestArcaneTome(accountId: number, input: ArcaneTomeInput): Promise<ArcaneTomeSuccess>;
  };
  limiter?: BoostMutationLimiter;
  sessions?: PortalSessionStore;
  getSecurityConfig?: () => PortalHttpSecurityConfig;
}

function publicRequestFailure(
  error: BoostRequestError,
  failedFallback: string
): { status: number; body: object } {
  if (error.kind === "ownership") {
    return { status: 403, body: { error: error.message } };
  }
  if (["conflict", "processing", "limit"].includes(error.kind)) {
    return {
      status: 409,
      body: error.requestId
        ? { requestId: error.requestId, status: "pending", error: error.message }
        : { error: error.message }
    };
  }
  if (error.kind === "unknown") {
    return {
      status: 503,
      body: { requestId: error.requestId, status: "unknown", error: error.message }
    };
  }
  if (error.kind === "disabled") {
    return { status: 503, body: { error: error.message } };
  }
  return { status: 503, body: { error: failedFallback } };
}

export function createBoostsRouter(dependencies: BoostsRouterDependencies = {}): Router {
  const router = Router();
  const service = dependencies.service ?? boostsService;
  const limiter = dependencies.limiter ?? boostMutationLimiter;
  const authDependencies = {
    sessions: dependencies.sessions,
    getSecurityConfig: dependencies.getSecurityConfig
  };
  const requireSession = createRequirePortalSession(authDependencies);
  const requireMutation = createRequirePortalMutation(authDependencies);

  router.use("/api/boosts", (_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });

  router.get("/api/boosts", requireSession, async (_request, response) => {
    const locals = response.locals as PortalAuthLocals;
    try {
      return response.json(await service.getOverview(locals.authenticatedPrincipal.accountId));
    } catch (error) {
      const errorKind = error instanceof Error ? error.name : "UnknownError";
      console.error(`Boost overview dependency failed (${errorKind}).`);
      return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
    }
  });

  router.post("/api/boosts/money", requireMutation, async (request, response) => {
    if (!request.is("application/json")) {
      return response.status(400).json({ error: INVALID_REQUEST_MESSAGE });
    }
    let config;
    try {
      config = service.readMoneyConfig();
    } catch (error) {
      const errorKind = error instanceof Error ? error.name : "UnknownError";
      console.error(`Boost configuration failed (${errorKind}).`);
      return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
    }
    const input = parseMoneyBoostInput(request.body, config);
    if (!input) {
      return response.status(400).json({ error: INVALID_REQUEST_MESSAGE });
    }
    if (!config.enabled) {
      return response.status(503).json({ error: "Money boosts are currently disabled." });
    }
    if (!limiter.consume(request.ip ?? "unknown")) {
      return response.status(429).json({ error: RATE_LIMIT_MESSAGE });
    }

    const locals = response.locals as PortalAuthLocals;
    try {
      const result = await service.requestMoney(locals.authenticatedPrincipal.accountId, input);
      const { created, ...body } = result;
      return response.status(created ? 201 : 200).json(body);
    } catch (error) {
      if (error instanceof BoostRequestError) {
        const failure = publicRequestFailure(error, "Gold could not be sent. Try again later.");
        return response.status(failure.status).json(failure.body);
      }
      const errorKind = error instanceof Error ? error.name : "UnknownError";
      console.error(`Boost money dependency failed (${errorKind}).`);
      return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
    }
  });

  router.post("/api/boosts/portable-holes", requireMutation, async (request, response) => {
    if (!request.is("application/json")) {
      return response.status(400).json({ error: INVALID_PORTABLE_HOLES_REQUEST_MESSAGE });
    }
    let config;
    try {
      config = service.readPortableHolesConfig();
    } catch (error) {
      const errorKind = error instanceof Error ? error.name : "UnknownError";
      console.error(`Portable Hole boost configuration failed (${errorKind}).`);
      return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
    }
    const input = parsePortableHolesInput(request.body);
    if (!input) {
      return response.status(400).json({ error: INVALID_PORTABLE_HOLES_REQUEST_MESSAGE });
    }
    if (!config.enabled) {
      return response.status(503).json({ error: "This boost is currently unavailable." });
    }
    if (!limiter.consume(request.ip ?? "unknown")) {
      return response.status(429).json({ error: RATE_LIMIT_MESSAGE });
    }

    const locals = response.locals as PortalAuthLocals;
    try {
      const result = await service.requestPortableHoles(
        locals.authenticatedPrincipal.accountId,
        input
      );
      const { created, ...body } = result;
      return response.status(created ? 201 : 200).json(body);
    } catch (error) {
      if (error instanceof BoostRequestError) {
        const failure = publicRequestFailure(error, "Bags could not be sent. Try again later.");
        return response.status(failure.status).json(failure.body);
      }
      const errorKind = error instanceof Error ? error.name : "UnknownError";
      console.error(`Portable Hole boost dependency failed (${errorKind}).`);
      return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
    }
  });

  router.post("/api/boosts/arcane-tome", requireMutation, async (request, response) => {
    if (!request.is("application/json")) {
      return response.status(400).json({ error: INVALID_PORTABLE_HOLES_REQUEST_MESSAGE });
    }
    let config;
    try {
      config = service.readArcaneTomeConfig();
    } catch (error) {
      const errorKind = error instanceof Error ? error.name : "UnknownError";
      console.error(`Arcane Tome boost configuration failed (${errorKind}).`);
      return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
    }
    const input = parseArcaneTomeInput(request.body);
    if (!input) {
      return response.status(400).json({ error: INVALID_PORTABLE_HOLES_REQUEST_MESSAGE });
    }
    if (!config.enabled) {
      return response.status(503).json({ error: "This boost is currently unavailable." });
    }
    if (!limiter.consume(request.ip ?? "unknown")) {
      return response.status(429).json({ error: RATE_LIMIT_MESSAGE });
    }

    const locals = response.locals as PortalAuthLocals;
    try {
      const result = await service.requestArcaneTome(locals.authenticatedPrincipal.accountId, input);
      const { created, ...body } = result;
      return response.status(created ? 201 : 200).json(body);
    } catch (error) {
      if (error instanceof BoostRequestError) {
        const failure = publicRequestFailure(error, "The tome could not be sent. Try again later.");
        return response.status(failure.status).json(failure.body);
      }
      const errorKind = error instanceof Error ? error.name : "UnknownError";
      console.error(`Arcane Tome boost dependency failed (${errorKind}).`);
      return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
    }
  });

  return router;
}

export default createBoostsRouter();
