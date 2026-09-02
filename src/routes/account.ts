import { Router } from "express";
import { createRequirePortalMutation, type PortalAuthLocals } from "../middleware/portal-auth.js";
import {
  accountPasswordService,
  AccountPasswordChangeError,
  type AccountPasswordService
} from "../services/account-password.js";
import { parseAccountPasswordInput } from "../services/account-password-http.js";
import {
  accountPasswordLimiter,
  type AccountPasswordLimiter
} from "../services/account-password-limiter.js";
import {
  clearSessionCookie,
  readPortalHttpSecurityConfig,
  type PortalHttpSecurityConfig
} from "../services/auth-http.js";
import { portalSessionStore, type PortalSessionStore } from "../services/portal-sessions.js";

const INVALID_MESSAGE = "Enter valid password values.";
const RATE_MESSAGE = "Too many password change attempts. Try again later.";
const CONFLICT_MESSAGE = "Your account credentials changed. Log in again.";
const AMBIGUOUS_MESSAGE = "The result could not be confirmed. Try signing in with the new password, then the old password if needed.";
const UNAVAILABLE_MESSAGE = "Password change is temporarily unavailable.";

interface PasswordChanger {
  change(accountId: number, username: string, input: {
    currentPassword: string;
    newPassword: string;
    confirmNewPassword: string;
  }): Promise<void>;
}

export interface AccountRouterDependencies {
  service?: PasswordChanger | AccountPasswordService;
  limiter?: AccountPasswordLimiter;
  sessions?: PortalSessionStore;
  getSecurityConfig?: () => PortalHttpSecurityConfig;
}

export function createAccountRouter(dependencies: AccountRouterDependencies = {}): Router {
  const router = Router();
  const service = dependencies.service ?? accountPasswordService;
  const limiter = dependencies.limiter ?? accountPasswordLimiter;
  const sessions = dependencies.sessions ?? portalSessionStore;
  const getSecurityConfig = dependencies.getSecurityConfig ?? readPortalHttpSecurityConfig;
  const requireMutation = createRequirePortalMutation({ sessions, getSecurityConfig });

  router.use("/api/account", (_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });

  router.post("/api/account/password", requireMutation, async (request, response) => {
    if (!request.is("application/json")) {
      return response.status(400).json({ error: INVALID_MESSAGE });
    }
    const input = parseAccountPasswordInput(request.body);
    if (!input) return response.status(400).json({ error: INVALID_MESSAGE });

    let securityConfig: PortalHttpSecurityConfig;
    try {
      securityConfig = getSecurityConfig();
    } catch {
      return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
    }

    const locals = response.locals as PortalAuthLocals;
    const principal = locals.authenticatedPrincipal;
    if (!limiter.consume(principal.accountId, request.ip ?? "unknown")) {
      return response.status(429).json({ error: RATE_MESSAGE });
    }

    try {
      await service.change(principal.accountId, principal.username, input);
      sessions.invalidateAccount(principal.accountId);
      clearSessionCookie(response, securityConfig);
      return response.status(204).end();
    } catch (error) {
      if (error instanceof AccountPasswordChangeError) {
        if (error.kind === "incorrect-current") {
          return response.status(401).json({ error: "The current password is incorrect." });
        }
        if (error.kind === "conflict" || error.kind === "ambiguous-update") {
          sessions.invalidateAccount(principal.accountId);
          clearSessionCookie(response, securityConfig);
          return response.status(error.kind === "conflict" ? 409 : 503).json({
            error: error.kind === "conflict" ? CONFLICT_MESSAGE : AMBIGUOUS_MESSAGE
          });
        }
      }
      const errorKind = error instanceof Error ? error.name : "UnknownError";
      console.error(`Account password dependency failed (${errorKind}).`);
      return response.status(503).json({ error: UNAVAILABLE_MESSAGE });
    }
  });

  return router;
}

export default createAccountRouter();
