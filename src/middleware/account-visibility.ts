import type { RequestHandler } from "express";
import {
  accountVisibilityService,
  type AccountVisibilityScope
} from "../services/account-visibility.js";
import type { PortalHttpSecurityConfig } from "../services/auth-http.js";
import type { PortalSessionStore } from "../services/portal-sessions.js";
import {
  resolveOptionalPortalSession,
  type PortalSessionMiddlewareDependencies
} from "./portal-auth.js";

export interface AccountVisibilityLocals {
  accountVisibilityScope: AccountVisibilityScope;
}

interface AccountVisibilityResolver {
  getScope(principal?: { accountId: number; username: string }): Promise<AccountVisibilityScope>;
}

export interface AccountVisibilityMiddlewareOptions {
  unavailableMessage: string;
  logLabel: string;
  service?: AccountVisibilityResolver;
  sessions?: PortalSessionStore;
  getSecurityConfig?: () => PortalHttpSecurityConfig;
}

export function createAccountVisibilityMiddleware(
  options: AccountVisibilityMiddlewareOptions
): RequestHandler {
  const service = options.service ?? accountVisibilityService;
  const sessionDependencies: PortalSessionMiddlewareDependencies = {
    sessions: options.sessions,
    getSecurityConfig: options.getSecurityConfig
  };

  return async (request, response, next) => {
    try {
      const session = resolveOptionalPortalSession(
        request,
        response,
        sessionDependencies
      );
      (response.locals as AccountVisibilityLocals).accountVisibilityScope =
        await service.getScope(session?.principal);
      next();
    } catch (error) {
      const errorKind = error instanceof Error ? error.name : "UnknownError";
      console.error(`${options.logLabel} account visibility failed (${errorKind}).`);
      response.status(503).json({ error: options.unavailableMessage });
    }
  };
}
