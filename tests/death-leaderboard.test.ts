import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeathLeaderboardQuery,
  DeathLeaderboardContractIntegrityError,
  DeathLeaderboardService,
  mapDeathLeaderboardQueryRows,
  mapDeathLeaderboardRows,
  type StatsPopulation
} from "../src/services/death-leaderboard.js";
import {
  readStatsDatabaseConfig,
  StatsDatabaseConfigurationError
} from "../src/services/stats-database.js";

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    characterGuid: 321,
    accountId: 12,
    characterName: "Thalgrim",
    raceId: 3,
    classId: 2,
    level: 42,
    accountLogin: "SHANE",
    isBot: 0,
    deaths: "14",
    email: "must-not-leak@example.com",
    ...overrides
  };
}

function queryRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cutoverCount: 1,
    cutoffEventId: "500",
    comprehensiveSince: new Date("2026-08-25T14:30:00.000Z"),
    hasInvalidCanonical: 0,
    ...row(),
    ...overrides
  };
}

function emptyQueryRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return queryRow({
    characterName: null,
    raceId: null,
    classId: null,
    level: null,
    accountLogin: null,
    isBot: null,
    deaths: null,
    ...overrides
  });
}

const config = {
  charactersDatabase: "acore_characters",
  authDatabase: "acore_auth"
};

test("builds the bounded hybrid death query with integrity and population checks", () => {
  const players = buildDeathLeaderboardQuery(config, "players");
  const all = buildDeathLeaderboardQuery(config, "all");

  assert.deepEqual(players.values, [
    "canonical_player_death_v1",
    "PLAYER_DEATH",
    "PLAYER_KILLED_BY_CREATURE",
    "PVP_KILL",
    "PLAYER_DEATH"
  ]);
  assert.match(players.sql, /FROM `acore_characters`\.`mod_player_stats_migrations`/u);
  assert.match(players.sql, /WHERE migration_key = \?/u);
  assert.match(players.sql, /COUNT\(\*\) AS cutover_count/u);
  assert.match(players.sql, /EXISTS[\s\S]+e\.id <= x\.cutoff_event_id/u);
  assert.match(players.sql, /actor_guid AS character_guid, e\.actor_is_bot AS is_bot/u);
  assert.match(players.sql, /target_guid AS character_guid, e\.target_is_bot AS is_bot/u);
  assert.match(players.sql, /e\.event_type = \?[\s\S]+e\.id > x\.cutoff_event_id/u);
  assert.equal((players.sql.match(/e\.id <= x\.cutoff_event_id/gu) ?? []).length, 3);
  assert.equal((players.sql.match(/e\.id > x\.cutoff_event_id/gu) ?? []).length, 1);
  assert.doesNotMatch(players.sql, /CREATURE_KILL(?:_PET)?/u);
  assert.match(players.sql, /UNION ALL/u);
  assert.match(players.sql, /WHERE is_bot = 0\s+GROUP BY character_guid, is_bot/u);
  assert.doesNotMatch(all.sql, /WHERE is_bot = 0/u);
  assert.match(all.sql, /GROUP BY character_guid, is_bot/u);
  assert.match(all.sql, /JOIN `acore_characters`\.`characters` c ON c\.guid = d\.character_guid/u);
  assert.match(all.sql, /LEFT JOIN `acore_auth`\.`account` a ON a\.id = c\.account/u);
  assert.match(all.sql, /WHERE c\.deleteDate IS NULL/u);
  assert.match(all.sql, /ORDER BY d\.deaths DESC, c\.name ASC, d\.is_bot ASC\s+LIMIT 25/u);
  assert.match(all.sql, /LEFT JOIN leaderboard l ON TRUE/u);
  assert.doesNotMatch(all.sql, /email|last_login|sessionkey|verifier|salt/iu);
  assert.throws(
    () => buildDeathLeaderboardQuery({
      charactersDatabase: "characters`; DROP TABLE account; --",
      authDatabase: "auth"
    }, "all"),
    /ASCII letters, digits, and underscores/u
  );
});

