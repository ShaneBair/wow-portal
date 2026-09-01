import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express from "express";
import { createBoostsRouter } from "../src/routes/boosts.js";
import { BoostMutationLimiter } from "../src/services/boost-mutation-limiter.js";
import type { PortalHttpSecurityConfig } from "../src/services/auth-http.js";
import { BoostRequestError, type MoneyBoostInput } from "../src/services/player-boosts.js";
import type { PortableHolesInput } from "../src/services/portable-hole-boost.js";
import type { ArcaneTomeInput } from "../src/services/arcane-tome-boost.js";
import type { CharacterLevelInput } from "../src/services/character-level-boost.js";
import { PortalSessionStore } from "../src/services/portal-sessions.js";

const origin = "http://127.0.0.1:5173";
const requestId = "0d6202eb-15c0-4e62-9cc2-f7697dd5866f";
const security: PortalHttpSecurityConfig = {
  publicOrigin: origin,
  secureCookies: false,
  sessionCookieName: "wow_portal_session"
};
const limits = {
  enabled: true,
  minimumGold: 1 as const,
  maximumGoldPerRequest: 10_000,
  dailyGoldLimit: 20_000,
  dailyRequestLimit: 5
};
const portableHoles = {
  enabled: true,
  name: "Hole Lotta Storage" as const,
  itemName: "Portable Hole" as const,
  itemCount: 4 as const,
  slotsPerBag: 24 as const,
  repeatable: true as const
};
const arcaneTome = {
  enabled: true,
  name: "Tomeward Bound" as const,
  itemName: "Arcane Tome of Displacement" as const,
  itemCount: 1 as const,
  repeatable: true as const
};
const characterLevel = {
  enabled: true,
  name: "Level Up, Buttercup" as const,
  maximumLevel: 80 as const,
  xpWillReset: true as const
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

interface TestService {
  readMoneyConfig(): typeof limits;
  readPortableHolesConfig(): { enabled: boolean };
  readArcaneTomeConfig(): { enabled: boolean };
  readCharacterLevelConfig(): { enabled: boolean };
  getOverview(accountId: number): Promise<{
    characters: Array<{ id: string; name: string; level: number; race: string; class: string }>;
    money: typeof limits;
    portableHoles: typeof portableHoles;
    arcaneTome: typeof arcaneTome;
    characterLevel: typeof characterLevel;
  }>;
  requestMoney(accountId: number, input: MoneyBoostInput): Promise<{
    requestId: string;
    status: "sent";
    message: string;
    created: boolean;
  }>;
  requestPortableHoles(accountId: number, input: PortableHolesInput): Promise<{
    requestId: string;
    status: "sent";
    message: string;
    created: boolean;
  }>;
  requestArcaneTome(accountId: number, input: ArcaneTomeInput): Promise<{
    requestId: string;
    status: "sent";
    message: string;
    created: boolean;
  }>;
  requestCharacterLevel(accountId: number, input: CharacterLevelInput): Promise<{
    requestId: string;
    status: "applied";
    character: { id: string; name: string; level: number };
    message: string;
    created: boolean;
  }>;
}

async function withBoostServer<T>(
  run: (baseUrl: string, authorization: { cookie: string; csrfToken: string }) => Promise<T>,
  serviceOverrides: Partial<TestService> = {},
  limiter = new BoostMutationLimiter()
): Promise<T> {
  let randomValue = 1;
  const sessions = new PortalSessionStore(Date.now, (size) => Buffer.alloc(size, randomValue++));
  const created = sessions.create({ accountId: 7, username: "TEST_USER" });
  const service: TestService = {
    readMoneyConfig: () => limits,
    readPortableHolesConfig: () => ({ enabled: true }),
    readArcaneTomeConfig: () => ({ enabled: true }),
    readCharacterLevelConfig: () => ({ enabled: true }),
    getOverview: async (accountId) => {
      assert.equal(accountId, 7);
      return {
        characters: [{ id: "42", name: "Thalgrim", level: 80, race: "Dwarf", class: "Paladin" }],
        money: limits,
        portableHoles,
        arcaneTome,
        characterLevel
      };
    },
    requestMoney: async (accountId, input) => ({
      requestId: input.requestId,
      status: "sent",
      message: `${input.gold} gold was sent to Thalgrim by in-game mail.`,
      created: accountId === 7
    }),
    requestPortableHoles: async (accountId, input) => ({
      requestId: input.requestId,
      status: "sent",
      message: "Four Portable Holes were sent to Thalgrim by in-game mail.",
      created: accountId === 7
    }),
    requestArcaneTome: async (accountId, input) => ({
      requestId: input.requestId,
      status: "sent",
      message: "An Arcane Tome of Displacement was sent to Thalgrim by in-game mail.",
      created: accountId === 7
    }),
    requestCharacterLevel: async (accountId, input) => ({
      requestId: input.requestId,
      status: "applied",
      character: { id: input.characterId, name: "Thalgrim", level: input.targetLevel },
      message: `Thalgrim is now level ${input.targetLevel}.`,
      created: accountId === 7
    }),
    ...serviceOverrides
  };
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "16kb" }));
  app.use(createBoostsRouter({
    service,
    limiter,
    sessions,
    getSecurityConfig: () => security
  }));
  const server = createServer(app);
  const port = await listen(server);
  try {
    return await run(`http://127.0.0.1:${port}`, {
      cookie: `wow_portal_session=${created.sessionId}`,
      csrfToken: created.csrfToken
    });
  } finally {
    await close(server);
  }
}

