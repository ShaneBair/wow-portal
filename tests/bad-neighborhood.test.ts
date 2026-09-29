import assert from "node:assert/strict";
import test from "node:test";
import { WOTLK_ZONE_CATALOG } from "../src/data/wotlk-area-zones.js";
import {
  BadNeighborhoodCatalogError,
  BadNeighborhoodContractIntegrityError,
  BadNeighborhoodService,
  buildBadNeighborhoodQuery,
  mapBadNeighborhoodQueryRows,
  resolveWotlkZoneName,
  type StatsPopulation
} from "../src/services/bad-neighborhood.js";
import { fullVisibility, standardVisibility } from "./fixtures/account-visibility.js";

const config = { charactersDatabase: "acore_characters" };

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cutoverCount: 1,
    cutoffEventId: "500",
    comprehensiveSince: new Date("2026-08-25T14:30:00.000Z"),
    hasInvalidCanonical: 0,
    omittedUnknownZoneDeaths: "3",
    zoneId: 12,
    deaths: "14",
    uniqueVictims: "4",
    ...overrides
  };
}

test("builds a bounded canonical query with pre-aggregation privacy and population filters", () => {
  const players = buildBadNeighborhoodQuery(config, "players", standardVisibility([19, 7]));
  const all = buildBadNeighborhoodQuery(config, "all", fullVisibility);
  assert.deepEqual(players.values, [
    "canonical_player_death_v1", "canonical", "PLAYER_DEATH", "PLAYER_DEATH", 7, 19
  ]);
  assert.match(players.sql, /FROM `acore_characters`\.`mod_player_stats_migrations`/u);
  assert.match(players.sql, /e\.id <= x\.cutoffEventId/u);
  assert.match(players.sql, /e\.id > x\.cutoffEventId/u);
  assert.match(players.sql, /e\.source IS NULL OR e\.source <> \?/u);
  assert.match(players.sql, /e\.target_type IS NULL OR e\.target_type <> 0/u);
  assert.match(players.sql, /e\.target_entry IS NULL OR e\.target_entry <> 0/u);
  assert.match(players.sql, /e\.target_guid IS NULL OR e\.target_guid <> 0/u);
  assert.match(players.sql, /e\.target_is_bot IS NULL OR e\.target_is_bot <> 0/u);
  assert.match(players.sql, /e\.value1 IS NULL OR e\.value1 <> 0/u);
  assert.match(players.sql, /e\.value2 IS NULL OR e\.value2 <> 0/u);
  assert.match(players.sql, /e\.realm_id IS NULL OR e\.realm_id = 0/u);
  assert.match(players.sql, /e\.actor_account_id IS NULL OR e\.actor_account_id = 0/u);
  assert.match(players.sql, /e\.actor_guid IS NULL OR e\.actor_guid = 0/u);
  assert.match(players.sql, /AND e\.actor_is_bot = 0[\s\S]+AND e\.actor_account_id NOT IN \(\?, \?\)/u);
  assert.doesNotMatch(all.sql, /AND e\.actor_is_bot = 0/u);
  assert.match(players.sql, /COUNT\(DISTINCT realm_id, actor_guid\) AS uniqueVictims/u);
  assert.match(players.sql, /WHERE zone_id > 0/u);
  assert.match(players.sql, /SUM\(zone_id = 0\)/u);
  assert.match(players.sql, /ORDER BY z\.deaths DESC, z\.uniqueVictims DESC,[\s\S]+z\.zoneId ASC\s+LIMIT 25/u);
  assert.doesNotMatch(players.sql, /JOIN\s+`[^`]+`\.`characters`|creature_template|AreaTable/u);
});

test("resolves every checked-in zone and retains the positive-ID fallback", () => {
  assert.equal(WOTLK_ZONE_CATALOG.length, 220);
  for (const [zoneId, zoneName] of WOTLK_ZONE_CATALOG) {
    assert.equal(resolveWotlkZoneName(zoneId), zoneName, `zone ${zoneId}`);
  }
  assert.equal(resolveWotlkZoneName(999_999), "Unknown zone #999999");
  assert.throws(
    () => resolveWotlkZoneName(1, [[1, "Dun Morogh"], [1, "Duplicate"]]),
    BadNeighborhoodCatalogError
  );
});

test("maps coverage, unknown zones, omissions, and safe counts", () => {
  assert.deepEqual(mapBadNeighborhoodQueryRows([
    row(),
    row({ zoneId: 999_999, deaths: 8, uniqueVictims: "2" })
  ]), {
    coverage: { comprehensiveSince: "2026-08-25T14:30:00.000Z" },
    omittedUnknownZoneDeaths: 3,
    entries: [
      { zoneId: 12, zoneName: "Elwynn Forest", deaths: 14, uniqueVictims: 4 },
      { zoneId: 999_999, zoneName: "Unknown zone #999999", deaths: 8, uniqueVictims: 2 }
    ]
  });
  assert.deepEqual(mapBadNeighborhoodQueryRows([row({
    zoneId: null, deaths: null, uniqueVictims: null, omittedUnknownZoneDeaths: 5
  })]).entries, []);
  assert.throws(
    () => mapBadNeighborhoodQueryRows([row({ hasInvalidCanonical: 1 })]),
    BadNeighborhoodContractIntegrityError
  );
  assert.throws(() => mapBadNeighborhoodQueryRows([row({ cutoverCount: 0 })]), /cutover/u);
  assert.throws(() => mapBadNeighborhoodQueryRows([row({ zoneId: 0 })]), /zoneId/u);
  assert.throws(() => mapBadNeighborhoodQueryRows([row({ deaths: Number.MAX_SAFE_INTEGER + 1 })]), /deaths/u);
});

test("caches independently by population and visibility and coalesces requests", async () => {
  let now = 1_000;
  const calls: string[] = [];
  let release: ((rows: unknown) => void) | undefined;
  const service = new BadNeighborhoodService((population, visibility) => {
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
