import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAzerothCoreVerifier,
  upperBasicLatin,
  verifyAzerothCorePassword
} from "../src/services/azerothcore-srp6.js";
import {
  buildPortalAccountQuery,
  mapPortalAccountRows,
  PortalAuthenticationDataError,
  PortalAuthenticationService
} from "../src/services/portal-authentication.js";
import {
  readPortalDatabaseConfig,
  PortalDatabaseConfigurationError
} from "../src/services/portal-database.js";
import { parseLoginInput, readPortalHttpSecurityConfig } from "../src/services/auth-http.js";
import { LoginAttemptLimiter } from "../src/services/login-attempt-limiter.js";
import {
  PortalSessionStore,
  SESSION_ABSOLUTE_TIMEOUT_MS,
  SESSION_IDLE_TIMEOUT_MS
} from "../src/services/portal-sessions.js";

const salt = Buffer.from(Array.from({ length: 32 }, (_value, index) => index));
const verifierHex = "68acfdc11b66407f9af0aec16dfb64a2735b7858b4164670b6422a9cf1404576";

function accountRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    accountId: 42,
    username: "TEST_USER",
    salt,
    verifier: Buffer.from(verifierHex, "hex"),
    hasTotp: 0,
    isBanned: 0,
    email: "must-not-leak@example.com",
    session_key: "must-not-leak",
    ...overrides
  };
}

test("matches the fixed AzerothCore SRP6 registration representation", () => {
  const verifier = calculateAzerothCoreVerifier(
    "TEST_USER",
    upperBasicLatin("PassWord1!"),
    salt
  );
  assert.equal(verifier.length, 32);
  assert.equal(verifier.toString("hex"), verifierHex);
  assert.equal(verifyAzerothCorePassword("test_user", "password1!", salt, verifier), true);
  assert.equal(verifyAzerothCorePassword("TEST_USER", "wrong", salt, verifier), false);
  assert.equal(upperBasicLatin("aézЖ"), "AéZЖ");
  assert.equal(verifyAzerothCorePassword("TEST_USER", "password1!", salt.subarray(0, 31), verifier), false);
});

test("validates login input with core-compatible normalization", () => {
  assert.deepEqual(parseLoginInput({ username: " test_user ", password: "Passéword" }), {
    username: "TEST_USER",
    password: "PASSéWORD"
  });
  for (const input of [
    null,
    { username: "ab", password: "x" },
    { username: "valid", password: "" },
    { username: "valid", password: "line\nbreak" },
    { username: "legacy-é", password: "x" },
    { username: "valid", password: "x".repeat(65) },
    { username: "valid", password: "\ud800" }
  ]) {
    assert.equal(parseLoginInput(input), undefined);
  }
});

test("builds a bounded parameterized eligibility query", () => {
  const query = buildPortalAccountQuery({ authDatabase: "acore_auth" }, "TEST_USER");
  assert.deepEqual(query.values, ["TEST_USER"]);
  assert.match(query.sql, /FROM `acore_auth`\.`account` a/u);
  assert.match(query.sql, /FROM `acore_auth`\.`account_banned` b/u);
  assert.match(query.sql, /b\.active = 1/u);
  assert.match(query.sql, /b\.unbandate > UNIX_TIMESTAMP\(\) OR b\.unbandate = b\.bandate/u);
  assert.match(query.sql, /WHERE a\.username = \?\s+LIMIT 2$/u);
  assert.doesNotMatch(query.sql, /email|session_key|last_ip|failed_logins/iu);
  assert.throws(
    () => buildPortalAccountQuery({ authDatabase: "auth`; DROP TABLE account" }, "TEST_USER"),
    /ASCII letters/u
  );
});

test("maps only fixed account authentication material", () => {
  const mapped = mapPortalAccountRows([accountRow()], "TEST_USER");
  assert.deepEqual(mapped, {
    accountId: 42,
    username: "TEST_USER",
    salt,
    verifier: Buffer.from(verifierHex, "hex"),
    banned: false,
    hasTotp: false
  });
  assert.equal(mapPortalAccountRows([], "TEST_USER"), undefined);
  assert.equal(mapped && "email" in mapped, false);
  assert.equal(mapped && "session_key" in mapped, false);
});

test("rejects malformed or ambiguous account material", () => {
  assert.throws(() => mapPortalAccountRows([accountRow(), accountRow()], "TEST_USER"), PortalAuthenticationDataError);
  assert.throws(() => mapPortalAccountRows([accountRow({ salt: Buffer.alloc(31) })], "TEST_USER"), /salt/u);
  assert.throws(() => mapPortalAccountRows([accountRow({ verifier: "hex" })], "TEST_USER"), /verifier/u);
  assert.throws(() => mapPortalAccountRows([accountRow({ accountId: 0 })], "TEST_USER"), /account ID/u);
  assert.throws(() => mapPortalAccountRows([accountRow({ username: "OTHER" })], "TEST_USER"), /account name/u);
  assert.throws(() => mapPortalAccountRows([accountRow({ hasTotp: 2 })], "TEST_USER"), /hasTotp/u);
});

