import assert from "node:assert/strict";
import { test } from "node:test";
import { AccountPasswordChangeError, AccountPasswordService, buildAccountPasswordQueries } from "../src/services/account-password.js";
import { parseAccountPasswordInput } from "../src/services/account-password-http.js";
import { calculateAzerothCoreVerifier, verifyAzerothCorePassword } from "../src/services/azerothcore-srp6.js";
import { PortalSessionStore } from "../src/services/portal-sessions.js";
import { AccountPasswordLimiter } from "../src/services/account-password-limiter.js";

const username = "TEST_USER";
const oldPassword = "OldPass1!";
const newPassword = "NéwPass2!";
const oldSalt = Buffer.alloc(32, 0x11);
const oldVerifier = calculateAzerothCoreVerifier(username, oldPassword.toUpperCase(), oldSalt);

test("validates exact password input fields and Unicode character boundaries", () => {
  assert.deepEqual(parseAccountPasswordInput({ currentPassword: oldPassword, newPassword, confirmNewPassword: newPassword }),
    { currentPassword: oldPassword, newPassword, confirmNewPassword: newPassword });
  assert.equal(parseAccountPasswordInput({ currentPassword: oldPassword, newPassword, confirmNewPassword: newPassword, accountId: 7 }), undefined);
  assert.equal(parseAccountPasswordInput({ currentPassword: "Password1", newPassword: "pASSWORD1", confirmNewPassword: "pASSWORD1" }), undefined);
  assert.ok(parseAccountPasswordInput({ currentPassword: oldPassword, newPassword: "1234567😀", confirmNewPassword: "1234567😀" }));
  assert.equal(parseAccountPasswordInput({ currentPassword: oldPassword, newPassword: "123456\ud800x", confirmNewPassword: "123456\ud800x" }), undefined);
});

test("generates fresh SRP6 material and supplies the complete compare-and-swap contract", async () => {
  let updateArguments: unknown[] | undefined;
  const service = new AccountPasswordService(
    async () => [{ username, salt: oldSalt, verifier: oldVerifier }],
    async (...args) => { updateArguments = args; return 1; },
    (size) => Buffer.alloc(size, 0x22)
  );
  await service.change(42, username, { currentPassword: oldPassword, newPassword, confirmNewPassword: newPassword });
  assert.ok(updateArguments);
  const [accountId, salt, verifier, priorSalt, priorVerifier] = updateArguments as [number, Buffer, Buffer, Buffer, Buffer];
  assert.equal(accountId, 42);
  assert.equal(salt.length, 32);
  assert.notDeepEqual(salt, oldSalt);
  assert.deepEqual(priorSalt, oldSalt);
  assert.deepEqual(priorVerifier, oldVerifier);
  assert.equal(verifyAzerothCorePassword(username, newPassword, salt, verifier), true);
  assert.equal(verifyAzerothCorePassword(username, oldPassword, salt, verifier), false);
  const queries = buildAccountPasswordQueries({ authDatabase: "auth_test" }, 42);
  assert.match(queries.updateSql, /WHERE id = \? AND salt = \? AND verifier = \?/u);
  assert.deepEqual(queries.selectValues, [42]);
});

test("distinguishes current-password, conflict, and ambiguous update failures", async () => {
  const material = async () => [{ username, salt: oldSalt, verifier: oldVerifier }];
  await assert.rejects(new AccountPasswordService(material).change(42, username,
    { currentPassword: "DefinitelyWrong", newPassword, confirmNewPassword: newPassword }),
    (error) => error instanceof AccountPasswordChangeError && error.kind === "incorrect-current");
  await assert.rejects(new AccountPasswordService(material, async () => 0).change(42, username,
    { currentPassword: oldPassword, newPassword, confirmNewPassword: newPassword }),
    (error) => error instanceof AccountPasswordChangeError && error.kind === "conflict");
  await assert.rejects(new AccountPasswordService(material, async () => { throw new Error("connection lost"); }).change(42, username,
    { currentPassword: oldPassword, newPassword, confirmNewPassword: newPassword }),
    (error) => error instanceof AccountPasswordChangeError && error.kind === "ambiguous-update");
});

test("invalidates every session for one account only", () => {
  let byte = 1;
  const sessions = new PortalSessionStore(Date.now, (size) => Buffer.alloc(size, byte++));
  const first = sessions.create({ accountId: 42, username });
  const second = sessions.create({ accountId: 42, username });
  const other = sessions.create({ accountId: 77, username: "OTHER" });
  sessions.invalidateAccount(42);
  assert.equal(sessions.resolve(first.sessionId), undefined);
  assert.equal(sessions.resolve(second.sessionId), undefined);
  assert.ok(sessions.resolve(other.sessionId));
});

test("enforces non-resetting account and client-IP password attempt windows", () => {
  let now = 1_000;
  const accounts = new AccountPasswordLimiter(() => now);
  for (let attempt = 0; attempt < 5; attempt += 1) assert.equal(accounts.consume(42, `ip-${attempt}`), true);
  assert.equal(accounts.consume(42, "another-ip"), false);

  const ips = new AccountPasswordLimiter(() => now);
  for (let attempt = 0; attempt < 10; attempt += 1) assert.equal(ips.consume(100 + attempt, "shared-ip"), true);
  assert.equal(ips.consume(999, "shared-ip"), false);
  now += 15 * 60 * 1000;
  assert.equal(accounts.consume(42, "another-ip"), true);
  assert.equal(ips.consume(999, "shared-ip"), true);
});
