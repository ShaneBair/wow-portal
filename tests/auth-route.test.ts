import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express from "express";
import {
  createRequirePortalMutation,
  createRequirePortalSession
} from "../src/middleware/portal-auth.js";
import { createAuthRouter } from "../src/routes/auth.js";
import type { PortalHttpSecurityConfig } from "../src/services/auth-http.js";
import { LoginAttemptLimiter } from "../src/services/login-attempt-limiter.js";
import { PortalSessionStore } from "../src/services/portal-sessions.js";

const origin = "http://127.0.0.1:5173";
const security: PortalHttpSecurityConfig = {
  publicOrigin: origin,
  secureCookies: false,
  sessionCookieName: "wow_portal_session"
};

async function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Test server did not receive a TCP port."));
        return;
      }
      resolve(address.port);
    });
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function makeSessions(): PortalSessionStore {
  let value = 1;
  return new PortalSessionStore(Date.now, (size) => Buffer.alloc(size, value++));
}

async function withAuthServer<T>(
  run: (baseUrl: string, sessions: PortalSessionStore) => Promise<T>,
  options: {
    authenticate?: (username: string, password: string) => Promise<
      { accountId: number; username: string } | undefined
    >;
    config?: PortalHttpSecurityConfig;
  } = {}
): Promise<T> {
  const sessions = makeSessions();
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "16kb" }));
  app.use(createAuthRouter({
    authentication: {
      authenticate: options.authenticate ?? (async () => ({ accountId: 42, username: "TEST_USER" }))
    },
    sessions,
    attempts: new LoginAttemptLimiter(),
    getSecurityConfig: () => options.config ?? security
  }));
  const server = createServer(app);
  const port = await listen(server);
  try {
    return await run(`http://127.0.0.1:${port}`, sessions);
  } finally {
    await close(server);
  }
}

function loginRequest(baseUrl: string, init: RequestInit = {}): Promise<Response> {
  const { headers, body, ...rest } = init;
  return fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    ...rest,
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...headers
    },
    body: body ?? JSON.stringify({ username: " test_user ", password: "PassWord1!" })
  });
}

function cookiePair(response: Response): string {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie.split(";", 1)[0]!;
}

test("logs in, rotates CSRF on session read, and logs out idempotently", async () => {
  let received: [string, string] | undefined;
  await withAuthServer(async (baseUrl, sessions) => {
    const login = await loginRequest(baseUrl);
    assert.equal(login.status, 200);
    assert.equal(login.headers.get("cache-control"), "no-store");
    const firstBody = await login.json() as Record<string, any>;
    assert.deepEqual(received, ["TEST_USER", "PASSWORD1!"]);
    assert.equal(firstBody.authenticated, true);
    assert.equal(firstBody.account.username, "TEST_USER");
    assert.match(firstBody.csrfToken, /^[A-Za-z0-9_-]{43}$/u);
    const cookie = cookiePair(login);
    const setCookie = login.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /HttpOnly/iu);
    assert.match(setCookie, /SameSite=Strict/iu);
    assert.match(setCookie, /Path=\//u);
    assert.doesNotMatch(setCookie, /Domain=/iu);
    assert.doesNotMatch(setCookie, /Secure/iu);
    assert.equal(sessions.size(), 1);

    const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } });
    const sessionBody = await session.json() as Record<string, any>;
    assert.equal(session.status, 200);
    assert.equal(sessionBody.authenticated, true);
    assert.notEqual(sessionBody.csrfToken, firstBody.csrfToken);

    const staleLogout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { Origin: origin, Cookie: cookie, "X-CSRF-Token": firstBody.csrfToken }
    });
    assert.equal(staleLogout.status, 403);

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { Origin: origin, Cookie: cookie, "X-CSRF-Token": sessionBody.csrfToken }
    });
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get("set-cookie") ?? "", /Expires=Thu, 01 Jan 1970/iu);
    assert.equal(sessions.size(), 0);

    const repeated = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { Origin: origin, Cookie: cookie }
    });
    assert.equal(repeated.status, 204);
  }, {
    authenticate: async (username, password) => {
      received = [username, password];
      return { accountId: 42, username: "TEST_USER" };
    }
  });
});

