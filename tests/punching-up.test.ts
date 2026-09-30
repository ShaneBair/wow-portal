import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPunchingUpQuery,
  mapPunchingUpQueryRows,
  PunchingUpContractIntegrityError,
  PunchingUpService,
  type StatsPopulation
} from "../src/services/punching-up.js";
import { fullVisibility, standardVisibility } from "./fixtures/account-visibility.js";

const config = {
  charactersDatabase: "acore_characters",
  authDatabase: "acore_auth",
  worldDatabase: "acore_world"
};

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
    actorLevelAtKill: 18,
    creatureEntry: 448,
    creatureName: "Hogger",
    creatureLevel: 23,
    levelDelta: 5,
    killMethod: "direct",
    occurredAt: new Date("2026-08-20T18:30:00.000Z"),
    ...overrides
  };
}

test("selects one strongest personal record with deterministic tie breakers", () => {
  const query = buildPunchingUpQuery(config, "players", standardVisibility([19, 7]));
  assert.match(query.sql, /ROW_NUMBER\(\) OVER \(\s+PARTITION BY ek\.realm_id, ek\.actor_guid, ek\.actor_is_bot/u);
  assert.match(query.sql, /ORDER BY ek\.levelDelta DESC, ek\.creatureLevel DESC,\s+ek\.occurredAt ASC, ek\.eventId ASC/u);
  assert.match(query.sql, /WHERE personalRank = 1/u);
  assert.match(query.sql, /ORDER BY levelDelta DESC, creatureLevel DESC, occurredAt ASC,\s+characterName ASC, actor_guid ASC/u);
  assert.match(query.sql, /LIMIT 25/u);
});

test("filters valid positive level gaps, population, visibility, and ownership before the window", () => {
  const players = buildPunchingUpQuery(config, "players", standardVisibility([19, 7]));
  const all = buildPunchingUpQuery(config, "all", fullVisibility);
  assert.match(players.sql, /JOIN `acore_characters`\.`characters` c[\s\S]+c\.guid = e\.actor_guid[\s\S]+c\.account = e\.actor_account_id/u);
  assert.match(players.sql, /e\.target_type = \?/u);
  assert.match(players.sql, /e\.target_entry > 0/u);
  assert.match(players.sql, /e\.value2 = 0/u);
  assert.match(players.sql, /e\.actor_level BETWEEN 1 AND \?/u);
  assert.match(players.sql, /e\.value1 BETWEEN 1 AND \?/u);
  assert.match(players.sql, /e\.value1 > e\.actor_level/u);
  assert.match(players.sql, /c\.deleteDate IS NULL[\s\S]+AND e\.actor_is_bot = 0[\s\S]+AND c\.account NOT IN \(\?, \?\)[\s\S]+\),\s+personal_records/u);
  assert.doesNotMatch(all.sql, /AND e\.actor_is_bot = 0/u);
  assert.match(players.sql, /LEFT JOIN `acore_world`\.`creature_template` ct ON ct\.entry = l\.creatureEntry/u);
  assert.match(players.sql, /Unknown creature #/u);
  for (const value of ["CREATURE_KILL", "direct", "CREATURE_KILL_PET", "pet"]) {
    assert.ok(players.values.includes(value));
  }
  assert.ok(players.values.includes(80));
  assert.ok(players.values.includes(255));
});

test("maps current metadata, actor flags, methods, unknown creatures, and timestamps", () => {
  assert.deepEqual(mapPunchingUpQueryRows([
    row(),
    row({
      isBot: 1,
      creatureEntry: 999999,
      creatureName: "Unknown creature #999999",
      actorLevelAtKill: 20,
      creatureLevel: 26,
      levelDelta: 6,
      killMethod: "pet",
      occurredAt: "2026-08-21 18:30:00.000000"
    })
  ]), {
    coverage: { firstRecordedAt: "2026-08-01T12:00:00.000Z" },
    entries: [
      {
        characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80,
        accountLogin: "SHANE", type: "Player", actorLevelAtKill: 18,
        creatureEntry: 448, creatureName: "Hogger", creatureLevel: 23,
        levelDelta: 5, killMethod: "direct", occurredAt: "2026-08-20T18:30:00.000Z"
      },
      {
        characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80,
        accountLogin: "SHANE", type: "Bot", actorLevelAtKill: 20,
        creatureEntry: 999999, creatureName: "Unknown creature #999999", creatureLevel: 26,
        levelDelta: 6, killMethod: "pet", occurredAt: "2026-08-21T18:30:00.000Z"
      }
    ]
  });
  assert.deepEqual(mapPunchingUpQueryRows([row({
    firstRecordedAt: null,
    characterName: null,
    raceId: null,
    classId: null,
    level: null,
    accountLogin: null,
    isBot: null,
    actorLevelAtKill: null,
    creatureEntry: null,
    creatureName: null,
    creatureLevel: null,
    levelDelta: null,
    killMethod: null,
    occurredAt: null
  })]), { coverage: { firstRecordedAt: null }, entries: [] });
});

test("rejects contract corruption, invalid levels, inconsistent deltas, and bad timestamps", () => {
  assert.throws(
    () => mapPunchingUpQueryRows([row({ hasInvalidEvent: 1 })]),
    PunchingUpContractIntegrityError
  );
  assert.throws(() => mapPunchingUpQueryRows([row({ actorLevelAtKill: 0 })]), /actorLevelAtKill/u);
  assert.throws(() => mapPunchingUpQueryRows([row({ actorLevelAtKill: 81 })]), /actorLevelAtKill/u);
  assert.throws(() => mapPunchingUpQueryRows([row({ creatureLevel: 0 })]), /creatureLevel/u);
  assert.throws(() => mapPunchingUpQueryRows([row({ levelDelta: 4 })]), /delta/u);
  assert.throws(() => mapPunchingUpQueryRows([row({ killMethod: "guardian" })]), /killMethod/u);
  assert.throws(() => mapPunchingUpQueryRows([row({ occurredAt: "not-a-date" })]), /occurredAt/u);
  assert.throws(() => mapPunchingUpQueryRows([row({ occurredAt: "2026-07-01 00:00:00" })]), /timestamp/u);
  assert.throws(() => mapPunchingUpQueryRows(Array.from({ length: 26 }, () => row())), /result/u);
});

test("caches independently by population and visibility and coalesces requests", async () => {
  let now = 1_000;
  const calls: string[] = [];
  let release: ((rows: unknown) => void) | undefined;
  const service = new PunchingUpService((population, visibility) => {
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
