import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { createArmoryRouter } from "../src/routes/armory.js";
import type { AccountVisibilityScope } from "../src/services/account-visibility.js";
import type { ArmoryCharacterDetail } from "../src/services/armory.js";
import type { PortalHttpSecurityConfig } from "../src/services/auth-http.js";
import { PortalSessionStore } from "../src/services/portal-sessions.js";

const security: PortalHttpSecurityConfig = {
  publicOrigin: "http://127.0.0.1:5173", secureCookies: false, sessionCookieName: "wow_portal_session"
};
const summary = { id: "42", name: "Kneecappin", level: 19, race: "Night Elf", class: "Hunter" };
const detail: ArmoryCharacterDetail = {
  ...summary,
  generatedAt: "2026-10-13T16:00:00.000Z",
  equipment: Array.from({ length: 19 }, (_, slot) => ({ slot, name: `Slot ${slot}`, item: null })),
  talentLoadouts: [{ index: 0, name: "Talents", active: true, points: 0, trees: [] }]
};

async function withServer<T>(run: (baseUrl: string, cookie: string) => Promise<T>, options: {
  listCharacters?: (scope: AccountVisibilityScope) => Promise<{ characters: typeof summary[] }>;
  loadCharacter?: (guid: number, scope: AccountVisibilityScope) => Promise<ArmoryCharacterDetail | undefined>;
  visibility?: RequestHandler;
  limiter?: RequestHandler;
} = {}): Promise<T> {
  const sessions = new PortalSessionStore(Date.now, (size) => Buffer.alloc(size, 7));
  const created = sessions.create({ accountId: 7, username: "TEST_USER" });
  const app = express();
  app.use(createArmoryRouter({
    sessions, getSecurityConfig: () => security,
    visibility: options.visibility ?? ((_request, response, next) => {
      response.locals.accountVisibilityScope = { cacheKey: "standard", excludedAccountIds: [9] };
      next();
    }),
    limiter: options.limiter ?? ((_request, _response, next) => next()),
    listCharacters: options.listCharacters ?? (async () => ({ characters: [summary] })),
    loadCharacter: options.loadCharacter ?? (async () => detail)
  }));
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port.");
  try { return await run(`http://127.0.0.1:${address.port}`, `wow_portal_session=${created.sessionId}`); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

test("requires authentication and returns no-store armory list and detail", async () => {
  await withServer(async (baseUrl, cookie) => {
    const anonymous = await fetch(`${baseUrl}/api/armory`);
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.headers.get("cache-control"), "no-store");
    const list = await fetch(`${baseUrl}/api/armory`, { headers: { Cookie: cookie } });
    assert.equal(list.status, 200);
    assert.deepEqual(await list.json(), { characters: [summary] });
    const character = await fetch(`${baseUrl}/api/armory/42`, { headers: { Cookie: cookie } });
    assert.equal(character.status, 200);
    assert.equal(character.headers.get("cache-control"), "no-store");
    assert.deepEqual(await character.json(), { character: detail });
  });
});

test("passes visibility scope and validates unavailable character IDs", async () => {
  const scope = { cacheKey: "full", excludedAccountIds: [] } as const;
  await withServer(async (baseUrl, cookie) => {
    assert.equal((await fetch(`${baseUrl}/api/armory/nope`, { headers: { Cookie: cookie } })).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/armory/42`, { headers: { Cookie: cookie } })).status, 404);
  }, {
    visibility: (_request, response, next) => { response.locals.accountVisibilityScope = scope; next(); },
    listCharacters: async (received) => { assert.equal(received, scope); return { characters: [summary] }; },
    loadCharacter: async (_guid, received) => { assert.equal(received, scope); return undefined; }
  });
});

test("returns fixed rate-limit and redacted dependency failures", async () => {
  await withServer(async (baseUrl, cookie) => {
    const response = await fetch(`${baseUrl}/api/armory`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { error: "Too many armory requests. Try again later." });
  }, { limiter: (_request, response) => { response.status(429).json({ error: "Too many armory requests. Try again later." }); } });

  const originalError = console.error;
  const logs: string[] = [];
  console.error = (message?: unknown) => logs.push(String(message));
  try {
    await withServer(async (baseUrl, cookie) => {
      const response = await fetch(`${baseUrl}/api/armory`, { headers: { Cookie: cookie } });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "The armory is temporarily unavailable." });
    }, { listCharacters: async () => { throw new Error("secret database detail"); } });
    assert.equal(logs.length, 1);
    assert.doesNotMatch(logs[0]!, /secret database detail/u);
  } finally { console.error = originalError; }
});
