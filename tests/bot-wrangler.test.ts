import assert from "node:assert/strict";
import test from "node:test";
import {
  BotWranglerContractIntegrityError,
  BotWranglerService,
  buildBotWranglerQuery,
  isBotWranglerMatch,
  mapBotWranglerQueryRows
} from "../src/services/bot-wrangler.js";
import { fullVisibility, standardVisibility } from "./fixtures/account-visibility.js";

const config = { charactersDatabase: "acore_characters", authDatabase: "acore_auth" };

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    firstRecordedAt: new Date("2026-09-01T12:00:00.000Z"),
    hasInvalidEvent: 0,
    characterName: "Thalgrim",
    raceId: 3,
    classId: 2,
    level: 80,
    accountLogin: "SHANE",
    botKills: "12",
    uniqueBotVictims: "4",
    lastBotKillAt: new Date("2026-09-28T18:30:00.000Z"),
    ...overrides
  };
}

test("builds a bounded human-to-bot PvP query with two-sided pre-ranking visibility", () => {
  const standard = buildBotWranglerQuery(config, standardVisibility([19, 7]));
  const full = buildBotWranglerQuery(config, fullVisibility);
  assert.deepEqual(standard.values, [1, "player", "PVP_KILL", "PVP_KILL", 0, 1, 7, 19, 7, 19]);
  assert.match(standard.sql, /FROM `acore_characters`\.`mod_player_stats_events` e/u);
  assert.match(standard.sql, /JOIN `acore_characters`\.`characters` c/u);
  assert.match(standard.sql, /ON c\.guid = e\.actor_guid\s+AND c\.account = e\.actor_account_id/u);
  assert.match(standard.sql, /AND e\.actor_is_bot = \?\s+AND e\.target_is_bot = \?/u);
  assert.match(standard.sql, /AND c\.deleteDate IS NULL/u);
  assert.match(standard.sql, /AND e\.actor_account_id NOT IN \(\?, \?\)\s+AND e\.value2 NOT IN \(\?, \?\)\s+GROUP BY/u);
  assert.doesNotMatch(full.sql, /e\.actor_account_id NOT IN|e\.value2 NOT IN/u);
  assert.match(standard.sql, /COUNT\(\*\) AS botKills/u);
  assert.match(standard.sql, /COUNT\(DISTINCT e\.target_guid\) AS uniqueBotVictims/u);
  assert.match(standard.sql, /ORDER BY botKills DESC, uniqueBotVictims DESC, c\.name ASC, e\.actor_guid ASC\s+LIMIT 25/u);
  assert.doesNotMatch(standard.sql, /targetName|victimName/u);
});

test("validates the PvP contract while the ranking accepts only one flag combination", () => {
  const query = buildBotWranglerQuery(config, fullVisibility).sql;
  assert.match(query, /e\.target_type IS NULL OR e\.target_type <> \?/u);
  assert.match(query, /e\.target_entry IS NULL OR e\.target_entry <> 0/u);
  assert.match(query, /e\.target_guid IS NULL OR e\.target_guid = 0/u);
  assert.match(query, /e\.target_is_bot IS NULL OR e\.target_is_bot NOT IN \(0, 1\)/u);
  assert.match(query, /e\.value1 IS NULL OR e\.value1 <= 0/u);
  assert.match(query, /e\.value2 IS NULL OR e\.value2 <= 0/u);
  assert.match(query, /e\.source IS NULL OR e\.source <> \?/u);
  assert.match(query, /e\.actor_guid IS NULL OR e\.actor_guid = 0/u);
  assert.match(query, /e\.actor_is_bot IS NULL OR e\.actor_is_bot NOT IN \(0, 1\)/u);
  for (const [actor, target, eligible] of [
    [0, 0, false], [0, 1, true], [1, 0, false], [1, 1, false]
  ] as const) {
    assert.equal(isBotWranglerMatch(actor, target), eligible);
  }
});

test("maps current killer metadata without victim identifiers and handles empty results", () => {
  assert.deepEqual(mapBotWranglerQueryRows([row()]), {
    coverage: { firstRecordedAt: "2026-09-01T12:00:00.000Z" },
    entries: [{
      characterName: "Thalgrim",
      race: "Dwarf",
      class: "Paladin",
      level: 80,
      accountLogin: "SHANE",
      botKills: 12,
      uniqueBotVictims: 4,
      lastBotKillAt: "2026-09-28T18:30:00.000Z"
    }]
  });
  assert.deepEqual(mapBotWranglerQueryRows([row({
    characterName: null,
    raceId: null,
    classId: null,
    level: null,
    accountLogin: null,
    botKills: null,
    uniqueBotVictims: null,
    lastBotKillAt: null
  })]), {
    coverage: { firstRecordedAt: "2026-09-01T12:00:00.000Z" },
    entries: []
  });
});

test("rejects contract corruption, malformed metadata, unsafe counts, and over-limit rows", () => {
  assert.throws(
    () => mapBotWranglerQueryRows([row({ hasInvalidEvent: 1 })]),
    BotWranglerContractIntegrityError
  );
  assert.throws(() => mapBotWranglerQueryRows([row({ firstRecordedAt: "not-a-date" })]), /firstRecordedAt/u);
  assert.throws(() => mapBotWranglerQueryRows([row({ characterName: "bad\nname" })]), /characterName/u);
  assert.throws(() => mapBotWranglerQueryRows([row({ botKills: 3, uniqueBotVictims: 4 })]), /uniqueBotVictims/u);
  assert.throws(() => mapBotWranglerQueryRows([row({ lastBotKillAt: null })]), /lastBotKillAt/u);
  assert.throws(() => mapBotWranglerQueryRows([row({
    lastBotKillAt: "2026-08-31T12:00:00.000Z"
  })]), /timestamp/u);
  assert.throws(() => mapBotWranglerQueryRows(Array.from({ length: 26 }, () => row())), /result/u);
});

test("caches independently by visibility scope and coalesces matching requests", async () => {
  let now = 1_000;
  const calls: string[] = [];
  let release: ((rows: unknown) => void) | undefined;
  const service = new BotWranglerService((visibility) => {
    calls.push(visibility.cacheKey);
    return new Promise((resolve) => { release = resolve; });
  }, () => now);
  const first = service.getLeaderboard(fullVisibility);
  const coalesced = service.getLeaderboard(fullVisibility);
  assert.equal(calls.length, 1);
  release?.([row()]);
  assert.equal(await first, await coalesced);
  await service.getLeaderboard(fullVisibility);
  assert.equal(calls.length, 1);

  const standard = service.getLeaderboard(standardVisibility());
  release?.([row()]);
  assert.equal((await standard).population, "human-vs-bot");
  assert.deepEqual(calls, ["full", "standard"]);
  now += 60_000;
  const expired = service.getLeaderboard(fullVisibility);
  release?.([row()]);
  await expired;
  assert.deepEqual(calls, ["full", "standard", "full"]);
});
