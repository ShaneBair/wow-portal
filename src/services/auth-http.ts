import type { Request, Response } from "express";
import { upperBasicLatin } from "./azerothcore-srp6.js";

export const INVALID_CREDENTIALS_MESSAGE = "The account name or password is incorrect.";
export const INVALID_REQUEST_MESSAGE = "Enter a valid account name and password.";
export const UNVERIFIED_REQUEST_MESSAGE = "This request could not be verified.";

export interface LoginInput {
  username: string;
  password: string;
}

export interface PortalHttpSecurityConfig {
  publicOrigin: string;
  secureCookies: boolean;
  sessionCookieName: string;
}

export class PortalHttpSecurityConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortalHttpSecurityConfigurationError";
  }
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function parseLoginInput(body: unknown): LoginInput | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const source = body as Record<string, unknown>;
  if (typeof source.username !== "string" || typeof source.password !== "string") {
    return undefined;
  }
  const username = source.username.trim();
  const passwordLength = Array.from(source.password).length;
  if (
    !/^[A-Za-z0-9_]{3,16}$/u.test(username) ||
    passwordLength < 1 ||
    passwordLength > 64 ||
    /[\u0000\r\n]/u.test(source.password) ||
    !isWellFormedUnicode(source.password)
  ) {
    return undefined;
  }
  return {
    username: username.toUpperCase(),
    password: upperBasicLatin(source.password)
  };
}

export function readPortalHttpSecurityConfig(
  environment: NodeJS.ProcessEnv = process.env
): PortalHttpSecurityConfig {
  const configuredOrigin = environment.PORTAL_PUBLIC_ORIGIN?.trim();
  if (!configuredOrigin) {
    throw new PortalHttpSecurityConfigurationError("PORTAL_PUBLIC_ORIGIN is required.");
  }

  let url: URL;
  try {
    url = new URL(configuredOrigin);
  } catch {
    throw new PortalHttpSecurityConfigurationError("PORTAL_PUBLIC_ORIGIN must be an absolute origin.");
  }
  if (
    url.origin !== configuredOrigin ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" && url.protocol !== "http:")
  ) {
    throw new PortalHttpSecurityConfigurationError("PORTAL_PUBLIC_ORIGIN must be an exact HTTP origin.");
  }

  const production = environment.NODE_ENV === "production";
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (production && url.protocol !== "https:") {
    throw new PortalHttpSecurityConfigurationError("Production portal authentication requires HTTPS.");
  }
  if (!production && url.protocol === "http:" && !loopback) {
    throw new PortalHttpSecurityConfigurationError("Development HTTP authentication is loopback-only.");
  }

  const secureCookies = url.protocol === "https:";
  return {
    publicOrigin: url.origin,
    secureCookies,
    sessionCookieName: secureCookies ? "__Host-wow-portal-session" : "wow_portal_session"
  };
}

export function requestHasAllowedOrigin(
  request: Pick<Request, "get">,
  config: PortalHttpSecurityConfig
): boolean {
  return request.get("origin") === config.publicOrigin;
}

export function readCookie(request: Pick<Request, "get">, name: string): string | undefined {
  const cookieHeader = request.get("cookie");
  if (!cookieHeader) {
    return undefined;
  }
  const matches = cookieHeader.split(";").map((part) => part.trim()).filter((part) =>
    part.startsWith(`${name}=`)
  );
  if (matches.length === 0) {
    return undefined;
  }
  if (matches.length !== 1) {
    return "invalid-cookie";
  }
  return matches[0]!.slice(name.length + 1) || "invalid-cookie";
}

const COOKIE_BASE = {
  httpOnly: true,
  sameSite: "strict" as const,
  path: "/"
};

export function setSessionCookie(
  response: Response,
  config: PortalHttpSecurityConfig,
  sessionId: string,
  maximumAge: number
): void {
  response.cookie(config.sessionCookieName, sessionId, {
    ...COOKIE_BASE,
    secure: config.secureCookies,
    maxAge: maximumAge
  });
}

export function clearSessionCookie(response: Response, config: PortalHttpSecurityConfig): void {
  response.clearCookie(config.sessionCookieName, {
    ...COOKIE_BASE,
    secure: config.secureCookies
  });
}