test("validates cutover metadata, coverage, integrity, and empty results", async (context) => {
  await context.test("accepts zero and nonzero safe cutoffs", () => {
    for (const cutoffEventId of [0, "500", 9007199254740991n]) {
      const result = mapDeathLeaderboardQueryRows([
        emptyQueryRow({ cutoffEventId, comprehensiveSince: "2026-08-25 14:30:00.123456" })
      ]);
      assert.deepEqual(result, {
        coverage: { comprehensiveSince: "2026-08-25T14:30:00.123Z" },
        entries: []
      });
    }
  });

  for (const cutoverCount of [0, 2, "invalid"] as const) {
    await context.test(`cutover count ${String(cutoverCount)}`, () => {
      assert.throws(
        () => mapDeathLeaderboardQueryRows([emptyQueryRow({ cutoverCount })]),
        /cutover metadata|cutoverCount/u
      );
    });
  }

  for (const cutoffEventId of [-1, 1.5, "9007199254740992", null] as const) {
    await context.test(`cutoff ${String(cutoffEventId)}`, () => {
      assert.throws(
        () => mapDeathLeaderboardQueryRows([emptyQueryRow({ cutoffEventId })]),
        /cutoffEventId/u
      );
    });
  }

  for (const comprehensiveSince of [null, "not-a-date", "2026-02-30 14:30:00"] as const) {
    await context.test(`timestamp ${String(comprehensiveSince)}`, () => {
      assert.throws(
        () => mapDeathLeaderboardQueryRows([emptyQueryRow({ comprehensiveSince })]),
        /comprehensiveSince/u
      );
    });
  }

  await context.test("rejects canonical rows at or before the cutoff", () => {
    assert.throws(
      () => mapDeathLeaderboardQueryRows([emptyQueryRow({ hasInvalidCanonical: 1 })]),
      DeathLeaderboardContractIntegrityError
    );
  });

  await context.test("rejects a missing query result", () => {
    assert.throws(() => mapDeathLeaderboardQueryRows([]), /database result is invalid/u);
  });

  await context.test("maps repeated valid coverage without exposing cutover fields", () => {
    const result = mapDeathLeaderboardQueryRows([
      queryRow(),
      queryRow({ characterName: "Other", deaths: 3, isBot: 1 })
    ]);
    assert.equal(result.coverage.comprehensiveSince, "2026-08-25T14:30:00.000Z");
    assert.equal(result.entries.length, 2);
    assert.equal("cutoffEventId" in result.entries[0]!, false);
  });
});

test("maps current metadata, preserves control groups, and strips integration-only fields", () => {
  const entries = mapDeathLeaderboardRows([
    row(),
    row({ isBot: 1, deaths: 37n }),
    row({
      characterName: "Mystery",
      raceId: 99,
      classId: 98,
      accountLogin: null,
      deaths: 1
    })
  ]);

  assert.deepEqual(entries, [
    {
      characterName: "Thalgrim",
      race: "Dwarf",
      class: "Paladin",
      level: 42,
      accountLogin: "SHANE",
      isBot: false,
      deaths: 14
    },
    {
      characterName: "Thalgrim",
      race: "Dwarf",
      class: "Paladin",
      level: 42,
      accountLogin: "SHANE",
      isBot: true,
      deaths: 37
    },
    {
      characterName: "Mystery",
      race: "Unknown race (99)",
      class: "Unknown class (98)",
      level: 42,
      accountLogin: "Unknown account",
      isBot: false,
      deaths: 1
    }
  ]);
  assert.equal("characterGuid" in entries[0], false);
  assert.equal("accountId" in entries[0], false);
  assert.equal("email" in entries[0], false);
});

