import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { createRosterRouter } from "../src/routes/roster.js";
import type { PortalHttpSecurityConfig } from "../src/services/auth-http.js";
import type { AccountVisibilityScope } from "../src/services/account-visibility.js";
import type { AccountRosterResponse } from "../src/services/account-roster.js";
import { PortalSessionStore } from "../src/services/portal-sessions.js";

const security: PortalHttpSecurityConfig = {
  publicOrigin: "http://127.0.0.1:5173", secureCookies: false, sessionCookieName: "wow_portal_session"
};
const responseBody = {
  generatedAt: "2026-08-28T16:00:00.000Z", accountCount: 1, characterCount: 1,
  accounts: [{ accountLogin: "SHANE", characters: [{
    characterName: "Thalgrim", level: 80, class: "Paladin", race: "Dwarf", totalPlayedSeconds: 987654
  }] }]
};

async function withServer<T>(run: (baseUrl: string, cookie: string) => Promise<T>, options: {
  loadRoster?: (visibility: AccountVisibilityScope) => Promise<AccountRosterResponse>;
  visibility?: RequestHandler;
  limiter?: RequestHandler;
} = {}): Promise<T> {
  const sessions = new PortalSessionStore(Date.now, (size) => Buffer.alloc(size, 4));
  const created = sessions.create({ accountId: 7, username: "TEST_USER" });
  const app = express();
  app.use(createRosterRouter({
    sessions, getSecurityConfig: () => security,
    visibility: options.visibility ?? ((_request, response, next) => {
      response.locals.accountVisibilityScope = { cacheKey: "standard", excludedAccountIds: [9] };
      next();
    }),
    limiter: options.limiter ?? ((_request, _response, next) => next()),
    loadRoster: options.loadRoster ?? (async () => responseBody)
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port.");
  try { return await run(`http://127.0.0.1:${address.port}`, `wow_portal_session=${created.sessionId}`); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

test("requires authentication and returns no-store populated and empty rosters", async () => {
  await withServer(async (baseUrl, cookie) => {
    const anonymous = await fetch(`${baseUrl}/api/roster`);
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.headers.get("cache-control"), "no-store");
    const populated = await fetch(`${baseUrl}/api/roster`, { headers: { Cookie: cookie } });
    assert.equal(populated.status, 200);
    assert.equal(populated.headers.get("cache-control"), "no-store");
    assert.deepEqual(await populated.json(), responseBody);
  });
  await withServer(async (baseUrl, cookie) => {
    const empty = await fetch(`${baseUrl}/api/roster`, { headers: { Cookie: cookie } });
    assert.deepEqual(await empty.json(), {
      generatedAt: "2026-08-28T16:00:00.000Z", accountCount: 0, characterCount: 0, accounts: []
    });
  }, { loadRoster: async () => ({
    generatedAt: "2026-08-28T16:00:00.000Z", accountCount: 0, characterCount: 0, accounts: []
  }) });
});

test("passes standard and full visibility scopes unchanged", async () => {
  for (const scope of [
    { cacheKey: "standard", excludedAccountIds: [9] } as const,
    { cacheKey: "full", excludedAccountIds: [] } as const
  ]) await withServer(async (baseUrl, cookie) => {
    assert.equal((await fetch(`${baseUrl}/api/roster`, { headers: { Cookie: cookie } })).status, 200);
  }, {
    visibility: (_request, response, next) => { response.locals.accountVisibilityScope = scope; next(); },
    loadRoster: async (received: AccountVisibilityScope) => { assert.equal(received, scope); return responseBody; }
  });
});

test("returns fixed no-store 429 and redacted 503 failures", async () => {
  await withServer(async (baseUrl, cookie) => {
    const limited = await fetch(`${baseUrl}/api/roster`, { headers: { Cookie: cookie } });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("cache-control"), "no-store");
  }, { limiter: (_request, response) => { response.status(429).json({ error: "Too many roster requests. Try again later." }); } });

  const originalError = console.error;
  const logs: string[] = [];
  console.error = (message?: unknown) => logs.push(String(message));
  try {
    await withServer(async (baseUrl, cookie) => {
      const failed = await fetch(`${baseUrl}/api/roster`, { headers: { Cookie: cookie } });
      assert.equal(failed.status, 503);
      assert.deepEqual(await failed.json(), { error: "The roster is temporarily unavailable." });
    }, { loadRoster: async () => { throw new Error("db.internal raw secret"); } });
    assert.equal(logs.length, 1);
    assert.doesNotMatch(logs[0] ?? "", /db\.internal|raw secret/u);
  } finally { console.error = originalError; }
});
