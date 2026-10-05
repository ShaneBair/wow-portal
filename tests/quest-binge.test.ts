import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQuestBingeQuery, currentUtcDayStart, mapQuestBingeRows,
  QuestBingeContractIntegrityError, QuestBingeService
} from "../src/services/quest-binge.js";
import { fullVisibility, standardVisibility } from "./fixtures/account-visibility.js";

const config = { charactersDatabase: "acore_characters", authDatabase: "acore_auth" };
const contract = [{ firstRecordedAt: new Date("2026-08-19T19:37:00.000Z"), hasInvalidEvent: 0 }];
function row(overrides: Record<string, unknown> = {}) {
  return { characterName: "Thalgrim", raceId: 3, classId: 2, level: 80, accountLogin: "SHANE",
    isBot: 0, day: "2026-09-29", questsCompleted: "12", uniqueQuests: "9", ...overrides };
}

test("groups valid visible events into completed UTC days and selects stable personal records", () => {
  const cutoff = new Date("2026-10-01T00:00:00.000Z");
  const players = buildQuestBingeQuery(config, "players", standardVisibility([19, 7]), cutoff);
  const all = buildQuestBingeQuery(config, "all", fullVisibility, cutoff);
  assert.match(players.sql, /DATE\(CONVERT_TZ\(e\.event_time, '\+00:00', '\+00:00'\)\) AS day/u);
  assert.match(players.sql, /e\.event_time IS NOT NULL AND e\.event_time < \?/u);
  assert.match(players.sql, /COUNT\(\*\) AS questsCompleted/u);
  assert.match(players.sql, /COUNT\(DISTINCT target_entry\) AS uniqueQuests/u);
  assert.match(players.sql, /AND e\.actor_is_bot = 0[\s\S]+AND c\.account NOT IN \(\?, \?\)[\s\S]+daily_totals AS/u);
  assert.doesNotMatch(all.sql, /AND e\.actor_is_bot = 0/u);
  assert.doesNotMatch(players.sql, /FORCE INDEX/u);
  assert.match(all.sql, /FORCE INDEX \(idx_bot_event_time\)/u);
  assert.doesNotMatch(players.sql, /FORCE INDEX/u);
  assert.match(all.sql, /FORCE INDEX \(idx_bot_event_time\)/u);
  assert.match(players.sql, /PARTITION BY realm_id, actor_guid, actor_is_bot[\s\S]+ORDER BY questsCompleted DESC, uniqueQuests DESC, day ASC/u);
  assert.match(players.sql, /WHERE personalRank = 1[\s\S]+ORDER BY questsCompleted DESC, uniqueQuests DESC, day ASC,[\s\S]+characterName ASC, actor_guid ASC/u);
  assert.match(players.sql, /LIMIT 25/u);
  assert.equal(players.values.includes(cutoff), true);
});

test("validates the exact quest event contract", () => {
  const query = buildQuestBingeQuery(config, "all", fullVisibility, new Date("2026-10-01T00:00:00Z"));
  assert.deepEqual(query.contractValues, [4, "quest", "QUEST_COMPLETE"]);
  assert.match(query.contractSql, /target_type IS NULL OR e\.target_type <> \?/u);
  assert.match(query.contractSql, /target_entry IS NULL OR e\.target_entry <= 0/u);
  assert.match(query.contractSql, /target_guid IS NULL OR e\.target_guid <> 0/u);
  assert.match(query.contractSql, /target_is_bot IS NULL OR e\.target_is_bot <> 0/u);
  assert.match(query.contractSql, /value1 IS NULL OR e\.value1 <> 0/u);
  assert.match(query.contractSql, /value2 IS NULL OR e\.value2 <> 0/u);
});

test("uses UTC midnight boundaries independently of local time", () => {
  assert.equal(currentUtcDayStart(Date.parse("2026-09-30T23:59:59.999Z")).toISOString(), "2026-09-30T00:00:00.000Z");
  assert.equal(currentUtcDayStart(Date.parse("2026-10-01T00:00:00.000Z")).toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(currentUtcDayStart(Date.parse("2026-11-01T05:30:00.000Z")).toISOString(), "2026-11-01T00:00:00.000Z");
});

test("maps repeatable completion and unique quest counts separately", () => {
  assert.deepEqual(mapQuestBingeRows(contract, [row(), row({ isBot: 1, day: new Date("2026-09-28T00:00:00Z"), questsCompleted: 7, uniqueQuests: 7 })]), {
    coverage: { firstRecordedAt: "2026-08-19T19:37:00.000Z" }, entries: [
      { characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80, accountLogin: "SHANE",
        type: "Player", day: "2026-09-29", questsCompleted: 12, uniqueQuests: 9 },
      { characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80, accountLogin: "SHANE",
        type: "Bot", day: "2026-09-28", questsCompleted: 7, uniqueQuests: 7 }
    ]
  });
});

test("fails closed on contract corruption, malformed days, impossible totals, and oversized results", () => {
  assert.throws(() => mapQuestBingeRows([{ ...contract[0], hasInvalidEvent: 1 }], [row()]), QuestBingeContractIntegrityError);
  assert.throws(() => mapQuestBingeRows(contract, [row({ day: "2026-02-30" })]), /day/u);
  assert.throws(() => mapQuestBingeRows(contract, [row({ uniqueQuests: 13 })]), /totals/u);
  assert.throws(() => mapQuestBingeRows(contract, [row({ questsCompleted: -1 })]), /questsCompleted/u);
  assert.throws(() => mapQuestBingeRows(contract, Array.from({ length: 26 }, () => row())), /result/u);
});

test("freezes the cutoff and isolates population and visibility caches", async () => {
  const calls: string[] = [];
  const service = new QuestBingeService(async (population, visibility, cutoff) => {
    calls.push(`${population}:${visibility.cacheKey}:${cutoff.toISOString()}`);
    return { contractRows: contract, leaderboardRows: [row()] };
  }, () => Date.parse("2026-10-01T15:42:00.000Z"));
  await service.getLeaderboard("players", fullVisibility);
  await service.getLeaderboard("players", fullVisibility);
  await service.getLeaderboard("all", fullVisibility);
  await service.getLeaderboard("players", standardVisibility([7]));
  assert.deepEqual(calls, [
    "players:full:2026-10-01T00:00:00.000Z", "all:full:2026-10-01T00:00:00.000Z",
    "players:standard:2026-10-01T00:00:00.000Z"
  ]);
});