test("uses a secure host-only production cookie", async () => {
  await withAuthServer(async (baseUrl) => {
    const response = await loginRequest(baseUrl, { headers: { Origin: "https://play.example.com" } });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(cookie, /^__Host-wow-portal-session=/u);
    assert.match(cookie, /Secure/iu);
    assert.match(cookie, /HttpOnly/iu);
    assert.match(cookie, /SameSite=Strict/iu);
    assert.doesNotMatch(cookie, /Domain=/iu);
  }, {
    config: {
      publicOrigin: "https://play.example.com",
      secureCookies: true,
      sessionCookieName: "__Host-wow-portal-session"
    }
  });
});

test("returns generic validation, credential, origin, rate, and dependency failures", async () => {
  await withAuthServer(async (baseUrl) => {
    const wrong = await loginRequest(baseUrl);
    assert.equal(wrong.status, 401);
    assert.deepEqual(await wrong.json(), { error: "The account name or password is incorrect." });

    const malformed = await loginRequest(baseUrl, {
      body: JSON.stringify({ username: "x", password: "" })
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: "Enter a valid account name and password." });

    const wrongOrigin = await loginRequest(baseUrl, { headers: { Origin: "https://evil.example" } });
    assert.equal(wrongOrigin.status, 403);
    assert.deepEqual(await wrongOrigin.json(), { error: "This request could not be verified." });
  }, { authenticate: async () => undefined });

  const originalError = console.error;
  const logs: string[] = [];
  console.error = (message?: unknown) => logs.push(String(message));
  try {
    await withAuthServer(async (baseUrl) => {
      const response = await loginRequest(baseUrl);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "Login is temporarily unavailable." });
    }, {
      authenticate: async () => {
        throw new Error("database.internal password verifier secret");
      }
    });
    assert.equal(logs.length, 1);
    assert.doesNotMatch(logs[0] ?? "", /database\.internal|password|verifier|secret/iu);
  } finally {
    console.error = originalError;
  }
});

test("clears malformed and expired cookies as anonymous sessions", async () => {
  await withAuthServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: "wow_portal_session=malformed" }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { authenticated: false });
    assert.match(response.headers.get("set-cookie") ?? "", /Expires=Thu, 01 Jan 1970/iu);
  });
});

test("protected API middleware enforces session, origin, CSRF, and internal principal", async () => {
  const sessions = makeSessions();
  const created = sessions.create({ accountId: 42, username: "TEST_USER" });
  const cookie = `wow_portal_session=${created.sessionId}`;
  const dependencies = { sessions, getSecurityConfig: () => security };
  const app = express();
  app.get("/protected", createRequirePortalSession(dependencies), (_request, response) => {
    response.json(response.locals.authenticatedPrincipal);
  });
  app.post("/protected", createRequirePortalMutation(dependencies), (_request, response) => {
    response.json(response.locals.authenticatedPrincipal);
  });
  const server = createServer(app);
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    assert.equal((await fetch(`${baseUrl}/protected`)).status, 401);
    const authenticated = await fetch(`${baseUrl}/protected`, { headers: { Cookie: cookie } });
    assert.deepEqual(await authenticated.json(), { accountId: 42, username: "TEST_USER" });

    assert.equal((await fetch(`${baseUrl}/protected`, {
      method: "POST",
      headers: { Origin: "https://evil.example", Cookie: cookie }
    })).status, 403);
    assert.equal((await fetch(`${baseUrl}/protected`, {
      method: "POST",
      headers: { Origin: origin, Cookie: cookie, "X-CSRF-Token": "invalid" }
    })).status, 403);
    const mutation = await fetch(`${baseUrl}/protected`, {
      method: "POST",
      headers: { Origin: origin, Cookie: cookie, "X-CSRF-Token": created.csrfToken }
    });
    assert.equal(mutation.status, 200);
    assert.deepEqual(await mutation.json(), { accountId: 42, username: "TEST_USER" });
  } finally {
    await close(server);
  }
});