function postPortableHoles(
  baseUrl: string,
  authorization: { cookie: string; csrfToken: string },
  overrides: RequestInit = {}
): Promise<Response> {
  return fetch(`${baseUrl}/api/boosts/portable-holes`, {
    method: "POST",
    ...overrides,
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: authorization.cookie,
      "X-CSRF-Token": authorization.csrfToken,
      ...overrides.headers
    },
    body: overrides.body ?? JSON.stringify({ requestId, characterId: "42" })
  });
}

function postMoney(
  baseUrl: string,
  authorization: { cookie: string; csrfToken: string },
  overrides: RequestInit = {}
): Promise<Response> {
  return fetch(`${baseUrl}/api/boosts/money`, {
    method: "POST",
    ...overrides,
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: authorization.cookie,
      "X-CSRF-Token": authorization.csrfToken,
      ...overrides.headers
    },
    body: overrides.body ?? JSON.stringify({ requestId, characterId: "42", gold: 500 })
  });
}

function postArcaneTome(
  baseUrl: string,
  authorization: { cookie: string; csrfToken: string },
  overrides: RequestInit = {}
): Promise<Response> {
  return fetch(`${baseUrl}/api/boosts/arcane-tome`, {
    method: "POST",
    ...overrides,
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: authorization.cookie,
      "X-CSRF-Token": authorization.csrfToken,
      ...overrides.headers
    },
    body: overrides.body ?? JSON.stringify({ requestId, characterId: "42" })
  });
}

function postCharacterLevel(
  baseUrl: string,
  authorization: { cookie: string; csrfToken: string },
  overrides: RequestInit = {}
): Promise<Response> {
  return fetch(`${baseUrl}/api/boosts/character-level`, {
    method: "POST",
    ...overrides,
    headers: {
      "Content-Type": "application/json", Origin: origin, Cookie: authorization.cookie,
      "X-CSRF-Token": authorization.csrfToken, ...overrides.headers
    },
    body: overrides.body ?? JSON.stringify({ requestId, characterId: "42", targetLevel: 60 })
  });
}

test("protects and returns the no-store character overview", async () => {
  await withBoostServer(async (baseUrl, authorization) => {
    const anonymous = await fetch(`${baseUrl}/api/boosts`);
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.headers.get("cache-control"), "no-store");

    const response = await fetch(`${baseUrl}/api/boosts`, {
      headers: { Cookie: authorization.cookie }
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      characters: [{ id: "42", name: "Thalgrim", level: 80, race: "Dwarf", class: "Paladin" }],
      money: limits,
      portableHoles,
      arcaneTome,
      characterLevel
    });
  });
});

