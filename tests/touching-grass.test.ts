import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTouchingGrassQuery,
  mapTouchingGrassQueryRows,
  TouchingGrassContractIntegrityError,
  TouchingGrassService,
  type StatsPopulation
} from "../src/services/touching-grass.js";
import { fullVisibility, standardVisibility } from "./fixtures/account-visibility.js";

const config = { charactersDatabase: "acore_characters", authDatabase: "acore_auth" };

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    firstRecordedAt: new Date("2026-08-01T12:00:00.000Z"),
    hasInvalidEvent: 0,
    characterName: "Thalgrim",
    raceId: 3,
    classId: 2,
    level: 80,
    accountLogin: "SHANE",
    isBot: 0,
    zonesVisited: "14",
    mapsVisited: "3",
    characterFirstRecordedAt: new Date("2026-08-02T12:00:00.000Z"),
    characterLastRecordedAt: new Date("2026-08-20T18:30:00.000Z"),
    ...overrides
  };
}

test("builds the all-history distinct-location query from exactly the default event allowlist", () => {
  const players = buildTouchingGrassQuery(config, "players", standardVisibility([19, 7]));
  const all = buildTouchingGrassQuery(config, "all", fullVisibility);
  for (const eventType of [
    "CREATURE_KILL", "CREATURE_KILL_PET", "PLAYER_DEATH", "PLAYER_KILLED_BY_CREATURE",
    "PVP_KILL", "LEVEL_CHANGE", "QUEST_COMPLETE", "ACHIEVEMENT"
  ]) assert.ok(players.values.includes(eventType), eventType);
  for (const optional of ["LOOT_ITEM", "XP_GAIN", "MONEY_CHANGE"]) {
    assert.equal(players.values.includes(optional), false);
    assert.doesNotMatch(players.sql, new RegExp(optional, "u"));
  }
  assert.match(players.sql, /COUNT\(DISTINCT CASE WHEN e\.zone_id > 0 THEN e\.zone_id END\) AS zonesVisited/u);
  assert.match(players.sql, /COUNT\(DISTINCT CASE WHEN e\.map_id > 0 THEN e\.map_id END\) AS mapsVisited/u);
  assert.match(players.sql, /GROUP BY\s+e\.realm_id, e\.actor_guid, e\.actor_is_bot/u);
  assert.match(players.sql, /JOIN `acore_characters`\.`characters` c[\s\S]+c\.guid = e\.actor_guid[\s\S]+c\.account = e\.actor_account_id/u);
  assert.match(players.sql, /LEFT JOIN `acore_auth`\.`account` a ON a\.id = c\.account/u);
  assert.match(players.sql, /c\.deleteDate IS NULL/u);
  assert.match(players.sql, /AND e\.actor_is_bot = 0[\s\S]+AND c\.account NOT IN \(\?, \?\)/u);
  assert.doesNotMatch(all.sql, /AND e\.actor_is_bot = 0/u);
  assert.match(players.sql, /HAVING zonesVisited > 0/u);
  assert.match(players.sql, /ORDER BY zonesVisited DESC, mapsVisited DESC, characterLastRecordedAt ASC,[\s\S]+c\.name ASC, e\.actor_guid ASC/u);
  assert.match(players.sql, /LIMIT 25/u);
});

test("validates every accepted type/source/target/value contract", () => {
  const query = buildTouchingGrassQuery(config, "all", fullVisibility);
  const pairs = [
    ["CREATURE_KILL", "direct", 2],
    ["CREATURE_KILL_PET", "pet", 2],
    ["PLAYER_DEATH", "canonical", 0],
    ["PLAYER_KILLED_BY_CREATURE", "creature", 2],
    ["PVP_KILL", "player", 1],
    ["LEVEL_CHANGE", "level", 0],
    ["QUEST_COMPLETE", "quest", 4],
    ["ACHIEVEMENT", "achievement", 5]
  ] as const;
  for (const [eventType, source, targetType] of pairs) {
    const index = query.values.findIndex((value, position) =>
      value === eventType && query.values[position + 1] === targetType && query.values[position + 2] === source
    );
    assert.notEqual(index, -1, `${eventType} contract`);
  }
  assert.match(query.sql, /e\.target_entry > 0 AND e\.target_guid > 0 AND e\.target_is_bot = 0/u);
  assert.match(query.sql, /e\.target_entry = 0 AND e\.target_guid > 0 AND e\.target_is_bot IN \(0, 1\)/u);
  assert.match(query.sql, /e\.target_entry = 0 AND e\.target_guid = 0 AND e\.target_is_bot = 0/u);
  assert.match(query.sql, /e\.value1 > 0 AND e\.value2 > 0/u);
  assert.match(query.sql, /e\.value1 = 0 AND e\.value2 = 0/u);
});

