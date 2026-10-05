import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProfessionalProcrastinatorQuery,
  mapProfessionalProcrastinatorRows,
  ProfessionalProcrastinatorContractIntegrityError,
  ProfessionalProcrastinatorService
} from "../src/services/professional-procrastinator.js";
import { fullVisibility, standardVisibility } from "./fixtures/account-visibility.js";

const config = { charactersDatabase: "acore_characters", authDatabase: "acore_auth" };
const contract = [{ firstRecordedAt: new Date("2026-01-01T00:00:00.000Z"), hasInvalidEvent: 0 }];
function row(overrides: Record<string, unknown> = {}) {
  return {
    characterName: "Thalgrim", raceId: 3, classId: 2, level: 80, accountLogin: "SHANE", isBot: 0,
    fromLevel: 42, toLevel: 43, startedAt: new Date("2026-09-01T12:00:00.000Z"),
    endedAt: new Date("2026-09-04T13:02:03.004Z"), durationMilliseconds: "262923004",
    ...overrides
  };
}

test("establishes complete-history adjacency before population and ranks longest stable personal records", () => {
  const players = buildProfessionalProcrastinatorQuery(config, "players", standardVisibility([19, 7]));
  const all = buildProfessionalProcrastinatorQuery(config, "all", fullVisibility);
  assert.match(players.sql, /LAG\(e\.id\) OVER event_order/u);
  assert.match(players.sql, /PARTITION BY e\.realm_id, e\.actor_guid[\s\S]+ORDER BY e\.event_time, e\.id/u);
  assert.match(players.sql, /candidate_intervals AS[\s\S]+previousActorIsBot = actor_is_bot/u);
  assert.match(players.sql, /previousValue2 = previousValue1 \+ 1[\s\S]+value2 = value1 \+ 1[\s\S]+previousValue2 = value1/u);
  assert.match(players.sql, /previousActorIsBot = actor_is_bot[\s\S]+AND actor_is_bot = 0 AND previousActorIsBot = 0/u);
  assert.doesNotMatch(all.sql, /AND actor_is_bot = 0/u);
  assert.match(players.sql, /c\.deleteDate IS NULL[\s\S]+c\.account NOT IN \(\?, \?\)[\s\S]+personal_records AS/u);
  assert.match(players.sql, /PARTITION BY realm_id, actor_guid, actor_is_bot[\s\S]+ORDER BY durationMilliseconds DESC, endedAt ASC, endEventId ASC/u);
  assert.match(players.sql, /WHERE personalRank = 1[\s\S]+ORDER BY durationMilliseconds DESC, endedAt ASC, characterName ASC,[\s\S]+actor_guid ASC/u);
  assert.match(players.sql, /LIMIT 25/u);
});

test("validates the level provider contract and chronological IDs", () => {
  const query = buildProfessionalProcrastinatorQuery(config, "all", fullVisibility);
  assert.deepEqual(query.contractValues, ["LEVEL_CHANGE", "level"]);
  assert.doesNotMatch(query.contractSql, /e\.\*/u);
  assert.match(query.contractSql, /target_type IS NULL OR target_type <> 0/u);
  assert.match(query.contractSql, /target_entry IS NULL OR target_entry <> 0/u);
  assert.match(query.contractSql, /target_guid IS NULL OR target_guid <> 0/u);
  assert.match(query.contractSql, /value1 IS NULL OR value1 < 1 OR value1 > 80/u);
  assert.match(query.contractSql, /value2 IS NULL OR value2 < 1 OR value2 > 80/u);
  assert.match(query.contractSql, /previousEventId IS NOT NULL AND previousEventId >= id/u);
});

test("maps multi-day and identical-time intervals without coercion", () => {
  assert.deepEqual(mapProfessionalProcrastinatorRows(contract, [row(), row({
    isBot: 1, fromLevel: 10, toLevel: 11,
    startedAt: "2026-09-05 12:00:00.000000", endedAt: "2026-09-05 12:00:00.000000",
    durationMilliseconds: 0
  })]), {
    coverage: { firstRecordedAt: "2026-01-01T00:00:00.000Z" }, entries: [
      { characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80, accountLogin: "SHANE",
        type: "Player", fromLevel: 42, toLevel: 43, startedAt: "2026-09-01T12:00:00.000Z",
        endedAt: "2026-09-04T13:02:03.004Z", durationMilliseconds: 262923004 },
      { characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80, accountLogin: "SHANE",
        type: "Bot", fromLevel: 10, toLevel: 11, startedAt: "2026-09-05T12:00:00.000Z",
        endedAt: "2026-09-05T12:00:00.000Z", durationMilliseconds: 0 }
    ]
  });
});

test("fails closed on contract, negative/unsafe time, malformed spans, and oversized results", () => {
  assert.throws(() => mapProfessionalProcrastinatorRows([{ ...contract[0], hasInvalidEvent: 1 }], [row()]), ProfessionalProcrastinatorContractIntegrityError);
  assert.throws(() => mapProfessionalProcrastinatorRows(contract, [row({ durationMilliseconds: -1 })]), /durationMilliseconds/u);
  assert.throws(() => mapProfessionalProcrastinatorRows(contract, [row({ durationMilliseconds: "9007199254740992" })]), /durationMilliseconds/u);
  assert.throws(() => mapProfessionalProcrastinatorRows(contract, [row({ toLevel: 44 })]), /interval/u);
  assert.throws(() => mapProfessionalProcrastinatorRows(contract, [row({ endedAt: new Date("2026-08-31T12:00:00Z") })]), /interval/u);
  assert.throws(() => mapProfessionalProcrastinatorRows(contract, Array.from({ length: 26 }, () => row())), /result/u);
});

test("caches independently by population and visibility", async () => {
  const calls: string[] = [];
  const service = new ProfessionalProcrastinatorService(async (population, visibility) => {
    calls.push(`${population}:${visibility.cacheKey}`);
    return { contractRows: contract, leaderboardRows: [row()] };
  }, () => 1_000);
  await service.getLeaderboard("players", fullVisibility);
  await service.getLeaderboard("players", fullVisibility);
  await service.getLeaderboard("all", fullVisibility);
  await service.getLeaderboard("players", standardVisibility([7]));
  assert.deepEqual(calls, ["players:full", "all:full", "players:standard"]);
});
