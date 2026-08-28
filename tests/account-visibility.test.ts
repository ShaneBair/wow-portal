import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express from "express";
import { createAccountVisibilityMiddleware } from "../src/middleware/account-visibility.js";
import {
  AccountVisibilityConfigurationError,
  AccountVisibilityDataError,
  AccountVisibilityService,
  buildAccountExclusionClause,
  buildAccountVisibilityResolutionQuery,
  mapAccountVisibilityRows,
  readAccountVisibilityConfig,
  type AccountVisibilityScope
} from "../src/services/account-visibility.js";
import type { PortalHttpSecurityConfig } from "../src/services/auth-http.js";
import { PortalSessionStore } from "../src/services/portal-sessions.js";
import { fullVisibility, standardVisibility } from "./fixtures/account-visibility.js";

const securityConfig: PortalHttpSecurityConfig = {
  publicOrigin: "http://127.0.0.1",
  secureCookies: false,
  sessionCookieName: "wow_portal_session"
};

async function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("Missing test port."));
      else resolve(address.port);
    });
  });
}

test("requires, normalizes, deduplicates, and bounds both account lists", () => {
  assert.throws(() => readAccountVisibilityConfig({}), AccountVisibilityConfigurationError);
  assert.deepEqual(readAccountVisibilityConfig({
    PORTAL_HIDDEN_ACCOUNTS: "",
    PORTAL_HIDDEN_ACCOUNT_VIEWERS: ""
  }), {
    hiddenAccountLogins: [],
    hiddenAccountViewerLogins: []
  });
  assert.deepEqual(readAccountVisibilityConfig({
    PORTAL_HIDDEN_ACCOUNTS: " account_one,ACCOUNT_TWO,account_one ",
    PORTAL_HIDDEN_ACCOUNT_VIEWERS: " viewer_one, VIEWER_ONE "
  }), {
    hiddenAccountLogins: ["ACCOUNT_ONE", "ACCOUNT_TWO"],
    hiddenAccountViewerLogins: ["VIEWER_ONE"]
  });

  for (const hidden of [
    "VALID_ACCOUNT,,OTHER_ACCOUNT",
    "WILD*CARD",
    "AB",
    "A".repeat(17),
    "VALID-ACCOUNT"
  ]) {
    assert.throws(() => readAccountVisibilityConfig({
      PORTAL_HIDDEN_ACCOUNTS: hidden,
      PORTAL_HIDDEN_ACCOUNT_VIEWERS: ""
    }), AccountVisibilityConfigurationError);
  }
  assert.throws(() => readAccountVisibilityConfig({
    PORTAL_HIDDEN_ACCOUNTS: "VALID_ACCOUNT,".repeat(101).slice(0, -1),
    PORTAL_HIDDEN_ACCOUNT_VIEWERS: ""
  }), /too many accounts/u);
  assert.throws(() => readAccountVisibilityConfig({
    PORTAL_HIDDEN_ACCOUNTS: "A".repeat(2_049),
    PORTAL_HIDDEN_ACCOUNT_VIEWERS: ""
  }), /too large/u);
});

test("builds an exact bounded account-resolution query and validates every result", () => {
  const query = buildAccountVisibilityResolutionQuery(
    "acore_auth",
    ["ACCOUNT_ONE", "VIEWER_ONE"]
  );
  assert.deepEqual(query.values, ["ACCOUNT_ONE", "VIEWER_ONE"]);
  assert.match(query.sql, /FROM `acore_auth`\.`account`/u);
  assert.match(query.sql, /WHERE username IN \(\?, \?\)\s+LIMIT 3$/u);
  assert.doesNotMatch(query.sql, /ACCOUNT_ONE|VIEWER_ONE/u);
  assert.throws(
    () => buildAccountVisibilityResolutionQuery("auth`; DROP TABLE account", ["ACCOUNT_ONE"]),
    /ASCII letters/u
  );

  const mapped = mapAccountVisibilityRows([
    { accountId: "10", username: "ACCOUNT_ONE", email: "must-not-leak@example.com" },
    { accountId: 30, username: "VIEWER_ONE" }
  ], query.values);
  assert.equal(mapped.get("ACCOUNT_ONE"), 10);
  assert.equal(mapped.get("VIEWER_ONE"), 30);
  assert.throws(
    () => mapAccountVisibilityRows([{ accountId: 10, username: "ACCOUNT_ONE" }], query.values),
    /was not found/u
  );
  assert.throws(() => mapAccountVisibilityRows([
    { accountId: 10, username: "ACCOUNT_ONE" },
    { accountId: 10, username: "VIEWER_ONE" }
  ], query.values), AccountVisibilityDataError);
  assert.throws(() => mapAccountVisibilityRows([
    { accountId: 10, username: "ACCOUNT_ONE" },
    { accountId: 30, username: "UNEXPECTED" }
  ], query.values), AccountVisibilityDataError);
});

