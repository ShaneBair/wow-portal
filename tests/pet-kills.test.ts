import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPetKillQuery,
  calculatePetKillPercent,
  mapPetKillQueryRows,
  PetKillContractIntegrityError,
  PetKillService,
  type StatsPopulation
} from "../src/services/pet-kills.js";
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
    petKills: "7",
    directKills: "4",
    totalKills: "11",
    ...overrides
  };
}

test("builds one exact direct-and-pet aggregation with pet-qualified rows", () => {
  const players = buildPetKillQuery(config, "players", standardVisibility([19, 7]));
  const all = buildPetKillQuery(config, "all", fullVisibility);
  assert.deepEqual(players.values.slice(0, 11), [
    2,
    "CREATURE_KILL_PET", "pet",
    "CREATURE_KILL", "direct",
    "CREATURE_KILL", "CREATURE_KILL_PET",
    "CREATURE_KILL_PET", "CREATURE_KILL",
    "CREATURE_KILL", "CREATURE_KILL_PET"
  ]);
  assert.match(players.sql, /e\.target_type IS NULL OR e\.target_type <> \?/u);
  assert.match(players.sql, /e\.target_entry IS NULL OR e\.target_entry = 0/u);
  assert.match(players.sql, /e\.value2 IS NULL OR e\.value2 <> 0/u);
  assert.match(players.sql, /SUM\(e\.event_type = \?\) AS petKills/u);
  assert.match(players.sql, /SUM\(e\.event_type = \?\) AS directKills/u);
  assert.match(players.sql, /COUNT\(\*\) AS totalKills/u);
  assert.match(players.sql, /HAVING petKills > 0/u);
  assert.match(players.sql, /ORDER BY petKills DESC, petKills \/ totalKills DESC, totalKills DESC/u);
  assert.match(players.sql, /LIMIT 25/u);
  assert.doesNotMatch(all.sql, /AND e\.actor_is_bot = 0/u);
});

test("filters live matching visible characters before grouping and ranking", () => {
  const query = buildPetKillQuery(config, "players", standardVisibility([19, 7]));
  assert.match(query.sql, /JOIN `acore_characters`\.`characters` c[\s\S]+c\.guid = e\.actor_guid[\s\S]+c\.account = e\.actor_account_id/u);
  assert.match(query.sql, /c\.deleteDate IS NULL[\s\S]+AND e\.actor_is_bot = 0[\s\S]+AND c\.account NOT IN \(\?, \?\)[\s\S]+GROUP BY/u);
  assert.match(query.sql, /GROUP BY\s+e\.realm_id, e\.actor_guid, e\.actor_is_bot/u);
});

test("rounds pet share deterministically to one decimal place", () => {
  assert.equal(calculatePetKillPercent(1, 1), 100);
  assert.equal(calculatePetKillPercent(1, 3), 33.3);
  assert.equal(calculatePetKillPercent(2, 3), 66.7);
  assert.equal(calculatePetKillPercent(1, 6), 16.7);
  assert.equal(calculatePetKillPercent(7, 11), 63.6);
  assert.throws(() => calculatePetKillPercent(0, 1), /totals/u);
  assert.throws(() => calculatePetKillPercent(2, 1), /totals/u);
});

test("maps separate actor flags and derives totals and percentages", () => {
  assert.deepEqual(mapPetKillQueryRows([
    row(),
    row({ isBot: 1, petKills: 1, directKills: 0, totalKills: 1 })
  ]), {
    coverage: { firstRecordedAt: "2026-08-01T12:00:00.000Z" },
    entries: [
      {
        characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80,
        accountLogin: "SHANE", type: "Player", petKills: 7, directKills: 4,
        totalKills: 11, petKillPercent: 63.6
      },
      {
        characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80,
        accountLogin: "SHANE", type: "Bot", petKills: 1, directKills: 0,
        totalKills: 1, petKillPercent: 100
      }
    ]
  });
  assert.deepEqual(mapPetKillQueryRows([row({
    firstRecordedAt: null,
    characterName: null,
    raceId: null,
    classId: null,
    level: null,
    accountLogin: null,
    isBot: null,
    petKills: null,
    directKills: null,
    totalKills: null
  })]), { coverage: { firstRecordedAt: null }, entries: [] });
});

test("rejects contract corruption, impossible totals, and oversized results", () => {
  assert.throws(
    () => mapPetKillQueryRows([row({ hasInvalidEvent: 1 })]),
    PetKillContractIntegrityError
  );
  assert.throws(() => mapPetKillQueryRows([row({ petKills: 0 })]), /petKills/u);
  assert.throws(() => mapPetKillQueryRows([row({ directKills: -1 })]), /directKills/u);
  assert.throws(() => mapPetKillQueryRows([row({ totalKills: 12 })]), /totals/u);
  assert.throws(() => mapPetKillQueryRows([row({ isBot: 2 })]), /isBot/u);
  assert.throws(() => mapPetKillQueryRows(Array.from({ length: 26 }, () => row())), /result/u);
});

test("caches independently by population and visibility and coalesces requests", async () => {
  let now = 1_000;
  const calls: string[] = [];
  let release: ((rows: unknown) => void) | undefined;
  const service = new PetKillService((population, visibility) => {
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
