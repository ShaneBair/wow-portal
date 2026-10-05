import { describe, expect, it } from "vitest";
import { parseViolenceSpeedrunResponse } from "./violence-speedrun.js";

function response(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-09-30T13:42:17.000Z", population: "players",
    coverage: { firstRecordedAt: "2026-01-01T00:00:00.000Z" }, count: 1,
    entries: [{
      characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80,
      accountLogin: "SHANE", type: "Player", bucketStart: "2026-09-30T12:00:00.000Z",
      bucketEnd: "2026-09-30T13:00:00.000Z", kills: 12, directKills: 8, petKills: 4
    }],
    ...overrides
  };
}

describe("Violence Speedrun response parser", () => {
  it("accepts a consistent completed UTC hour", () => {
    expect(parseViolenceSpeedrunResponse(response(), "players").entries[0]?.kills).toBe(12);
  });

  it("fails closed on population, totals, and non-hour boundaries", () => {
    expect(() => parseViolenceSpeedrunResponse(response(), "all")).toThrow();
    expect(() => parseViolenceSpeedrunResponse(response({ entries: [{
      ...response().entries[0], directKills: 9
    }] }), "players")).toThrow();
    expect(() => parseViolenceSpeedrunResponse(response({ entries: [{
      ...response().entries[0], bucketStart: "2026-09-30T12:59:59.000Z"
    }] }), "players")).toThrow();
  });
});