test("authenticates only current eligible accounts and performs dummy work for missing accounts", async () => {
  const eligible = new PortalAuthenticationService(async () => [accountRow()]);
  assert.deepEqual(await eligible.authenticate("TEST_USER", "PASSWORD1!"), {
    accountId: 42,
    username: "TEST_USER"
  });
  assert.equal(await eligible.authenticate("TEST_USER", "WRONG"), undefined);
  assert.equal(await new PortalAuthenticationService(async () => []).authenticate("MISSING", "PASSWORD"), undefined);
  assert.equal(await new PortalAuthenticationService(async () => [accountRow({ isBanned: 1 })])
    .authenticate("TEST_USER", "PASSWORD1!"), undefined);
  assert.equal(await new PortalAuthenticationService(async () => [accountRow({ hasTotp: 1 })])
    .authenticate("TEST_USER", "PASSWORD1!"), undefined);
});

test("validates dedicated portal database and origin configuration", () => {
  assert.deepEqual(readPortalDatabaseConfig({
    PORTAL_DB_HOST: "database.internal",
    PORTAL_DB_USER: "portal_reader",
    PORTAL_DB_PASSWORD: "secret",
    PORTAL_AUTH_DATABASE: "acore_auth",
    PORTAL_CHARACTERS_DATABASE: "acore_characters",
    PORTAL_STATE_DATABASE: "portal_state"
  }), {
    host: "database.internal",
    port: 3306,
    user: "portal_reader",
    password: "secret",
    authDatabase: "acore_auth",
    charactersDatabase: "acore_characters",
    stateDatabase: "portal_state"
  });
  assert.throws(() => readPortalDatabaseConfig({}), PortalDatabaseConfigurationError);
  assert.deepEqual(readPortalHttpSecurityConfig({
    NODE_ENV: "production",
    PORTAL_PUBLIC_ORIGIN: "https://play.example.com"
  }), {
    publicOrigin: "https://play.example.com",
    secureCookies: true,
    sessionCookieName: "__Host-wow-portal-session"
  });
  assert.equal(readPortalHttpSecurityConfig({
    NODE_ENV: "development",
    PORTAL_PUBLIC_ORIGIN: "http://127.0.0.1:5173"
  }).secureCookies, false);
  assert.throws(() => readPortalHttpSecurityConfig({
    NODE_ENV: "production",
    PORTAL_PUBLIC_ORIGIN: "http://play.example.com"
  }), /requires HTTPS/u);
  assert.throws(() => readPortalHttpSecurityConfig({
    NODE_ENV: "development",
    PORTAL_PUBLIC_ORIGIN: "http://lan.example.com"
  }), /loopback-only/u);
});

test("enforces bounded IP and non-resetting account login limits", () => {
  let now = 0;
  const limiter = new LoginAttemptLimiter(() => now);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal(limiter.consumeIpAttempt("127.0.0.1"), true);
  }
  assert.equal(limiter.consumeIpAttempt("127.0.0.1"), false);
  for (let failure = 0; failure < 5; failure += 1) {
    assert.equal(limiter.isAccountBlocked("TEST_USER"), false);
    limiter.recordAccountFailure("TEST_USER");
  }
  assert.equal(limiter.isAccountBlocked("TEST_USER"), true);
  now = 15 * 60 * 1000;
  assert.equal(limiter.consumeIpAttempt("127.0.0.1"), true);
  assert.equal(limiter.isAccountBlocked("TEST_USER"), false);
});

test("creates, rotates, expires, and invalidates digest-backed sessions", () => {
  let now = 0;
  let randomValue = 1;
  const sessions = new PortalSessionStore(
    () => now,
    (size) => Buffer.alloc(size, randomValue++)
  );
  const created = sessions.create({ accountId: 42, username: "TEST_USER" });
  assert.equal(created.sessionId.length, 43);
  assert.equal(created.csrfToken.length, 43);
  assert.equal(sessions.size(), 1);
  const resolved = sessions.resolve(created.sessionId);
  assert.deepEqual(resolved?.principal, { accountId: 42, username: "TEST_USER" });
  assert.equal(resolved ? sessions.verifyCsrf(resolved, created.csrfToken) : false, true);
  const rotatedCsrf = sessions.rotateCsrf(resolved!);
  assert.equal(sessions.verifyCsrf(resolved!, created.csrfToken), false);
  assert.equal(sessions.verifyCsrf(resolved!, rotatedCsrf), true);

  const replacement = sessions.create({ accountId: 42, username: "TEST_USER" }, created.sessionId);
  assert.equal(sessions.resolve(created.sessionId), undefined);
  assert.equal(sessions.size(), 1);
  sessions.invalidate(replacement.sessionId);
  assert.equal(sessions.size(), 0);

  const idle = sessions.create({ accountId: 42, username: "TEST_USER" });
  now = SESSION_IDLE_TIMEOUT_MS;
  assert.equal(sessions.resolve(idle.sessionId), undefined);

  now = 0;
  const absolute = sessions.create({ accountId: 42, username: "TEST_USER" });
  now = SESSION_IDLE_TIMEOUT_MS - 1;
  assert.ok(sessions.resolve(absolute.sessionId));
  now = SESSION_ABSOLUTE_TIMEOUT_MS;
  assert.equal(sessions.resolve(absolute.sessionId), undefined);
});

test("passive session checks do not extend the idle timeout", () => {
  let now = 0;
  const sessions = new PortalSessionStore(
    () => now,
    (size) => Buffer.alloc(size, 9)
  );
  const session = sessions.create({ accountId: 42, username: "TEST_USER" });

  now = SESSION_IDLE_TIMEOUT_MS - 1;
  assert.ok(sessions.resolve(session.sessionId, false));
  now = SESSION_IDLE_TIMEOUT_MS;
  assert.equal(sessions.resolve(session.sessionId, false), undefined);
});
