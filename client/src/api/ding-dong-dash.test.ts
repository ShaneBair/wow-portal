import { describe, expect, it } from "vitest";
import { parseDingDongDashResponse } from "./ding-dong-dash.js";

function response(overrides: Record<string, unknown> = {}) {
  return { generatedAt: "2026-10-01T15:42:00.000Z", population: "players",
    coverage: { firstRecordedAt: "2026-01-01T00:00:00.000Z" }, count: 1,
    entries: [{ characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80,
      accountLogin: "SHANE", type: "Player", fromLevel: 42, toLevel: 43,
      startedAt: "2026-09-01T12:00:00.000Z", endedAt: "2026-09-01T12:00:01.234Z", durationMilliseconds: 1234 }],
    ...overrides };
}
describe("Ding Dong Dash response parser", () => {
  it("accepts exact millisecond intervals", () => {
    expect(parseDingDongDashResponse(response(), "players").entries[0]?.durationMilliseconds).toBe(1234);
  });
  it("rejects population, level-chain, and duration inconsistencies", () => {
    expect(() => parseDingDongDashResponse(response(), "all")).toThrow();
    expect(() => parseDingDongDashResponse(response({ entries: [{ ...response().entries[0], toLevel: 44 }] }), "players")).toThrow();
    expect(() => parseDingDongDashResponse(response({ entries: [{ ...response().entries[0], durationMilliseconds: 1235 }] }), "players")).toThrow();
  });
});
