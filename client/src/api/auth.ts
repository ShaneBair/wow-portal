import { PortalApiError } from "./portal.js";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export interface AuthenticatedSession {
  authenticated: true;
  account: {
    username: string;
  };
  csrfToken: string;
}

export interface AnonymousSession {
  authenticated: false;
}

export type PortalSession = AuthenticatedSession | AnonymousSession;

export interface LoginCredentials {
  username: string;
  password: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new PortalApiError("Login is temporarily unavailable.");
  }
}

function parseSession(value: unknown): PortalSession | undefined {
  if (!isRecord(value) || typeof value.authenticated !== "boolean") {
    return undefined;
  }
  if (value.authenticated === false) {
    return { authenticated: false };
  }
  if (
    !isRecord(value.account) ||
    typeof value.account.username !== "string" ||
    !/^[A-Z0-9_]{3,16}$/u.test(value.account.username) ||
    typeof value.csrfToken !== "string" ||
    !TOKEN_PATTERN.test(value.csrfToken)
  ) {
    return undefined;
  }
  return {
    authenticated: true,
    account: { username: value.account.username },
    csrfToken: value.csrfToken
  };
}

function readPublicError(value: unknown, fallback: string): string {
  if (!isRecord(value) || typeof value.error !== "string" || value.error.length > 256) {
    return fallback;
  }
  return value.error;
}

export async function getPortalSession(signal?: AbortSignal): Promise<PortalSession> {
  const response = await fetch("/api/auth/session", {
    cache: "no-store",
    credentials: "same-origin",
    signal
  });
  const body = await readJson(response);
  const session = parseSession(body);
  if (!response.ok || !session) {
    throw new PortalApiError("Portal session is temporarily unavailable.");
  }
  return session;
}

export async function loginToPortal(credentials: LoginCredentials): Promise<AuthenticatedSession> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(credentials)
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new PortalApiError(readPublicError(body, "Login failed."));
  }
  const session = parseSession(body);
  if (!session?.authenticated) {
    throw new PortalApiError("Login is temporarily unavailable.");
  }
  return session;
}

export async function logoutFromPortal(csrfToken: string): Promise<void> {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken },
    credentials: "same-origin"
  });
  if (response.status !== 204) {
    let body: unknown;
    try {
      body = await response.json() as unknown;
    } catch {
      body = undefined;
    }
    throw new PortalApiError(readPublicError(body, "Logout failed."));
  }
}