test("enforces origin, CSRF, JSON shape, and internal account identity before sending", async () => {
  const received: Array<[number, MoneyBoostInput]> = [];
  await withBoostServer(async (baseUrl, authorization) => {
    assert.equal((await postMoney(baseUrl, authorization, {
      headers: { Origin: "https://evil.example" }
    })).status, 403);
    assert.equal((await postMoney(baseUrl, authorization, {
      headers: { "X-CSRF-Token": "invalid" }
    })).status, 403);
    assert.equal((await postMoney(baseUrl, authorization, {
      body: JSON.stringify({ requestId, characterId: "42", gold: "500" })
    })).status, 400);

    const response = await postMoney(baseUrl, authorization);
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      requestId,
      status: "sent",
      message: "500 gold was sent to Thalgrim by in-game mail."
    });
    assert.deepEqual(received, [[7, { requestId, characterId: "42", gold: 500 }]]);
  }, {
    requestMoney: async (accountId, input) => {
      received.push([accountId, input]);
      return {
        requestId: input.requestId,
        status: "sent",
        message: "500 gold was sent to Thalgrim by in-game mail.",
        created: true
      };
    }
  });
});

test("maps ownership, replay conflict, and unknown delivery without leaking internals", async () => {
  for (const scenario of [
    {
      error: new BoostRequestError("ownership", "That character is not available for this account."),
      status: 403,
      body: { error: "That character is not available for this account." }
    },
    {
      error: new BoostRequestError("conflict", "That request ID was already used for different details."),
      status: 409,
      body: { error: "That request ID was already used for different details." }
    },
    {
      error: new BoostRequestError(
        "unknown",
        "Delivery could not be confirmed. Do not send again; give this request ID to an administrator.",
        requestId
      ),
      status: 503,
      body: {
        requestId,
        status: "unknown",
        error: "Delivery could not be confirmed. Do not send again; give this request ID to an administrator."
      }
    }
  ]) {
    await withBoostServer(async (baseUrl, authorization) => {
      const response = await postMoney(baseUrl, authorization);
      assert.equal(response.status, scenario.status);
      assert.deepEqual(await response.json(), scenario.body);
    }, {
      requestMoney: async () => {
        throw scenario.error;
      }
    });
  }
});

test("shares five boost submissions per client minute across every boost endpoint", async () => {
  await withBoostServer(async (baseUrl, authorization) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      assert.equal((await postMoney(baseUrl, authorization)).status, 201);
    }
    assert.equal((await postPortableHoles(baseUrl, authorization)).status, 201);
    assert.equal((await postArcaneTome(baseUrl, authorization)).status, 201);
    assert.equal((await postCharacterLevel(baseUrl, authorization)).status, 201);
    const limited = await postCharacterLevel(baseUrl, authorization);
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { error: "Too many boost submissions. Try again later." });
  });
});

test("fails closed without consuming the burst limit when Free Money is disabled", async () => {
  let now = 0;
  const limiter = new BoostMutationLimiter(() => now);
  await withBoostServer(async (baseUrl, authorization) => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await postMoney(baseUrl, authorization);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "Money boosts are currently disabled." });
      now += 1;
    }
  }, {
    readMoneyConfig: () => ({ ...limits, enabled: false })
  }, limiter);
});

test("validates and sends only the server-owned Portable Hole contract", async () => {
  const received: Array<[number, PortableHolesInput]> = [];
  await withBoostServer(async (baseUrl, authorization) => {
    assert.equal((await postPortableHoles(baseUrl, authorization, {
      body: JSON.stringify({ requestId, characterId: "42", itemEntry: 51809 })
    })).status, 400);
    assert.equal((await postPortableHoles(baseUrl, authorization, {
      body: JSON.stringify({ requestId, characterId: "42", count: 4 })
    })).status, 400);

    const response = await postPortableHoles(baseUrl, authorization);
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      requestId,
      status: "sent",
      message: "Four Portable Holes were sent to Thalgrim by in-game mail."
    });
    assert.deepEqual(received, [[7, { requestId, characterId: "42" }]]);
  }, {
    requestPortableHoles: async (accountId, input) => {
      received.push([accountId, input]);
      return {
        requestId: input.requestId,
        status: "sent",
        message: "Four Portable Holes were sent to Thalgrim by in-game mail.",
        created: true
      };
    }
  });
});

