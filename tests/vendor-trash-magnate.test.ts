import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVendorTrashMagnateQuery,
  formatCopper,
  mapVendorTrashMagnateRows,
  readVendorMoneyCriteriaId,
  VendorTrashMagnateService
} from "../src/services/vendor-trash-magnate.js";
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

test("requires the explicit DBC-verified criterion ID without a default", () => {
  assert.equal(readVendorMoneyCriteriaId({ STATS_VENDOR_MONEY_CRITERIA_ID: "3361" }), 3361);
  for (const value of [
    undefined, "", "0", "-1", "1.5", "abc", "4091", "4294967296", "9007199254740993"
  ]) {
    const environment = value === undefined ? {} : { STATS_VENDOR_MONEY_CRITERIA_ID: value };
    assert.throws(() => readVendorMoneyCriteriaId(environment), StatsDatabaseConfigurationError);
  }
});

test("binds only the verified criterion and filters live visible characters before ranking", () => {
  const query = buildVendorTrashMagnateQuery(config, 3361, standardVisibility([19, 7]));
  assert.deepEqual(query.values, [3361, 7, 19]);
  assert.match(query.sql, /FROM `acore_characters`\.`character_achievement_progress` p/u);
  assert.match(query.sql, /JOIN `acore_characters`\.`characters` c ON c\.guid = p\.guid/u);
  assert.match(query.sql, /LEFT JOIN `acore_auth`\.`account` a ON a\.id = c\.account/u);
  assert.match(query.sql, /CAST\(p\.counter AS CHAR\) AS copper/u);
  assert.match(query.sql, /WHERE p\.criteria = \?\s+AND p\.counter > 0\s+AND c\.deleteDate IS NULL\s+AND c\.account NOT IN \(\?, \?\)/u);
  assert.match(query.sql, /ORDER BY p\.counter DESC, c\.name ASC, c\.guid ASC\s+LIMIT 25/u);
  assert.doesNotMatch(query.sql, /mod_player_stats_events|actor_is_bot|target_is_bot/u);
  assert.throws(
    () => buildVendorTrashMagnateQuery(config, 0, fullVisibility),
    StatsDatabaseConfigurationError
  );
});

test("formats exact unsigned copper strings across denomination and safe-number boundaries", () => {
  assert.equal(formatCopper("1"), "0 gold, 0 silver, 1 copper");
  assert.equal(formatCopper("99"), "0 gold, 0 silver, 99 copper");
  assert.equal(formatCopper("100"), "0 gold, 1 silver, 0 copper");
  assert.equal(formatCopper("9999"), "0 gold, 99 silver, 99 copper");
  assert.equal(formatCopper("10000"), "1 gold, 0 silver, 0 copper");
  assert.equal(
    formatCopper("9007199254740993"),
    "900719925474 gold, 9 silver, 93 copper"
  );
  assert.equal(
    formatCopper("18446744073709551615"),
    "1844674407370955 gold, 16 silver, 15 copper"
  );
  for (const value of ["0", "01", "-1", "1.5", "18446744073709551616"]) {
    assert.throws(() => formatCopper(value), /copper/u);
  }
});

test("maps current metadata and rejects any counter that crossed the driver as a number", () => {
  assert.deepEqual(mapVendorTrashMagnateRows([row()]), [{
    characterName: "Thalgrim",
    race: "Dwarf",
    class: "Paladin",
    level: 80,
    accountLogin: "SHANE",
    copper: "123456",
    displayMoney: "12 gold, 34 silver, 56 copper"
  }]);
  assert.deepEqual(mapVendorTrashMagnateRows([]), []);
  assert.throws(() => mapVendorTrashMagnateRows([row({ copper: 123456 })]), /copper/u);
  assert.throws(() => mapVendorTrashMagnateRows([row({ copper: 123456n })]), /copper/u);
  assert.throws(() => mapVendorTrashMagnateRows([row({ copper: "0" })]), /copper/u);
  assert.throws(() => mapVendorTrashMagnateRows(Array.from({ length: 26 }, () => row())), /result/u);
});

test("caches by visibility and criterion ID and coalesces matching requests", async () => {
  let now = 1_000;
  let criterionId = 3361;
  const calls: string[] = [];
  let release: ((rows: unknown) => void) | undefined;
  const service = new VendorTrashMagnateService((criterion, visibility) => {
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
  criterionId = 4091;
  const differentCriterion = service.getLeaderboard(fullVisibility);
  release?.([row()]);
  await differentCriterion;
  assert.deepEqual(calls, ["full:3361", "standard:3361", "full:4091"]);

  criterionId = 3361;
  now += 60_000;
  const expired = service.getLeaderboard(fullVisibility);
  release?.([row()]);
  await expired;
  assert.deepEqual(calls, ["full:3361", "standard:3361", "full:4091", "full:3361"]);
});
