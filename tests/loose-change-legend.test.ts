import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLooseChangeLegendQuery,
  formatLootedCopper,
  LooseChangeLegendService,
  mapLooseChangeLegendRows,
  readLootMoneyCriteriaId
} from "../src/services/loose-change-legend.js";
import { StatsDatabaseConfigurationError } from "../src/services/stats-database.js";
import { fullVisibility, standardVisibility } from "./fixtures/account-visibility.js";

const config = { charactersDatabase: "acore_characters", authDatabase: "acore_auth" };

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    characterName: "Thalgrim",
    raceId: 3,
    classId: 2,
    level: 80,
    accountLogin: "SHANE",
    copper: "123456",
    ...overrides
  };
}

test("requires the deployed DBC-verified Gold looted criterion without a default", () => {
  assert.equal(readLootMoneyCriteriaId({ STATS_LOOT_MONEY_CRITERIA_ID: "3354" }), 3354);
  for (const value of [
    undefined, "", "0", "-1", "1.5", "abc", "4093", "3361", "4294967296",
    "9007199254740993"
  ]) {
    const environment = value === undefined ? {} : { STATS_LOOT_MONEY_CRITERIA_ID: value };
    assert.throws(() => readLootMoneyCriteriaId(environment), StatsDatabaseConfigurationError);
  }
});

test("binds only criterion 3354 and filters live visible characters before ranking", () => {
  const query = buildLooseChangeLegendQuery(config, 3354, standardVisibility([19, 7]));
  assert.deepEqual(query.values, [3354, 7, 19]);
  assert.match(query.sql, /FROM `acore_characters`\.`character_achievement_progress` p/u);
  assert.match(query.sql, /JOIN `acore_characters`\.`characters` c ON c\.guid = p\.guid/u);
  assert.match(query.sql, /LEFT JOIN `acore_auth`\.`account` a ON a\.id = c\.account/u);
  assert.match(query.sql, /CAST\(p\.counter AS CHAR\) AS copper/u);
  assert.match(query.sql, /WHERE p\.criteria = \?\s+AND p\.counter > 0\s+AND c\.deleteDate IS NULL\s+AND c\.account NOT IN \(\?, \?\)/u);
  assert.match(query.sql, /ORDER BY p\.counter DESC, c\.name ASC, c\.guid ASC\s+LIMIT 25/u);
  assert.doesNotMatch(query.sql, /mod_player_stats_events|actor_is_bot|target_is_bot|money AS/u);
  for (const invalid of [0, 333, 3361, 4093]) {
    assert.throws(
      () => buildLooseChangeLegendQuery(config, invalid, fullVisibility),
      StatsDatabaseConfigurationError
    );
  }
});

test("formats exact unsigned copper across denomination and safe-number boundaries", () => {
  assert.equal(formatLootedCopper("1"), "0 gold, 0 silver, 1 copper");
  assert.equal(formatLootedCopper("99"), "0 gold, 0 silver, 99 copper");
  assert.equal(formatLootedCopper("100"), "0 gold, 1 silver, 0 copper");
  assert.equal(formatLootedCopper("9999"), "0 gold, 99 silver, 99 copper");
  assert.equal(formatLootedCopper("10000"), "1 gold, 0 silver, 0 copper");
  assert.equal(
    formatLootedCopper("9007199254740993"),
    "900719925474 gold, 9 silver, 93 copper"
  );
  assert.equal(
    formatLootedCopper("18446744073709551615"),
    "1844674407370955 gold, 16 silver, 15 copper"
  );
  for (const value of ["0", "01", "-1", "1.5", "18446744073709551616"]) {
    assert.throws(() => formatLootedCopper(value), /copper/u);
  }
});

test("maps current metadata and rejects counters coerced by the database driver", () => {
  assert.deepEqual(mapLooseChangeLegendRows([row()]), [{
    characterName: "Thalgrim",
    race: "Dwarf",
    class: "Paladin",
    level: 80,
    accountLogin: "SHANE",
    copper: "123456",
    displayMoney: "12 gold, 34 silver, 56 copper"
  }]);
  assert.deepEqual(mapLooseChangeLegendRows([]), []);
  assert.throws(() => mapLooseChangeLegendRows([row({ copper: 123456 })]), /copper/u);
  assert.throws(() => mapLooseChangeLegendRows([row({ copper: 123456n })]), /copper/u);
  assert.throws(() => mapLooseChangeLegendRows([row({ copper: "0" })]), /copper/u);
  assert.throws(() => mapLooseChangeLegendRows(Array.from({ length: 26 }, () => row())), /result/u);
});

test("caches by visibility and criterion ID and coalesces matching requests", async () => {
  let now = 1_000;
  let criterionId = 3354;
  const calls: string[] = [];
  let release: ((rows: unknown) => void) | undefined;
  const service = new LooseChangeLegendService((criterion, visibility) => {
    calls.push(`${visibility.cacheKey}:${criterion}`);
    return new Promise((resolve) => { release = resolve; });
  }, () => now, () => criterionId);
  const first = service.getLeaderboard(fullVisibility);
  const coalesced = service.getLeaderboard(fullVisibility);
  assert.equal(calls.length, 1);
  release?.([row()]);
  assert.equal(await first, await coalesced);
  await service.getLeaderboard(fullVisibility);
  assert.equal(calls.length, 1);

  const standard = service.getLeaderboard(standardVisibility());
  release?.([]);
  assert.equal((await standard).count, 0);
  criterionId = 4093;
  const differentCriterion = service.getLeaderboard(fullVisibility);
  release?.([row()]);
  await differentCriterion;
  assert.deepEqual(calls, ["full:3354", "standard:3354", "full:4093"]);

  criterionId = 3354;
  now += 60_000;
  const expired = service.getLeaderboard(fullVisibility);
  release?.([row()]);
  await expired;
  assert.deepEqual(calls, ["full:3354", "standard:3354", "full:4093", "full:3354"]);
});
