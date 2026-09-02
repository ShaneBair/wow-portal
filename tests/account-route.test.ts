import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import express from "express";
import { createAccountRouter } from "../src/routes/account.js";
import { AccountPasswordChangeError } from "../src/services/account-password.js";
import { AccountPasswordLimiter } from "../src/services/account-password-limiter.js";
import type { PortalHttpSecurityConfig } from "../src/services/auth-http.js";
import { PortalSessionStore } from "../src/services/portal-sessions.js";

const origin = "http://127.0.0.1:5173";
const security: PortalHttpSecurityConfig = { publicOrigin: origin, secureCookies: false, sessionCookieName: "wow_portal_session" };
const validBody = { currentPassword: "OldPass1!", newPassword: "NewPass2!", confirmNewPassword: "NewPass2!" };

async function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No test port."));
      resolve(address.port);
    });
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function withServer(
  change: (accountId: number, username: string, input: typeof validBody) => Promise<void>,
  run: (baseUrl: string, sessions: PortalSessionStore, cookie: string, csrf: string) => Promise<void>
): Promise<void> {
  let byte = 1;
  const sessions = new PortalSessionStore(Date.now, (size) => Buffer.alloc(size, byte++));
  const created = sessions.create({ accountId: 42, username: "TEST_USER" });
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(createAccountRouter({ service: { change }, sessions, limiter: new AccountPasswordLimiter(), getSecurityConfig: () => security }));
  const server = createServer(app);
  const port = await listen(server);
  try { await run(`http://127.0.0.1:${port}`, sessions, `wow_portal_session=${created.sessionId}`, created.csrfToken); }
  finally { await close(server); }
}

function request(baseUrl: string, cookie: string, csrf: string, body: unknown = validBody): Promise<Response> {
  return fetch(`${baseUrl}/api/account/password`, { method: "POST", headers: {
    Origin: origin, Cookie: cookie, "X-CSRF-Token": csrf, "Content-Type": "application/json"
  }, body: JSON.stringify(body) });
}

test("changes only the session account, invalidates its sessions, and expires the cookie", async () => {
  let received: unknown[] | undefined;
  await withServer(async (...args) => { received = args; }, async (baseUrl, sessions, cookie, csrf) => {
    const otherSameAccount = sessions.create({ accountId: 42, username: "TEST_USER" });
    const unrelated = sessions.create({ accountId: 77, username: "OTHER" });
    const response = await request(baseUrl, cookie, csrf);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("set-cookie") ?? "", /Expires=Thu, 01 Jan 1970/iu);
    assert.deepEqual(received, [42, "TEST_USER", validBody]);
    assert.equal(sessions.resolve(otherSameAccount.sessionId), undefined);
    assert.ok(sessions.resolve(unrelated.sessionId));
  });
});

test("enforces session, origin, CSRF, and exact JSON fields", async () => {
  await withServer(async () => {}, async (baseUrl, _sessions, cookie, csrf) => {
    assert.equal((await request(baseUrl, "", csrf)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/account/password`, { method: "POST", headers: {
      Origin: "https://evil.example", Cookie: cookie, "X-CSRF-Token": csrf, "Content-Type": "application/json"
    }, body: JSON.stringify(validBody) })).status, 403);
    assert.equal((await request(baseUrl, cookie, "bad")).status, 403);
    assert.equal((await request(baseUrl, cookie, csrf, { ...validBody, accountId: 99 })).status, 400);
  });
});

test("uses fixed errors and invalidates sessions after conflict or ambiguous update", async () => {
  for (const [kind, status] of [["conflict", 409], ["ambiguous-update", 503]] as const) {
    await withServer(async () => { throw new AccountPasswordChangeError(kind); }, async (baseUrl, sessions, cookie, csrf) => {
      const response = await request(baseUrl, cookie, csrf);
      assert.equal(response.status, status);
      assert.equal(sessions.size(), 0);
      const body = await response.json() as { error: string };
      assert.doesNotMatch(body.error, /salt|verifier|database|accountId/iu);
    });
  }
});
