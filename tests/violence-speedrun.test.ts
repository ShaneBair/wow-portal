import assert from "node:assert/strict";
import test from "node:test";
import {
  buildViolenceSpeedrunQuery, completedUtcHour, mapViolenceSpeedrunRows,
  ViolenceSpeedrunContractIntegrityError, ViolenceSpeedrunService
} from "../src/services/violence-speedrun.js";
import { fullVisibility, standardVisibility } from "./fixtures/account-visibility.js";

const config = { charactersDatabase: "acore_characters", authDatabase: "acore_auth" };
function row(overrides: Record<string, unknown> = {}) {
  return {
    firstRecordedAt: new Date("2026-01-01T00:00:00.000Z"), hasInvalidEvent: 0,
    characterName: "Thalgrim", raceId: 3, classId: 2, level: 80, accountLogin: "SHANE",
    isBot: 0, bucketStart: new Date("2026-09-30T12:00:00.000Z"),
    bucketEnd: new Date("2026-09-30T13:00:00.000Z"), kills: "12", directKills: "8", petKills: "4",
    ...overrides
  };
}

test("builds fixed UTC hours, excludes the active hour, and selects one stable personal record", () => {
  const cutoff = new Date("2026-09-30T13:00:00.000Z");
  const query = buildViolenceSpeedrunQuery(config, "players", standardVisibility([19, 7]), cutoff);
  assert.match(query.sql, /DATE_FORMAT\(CONVERT_TZ\(e\.event_time, '\+00:00', '\+00:00'\), '%Y-%m-%d %H:00:00'\)/u);
  assert.match(query.sql, /e\.event_time < \?/u);
  assert.match(query.contractSql, /e\.target_entry IS NULL OR e\.target_entry <= 0/u);
  assert.doesNotMatch(query.sql, /FORCE INDEX/u);
  assert.match(query.sql, /AND e\.actor_is_bot = 0/u);
  assert.match(query.sql, /c\.deleteDate IS NULL[\s\S]+c\.account NOT IN \(\?, \?\)[\s\S]+hourly AS/u);
  assert.match(query.sql, /PARTITION BY realm_id, actor_guid, actor_is_bot[\s\S]+ORDER BY kills DESC, bucketStart ASC/u);
  assert.match(query.sql, /WHERE personalRank = 1[\s\S]+ORDER BY kills DESC, bucketStart ASC, characterName ASC, actor_guid ASC/u);
  assert.match(query.sql, /LIMIT 25/u);
  assert.equal(query.values.includes(cutoff), true);
  const all = buildViolenceSpeedrunQuery(config, "all", fullVisibility, cutoff);
  assert.doesNotMatch(all.sql, /AND e\.actor_is_bot = 0/u);
  assert.match(all.sql, /FORCE INDEX \(idx_event_type_time\)/u);
});

test("uses UTC hour boundaries independently of local DST", () => {
  assert.equal(completedUtcHour(Date.parse("2026-03-08T06:59:59.999Z")).toISOString(), "2026-03-08T06:00:00.000Z");
  assert.equal(completedUtcHour(Date.parse("2026-03-08T07:00:00.000Z")).toISOString(), "2026-03-08T07:00:00.000Z");
  assert.equal(completedUtcHour(Date.parse("2026-11-01T05:30:00.000Z")).toISOString(), "2026-11-01T05:00:00.000Z");
});

test("maps control types and validates contract, bucket, and kill totals", () => {
  const contract = [{ firstRecordedAt: new Date("2026-01-01T00:00:00.000Z"), hasInvalidEvent: 0 }];
  assert.deepEqual(mapViolenceSpeedrunRows(contract, [row(), row({ isBot: 1, kills: 3, directKills: 0, petKills: 3 })]), {
    coverage: { firstRecordedAt: "2026-01-01T00:00:00.000Z" }, entries: [
      { characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80, accountLogin: "SHANE",
        type: "Player", bucketStart: "2026-09-30T12:00:00.000Z", bucketEnd: "2026-09-30T13:00:00.000Z",
        kills: 12, directKills: 8, petKills: 4 },
      { characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80, accountLogin: "SHANE",
        type: "Bot", bucketStart: "2026-09-30T12:00:00.000Z", bucketEnd: "2026-09-30T13:00:00.000Z",
        kills: 3, directKills: 0, petKills: 3 }
    ]
  });
  assert.throws(() => mapViolenceSpeedrunRows([{ ...contract[0], hasInvalidEvent: 1 }], [row()]), ViolenceSpeedrunContractIntegrityError);
  assert.throws(() => mapViolenceSpeedrunRows(contract, [row({ kills: 11 })]), /totals/u);
  assert.throws(() => mapViolenceSpeedrunRows(contract, [row({ bucketEnd: new Date("2026-09-30T14:00:00Z") })]), /bucket/u);
});

test("passes a frozen completed-hour cutoff and isolates population and visibility caches", async () => {
  const calls: string[] = [];
  const service = new ViolenceSpeedrunService(async (population, visibility, cutoff) => {
    calls.push(`${population}:${visibility.cacheKey}:${cutoff.toISOString()}`);
    return {
      contractRows: [{ firstRecordedAt: new Date("2026-01-01T00:00:00.000Z"), hasInvalidEvent: 0 }],
      leaderboardRows: [row()]
    };
  }, () => Date.parse("2026-09-30T13:42:17.000Z"));
  await service.getLeaderboard("players", fullVisibility);
  await service.getLeaderboard("players", fullVisibility);
  await service.getLeaderboard("all", fullVisibility);
  await service.getLeaderboard("players", standardVisibility([7]));
  assert.deepEqual(calls, [
    "players:full:2026-09-30T13:00:00.000Z", "all:full:2026-09-30T13:00:00.000Z",
    "players:standard:2026-09-30T13:00:00.000Z"
  ]);
});
