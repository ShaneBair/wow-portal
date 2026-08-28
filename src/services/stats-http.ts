import rateLimit from "express-rate-limit";
import type { StatsPopulation } from "./death-leaderboard.js";

export const statsReadLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({ error: "Too many statistics requests. Try again shortly." });
  }
});

export function parseStatsPopulation(value: unknown): StatsPopulation | undefined {
  if (value === undefined) return "players";
  if (value === "players" || value === "all") return value;
  return undefined;
}
