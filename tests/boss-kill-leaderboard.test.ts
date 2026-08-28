import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBossKillLeaderboardQuery,
  BossKillContractIntegrityError,
  BossKillLeaderboardService,
  CREATURE_ELITE_WORLDBOSS,
  CREATURE_TYPE_FLAG_BOSS_MOB,
  ENCOUNTER_CREDIT_KILL_CREATURE,
  mapBossKillLeaderboardRows,
  mapBossKillQueryRows,
  TARGET_TYPE_CREATURE,
  type StatsPopulation
} from "../src/services/boss-kill-leaderboard.js";
import {
  readStatsDatabaseConfig,
  readStatsWorldDatabaseConfig,
  StatsDatabaseConfigurationError
} from "../src/services/stats-database.js";

const config = {
  charactersDatabase: "acore_characters",
  authDatabase: "acore_auth",
  worldDatabase: "acore_world"
};

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    characterGuid: 42,
    accountId: 7,
    creatureEntry: 999,
    characterName: "Thalgrim",
    raceId: 3,
    classId: 2,
    level: 80,
    accountLogin: "SHANE",
    isBot: 0,
    bossKills: "12",
    ...overrides
  };
}

function queryRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    firstRecordedAt: new Date("2026-08-19T19:37:22.256Z"),
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
    bossKills: null,
    ...overrides
  });
}

test("defines compatible boss constants and builds one deduplicated boss-entry set", () => {
  assert.equal(ENCOUNTER_CREDIT_KILL_CREATURE, 0);
  assert.equal(CREATURE_ELITE_WORLDBOSS, 3);
  assert.equal(CREATURE_TYPE_FLAG_BOSS_MOB, 0x00000004);
  assert.equal(TARGET_TYPE_CREATURE, 2);
  const players = buildBossKillLeaderboardQuery(config, "players");
  const all = buildBossKillLeaderboardQuery(config, "all");
  assert.deepEqual(players.values, [
    0, 3, 4, 2,
    "CREATURE_KILL", "direct", "CREATURE_KILL_PET", "pet",
    "CREATURE_KILL", "CREATURE_KILL_PET", "CREATURE_KILL", "CREATURE_KILL_PET"
  ]);
  assert.match(players.sql, /FROM `acore_world`\.`instance_encounters`/u);
  assert.match(players.sql, /WHERE creditType = \?\s+AND creditEntry <> 0/u);
  assert.match(players.sql, /\sUNION\s/u);
  assert.doesNotMatch(players.sql, /UNION ALL/u);
  assert.match(players.sql, /FROM `acore_world`\.`creature_template`/u);
  assert.match(players.sql, /WHERE `rank` = \?\s+OR \(type_flags & \?\) <> 0/u);
  assert.match(players.sql, /JOIN boss_entries b ON b\.entry = e\.target_entry/u);
  assert.match(players.sql, /COUNT\(\*\) AS bossKills/u);
  assert.match(players.sql, /e\.actor_is_bot = 0\s+GROUP BY e\.actor_guid, e\.actor_is_bot/u);
  assert.doesNotMatch(all.sql, /e\.actor_is_bot = 0/u);
  assert.match(all.sql, /GROUP BY e\.actor_guid, e\.actor_is_bot/u);
  assert.match(all.sql, /JOIN `acore_characters`\.`characters` c ON c\.guid = b\.actor_guid/u);
  assert.match(all.sql, /WHERE c\.deleteDate IS NULL/u);
  assert.match(all.sql, /ORDER BY b\.bossKills DESC, c\.name ASC, b\.actor_is_bot ASC\s+LIMIT 25/u);
  assert.doesNotMatch(all.sql, /flags_extra|email|last_login|sessionkey|verifier|salt/iu);
});

test("validates the direct/pet event contract and general creature coverage in SQL", () => {
  const query = buildBossKillLeaderboardQuery(config, "all");
  for (const pattern of [
    /MIN\(event_time\) AS firstRecordedAt/u,
    /target_type IS NULL OR target_type <> \?/u,
    /target_entry IS NULL OR target_entry = 0/u,
    /target_guid IS NULL OR target_guid = 0/u,
    /target_is_bot IS NULL OR target_is_bot <> 0/u,
    /value2 IS NULL OR value2 <> 0/u,
    /event_type = \? AND \(source IS NULL OR source <> \?\)/u,
    /WHERE event_type IN \(\?, \?\)/u
  ]) assert.match(query.sql, pattern);
});

