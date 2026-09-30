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
import {
  parseCharacterLevelInput,
  type CharacterLevelInput,
  type CharacterLevelSuccess
} from "../services/character-level-boost.js";
import type { CharacterLevelBoostConfig } from "../services/boost-config.js";
import type { PortalSessionStore } from "../services/portal-sessions.js";
import {
  parseItemDeliveryInput,
  isCanonicalItemDeliveryJson,
  parseItemId,
  type ItemDeliveryInput,
  type ItemDeliveryPreview,
  type ItemDeliverySuccess
} from "../services/item-delivery.js";
import type { ItemDeliveryBoostConfig } from "../services/boost-config.js";
import { itemLookupLimiter, type ItemLookupLimiter } from "../services/item-lookup-limiter.js";
import { getRawJsonBody } from "../services/raw-json-body.js";

const UNAVAILABLE_MESSAGE = "Boosts are temporarily unavailable.";
const INVALID_REQUEST_MESSAGE = "Enter a valid character, request ID, and whole-gold amount.";
const INVALID_PORTABLE_HOLES_REQUEST_MESSAGE = "Enter a valid character and request ID.";
const RATE_LIMIT_MESSAGE = "Too many boost submissions. Try again later.";
const INVALID_CHARACTER_LEVEL_REQUEST_MESSAGE = "Enter a valid character, request ID, and target level.";
const INVALID_ITEM_DELIVERY_REQUEST_MESSAGE = "Enter a valid character, request ID, item ID, and quantity.";
const LOOKUP_RATE_LIMIT_MESSAGE = "Too many item lookups. Try again later.";

