import { Router } from "express";
import {
  clearSessionCookie,
  INVALID_CREDENTIALS_MESSAGE,
  INVALID_REQUEST_MESSAGE,
  parseLoginInput,
  readCookie,
  readPortalHttpSecurityConfig,
  requestHasAllowedOrigin,
  setSessionCookie,
  UNVERIFIED_REQUEST_MESSAGE,
  type PortalHttpSecurityConfig
} from "../services/auth-http.js";
import {
  loginAttemptLimiter,
  type LoginAttemptLimiter
} from "../services/login-attempt-limiter.js";
import {
  portalAuthenticationService,
  type PortalAccount,
  type PortalAuthenticationService
} from "../services/portal-authentication.js";
import {
  portalSessionStore,
  SESSION_ABSOLUTE_TIMEOUT_MS,
  type PortalSessionStore
} from "../services/portal-sessions.js";

const LOGIN_UNAVAILABLE_MESSAGE = "Login is temporarily unavailable.";
const TOO_MANY_ATTEMPTS_MESSAGE = "Too many login attempts. Try again later.";

interface AuthenticationService {
  authenticate(username: string, password: string): Promise<PortalAccount | undefined>;
}

export interface AuthRouterDependencies {
  authentication?: AuthenticationService | PortalAuthenticationService;
  sessions?: PortalSessionStore;
  attempts?: LoginAttemptLimiter;
  getSecurityConfig?: () => PortalHttpSecurityConfig;
}

function authenticatedResponse(username: string, csrfToken: string) {
  return {
    authenticated: true as const,
    account: { username },
    csrfToken
  };
}

export function createAuthRouter(dependencies: AuthRouterDependencies = {}): Router {
  const authentication = dependencies.authentication ?? portalAuthenticationService;
  const sessions = dependencies.sessions ?? portalSessionStore;
  const attempts = dependencies.attempts ?? loginAttemptLimiter;
  const getSecurityConfig = dependencies.getSecurityConfig ?? readPortalHttpSecurityConfig;
  const router = Router();

  router.use("/api/auth", (_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });

  router.post("/api/auth/login", async (request, response) => {
    let config: PortalHttpSecurityConfig;
    try {
      config = getSecurityConfig();
    } catch (error) {
      const errorKind = error instanceof Error ? error.name : "UnknownError";
      console.error(`Portal login configuration failed (${errorKind}).`);
      return response.status(503).json({ error: LOGIN_UNAVAILABLE_MESSAGE });
    }

    if (!requestHasAllowedOrigin(request, config)) {
      return response.status(403).json({ error: UNVERIFIED_REQUEST_MESSAGE });
    }
    if (!request.is("application/json")) {
      return response.status(400).json({ error: INVALID_REQUEST_MESSAGE });
    }
    if (!attempts.consumeIpAttempt(request.ip ?? "unknown")) {
      return response.status(429).json({ error: TOO_MANY_ATTEMPTS_MESSAGE });
    }

    const input = parseLoginInput(request.body);
    if (!input) {
      return response.status(400).json({ error: INVALID_REQUEST_MESSAGE });
    }
    if (attempts.isAccountBlocked(input.username)) {
      return response.status(429).json({ error: TOO_MANY_ATTEMPTS_MESSAGE });
    }

    try {
      const account = await authentication.authenticate(input.username, input.password);
      if (!account) {
        attempts.recordAccountFailure(input.username);
        return response.status(401).json({ error: INVALID_CREDENTIALS_MESSAGE });
      }

      const priorSessionId = readCookie(request, config.sessionCookieName);
      const session = sessions.create(account, priorSessionId);
      setSessionCookie(
        response,
        config,
        session.sessionId,
        SESSION_ABSOLUTE_TIMEOUT_MS
      );
      return response.json(authenticatedResponse(account.username, session.csrfToken));
    } catch (error) {
      const errorKind = error instanceof Error ? error.name : "UnknownError";
      console.error(`Portal login dependency failed (${errorKind}).`);
      return response.status(503).json({ error: LOGIN_UNAVAILABLE_MESSAGE });
    }
  });

  router.get("/api/auth/session", (request, response) => {
    let config: PortalHttpSecurityConfig;
    try {
      config = getSecurityConfig();
    } catch {
      return response.json({ authenticated: false });
    }
    const sessionId = readCookie(request, config.sessionCookieName);
    const session = sessionId ? sessions.resolve(sessionId) : undefined;
    if (!session) {
      if (sessionId) {
        clearSessionCookie(response, config);
      }
      return response.json({ authenticated: false });
    }
    const csrfToken = sessions.rotateCsrf(session);
    return response.json(authenticatedResponse(session.principal.username, csrfToken));
  });

  router.post("/api/auth/logout", (request, response) => {
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
      return response.status(204).end();
    }
    if (!sessions.verifyCsrf(session, request.get("x-csrf-token") ?? "")) {
      return response.status(403).json({ error: UNVERIFIED_REQUEST_MESSAGE });
    }

    sessions.invalidate(sessionId!);
    clearSessionCookie(response, config);
    return response.status(204).end();
  });

  return router;
}

export default createAuthRouter();
