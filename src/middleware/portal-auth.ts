import type { RequestHandler } from "express";
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

interface MiddlewareDependencies {
  sessions?: PortalSessionStore;
  getSecurityConfig?: () => PortalHttpSecurityConfig;
}

export function createRequirePortalSession(
  dependencies: MiddlewareDependencies = {}
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
  dependencies: MiddlewareDependencies = {}
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