export interface BoostsRouterDependencies {
  service?: {
    readMoneyConfig(): MoneyBoostConfig;
    readPortableHolesConfig(): PortableHolesBoostConfig;
    readArcaneTomeConfig(): ArcaneTomeBoostConfig;
    readCharacterLevelConfig(): CharacterLevelBoostConfig;
    readItemDeliveryConfig(): ItemDeliveryBoostConfig;
    getOverview(accountId: number): Promise<BoostsOverview>;
    requestMoney(accountId: number, input: MoneyBoostInput): Promise<MoneyBoostSuccess>;
    requestPortableHoles(accountId: number, input: PortableHolesInput): Promise<PortableHolesSuccess>;
    requestArcaneTome(accountId: number, input: ArcaneTomeInput): Promise<ArcaneTomeSuccess>;
    requestCharacterLevel(accountId: number, input: CharacterLevelInput): Promise<CharacterLevelSuccess>;
    lookupItem(itemId: number): Promise<ItemDeliveryPreview | undefined>;
    requestItemDelivery(accountId: number, input: ItemDeliveryInput): Promise<ItemDeliverySuccess>;
  };
  limiter?: BoostMutationLimiter;
  lookupLimiter?: ItemLookupLimiter;
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
  if (error.kind === "invalid") {
    return { status: 400, body: { error: error.message } };
  }
  if (error.kind === "not-found") {
    return { status: 404, body: { error: error.message } };
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
  const lookupLimiter = dependencies.lookupLimiter ?? itemLookupLimiter;
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

  router.get("/api/boosts/items/:itemId", requireSession, async (request, response) => {
    const itemId = parseItemId(request.params.itemId);
    if (itemId === undefined) return response.status(400).json({ error: "Enter a valid item ID." });
    let config;
    try {
      config = service.readItemDeliveryConfig();
    } catch (error) {
      const errorKind = error instanceof Error ? error.name : "UnknownError";
      console.error(`Item delivery configuration failed (${errorKind}).`);
      return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
    }
    if (!config.enabled) return response.status(503).json({ error: "This boost is currently unavailable." });
    const locals = response.locals as PortalAuthLocals;
    if (!lookupLimiter.consume(`${locals.authenticatedPrincipal.accountId}:${request.ip ?? "unknown"}`)) {
      return response.status(429).json({ error: LOOKUP_RATE_LIMIT_MESSAGE });
    }
    try {
      const item = await service.lookupItem(itemId);
      return item
        ? response.json({ item })
        : response.status(404).json({ error: "That item could not be found." });
    } catch (error) {
      if (error instanceof BoostRequestError) {
        const failure = publicRequestFailure(error, UNAVAILABLE_MESSAGE);
        return response.status(failure.status).json(failure.body);
      }
      const errorKind = error instanceof Error ? error.name : "UnknownError";
      console.error(`Item lookup dependency failed (${errorKind}).`);
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

  router.post("/api/boosts/character-level", requireMutation, async (request, response) => {
    if (!request.is("application/json")) {
      return response.status(400).json({ error: INVALID_CHARACTER_LEVEL_REQUEST_MESSAGE });
    }
    let config;
    try {
      config = service.readCharacterLevelConfig();
    } catch (error) {
      const errorKind = error instanceof Error ? error.name : "UnknownError";
      console.error(`Character level boost configuration failed (${errorKind}).`);
      return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
    }
    const input = parseCharacterLevelInput(request.body);
    if (!input) {
      return response.status(400).json({ error: INVALID_CHARACTER_LEVEL_REQUEST_MESSAGE });
    }
    if (!config.enabled) {
      return response.status(503).json({ error: "This boost is currently unavailable." });
    }
    if (!limiter.consume(request.ip ?? "unknown")) {
      return response.status(429).json({ error: RATE_LIMIT_MESSAGE });
    }
    const locals = response.locals as PortalAuthLocals;
    try {
      const result = await service.requestCharacterLevel(locals.authenticatedPrincipal.accountId, input);
      const { created, ...body } = result;
      return response.status(created ? 201 : 200).json(body);
    } catch (error) {
      if (error instanceof BoostRequestError) {
        const failure = publicRequestFailure(error, "The character level could not be changed. Try again later.");
        return response.status(failure.status).json(failure.body);
      }
      const errorKind = error instanceof Error ? error.name : "UnknownError";
      console.error(`Character level boost dependency failed (${errorKind}).`);
      return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
    }
  });

  router.post("/api/boosts/item-delivery", requireMutation, async (request, response) => {
    if (!request.is("application/json")) {
      return response.status(400).json({ error: INVALID_ITEM_DELIVERY_REQUEST_MESSAGE });
    }
    if (!isCanonicalItemDeliveryJson(getRawJsonBody(request))) {
      return response.status(400).json({ error: INVALID_ITEM_DELIVERY_REQUEST_MESSAGE });
    }
    let config;
    try {
      config = service.readItemDeliveryConfig();
    } catch (error) {
      const errorKind = error instanceof Error ? error.name : "UnknownError";
      console.error(`Item delivery configuration failed (${errorKind}).`);
      return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
    }
    const input = parseItemDeliveryInput(request.body, config);
    if (!input) return response.status(400).json({ error: INVALID_ITEM_DELIVERY_REQUEST_MESSAGE });
    if (!config.enabled) return response.status(503).json({ error: "This boost is currently unavailable." });
    if (!limiter.consume(request.ip ?? "unknown")) {
      return response.status(429).json({ error: RATE_LIMIT_MESSAGE });
    }
    const locals = response.locals as PortalAuthLocals;
    try {
      const result = await service.requestItemDelivery(locals.authenticatedPrincipal.accountId, input);
      const { created, ...body } = result;
      return response.status(created ? 201 : 200).json(body);
    } catch (error) {
      if (error instanceof BoostRequestError) {
        const failure = publicRequestFailure(error, "Items could not be sent. Try again later.");
        return response.status(failure.status).json(failure.body);
      }
      const errorKind = error instanceof Error ? error.name : "UnknownError";
      console.error(`Item delivery dependency failed (${errorKind}).`);
      return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
    }
  });

  return router;
}

export default createBoostsRouter();
