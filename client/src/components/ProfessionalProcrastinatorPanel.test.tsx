import { describe, expect, it } from "vitest";
import { formatProcrastinationDuration } from "./ProfessionalProcrastinatorPanel.js";

describe("Professional Procrastinator duration formatting", () => {
  it("provides compact and exact screen-reader durations", () => {
    expect(formatProcrastinationDuration(262923004)).toEqual({
      compact: "3d 1h 2m 3.004s",
      exact: "3 days, 1 hour, 2 minutes, 3 seconds, 4 milliseconds"
    });
    expect(formatProcrastinationDuration(0)).toEqual({ compact: "0s", exact: "0 milliseconds" });
  });
  it("rejects negative and unsafe durations", () => {
    expect(() => formatProcrastinationDuration(-1)).toThrow();
    expect(() => formatProcrastinationDuration(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
});
