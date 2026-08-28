import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { createStatsBossKillsRouter } from "../src/routes/stats-boss-kills.js";
import type { AccountVisibilityScope } from "../src/services/account-visibility.js";
import {
  BossKillContractIntegrityError,
  type BossKillLeaderboardResponse,
  type StatsPopulation
} from "../src/services/boss-kill-leaderboard.js";
import { attachVisibility, fullVisibility } from "./fixtures/account-visibility.js";

const noLimit: RequestHandler = (_request, _response, next) => next();

function result(population: StatsPopulation): BossKillLeaderboardResponse {
  return {
    generatedAt: "2026-08-28T12:00:00.000Z",
    population,
    coverage: { firstRecordedAt: "2026-08-19T19:37:22.256Z" },
    count: 1,
    entries: [{ characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80,
      accountLogin: "SHANE", isBot: false, bossKills: 12 }]
  };
}

async function requestRoute(
  query: string,
  load: (
    population: StatsPopulation,
    visibility: AccountVisibilityScope
  ) => Promise<BossKillLeaderboardResponse>,
  limiter: RequestHandler = noLimit
) {
  const app = express();
  app.use(createStatsBossKillsRouter(load, limiter, attachVisibility(fullVisibility)));
  const server = createServer(app);
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("Missing test port."));
      else resolve(address.port);
    });
  });
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/stats/boss-kills${query}`);
    return { response, body: await response.json() as unknown };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("defaults and accepts shared populations with no-store", async () => {
  for (const [query, population] of [["", "players"], ["?population=players", "players"], ["?population=all", "all"]] as const) {
    let received: StatsPopulation | undefined;
    const response = await requestRoute(query, async (value) => {
      received = value;
      return result(value);
    });
    assert.equal(response.response.status, 200);
    assert.equal(response.response.headers.get("cache-control"), "no-store");
    assert.equal(response.response.headers.get("vary"), "Cookie");
    assert.equal(received, population);
    assert.deepEqual(response.body, result(population));
  }
});

test("rejects invalid and repeated population before loading", async () => {
  for (const query of ["?population=bots", "?population=", "?population=players&population=all"]) {
    let called = false;
    const response = await requestRoute(query, async (population) => {
      called = true;
      return result(population);
    });
    assert.equal(response.response.status, 400);
    assert.deepEqual(response.body, { error: "Invalid population filter." });
    assert.equal(called, false);
  }
});

test("uses the shared limiter boundary", async () => {
  let called = false;
  const limiter: RequestHandler = (_request, response) => {
    response.status(429).json({ error: "Too many statistics requests. Try again shortly." });
  };
  const response = await requestRoute("", async (population) => {
    called = true;
    return result(population);
  }, limiter);
  assert.equal(response.response.status, 429);
  assert.equal(called, false);
});

test("redacts dependency and contract failures", async () => {
  const originalError = console.error;
  const logs: string[] = [];
  console.error = (message?: unknown) => logs.push(String(message));
  try {
    let response = await requestRoute("", async () => {
      throw new Error("world.private raw row password");
    });
    assert.equal(response.response.status, 503);
    assert.deepEqual(response.body, { error: "Boss kill statistics are temporarily unavailable." });
    assert.doesNotMatch(logs[0] ?? "", /world\.private|raw row|password/u);
    logs.length = 0;
    response = await requestRoute("", async () => { throw new BossKillContractIntegrityError(); });
    assert.equal(response.response.status, 503);
    assert.deepEqual(logs, ["Boss kill statistics provider contract integrity check failed."]);
  } finally {
    console.error = originalError;
  }
});
