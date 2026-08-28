import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
const MAX_SESSIONS = 10_000;
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export interface AuthenticatedPrincipal {
  accountId: number;
  username: string;
}

interface SessionRecord extends AuthenticatedPrincipal {
  createdAt: number;
  lastUsedAt: number;
  absoluteExpiresAt: number;
  csrfDigest: Buffer;
}

export interface CreatedPortalSession {
  sessionId: string;
  csrfToken: string;
  principal: AuthenticatedPrincipal;
}

export interface ResolvedPortalSession {
  digestKey: string;
  record: SessionRecord;
  principal: AuthenticatedPrincipal;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function digestKey(value: string): string {
  return digest(value).toString("hex");
}

export function isValidOpaqueToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

export class PortalSessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly makeRandomBytes: (size: number) => Buffer = randomBytes
  ) {}

  create(principal: AuthenticatedPrincipal, priorSessionId?: string): CreatedPortalSession {
    if (priorSessionId) {
      this.invalidate(priorSessionId);
    }
    this.prune();
    while (this.sessions.size >= MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value as string | undefined;
      if (!oldest) {
        break;
      }
      this.sessions.delete(oldest);
    }

    const now = this.now();
    const sessionId = this.makeToken();
    const csrfToken = this.makeToken();
    this.sessions.set(digestKey(sessionId), {
      accountId: principal.accountId,
      username: principal.username,
      createdAt: now,
      lastUsedAt: now,
      absoluteExpiresAt: now + SESSION_ABSOLUTE_TIMEOUT_MS,
      csrfDigest: digest(csrfToken)
    });
    return { sessionId, csrfToken, principal: { ...principal } };
  }

  resolve(sessionId: string, touch = true): ResolvedPortalSession | undefined {
    if (!isValidOpaqueToken(sessionId)) {
      return undefined;
    }
    const key = digestKey(sessionId);
    const record = this.sessions.get(key);
    if (!record) {
      return undefined;
    }

    const now = this.now();
    if (
      now >= record.absoluteExpiresAt ||
      now - record.lastUsedAt >= SESSION_IDLE_TIMEOUT_MS
    ) {
      this.sessions.delete(key);
      return undefined;
    }
    if (touch) {
      record.lastUsedAt = now;
    }
    return {
      digestKey: key,
      record,
      principal: { accountId: record.accountId, username: record.username }
    };
  }

  rotateCsrf(session: ResolvedPortalSession): string {
    const csrfToken = this.makeToken();
    session.record.csrfDigest = digest(csrfToken);
    return csrfToken;
  }

  verifyCsrf(session: ResolvedPortalSession, csrfToken: string): boolean {
    if (!isValidOpaqueToken(csrfToken)) {
      return false;
    }
    return timingSafeEqual(session.record.csrfDigest, digest(csrfToken));
  }

  invalidate(sessionId: string): void {
    if (isValidOpaqueToken(sessionId)) {
      this.sessions.delete(digestKey(sessionId));
    }
  }

  size(): number {
    return this.sessions.size;
  }

  private makeToken(): string {
    const token = this.makeRandomBytes(TOKEN_BYTES).toString("base64url");
    if (!isValidOpaqueToken(token)) {
      throw new Error("Secure session token generation failed.");
    }
    return token;
  }

  private prune(): void {
    const now = this.now();
    for (const [key, record] of this.sessions) {
      if (now >= record.absoluteExpiresAt || now - record.lastUsedAt >= SESSION_IDLE_TIMEOUT_MS) {
        this.sessions.delete(key);
      }
    }
  }
}

export const portalSessionStore = new PortalSessionStore();
