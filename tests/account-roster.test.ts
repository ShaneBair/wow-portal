import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountRosterDataError,
  AccountRosterService,
  buildAccountRosterQuery,
  mapAccountRosterRows,
  readAccountRosterConfig
} from "../src/services/account-roster.js";
import type { AccountVisibilityScope } from "../src/services/account-visibility.js";

const full: AccountVisibilityScope = { cacheKey: "full", excludedAccountIds: [] };
const standard: AccountVisibilityScope = { cacheKey: "standard", excludedAccountIds: [9, 3, 9] };

function row(overrides: Record<string, unknown> = {}) {
  return {
    accountId: 7,
    accountLogin: "SHANE",
    characterGuid: 42,
    characterName: "Thalgrim",
    level: 80,
    raceId: 3,
    classId: 2,
    totalPlayedSeconds: 987_654,
    ...overrides
  };
}

test("reads a roster-only Playerbots schema and builds authoritative bot/visibility exclusions", () => {
  assert.deepEqual(readAccountRosterConfig({ authDatabase: "auth", charactersDatabase: "characters" }, {
    PORTAL_PLAYERBOTS_DATABASE: "playerbots"
  }), { authDatabase: "auth", charactersDatabase: "characters", playerbotsDatabase: "playerbots" });
  assert.throws(() => readAccountRosterConfig({ authDatabase: "auth", charactersDatabase: "characters" }, {}),
    /PORTAL_PLAYERBOTS_DATABASE is required/u);
  assert.throws(() => readAccountRosterConfig({ authDatabase: "auth", charactersDatabase: "characters" }, {
    PORTAL_PLAYERBOTS_DATABASE: "bad-name"
  }), /ASCII letters/u);

  const fullQuery = buildAccountRosterQuery({
    authDatabase: "auth", charactersDatabase: "characters", playerbotsDatabase: "playerbots"
  }, full);
  assert.match(fullQuery.sql, /LEFT JOIN `playerbots`\.`playerbots_account_type` p ON p\.account_id = a\.id/u);
  assert.match(fullQuery.sql, /WHERE p\.account_id IS NULL/u);
  assert.doesNotMatch(fullQuery.sql, /account_type\s*[=,]/u);
  assert.match(fullQuery.sql, /c\.deleteInfos_Name IS NULL/u);
  assert.match(fullQuery.sql, /LIMIT 2501$/u);
  assert.deepEqual(fullQuery.values, []);

  const standardQuery = buildAccountRosterQuery({
    authDatabase: "auth", charactersDatabase: "characters", playerbotsDatabase: "playerbots"
  }, standard);
  assert.match(standardQuery.sql, /AND a\.id NOT IN \(\?, \?\)/u);
  assert.deepEqual(standardQuery.values, [3, 9]);
});

test("groups and deterministically sorts accounts and characters while stripping IDs", () => {
  const result = mapAccountRosterRows([
    row({ accountId: 8, accountLogin: "ZED", characterGuid: 90, characterName: "Zulu", raceId: 1, classId: 1, totalPlayedSeconds: 0 }),
    row({ characterGuid: 43, characterName: "Eori", raceId: 1, classId: 4, level: 10, totalPlayedSeconds: 4_321 }),
    row()
  ], () => new Date("2026-08-28T16:00:00.000Z"));
  assert.deepEqual(result, {
    generatedAt: "2026-08-28T16:00:00.000Z",
    accountCount: 2,
    characterCount: 3,
    accounts: [{
      accountLogin: "SHANE",
      characters: [{ characterName: "Eori", level: 10, class: "Rogue", race: "Human", totalPlayedSeconds: 4_321 },
        { characterName: "Thalgrim", level: 80, class: "Paladin", race: "Dwarf", totalPlayedSeconds: 987_654 }]
    }, {
      accountLogin: "ZED",
      characters: [{ characterName: "Zulu", level: 80, class: "Warrior", race: "Human", totalPlayedSeconds: 0 }]
    }]
  });
  assert.doesNotMatch(JSON.stringify(result), /accountId|characterGuid|raceId|classId/u);
});

test("accepts total-time boundaries and retains unknown race/class values", () => {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (message?: unknown) => warnings.push(String(message));
  try {
    const result = mapAccountRosterRows([
      row({ totalPlayedSeconds: 0 }),
      row({ characterGuid: 43, characterName: "Mystery", raceId: 250, classId: 251, totalPlayedSeconds: 0xffff_ffff })
    ]);
    const mystery = result.accounts[0]?.characters.find((character) => character.characterName === "Mystery");
    assert.equal(mystery?.race, "Unknown race (250)");
    assert.equal(mystery?.class, "Unknown class (251)");
    assert.deepEqual(warnings, [
      "Unknown WotLK race ID received from account roster: 250.",
      "Unknown WotLK class ID received from account roster: 251."
    ]);
  } finally {
    console.warn = originalWarn;
  }
});

test("rejects malformed, duplicate, inconsistent, and oversized results instead of truncating", () => {
  for (const rows of [
    [row({ totalPlayedSeconds: -1 })],
    [row({ totalPlayedSeconds: 0x1_0000_0000 })],
    [row({ level: 0 })],
    [row({ accountLogin: "   " })],
    [row(), row()],
    [row(), row({ characterGuid: 43, accountLogin: "OTHER" })],
    [row(), row({ accountId: 8, characterGuid: 43, accountLogin: "SHANE" })]
  ]) assert.throws(() => mapAccountRosterRows(rows), AccountRosterDataError);
  assert.throws(() => mapAccountRosterRows(Array.from({ length: 2_501 }, (_, index) =>
    row({ characterGuid: index + 1, characterName: `C${index}`.slice(0, 12) })
  )), /bound/u);
  assert.throws(() => mapAccountRosterRows(Array.from({ length: 251 }, (_, index) =>
    row({ accountId: index + 1, accountLogin: `A${index}`, characterGuid: index + 1, characterName: `C${index}` })
  )), /account bound/u);
});

test("service passes the trusted visibility scope unchanged and treats failures as failures", async () => {
  let received: AccountVisibilityScope | undefined;
  const service = new AccountRosterService(async (scope) => {
    received = scope;
    return [];
  }, () => new Date("2026-08-28T16:00:00.000Z"));
  assert.deepEqual(await service.getRoster(standard), {
    generatedAt: "2026-08-28T16:00:00.000Z", accountCount: 0, characterCount: 0, accounts: []
  });
  assert.equal(received, standard);
  await assert.rejects(new AccountRosterService(async () => { throw new Error("classification unavailable"); }).getRoster(full));
});
