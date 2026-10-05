import { describe, expect, it } from "vitest";
import { formatQuestBingeDay } from "./QuestBingePanel.js";

describe("Quest Binge day formatting", () => {
  it("keeps the UTC calendar date regardless of local time zone", () => {
    const formatted = formatQuestBingeDay("2026-09-29");
    expect(formatted).toContain("2026");
    expect(formatted).toMatch(/29/u);
  });
});
