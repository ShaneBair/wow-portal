import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublicEnemyQuery,
  mapPublicEnemyQueryRows,
  PublicEnemyContractIntegrityError,
  PublicEnemyService,
  type StatsPopulation
} from "../src/services/public-enemy.js";
import { fullVisibility, standardVisibility } from "./fixtures/account-visibility.js";

const config = { charactersDatabase: "acore_characters", worldDatabase: "acore_world" };

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    firstRecordedAt: new Date("2026-09-01T12:00:00.000Z"),
    hasInvalidEvent: 0,
    creatureEntry: 448,
    creatureName: "Hogger",
    kills: "14",
    directKills: "10",
    petKills: "4",
    ...overrides
  };
}

test("builds a bounded direct and pet kill query with contract and pre-ranking filters", () => {
  const players = buildPublicEnemyQuery(config, "players", standardVisibility([19, 7]));
  const all = buildPublicEnemyQuery(config, "all", fullVisibility);
  assert.deepEqual(players.values, [
    2,
    "CREATURE_KILL", "direct", "CREATURE_KILL_PET", "pet",
    "CREATURE_KILL", "CREATURE_KILL_PET",
    "CREATURE_KILL", "CREATURE_KILL_PET",
    "CREATURE_KILL", "CREATURE_KILL_PET",
    7, 19
  ]);
  assert.match(players.sql, /FROM `acore_characters`\.`mod_player_stats_events` e/u);
  assert.match(players.sql, /LEFT JOIN `acore_world`\.`creature_template` c ON c\.entry = t\.creatureEntry/u);
  assert.match(players.sql, /e\.target_type IS NULL OR e\.target_type <> \?/u);
  assert.match(players.sql, /e\.target_entry IS NULL OR e\.target_entry = 0/u);
  assert.match(players.sql, /e\.target_guid IS NULL OR e\.target_guid = 0/u);
  assert.match(players.sql, /e\.target_is_bot IS NULL OR e\.target_is_bot <> 0/u);
  assert.match(players.sql, /e\.value1 IS NULL OR e\.value1 <= 0/u);
  assert.match(players.sql, /e\.value2 IS NULL OR e\.value2 <> 0/u);
  assert.match(players.sql, /e\.event_type = \? AND e\.source = \?/u);
  assert.match(players.sql, /COUNT\(\*\) AS kills/u);
  assert.match(players.sql, /SUM\(e\.event_type = \?\) AS directKills/u);
  assert.match(players.sql, /SUM\(e\.event_type = \?\) AS petKills/u);
  assert.match(players.sql, /AND e\.actor_is_bot = 0[\s\S]+AND e\.actor_account_id NOT IN \(\?, \?\)[\s\S]+GROUP BY e\.target_entry/u);
  assert.doesNotMatch(all.sql, /AND e\.actor_is_bot = 0/u);
  assert.doesNotMatch(players.sql, /JOIN\s+`[^`]+`\.`characters`/u);
  assert.match(players.sql, /ORDER BY t\.kills DESC, creatureName ASC, t\.creatureEntry ASC\s+LIMIT 25/u);
});

test("maps direct and pet totals, unknown creatures, and valid empty results", () => {
  assert.deepEqual(mapPublicEnemyQueryRows([
    row(),
    row({
      creatureEntry: 999_999,
      creatureName: "Unknown creature #999999",
      kills: 3,
      directKills: 0,
      petKills: 3
    })
  ]), {
    coverage: { firstRecordedAt: "2026-09-01T12:00:00.000Z" },
    entries: [
      { creatureEntry: 448, creatureName: "Hogger", kills: 14, directKills: 10, petKills: 4 },
      {
        creatureEntry: 999_999,
        creatureName: "Unknown creature #999999",
        kills: 3,
        directKills: 0,
        petKills: 3
      }
    ]
  });
  assert.deepEqual(mapPublicEnemyQueryRows([row({
    creatureEntry: null,
    creatureName: null,
    kills: null,
    directKills: null,
    petKills: null
  })]), {
    coverage: { firstRecordedAt: "2026-09-01T12:00:00.000Z" },
    entries: []
  });
  assert.deepEqual(mapPublicEnemyQueryRows([row({
    firstRecordedAt: null,
    creatureEntry: null,
    creatureName: null,
    kills: null,
    directKills: null,
    petKills: null
  })]), { coverage: { firstRecordedAt: null }, entries: [] });
});

test("rejects contract corruption, malformed coverage, inconsistent totals, and unsafe rows", () => {
  assert.throws(
    () => mapPublicEnemyQueryRows([row({ hasInvalidEvent: 1 })]),
    PublicEnemyContractIntegrityError
  );
  assert.throws(() => mapPublicEnemyQueryRows([row({ firstRecordedAt: "2026-02-30 12:00:00" })]), /firstRecordedAt/u);
  assert.throws(() => mapPublicEnemyQueryRows([row({ creatureEntry: 0 })]), /creatureEntry/u);
  assert.throws(() => mapPublicEnemyQueryRows([row({ creatureName: "bad\nname" })]), /creatureName/u);
  assert.throws(() => mapPublicEnemyQueryRows([row({ kills: 13 })]), /totals/u);
  assert.throws(() => mapPublicEnemyQueryRows([
    row(), row({ creatureName: "Hogger duplicate" })
  ]), /totals/u);
  assert.throws(() => mapPublicEnemyQueryRows(Array.from({ length: 26 }, () => row())), /result/u);
});

test("caches independently by population and visibility and coalesces requests", async () => {
  let now = 1_000;
  const calls: string[] = [];
  let release: ((rows: unknown) => void) | undefined;
  const service = new PublicEnemyService((population, visibility) => {
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