test("keeps world configuration isolated and validates its identifier", () => {
  const baseEnvironment = {
    STATS_DB_HOST: "database.internal",
    STATS_DB_USER: "reader",
    STATS_DB_PASSWORD: "secret",
    STATS_CHARACTERS_DATABASE: "acore_characters",
    STATS_AUTH_DATABASE: "acore_auth"
  };
  assert.equal(readStatsDatabaseConfig(baseEnvironment).charactersDatabase, "acore_characters");
  assert.throws(() => readStatsWorldDatabaseConfig(baseEnvironment), StatsDatabaseConfigurationError);
  assert.deepEqual(readStatsWorldDatabaseConfig({
    ...baseEnvironment,
    STATS_WORLD_DATABASE: "acore_world"
  }), { worldDatabase: "acore_world" });
  assert.throws(() => readStatsWorldDatabaseConfig({
    ...baseEnvironment,
    STATS_WORLD_DATABASE: "world`; DROP TABLE creature_template"
  }), /ASCII letters, digits, and underscores/u);
});

test("maps null/non-null coverage, Player/Bot rows, and current metadata safely", () => {
  assert.deepEqual(mapBossKillQueryRows([emptyRow({ firstRecordedAt: null })]), {
    coverage: { firstRecordedAt: null },
    entries: []
  });
  assert.deepEqual(mapBossKillQueryRows([emptyRow()]).coverage, {
    firstRecordedAt: "2026-08-19T19:37:22.256Z"
  });
  const mapped = mapBossKillQueryRows([
    queryRow(),
    queryRow({ isBot: 1, bossKills: 20 })
  ]);
  assert.deepEqual(mapped.entries.map((entry) => [entry.characterName, entry.isBot, entry.bossKills]), [
    ["Thalgrim", false, 12], ["Thalgrim", true, 20]
  ]);

  const fallback = mapBossKillLeaderboardRows([row({
    characterName: "Mystery", raceId: 99, classId: 98, accountLogin: null, bossKills: 1n
  })])[0]!;
  assert.equal(fallback.race, "Unknown race (99)");
  assert.equal(fallback.class, "Unknown class (98)");
  assert.equal(fallback.accountLogin, "Unknown account");
  for (const key of ["characterGuid", "accountId", "creatureEntry"]) assert.equal(key in fallback, false);
});

test("fails closed on contract corruption, malformed rows, and unsafe totals", () => {
  assert.throws(() => mapBossKillQueryRows([emptyRow({ hasInvalidEvent: 1 })]), BossKillContractIntegrityError);
  assert.throws(() => mapBossKillQueryRows([]), /database result is invalid/u);
  assert.throws(() => mapBossKillQueryRows([queryRow({ firstRecordedAt: null })]), /coverage metadata/u);
  assert.throws(
    () => mapBossKillLeaderboardRows(Array.from({ length: 26 }, () => row())),
    /database result is invalid/u
  );
  for (const count of [-1, 1.5, Infinity, "1.5", "-1", "9007199254740992"]) {
    assert.throws(() => mapBossKillLeaderboardRows([row({ bossKills: count })]), /bossKills is invalid/u);
  }
  assert.throws(() => mapBossKillLeaderboardRows([row({ isBot: 2 })]), /isBot is invalid/u);
});

test("separates and coalesces population caches and rejects expired stale fallback", async () => {
  let now = 1_000;
  const calls: StatsPopulation[] = [];
  const pending = new Map<StatsPopulation, (rows: unknown[]) => void>();
  const service = new BossKillLeaderboardService((population) => {
    calls.push(population);
    return new Promise((resolve) => pending.set(population, resolve));
  }, () => now);
  const first = service.getLeaderboard("players");
  const second = service.getLeaderboard("players");
  const all = service.getLeaderboard("all");
  assert.deepEqual(calls, ["players", "all"]);
  pending.get("players")?.([queryRow()]);
  pending.get("all")?.([queryRow({ isBot: 1 })]);
  const [firstResult, secondResult] = await Promise.all([first, second]);
  await all;
  assert.strictEqual(firstResult, secondResult);
  now = 60_999;
  assert.strictEqual(await service.getLeaderboard("players"), firstResult);

  let refreshes = 0;
  const expiring = new BossKillLeaderboardService(async () => {
    refreshes += 1;
    if (refreshes === 1) return [queryRow()];
    throw new Error("database unavailable");
  }, () => now);
  await expiring.getLeaderboard("players");
  now += 60_001;
  await assert.rejects(() => expiring.getLeaderboard("players"), /database unavailable/u);
});
