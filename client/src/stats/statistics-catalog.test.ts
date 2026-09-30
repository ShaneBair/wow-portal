import { describe, expect, it } from "vitest";
import {
  getStatisticCategory,
  ORDERED_STATISTICS,
  STATISTICS_CATALOG,
  validateStatisticsCatalog
} from "./statistics-catalog.js";

describe("statistics catalog", () => {
  it("contains only valid, unique, deterministically ordered entries", () => {
    expect(validateStatisticsCatalog()).toEqual([]);
    expect(new Set(STATISTICS_CATALOG.map((statistic) => statistic.slug)).size).toBe(STATISTICS_CATALOG.length);
    expect(new Set(STATISTICS_CATALOG.map((statistic) => statistic.title.toLocaleLowerCase())).size)
      .toBe(STATISTICS_CATALOG.length);
    expect(ORDERED_STATISTICS.map((statistic) => statistic.slug)).toEqual([
      "server-mvp", "public-enemy", "gotta-kill-em-all", "let-the-pet-cook", "punching-up",
      "most-deaths", "bad-neighborhood", "real-raid-boss",
      "completionist", "touching-grass", "vendor-trash-magnate", "loose-change-legend", "bot-wrangler"
    ]);
  });

  it("registers categories and population modes for every implemented statistic", () => {
    expect(STATISTICS_CATALOG).toHaveLength(13);
    for (const statistic of STATISTICS_CATALOG) {
      expect(getStatisticCategory(statistic.category).id).toBe(statistic.category);
      expect(["event", "all-characters", "human-vs-bot"]).toContain(statistic.populationMode);
    }
  });
});
