import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQuestCompletionLeaderboardQuery,
  mapQuestCompletionLeaderboardRows,
  mapQuestCompletionQueryRows,
  QuestCompletionContractIntegrityError,
  QuestCompletionLeaderboardService
} from "../src/services/quest-completion-leaderboard.js";
import { fullVisibility, standardVisibility } from "./fixtures/account-visibility.js";

const config = { charactersDatabase: "acore_characters", authDatabase: "acore_auth" };

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    characterGuid: 42,
    accountId: 7,
    characterName: "Thalgrim",
    raceId: 3,
    classId: 2,
    level: 80,
    accountLogin: "SHANE",
    isBot: 0,
    questCompletions: "84",
    targetEntry: 12345,
    email: "must-not-leak@example.com",
    ...overrides
  };
}

function queryRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    firstRecordedAt: new Date("2026-08-19T19:37:55.990Z"),
    hasInvalidEvent: 0,
    ...row(),
    ...overrides
  };
}

function emptyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return queryRow({
    characterName: null,
    raceId: null,
    classId: null,
    level: null,
    accountLogin: null,
    isBot: null,
    questCompletions: null,
    ...overrides
  });
}

test("builds bounded raw-event quest queries for players and combined populations", () => {
  const players = buildQuestCompletionLeaderboardQuery(config, "players", fullVisibility);
  const all = buildQuestCompletionLeaderboardQuery(config, "all", fullVisibility);
  assert.deepEqual(players.values, [4, "quest", "QUEST_COMPLETE", "QUEST_COMPLETE"]);
  assert.match(players.sql, /MIN\(event_time\) AS firstRecordedAt/u);
  assert.match(players.sql, /event_time IS NULL/u);
  assert.match(players.sql, /target_type IS NULL OR target_type <> \?/u);
  assert.match(players.sql, /target_type <> \?/u);
  assert.match(players.sql, /target_entry = 0/u);
  assert.match(players.sql, /target_guid <> 0/u);
  assert.match(players.sql, /target_is_bot <> 0/u);
  assert.match(players.sql, /source <> \?/u);
  assert.match(players.sql, /actor_is_bot IS NULL OR actor_is_bot NOT IN \(0, 1\)/u);
  assert.match(players.sql, /COUNT\(\*\) AS questCompletions/u);
  assert.doesNotMatch(players.sql, /COUNT\s*\(\s*DISTINCT/iu);
  assert.match(players.sql, /e\.actor_is_bot = 0\s+GROUP BY e\.actor_guid, e\.actor_is_bot/u);
  assert.doesNotMatch(all.sql, /e\.actor_is_bot = 0/u);
  assert.match(all.sql, /GROUP BY e\.actor_guid, e\.actor_is_bot/u);
  assert.match(all.sql, /JOIN `acore_characters`\.`characters` c ON c\.guid = q\.actor_guid/u);
  assert.match(all.sql, /LEFT JOIN `acore_auth`\.`account` a ON a\.id = c\.account/u);
  assert.match(all.sql, /WHERE c\.deleteDate IS NULL/u);
  assert.match(all.sql, /ORDER BY q\.questCompletions DESC, c\.name ASC, q\.actor_is_bot ASC\s+LIMIT 25/u);
  assert.doesNotMatch(all.sql, /email|last_login|sessionkey|verifier|salt/iu);
  const standard = buildQuestCompletionLeaderboardQuery(
    config,
    "all",
    standardVisibility([19, 7])
  );
  assert.match(standard.sql, /AND c\.account NOT IN \(\?, \?\)/u);
  assert.ok(standard.sql.indexOf("c.account NOT IN") < standard.sql.indexOf("ORDER BY"));
  assert.deepEqual(standard.values.slice(-2), [7, 19]);
  assert.doesNotMatch(all.sql, /c\.account NOT IN/u);
  assert.throws(() => buildQuestCompletionLeaderboardQuery({
    charactersDatabase: "characters`; DROP TABLE account; --",
    authDatabase: "auth"
  }, "all", fullVisibility), /ASCII letters, digits, and underscores/u);
});

test("maps coverage, valid empty results, and separate Player/Bot groups", () => {
  assert.deepEqual(mapQuestCompletionQueryRows([emptyRow({ firstRecordedAt: null })]), {
    coverage: { firstRecordedAt: null },
    entries: []
  });
  const mapped = mapQuestCompletionQueryRows([
    queryRow({ firstRecordedAt: "2026-08-19 19:37:55.990123" }),
    queryRow({ isBot: 1, questCompletions: 211 })
  ]);
  assert.equal(mapped.coverage.firstRecordedAt, "2026-08-19T19:37:55.990Z");
  assert.deepEqual(mapped.entries.map((entry) => [entry.characterName, entry.isBot, entry.questCompletions]), [
    ["Thalgrim", false, 84],
    ["Thalgrim", true, 211]
  ]);
});

test("maps current metadata, friendly fallbacks, and strips private integration fields", () => {
  const entries = mapQuestCompletionLeaderboardRows([
    row(),
    row({
      characterName: "Mystery",
      raceId: 99,
      classId: 98,
      accountLogin: null,
      questCompletions: 2n
    })
  ]);
  assert.deepEqual(entries[1], {
    characterName: "Mystery",
    race: "Unknown race (99)",
    class: "Unknown class (98)",
    level: 80,
    accountLogin: "Unknown account",
    isBot: false,
    questCompletions: 2
  });
  for (const prohibited of ["characterGuid", "accountId", "targetEntry", "email"]) {
    assert.equal(prohibited in entries[0]!, false);
  }
});

test("fails closed for malformed event contracts, metadata, rows, and unsafe counts", () => {
  assert.throws(
    () => mapQuestCompletionQueryRows([emptyRow({ hasInvalidEvent: 1 })]),
    QuestCompletionContractIntegrityError
  );
  assert.throws(() => mapQuestCompletionQueryRows([]), /database result is invalid/u);
  assert.throws(
    () => mapQuestCompletionQueryRows([queryRow({ firstRecordedAt: null })]),
    /coverage metadata/u
  );
  assert.throws(
    () => mapQuestCompletionQueryRows([
      queryRow(),
      queryRow({ firstRecordedAt: "2026-08-20 00:00:00" })
    ]),
    /coverage metadata/u
  );
  assert.throws(
    () => mapQuestCompletionLeaderboardRows(Array.from({ length: 26 }, () => row())),
    /database result is invalid/u
  );
  for (const count of [-1, 1.5, Number.POSITIVE_INFINITY, "1.5", "-1", "9007199254740992"]) {
    assert.throws(
      () => mapQuestCompletionLeaderboardRows([row({ questCompletions: count })]),
      /questCompletions is invalid/u
    );
  }
  assert.throws(() => mapQuestCompletionLeaderboardRows([row({ isBot: 2 })]), /isBot is invalid/u);
});

test("separates 60-second caches and coalesces only matching population refreshes", async () => {
  let now = 1_000;
  const calls: string[] = [];
  const pending = new Map<string, (rows: unknown[]) => void>();
  const service = new QuestCompletionLeaderboardService((population, visibility) => {
    const key = `${population}:${visibility.cacheKey}`;
    calls.push(key);
    return new Promise((resolve) => pending.set(key, resolve));
  }, () => now);
  const playersOne = service.getLeaderboard("players", fullVisibility);
  const playersTwo = service.getLeaderboard("players", fullVisibility);
  const all = service.getLeaderboard("all", fullVisibility);
  const standard = service.getLeaderboard("players", standardVisibility([7]));
  assert.deepEqual(calls, ["players:full", "all:full", "players:standard"]);
  pending.get("players:full")?.([queryRow()]);
  pending.get("all:full")?.([queryRow({ isBot: 1 })]);
  pending.get("players:standard")?.([queryRow({ characterName: "Visible" })]);
  const [first, second] = await Promise.all([playersOne, playersTwo]);
  const allResult = await all;
  assert.notStrictEqual(await standard, first);
  assert.strictEqual(first, second);
  assert.notStrictEqual(first, allResult);
  now = 60_999;
  assert.strictEqual(await service.getLeaderboard("players", fullVisibility), first);
  assert.deepEqual(calls, ["players:full", "all:full", "players:standard"]);
});

test("returns failure instead of expired stale data", async () => {
  let now = 0;
  let calls = 0;
  const service = new QuestCompletionLeaderboardService(async () => {
    calls += 1;
    if (calls === 1) return [queryRow()];
    throw new Error("database unavailable");
  }, () => now);
  await service.getLeaderboard("players", fullVisibility);
  now = 60_001;
  await assert.rejects(
    () => service.getLeaderboard("players", fullVisibility),
    /database unavailable/u
  );
  assert.equal(calls, 2);
});
