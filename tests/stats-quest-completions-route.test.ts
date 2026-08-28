import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { createStatsQuestCompletionsRouter } from "../src/routes/stats-quest-completions.js";
import {
  QuestCompletionContractIntegrityError,
  type QuestCompletionLeaderboardResponse,
  type StatsPopulation
} from "../src/services/quest-completion-leaderboard.js";

const noLimit: RequestHandler = (_request, _response, next) => next();

function result(population: StatsPopulation): QuestCompletionLeaderboardResponse {
  return {
    generatedAt: "2026-08-28T12:00:00.000Z",
    population,
    coverage: { firstRecordedAt: "2026-08-19T19:37:55.990Z" },
    count: 1,
    entries: [{
      characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80,
      accountLogin: "SHANE", isBot: false, questCompletions: 84
    }]
  };
}

async function requestRoute(
  query: string,
  load: (population: StatsPopulation) => Promise<QuestCompletionLeaderboardResponse>,
  limiter: RequestHandler = noLimit
): Promise<{ response: Response; body: unknown }> {
  const app = express();
  app.use(createStatsQuestCompletionsRouter(load, limiter));
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
    const response = await fetch(`http://127.0.0.1:${port}/api/stats/quest-completions${query}`);
    return { response, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("defaults and accepts the shared population values with no-store responses", async () => {
  for (const [query, expected] of [["", "players"], ["?population=players", "players"], ["?population=all", "all"]] as const) {
    let received: StatsPopulation | undefined;
    const response = await requestRoute(query, async (population) => {
      received = population;
      return result(population);
    });
    assert.equal(response.response.status, 200);
    assert.equal(response.response.headers.get("cache-control"), "no-store");
    assert.equal(received, expected);
    assert.deepEqual(response.body, result(expected));
  }
});

test("rejects invalid, empty, and repeated population without loading", async () => {
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

test("uses the injected read limiter", async () => {
  let called = false;
  const limited: RequestHandler = (_request, response) => {
    response.status(429).json({ error: "Too many statistics requests. Try again shortly." });
  };
  const response = await requestRoute("", async (population) => {
    called = true;
    return result(population);
  }, limited);
  assert.equal(response.response.status, 429);
  assert.equal(called, false);
});

test("redacts dependency and provider-contract failures", async () => {
  const originalError = console.error;
  const logs: string[] = [];
  console.error = (message?: unknown) => logs.push(String(message));
  try {
    let response = await requestRoute("", async () => {
      throw new Error("private.database.internal password raw row");
    });
    assert.equal(response.response.status, 503);
    assert.deepEqual(response.body, { error: "Quest completion statistics are temporarily unavailable." });
    assert.doesNotMatch(logs[0] ?? "", /private\.database|password|raw row/u);

    logs.length = 0;
    response = await requestRoute("?population=all", async () => {
      throw new QuestCompletionContractIntegrityError();
    });
    assert.equal(response.response.status, 503);
    assert.deepEqual(logs, ["Quest completion statistics provider contract integrity check failed."]);
  } finally {
    console.error = originalError;
  }
});