test("rejects invalid database rows and unsafe death totals", async (context) => {
  await context.test("non-array result", () => {
    assert.throws(() => mapDeathLeaderboardRows({}), /database result is invalid/u);
  });

  await context.test("more than 25 results", () => {
    assert.throws(() => mapDeathLeaderboardRows(Array.from({ length: 26 }, () => row())), /invalid/u);
  });

  for (const deaths of [-1, 1.5, Number.POSITIVE_INFINITY, "1.5", "-1", "9007199254740992"] as const) {
    await context.test(`death total ${String(deaths)}`, () => {
      assert.throws(() => mapDeathLeaderboardRows([row({ deaths })]), /deaths is invalid/u);
    });
  }

  await context.test("invalid control flag", () => {
    assert.throws(() => mapDeathLeaderboardRows([row({ isBot: 2 })]), /isBot is invalid/u);
  });

  await context.test("invalid current level", () => {
    assert.throws(() => mapDeathLeaderboardRows([row({ level: 0 })]), /level is invalid/u);
  });
});

test("validates complete Stats database configuration and identifier safety", () => {
  assert.deepEqual(readStatsDatabaseConfig({
    STATS_DB_HOST: "database.internal",
    STATS_DB_USER: "stats_reader",
    STATS_DB_PASSWORD: "secret",
    STATS_CHARACTERS_DATABASE: "acore_characters",
    STATS_AUTH_DATABASE: "acore_auth"
  }), {
    host: "database.internal",
    port: 3306,
    user: "stats_reader",
    password: "secret",
    charactersDatabase: "acore_characters",
    authDatabase: "acore_auth"
  });

  assert.throws(
    () => readStatsDatabaseConfig({}),
    StatsDatabaseConfigurationError
  );
  assert.throws(
    () => readStatsDatabaseConfig({
      STATS_DB_HOST: "host",
      STATS_DB_USER: "user",
      STATS_DB_PASSWORD: "password",
      STATS_CHARACTERS_DATABASE: "characters; DROP TABLE account",
      STATS_AUTH_DATABASE: "auth"
    }),
    /ASCII letters, digits, and underscores/u
  );
});

test("keeps successful cache entries independent by population for sixty seconds", async () => {
  let now = 1_000;
  const calls: StatsPopulation[] = [];
  const service = new DeathLeaderboardService(async (population) => {
    calls.push(population);
    return [queryRow({ isBot: population === "all" ? 1 : 0 })];
  }, () => now);

  const players = await service.getLeaderboard("players");
  const all = await service.getLeaderboard("all");
  now = 60_999;
  const cachedPlayers = await service.getLeaderboard("players");
  const cachedAll = await service.getLeaderboard("all");

  assert.strictEqual(cachedPlayers, players);
  assert.strictEqual(cachedAll, all);
  assert.notStrictEqual(players, all);
  assert.deepEqual(calls, ["players", "all"]);
  assert.equal(players.population, "players");
  assert.equal(all.population, "all");
  assert.deepEqual(players.coverage, { comprehensiveSince: "2026-08-25T14:30:00.000Z" });
});

test("coalesces only concurrent requests for the same population", async () => {
  const pending = new Map<StatsPopulation, (rows: unknown[]) => void>();
  const calls: StatsPopulation[] = [];
  const service = new DeathLeaderboardService((population) => {
    calls.push(population);
    return new Promise((resolve) => pending.set(population, resolve));
  });

  const firstPlayers = service.getLeaderboard("players");
  const secondPlayers = service.getLeaderboard("players");
  const all = service.getLeaderboard("all");
  assert.deepEqual(calls, ["players", "all"]);

  pending.get("players")?.([queryRow()]);
  pending.get("all")?.([queryRow({ isBot: 1 })]);
  const [firstResult, secondResult] = await Promise.all([firstPlayers, secondPlayers]);
  await all;
  assert.strictEqual(firstResult, secondResult);
});

test("returns failure instead of stale data after an expired refresh fails", async () => {
  let now = 0;
  let calls = 0;
  const service = new DeathLeaderboardService(async () => {
    calls += 1;
    if (calls === 1) {
      return [queryRow()];
    }
    throw new Error("database unavailable");
  }, () => now);

  await service.getLeaderboard("players");
  now = 60_001;

  await assert.rejects(() => service.getLeaderboard("players"), /database unavailable/u);
  assert.equal(calls, 2);
});
