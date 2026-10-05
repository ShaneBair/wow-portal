import { describe, expect, it } from "vitest";
import { parseQuestBingeResponse } from "./quest-binge.js";

function response(overrides: Record<string, unknown> = {}) {
  return { generatedAt: "2026-10-01T15:42:00.000Z", population: "players",
    coverage: { firstRecordedAt: "2026-08-19T19:37:00.000Z" }, count: 1,
    entries: [{ characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80,
      accountLogin: "SHANE", type: "Player", day: "2026-09-29", questsCompleted: 12, uniqueQuests: 9 }],
    ...overrides };
}

describe("Quest Binge response parser", () => {
  it("accepts repeatable completion totals", () => {
    expect(parseQuestBingeResponse(response(), "players").entries[0]?.uniqueQuests).toBe(9);
  });
  it("rejects population, date, and impossible count data", () => {
    expect(() => parseQuestBingeResponse(response(), "all")).toThrow();
    expect(() => parseQuestBingeResponse(response({ entries: [{ ...response().entries[0], day: "2026-02-30" }] }), "players")).toThrow();
    expect(() => parseQuestBingeResponse(response({ entries: [{ ...response().entries[0], uniqueQuests: 13 }] }), "players")).toThrow();
  });
});
