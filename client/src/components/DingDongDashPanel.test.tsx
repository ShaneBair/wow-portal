import { describe, expect, it } from "vitest";
import { formatDingDuration } from "./DingDongDashPanel.js";

describe("Ding Dong Dash duration formatting", () => {
  it("provides compact and exact accessible text", () => {
    expect(formatDingDuration(3_723_004)).toEqual({ compact: "1h 2m 3.004s", exact: "1 hour, 2 minutes, 3 seconds, 4 milliseconds" });
    expect(formatDingDuration(0)).toEqual({ compact: "0s", exact: "0 milliseconds" });
  });
  it("rejects invalid durations", () => {
    expect(() => formatDingDuration(-1)).toThrow();
    expect(() => formatDingDuration(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
});
