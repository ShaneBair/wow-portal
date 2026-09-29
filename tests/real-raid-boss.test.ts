import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRealRaidBossQuery,
  mapRealRaidBossQueryRows,
  RealRaidBossContractIntegrityError,
  RealRaidBossService,
  type StatsPopulation
} from "../src/services/real-raid-boss.js";
import { fullVisibility, standardVisibility } from "./fixtures/account-visibility.js";

const config = { charactersDatabase: "acore_characters", worldDatabase: "acore_world" };

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    firstRecordedAt: new Date("2026-08-19T19:37:22.256Z"),
    hasInvalidEvent: 0,
    creatureEntry: 448,
    creatureName: "Hogger",
    characterKills: "14",
    uniqueVictims: "4",
    ...overrides
  };
}

test("builds the bounded creature-death query with contract, privacy, and stable ranking", () => {
  const players = buildRealRaidBossQuery(config, "players", standardVisibility([19, 7]));
  const all = buildRealRaidBossQuery(config, "all", fullVisibility);
  assert.deepEqual(players.values, [
    2, "creature", "PLAYER_KILLED_BY_CREATURE", "PLAYER_KILLED_BY_CREATURE", 7, 19
  ]);
  assert.match(players.sql, /FROM `acore_characters`\.`mod_player_stats_events` e/u);
  assert.match(players.sql, /LEFT JOIN `acore_world`\.`creature_template` c ON c\.entry = t\.creatureEntry/u);
  assert.match(players.sql, /e\.target_type IS NULL OR e\.target_type <> \?/u);
  assert.match(players.sql, /e\.target_entry IS NULL OR e\.target_entry = 0/u);
  assert.match(players.sql, /e\.source IS NULL OR e\.source <> \?/u);
  assert.match(players.sql, /e\.value1 IS NULL OR e\.value1 <= 0/u);
  assert.match(players.sql, /e\.value2 IS NULL OR e\.value2 <> 0/u);
  assert.match(players.sql, /e\.realm_id IS NULL OR e\.realm_id = 0/u);
  assert.match(players.sql, /e\.actor_account_id IS NULL OR e\.actor_account_id = 0/u);
  assert.match(players.sql, /e\.actor_guid IS NULL OR e\.actor_guid = 0/u);
  assert.match(players.sql, /AND e\.actor_is_bot = 0[\s\S]+AND e\.actor_account_id NOT IN \(\?, \?\)/u);
  assert.doesNotMatch(all.sql, /AND e\.actor_is_bot = 0/u);
  assert.match(players.sql, /GROUP BY e\.target_entry/u);
  assert.match(players.sql, /COUNT\(DISTINCT e\.realm_id, e\.actor_guid\) AS uniqueVictims/u);
  assert.match(players.sql, /COALESCE\(NULLIF\(c\.name, ''\), CONCAT\('Unknown creature #'/u);
  assert.match(players.sql, /ORDER BY t\.characterKills DESC, t\.uniqueVictims DESC, creatureName ASC, t\.creatureEntry ASC\s+LIMIT 25/u);
  assert.doesNotMatch(players.sql, /PLAYER_DEATH|PVP_KILL|JOIN\s+`[^`]+`\.`characters`/u);
});

test("maps coverage, missing metadata fallback, and valid empty results", () => {
  assert.deepEqual(mapRealRaidBossQueryRows([
    row(),
    row({
      creatureEntry: 999_999,
      creatureName: "Unknown creature #999999",
      characterKills: 8,
      uniqueVictims: "2"
    })
  ]), {
    coverage: { firstRecordedAt: "2026-08-19T19:37:22.256Z" },
    entries: [
      { creatureEntry: 448, creatureName: "Hogger", characterKills: 14, uniqueVictims: 4 },
      { creatureEntry: 999_999, creatureName: "Unknown creature #999999", characterKills: 8, uniqueVictims: 2 }
    ]
  });
  assert.deepEqual(mapRealRaidBossQueryRows([row({
    firstRecordedAt: null,
    creatureEntry: null,
    creatureName: null,
    characterKills: null,
    uniqueVictims: null
  })]), { coverage: { firstRecordedAt: null }, entries: [] });
});

test("rejects contract corruption, malformed metadata, and unsafe rows", () => {
  assert.throws(
    () => mapRealRaidBossQueryRows([row({ hasInvalidEvent: 1 })]),
    RealRaidBossContractIntegrityError
  );
  assert.throws(() => mapRealRaidBossQueryRows([row({ firstRecordedAt: "2026-02-30 12:00:00" })]), /firstRecordedAt/u);
  assert.throws(() => mapRealRaidBossQueryRows([row({ creatureEntry: 0 })]), /creatureEntry/u);
  assert.throws(() => mapRealRaidBossQueryRows([row({ creatureName: "bad\nname" })]), /creatureName/u);
  assert.throws(() => mapRealRaidBossQueryRows([row({ characterKills: 2, uniqueVictims: 3 })]), /uniqueVictims/u);
  assert.throws(() => mapRealRaidBossQueryRows(Array.from({ length: 26 }, () => row())), /result/u);
  assert.throws(() => mapRealRaidBossQueryRows([row({ firstRecordedAt: null })]), /coverage/u);
});

test("caches independently by population and visibility and coalesces requests", async () => {
  let now = 1_000;
  const calls: string[] = [];
  let release: ((rows: unknown) => void) | undefined;
  const service = new RealRaidBossService((population, visibility) => {
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
