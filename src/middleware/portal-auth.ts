import type { Request, RequestHandler, Response } from "express";
import {
  clearSessionCookie,
  readCookie,
  readPortalHttpSecurityConfig,
  requestHasAllowedOrigin,
  UNVERIFIED_REQUEST_MESSAGE,
  type PortalHttpSecurityConfig
} from "../services/auth-http.js";
import {
  portalSessionStore,
  type AuthenticatedPrincipal,
  type PortalSessionStore,
  type ResolvedPortalSession
} from "../services/portal-sessions.js";

export interface PortalAuthLocals {
  authenticatedPrincipal: AuthenticatedPrincipal;
  portalSession: ResolvedPortalSession;
}

export interface PortalSessionMiddlewareDependencies {
  sessions?: PortalSessionStore;
  getSecurityConfig?: () => PortalHttpSecurityConfig;
}

export function resolveOptionalPortalSession(
  request: Request,
  response: Response,
  dependencies: PortalSessionMiddlewareDependencies = {}
): ResolvedPortalSession | undefined {
  const sessions = dependencies.sessions ?? portalSessionStore;
  const getSecurityConfig = dependencies.getSecurityConfig ?? readPortalHttpSecurityConfig;
  let config: PortalHttpSecurityConfig;
  try {
    config = getSecurityConfig();
  } catch {
    return undefined;
  }
  const sessionId = readCookie(request, config.sessionCookieName);
  const session = sessionId ? sessions.resolve(sessionId, false) : undefined;
  if (!session && sessionId) {
    clearSessionCookie(response, config);
  }
  return session;
}

export function createRequirePortalSession(
  dependencies: PortalSessionMiddlewareDependencies = {}
): RequestHandler<Record<string, string>, unknown, unknown, unknown, PortalAuthLocals> {
  const sessions = dependencies.sessions ?? portalSessionStore;
  const getSecurityConfig = dependencies.getSecurityConfig ?? readPortalHttpSecurityConfig;

  return (request, response, next) => {
    let config: PortalHttpSecurityConfig;
    try {
      config = getSecurityConfig();
    } catch {
      return response.status(401).json({ error: "Log in to continue." });
    }
    const sessionId = readCookie(request, config.sessionCookieName);
    const session = sessionId ? sessions.resolve(sessionId) : undefined;
    if (!session) {
      if (sessionId) {
        clearSessionCookie(response, config);
      }
      return response.status(401).json({ error: "Log in to continue." });
    }
    response.locals.authenticatedPrincipal = session.principal;
    response.locals.portalSession = session;
    next();
  };
}

export function createRequirePortalMutation(
  dependencies: PortalSessionMiddlewareDependencies = {}
): RequestHandler<Record<string, string>, unknown, unknown, unknown, PortalAuthLocals> {
  const sessions = dependencies.sessions ?? portalSessionStore;
  const getSecurityConfig = dependencies.getSecurityConfig ?? readPortalHttpSecurityConfig;

  return (request, response, next) => {
    let config: PortalHttpSecurityConfig;
    try {
      config = getSecurityConfig();
    } catch {
      return response.status(403).json({ error: UNVERIFIED_REQUEST_MESSAGE });
    }
    if (!requestHasAllowedOrigin(request, config)) {
      return response.status(403).json({ error: UNVERIFIED_REQUEST_MESSAGE });
    }
    const sessionId = readCookie(request, config.sessionCookieName);
    const session = sessionId ? sessions.resolve(sessionId) : undefined;
    if (!session) {
      if (sessionId) {
        clearSessionCookie(response, config);
      }
      return response.status(401).json({ error: "Log in to continue." });
    }
    const csrfToken = request.get("x-csrf-token") ?? "";
    if (!sessions.verifyCsrf(session, csrfToken)) {
      return response.status(403).json({ error: UNVERIFIED_REQUEST_MESSAGE });
    }
    response.locals.authenticatedPrincipal = session.principal;
    response.locals.portalSession = session;
    next();
  };
}