test("fails Portable Holes closed before consuming the shared burst limit", async () => {
  const limiter = new BoostMutationLimiter(() => 0);
  await withBoostServer(async (baseUrl, authorization) => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await postPortableHoles(baseUrl, authorization);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "This boost is currently unavailable." });
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await postMoney(baseUrl, authorization)).status, 201);
    }
  }, {
    readPortableHolesConfig: () => ({ enabled: false })
  }, limiter);
});

test("validates and sends only the server-owned Arcane Tome contract", async () => {
  const received: Array<[number, ArcaneTomeInput]> = [];
  await withBoostServer(async (baseUrl, authorization) => {
    assert.equal((await postArcaneTome(baseUrl, authorization, {
      body: JSON.stringify({ requestId, characterId: "42", itemEntry: 900001 })
    })).status, 400);
    assert.equal((await postArcaneTome(baseUrl, authorization, {
      body: JSON.stringify({ requestId, characterId: "42", count: 1 })
    })).status, 400);
    const response = await postArcaneTome(baseUrl, authorization);
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      requestId,
      status: "sent",
      message: "An Arcane Tome of Displacement was sent to Thalgrim by in-game mail."
    });
    assert.deepEqual(received, [[7, { requestId, characterId: "42" }]]);
  }, {
    requestArcaneTome: async (accountId, input) => {
      received.push([accountId, input]);
      return {
        requestId: input.requestId,
        status: "sent",
        message: "An Arcane Tome of Displacement was sent to Thalgrim by in-game mail.",
        created: true
      };
    }
  });
});

test("validates and applies only an absolute bounded character level target", async () => {
  const received: Array<[number, CharacterLevelInput]> = [];
  await withBoostServer(async (baseUrl, authorization) => {
    for (const body of [
      { requestId, characterId: "42", targetLevel: 81 },
      { requestId, characterId: "42", targetLevel: 60.5 },
      { requestId, characterId: "42", targetLevel: 60, currentLevel: 39 },
      { requestId, characterId: "42", targetLevel: 60, command: "character level Other 1" }
    ]) assert.equal((await postCharacterLevel(baseUrl, authorization, { body: JSON.stringify(body) })).status, 400);

    const response = await postCharacterLevel(baseUrl, authorization);
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      requestId,
      status: "applied",
      character: { id: "42", name: "Thalgrim", level: 60 },
      message: "Thalgrim is now level 60."
    });
    assert.deepEqual(received, [[7, { requestId, characterId: "42", targetLevel: 60 }]]);
  }, {
    requestCharacterLevel: async (accountId, input) => {
      received.push([accountId, input]);
      return {
        requestId: input.requestId, status: "applied",
        character: { id: input.characterId, name: "Thalgrim", level: input.targetLevel },
        message: `Thalgrim is now level ${input.targetLevel}.`, created: true
      };
    }
  });
});

test("fails Character Level closed before consuming the shared burst limit", async () => {
  const limiter = new BoostMutationLimiter(() => 0);
  await withBoostServer(async (baseUrl, authorization) => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await postCharacterLevel(baseUrl, authorization);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "This boost is currently unavailable." });
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await postMoney(baseUrl, authorization)).status, 201);
    }
  }, {
    readCharacterLevelConfig: () => ({ enabled: false })
  }, limiter);
});

test("redacts dependency failures", async () => {
  const originalError = console.error;
  const logs: string[] = [];
  console.error = (message?: unknown) => logs.push(String(message));
  try {
    await withBoostServer(async (baseUrl, authorization) => {
      const response = await fetch(`${baseUrl}/api/boosts`, {
        headers: { Cookie: authorization.cookie }
      });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "Boosts are temporarily unavailable." });
    }, {
      getOverview: async () => {
        throw new Error("database.internal secret raw row");
      }
    });
    assert.equal(logs.length, 1);
    assert.doesNotMatch(logs[0] ?? "", /database\.internal|secret|raw row/u);
  } finally {
    console.error = originalError;
  }
});
