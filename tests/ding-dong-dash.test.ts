import assert from "node:assert/strict";
import test from "node:test";
import { buildDingDongDashQuery, DingDongDashService } from "../src/services/ding-dong-dash.js";
import { mapProfessionalProcrastinatorRows, ProfessionalProcrastinatorContractIntegrityError } from "../src/services/professional-procrastinator.js";
import { fullVisibility, standardVisibility } from "./fixtures/account-visibility.js";

const config = { charactersDatabase: "acore_characters", authDatabase: "acore_auth" };
const contract = [{ firstRecordedAt: new Date("2026-01-01T00:00:00.000Z"), hasInvalidEvent: 0 }];
function row(overrides: Record<string, unknown> = {}) {
  return { characterName: "Thalgrim", raceId: 3, classId: 2, level: 80, accountLogin: "SHANE", isBot: 0,
    fromLevel: 42, toLevel: 43, startedAt: new Date("2026-09-01T12:00:00.000Z"),
    endedAt: new Date("2026-09-01T12:00:01.234Z"), durationMilliseconds: "1234", ...overrides };
}

test("establishes adjacency before population and ranks shortest intervals with stable ties", () => {
  const players = buildDingDongDashQuery(config, "players", standardVisibility([19, 7]));
  const all = buildDingDongDashQuery(config, "all", fullVisibility);
  assert.match(players.sql, /LAG\(e\.id\) OVER event_order/u);
  assert.match(players.sql, /PARTITION BY e\.realm_id, e\.actor_guid[\s\S]+ORDER BY e\.event_time, e\.id/u);
  assert.match(players.sql, /previousValue2 = previousValue1 \+ 1[\s\S]+value2 = value1 \+ 1[\s\S]+previousValue2 = value1/u);
  assert.match(players.sql, /previousActorIsBot = actor_is_bot[\s\S]+AND actor_is_bot = 0 AND previousActorIsBot = 0/u);
  assert.doesNotMatch(all.sql, /AND actor_is_bot = 0/u);
  assert.match(players.sql, /c\.deleteDate IS NULL[\s\S]+c\.account NOT IN \(\?, \?\)[\s\S]+personal_records AS/u);
  assert.match(players.sql, /ORDER BY durationMilliseconds ASC, toLevel DESC, endedAt ASC, endEventId ASC/u);
  assert.match(players.sql, /WHERE personalRank = 1[\s\S]+ORDER BY durationMilliseconds ASC, toLevel DESC, endedAt ASC, characterName ASC, actor_guid ASC/u);
  assert.match(players.sql, /LIMIT 25/u);
});

test("shares the strict level contract and maps millisecond-precise zero and positive intervals", () => {
  const query = buildDingDongDashQuery(config, "all", fullVisibility);
  assert.deepEqual(query.contractValues, ["LEVEL_CHANGE", "level"]);
  assert.match(query.contractSql, /target_guid IS NULL OR target_guid <> 0/u);
  assert.match(query.contractSql, /value1 IS NULL OR value1 < 1 OR value1 > 80/u);
  assert.deepEqual(mapProfessionalProcrastinatorRows(contract, [row(), row({
    isBot: 1, fromLevel: 11, toLevel: 12,
    startedAt: new Date("2026-09-02T12:00:00Z"), endedAt: new Date("2026-09-02T12:00:00Z"), durationMilliseconds: 0
  })]).entries.map(({ type, fromLevel, toLevel, durationMilliseconds }) => ({ type, fromLevel, toLevel, durationMilliseconds })), [
    { type: "Player", fromLevel: 42, toLevel: 43, durationMilliseconds: 1234 },
    { type: "Bot", fromLevel: 11, toLevel: 12, durationMilliseconds: 0 }
  ]);
});

test("rejects contract corruption, negative/unsafe durations, broken spans, and oversized results", () => {
  assert.throws(() => mapProfessionalProcrastinatorRows([{ ...contract[0], hasInvalidEvent: 1 }], [row()]), ProfessionalProcrastinatorContractIntegrityError);
  assert.throws(() => mapProfessionalProcrastinatorRows(contract, [row({ durationMilliseconds: -1 })]), /durationMilliseconds/u);
  assert.throws(() => mapProfessionalProcrastinatorRows(contract, [row({ durationMilliseconds: "9007199254740992" })]), /durationMilliseconds/u);
  assert.throws(() => mapProfessionalProcrastinatorRows(contract, [row({ toLevel: 44 })]), /interval/u);
  assert.throws(() => mapProfessionalProcrastinatorRows(contract, Array.from({ length: 26 }, () => row())), /result/u);
});

test("separates population and visibility caches", async () => {
  const calls: string[] = [];
  const service = new DingDongDashService(async (population, visibility) => {
    calls.push(`${population}:${visibility.cacheKey}`); return { contractRows: contract, leaderboardRows: [row()] };
  }, () => 1_000);
  await service.getLeaderboard("players", fullVisibility);
  await service.getLeaderboard("players", fullVisibility);
  await service.getLeaderboard("all", fullVisibility);
  await service.getLeaderboard("players", standardVisibility([7]));
  assert.deepEqual(calls, ["players:full", "all:full", "players:standard"]);
});
