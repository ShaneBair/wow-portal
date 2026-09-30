import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { createStatsPetKillsRouter } from "../src/routes/stats-pet-kills.js";
import type { AccountVisibilityScope } from "../src/services/account-visibility.js";
import type { PetKillResponse, StatsPopulation } from "../src/services/pet-kills.js";
import { attachVisibility, fullVisibility } from "./fixtures/account-visibility.js";

const noLimit: RequestHandler = (_request, _response, next) => next();

function result(population: StatsPopulation): PetKillResponse {
  return {
    generatedAt: "2026-09-30T20:00:00.000Z",
    population,
    coverage: { firstRecordedAt: "2026-08-01T12:00:00.000Z" },
    count: 1,
    entries: [{
      characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80,
      accountLogin: "SHANE", type: "Player", petKills: 7, directKills: 4,
      totalKills: 11, petKillPercent: 63.6
    }]
  };
}

async function requestRoute(
  query: string,
  load: (
    population: StatsPopulation,
    visibility: AccountVisibilityScope
  ) => Promise<PetKillResponse>,
  limiter: RequestHandler = noLimit
) {
  const app = express();
  app.use(createStatsPetKillsRouter(load, limiter, attachVisibility(fullVisibility)));
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
    const response = await fetch(`http://127.0.0.1:${port}/api/stats/pet-kills${query}`);
    return { response, body: await response.json() as unknown };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("defaults population and sets private response headers", async () => {
  for (const [query, population] of [["", "players"], ["?population=all", "all"]] as const) {
    const received = await requestRoute(query, async (value, visibility) => {
      assert.equal(visibility, fullVisibility);
      return result(value);
    });
    assert.equal(received.response.status, 200);
    assert.equal(received.response.headers.get("cache-control"), "no-store");
    assert.equal(received.response.headers.get("vary"), "Cookie");
    assert.deepEqual(received.body, result(population));
  }
});

test("rejects invalid population and sanitizes failures", async () => {
  let calls = 0;
  for (const query of ["?population=bots", "?population=", "?population=players&population=all"]) {
    const invalid = await requestRoute(query, async (population) => {
      calls += 1;
      return result(population);
    });
    assert.equal(invalid.response.status, 400);
  }
  assert.equal(calls, 0);
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const failed = await requestRoute("", async () => {
      throw new Error("secret database host and event row");
    });
    assert.equal(failed.response.status, 503);
    assert.deepEqual(failed.body, { error: "Pet kill statistics are temporarily unavailable." });
    assert.doesNotMatch(JSON.stringify(failed.body), /secret|database host|event row/u);
  } finally {
    console.error = originalError;
  }
});

test("uses the shared limiter before loading", async () => {
  let loaded = false;
  const limited = await requestRoute("", async (population) => {
    loaded = true;
    return result(population);
  }, (_request, response) => response.status(429).json({ error: "Too many statistics requests." }));
  assert.equal(limited.response.status, 429);
  assert.equal(loaded, false);
});