test("resolves one immutable policy and grants full scope only by trusted account ID", async () => {
  let resolveRows: ((rows: unknown) => void) | undefined;
  const queried: readonly string[][] = [];
  const service = new AccountVisibilityService(
    () => ({
      hiddenAccountLogins: ["ACCOUNT_ONE", "ACCOUNT_TWO"],
      hiddenAccountViewerLogins: ["VIEWER_ONE", "ACCOUNT_ONE"]
    }),
    (logins) => {
      (queried as string[][]).push([...logins]);
      return new Promise((resolve) => { resolveRows = resolve; });
    }
  );

  const anonymous = service.getScope();
  const viewer = service.getScope({ accountId: 30, username: "DISPLAY_NAME_IGNORED" });
  assert.deepEqual(queried, [["ACCOUNT_ONE", "ACCOUNT_TWO", "VIEWER_ONE"]]);
  resolveRows?.([
    { accountId: 10, username: "ACCOUNT_ONE" },
    { accountId: 20, username: "ACCOUNT_TWO" },
    { accountId: 30, username: "VIEWER_ONE" }
  ]);

  assert.deepEqual(await anonymous, standardVisibility([10, 20]));
  assert.deepEqual(await viewer, fullVisibility);
  assert.deepEqual(
    await service.getScope({ accountId: 10, username: "ACCOUNT_ONE" }),
    fullVisibility
  );
  assert.deepEqual(
    await service.getScope({ accountId: 99, username: "VIEWER_ONE" }),
    standardVisibility([10, 20])
  );
  assert.equal(queried.length, 1);
});

test("backs off after a failed policy resolution and never produces a partial scope", async () => {
  let now = 0;
  let calls = 0;
  const service = new AccountVisibilityService(
    () => ({ hiddenAccountLogins: ["ACCOUNT_ONE"], hiddenAccountViewerLogins: [] }),
    async () => {
      calls += 1;
      throw new Error("database unavailable for ACCOUNT_ONE");
    },
    () => now
  );

  await assert.rejects(() => service.getScope(), /database unavailable/u);
  await assert.rejects(() => service.getScope(), /temporarily unavailable/u);
  assert.equal(calls, 1);
  now = 3_000;
  await assert.rejects(() => service.getScope(), /database unavailable/u);
  assert.equal(calls, 2);
});

test("builds sorted parameterized account exclusions without interpolating IDs", () => {
  assert.deepEqual(buildAccountExclusionClause(fullVisibility, "c.account"), {
    clause: "",
    values: []
  });
  const exclusion = buildAccountExclusionClause(standardVisibility([19, 7, 19]), "a.id");
  assert.equal(exclusion.clause, "    AND a.id NOT IN (?, ?)\n");
  assert.deepEqual(exclusion.values, [7, 19]);
  assert.doesNotMatch(exclusion.clause, /7|19/u);
  assert.throws(
    () => buildAccountExclusionClause(standardVisibility([0]), "c.account"),
    AccountVisibilityDataError
  );
});

test("middleware derives scope from optional sessions and ignores browser scope claims", async () => {
  const sessions = new PortalSessionStore(undefined, (size) => Buffer.alloc(size, 4));
  const viewerSession = sessions.create({ accountId: 30, username: "VIEWER_ONE" });
  const ordinarySessions = new PortalSessionStore(undefined, (size) => Buffer.alloc(size, 5));
  const ordinarySession = ordinarySessions.create({ accountId: 99, username: "ORDINARY" });
  const scopeFor = async (principal?: { accountId: number }): Promise<AccountVisibilityScope> =>
    principal?.accountId === 30 ? fullVisibility : standardVisibility([10, 20]);

  const app = express();
  app.get("/health", (_request, response) => response.json({ ok: true }));
  app.get("/covered", createAccountVisibilityMiddleware({
    unavailableMessage: "Covered data is temporarily unavailable.",
    logLabel: "Covered data",
    service: { getScope: scopeFor },
    sessions,
    getSecurityConfig: () => securityConfig
  }), (_request, response) => response.json(response.locals.accountVisibilityScope));
  const server = createServer(app);
  const port = await listen(server);

  try {
    const anonymous = await fetch(`http://127.0.0.1:${port}/covered?includeHidden=true`, {
      headers: { "x-visibility-scope": "full" }
    });
    assert.deepEqual(await anonymous.json(), standardVisibility([10, 20]));

    const viewer = await fetch(`http://127.0.0.1:${port}/covered`, {
      headers: { cookie: `${securityConfig.sessionCookieName}=${viewerSession.sessionId}` }
    });
    assert.deepEqual(await viewer.json(), fullVisibility);

    const ordinary = await fetch(`http://127.0.0.1:${port}/covered`, {
      headers: { cookie: `${securityConfig.sessionCookieName}=${ordinarySession.sessionId}` }
    });
    assert.deepEqual(await ordinary.json(), standardVisibility([10, 20]));

    const invalid = await fetch(`http://127.0.0.1:${port}/covered`, {
      headers: { cookie: `${securityConfig.sessionCookieName}=invalid-cookie` }
    });
    assert.deepEqual(await invalid.json(), standardVisibility([10, 20]));
    assert.match(invalid.headers.get("set-cookie") ?? "", /wow_portal_session=;/u);

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("middleware fails closed with a fixed response and a non-sensitive log", async () => {
  const logs: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => logs.push(String(message));
  const app = express();
  app.get("/covered", createAccountVisibilityMiddleware({
    unavailableMessage: "Covered data is temporarily unavailable.",
    logLabel: "Covered data",
    service: { getScope: async () => { throw new Error("ACCOUNT_ONE at secret.database"); } },
    getSecurityConfig: () => { throw new Error("auth configuration unavailable"); }
  }), (_request, response) => response.json({ shouldNotRun: true }));
  const server = createServer(app);
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/covered`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Covered data is temporarily unavailable." });
    assert.deepEqual(logs, ["Covered data account visibility failed (Error)."]);
    assert.doesNotMatch(logs[0] ?? "", /ACCOUNT_ONE|secret\.database/u);
  } finally {
    console.error = originalError;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