test("maps separate control types, metadata, counts, and activity spans", () => {
  assert.deepEqual(mapTouchingGrassQueryRows([
    row(),
    row({
      characterName: "Thalgrim",
      accountLogin: null,
      isBot: 1,
      zonesVisited: 9,
      mapsVisited: 2,
      characterFirstRecordedAt: "2026-08-03 12:00:00.000000",
      characterLastRecordedAt: "2026-08-21 18:30:00.000000"
    })
  ]), {
    coverage: { firstRecordedAt: "2026-08-01T12:00:00.000Z" },
    entries: [
      {
        characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80,
        accountLogin: "SHANE", type: "Player", zonesVisited: 14, mapsVisited: 3,
        firstRecordedAt: "2026-08-02T12:00:00.000Z",
        lastRecordedAt: "2026-08-20T18:30:00.000Z"
      },
      {
        characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80,
        accountLogin: "Unknown account", type: "Bot", zonesVisited: 9, mapsVisited: 2,
        firstRecordedAt: "2026-08-03T12:00:00.000Z",
        lastRecordedAt: "2026-08-21T18:30:00.000Z"
      }
    ]
  });
  assert.deepEqual(mapTouchingGrassQueryRows([row({
    firstRecordedAt: null,
    characterName: null,
    raceId: null,
    classId: null,
    level: null,
    accountLogin: null,
    isBot: null,
    zonesVisited: null,
    mapsVisited: null,
    characterFirstRecordedAt: null,
    characterLastRecordedAt: null
  })]), { coverage: { firstRecordedAt: null }, entries: [] });
});

test("rejects contract corruption and malformed database rows", () => {
  assert.throws(
    () => mapTouchingGrassQueryRows([row({ hasInvalidEvent: 1 })]),
    TouchingGrassContractIntegrityError
  );
  assert.throws(() => mapTouchingGrassQueryRows([row({ zonesVisited: 0 })]), /zonesVisited/u);
  assert.throws(() => mapTouchingGrassQueryRows([row({ mapsVisited: -1 })]), /mapsVisited/u);
  assert.throws(() => mapTouchingGrassQueryRows([row({ isBot: 2 })]), /isBot/u);
  assert.throws(() => mapTouchingGrassQueryRows([row({
    characterFirstRecordedAt: "2026-08-22 00:00:00",
    characterLastRecordedAt: "2026-08-21 00:00:00"
  })]), /span/u);
  assert.throws(() => mapTouchingGrassQueryRows(Array.from({ length: 26 }, () => row())), /result/u);
});

test("caches independently by population and visibility and coalesces requests", async () => {
  let now = 1_000;
  const calls: string[] = [];
  let release: ((rows: unknown) => void) | undefined;
  const service = new TouchingGrassService((population, visibility) => {
    calls.push(`${population}:${visibility.cacheKey}`);
    return new Promise((resolve) => { release = resolve; });
  }, () => now);
  const first = service.getLeaderboard("players", fullVisibility);
  const coalesced = service.getLeaderboard("players", fullVisibility);
  assert.equal(calls.length, 1);
  release?.([row()]);
  assert.equal(await first, await coalesced);
  await service.getLeaderboard("players", fullVisibility);
  assert.equal(calls.length, 1);
  const variants: [StatsPopulation, typeof fullVisibility][] = [
    ["all", fullVisibility], ["players", standardVisibility()]
  ];
  for (const [population, visibility] of variants) {
    const pending = service.getLeaderboard(population, visibility);
    release?.([row()]);
    await pending;
  }
  assert.deepEqual(calls, ["players:full", "all:full", "players:standard"]);
  now += 60_000;
  const expired = service.getLeaderboard("players", fullVisibility);
  release?.([row()]);
  await expired;
  assert.equal(calls.length, 4);
});
