import { describe, expect, it } from "vitest";
import { parseProfessionalProcrastinatorResponse } from "./professional-procrastinator.js";

function response(overrides: Record<string, unknown> = {}) {
  return { generatedAt: "2026-09-30T22:00:00.000Z", population: "players",
    coverage: { firstRecordedAt: "2026-01-01T00:00:00.000Z" }, count: 1,
    entries: [{ characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80,
      accountLogin: "SHANE", type: "Player", fromLevel: 42, toLevel: 43,
      startedAt: "2026-09-01T12:00:00.000Z", endedAt: "2026-09-04T13:02:03.004Z",
      durationMilliseconds: 262923004 }], ...overrides };
}

describe("Professional Procrastinator response parser", () => {
  it("accepts an exact multi-day interval", () => {
    expect(parseProfessionalProcrastinatorResponse(response(), "players").entries[0]?.durationMilliseconds).toBe(262923004);
  });
  it("rejects population, chain, and duration inconsistencies", () => {
    expect(() => parseProfessionalProcrastinatorResponse(response(), "all")).toThrow();
    expect(() => parseProfessionalProcrastinatorResponse(response({ entries: [{ ...response().entries[0], toLevel: 44 }] }), "players")).toThrow();
    expect(() => parseProfessionalProcrastinatorResponse(response({ entries: [{ ...response().entries[0], durationMilliseconds: 1 }] }), "players")).toThrow();
  });
});
