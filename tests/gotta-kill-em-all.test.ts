import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGottaKillEmAllQuery,
  GottaKillEmAllContractIntegrityError,
  GottaKillEmAllService,
  mapGottaKillEmAllQueryRows,
  type StatsPopulation
} from "../src/services/gotta-kill-em-all.js";
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
    accountName: "SHANE",
    isBot: 0,
    uniqueCreatures: "2",
    totalKills: "7",
    ...overrides
  };
}

test("builds distinct creature variety from exact direct and pet kill contracts", () => {
  const players = buildGottaKillEmAllQuery(config, "players", standardVisibility([19, 7]));
  const all = buildGottaKillEmAllQuery(config, "all", fullVisibility);
  assert.deepEqual(players.values.slice(0, 9), [
    2,
    "CREATURE_KILL", "direct",
    "CREATURE_KILL_PET", "pet",
    "CREATURE_KILL", "CREATURE_KILL_PET",
    "CREATURE_KILL", "CREATURE_KILL_PET"
  ]);
  assert.match(players.sql, /e\.target_type IS NULL OR e\.target_type <> \?/u);
  assert.match(players.sql, /e\.target_entry IS NULL OR e\.target_entry = 0/u);
  assert.match(players.sql, /e\.value2 IS NULL OR e\.value2 <> 0/u);
  assert.match(players.sql, /\(e\.event_type = \? AND e\.source = \?\)[\s\S]+\(e\.event_type = \? AND e\.source = \?\)/u);
  assert.match(players.sql, /COUNT\(DISTINCT e\.target_entry\) AS uniqueCreatures/u);
  assert.match(players.sql, /COUNT\(\*\) AS totalKills/u);
});

test("joins only live matching characters, filters before grouping, and ranks stably", () => {
  const players = buildGottaKillEmAllQuery(config, "players", standardVisibility([19, 7]));
  const all = buildGottaKillEmAllQuery(config, "all", fullVisibility);
  assert.match(players.sql, /JOIN `acore_characters`\.`characters` c[\s\S]+c\.guid = e\.actor_guid[\s\S]+c\.account = e\.actor_account_id/u);
  assert.match(players.sql, /JOIN `acore_auth`\.`account` a ON a\.id = c\.account/u);
  assert.match(players.sql, /c\.deleteDate IS NULL[\s\S]+AND e\.actor_is_bot = 0[\s\S]+AND c\.account NOT IN \(\?, \?\)[\s\S]+GROUP BY/u);
  assert.match(players.sql, /GROUP BY\s+e\.realm_id, e\.actor_guid, e\.actor_is_bot/u);
  assert.match(players.sql, /ORDER BY uniqueCreatures DESC, totalKills DESC, c\.name ASC, e\.actor_guid ASC/u);
  assert.match(players.sql, /LIMIT 25/u);
  assert.doesNotMatch(all.sql, /AND e\.actor_is_bot = 0/u);
});

test("maps current metadata and keeps Player and Bot histories separate", () => {
  assert.deepEqual(mapGottaKillEmAllQueryRows([
    row({ accountName: "shane" }),
    row({ isBot: 1, uniqueCreatures: 1, totalKills: 3 })
  ]), {
    coverage: { firstRecordedAt: "2026-08-01T12:00:00.000Z" },
    entries: [
      {
        characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80,
        accountName: "SHANE", type: "Player", uniqueCreatures: 2, totalKills: 7
      },
      {
        characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80,
        accountName: "SHANE", type: "Bot", uniqueCreatures: 1, totalKills: 3
      }
    ]
  });
  assert.deepEqual(mapGottaKillEmAllQueryRows([row({
    firstRecordedAt: null,
    characterName: null,
    raceId: null,
    classId: null,
    level: null,
    accountName: null,
    isBot: null,
    uniqueCreatures: null,
    totalKills: null
  })]), { coverage: { firstRecordedAt: null }, entries: [] });
});

test("rejects contract corruption, malformed totals, and over-limit rows", () => {
  assert.throws(
    () => mapGottaKillEmAllQueryRows([row({ hasInvalidEvent: 1 })]),
    GottaKillEmAllContractIntegrityError
  );
  assert.throws(() => mapGottaKillEmAllQueryRows([row({ uniqueCreatures: 0 })]), /uniqueCreatures/u);
  assert.throws(() => mapGottaKillEmAllQueryRows([row({ uniqueCreatures: 8, totalKills: 7 })]), /totals/u);
  assert.throws(() => mapGottaKillEmAllQueryRows([row({ isBot: 2 })]), /isBot/u);
  assert.throws(() => mapGottaKillEmAllQueryRows(Array.from({ length: 26 }, () => row())), /result/u);
});

test("caches independently by population and visibility and coalesces requests", async () => {
  let now = 1_000;
  const calls: string[] = [];
  let release: ((rows: unknown) => void) | undefined;
  const service = new GottaKillEmAllService((population, visibility) => {
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
