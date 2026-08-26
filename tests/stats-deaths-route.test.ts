import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { createStatsDeathsRouter } from "../src/routes/stats-deaths.js";
import type {
  DeathLeaderboardResponse,
  StatsPopulation
} from "../src/services/death-leaderboard.js";
import { DeathLeaderboardContractIntegrityError } from "../src/services/death-leaderboard.js";

const noLimit: RequestHandler = (_req, _res, next) => next();

async function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Test server did not receive a TCP port."));
        return;
      }
      resolve(address.port);
    });
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function requestRoute(
  query: string,
  load: (population: StatsPopulation) => Promise<DeathLeaderboardResponse>
): Promise<{ response: Response; body: unknown }> {
  const app = express();
  app.use(createStatsDeathsRouter(load, noLimit));
  const server = createServer(app);
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/stats/deaths${query}`);
    return { response, body: await response.json() };
  } finally {
    await close(server);
  }
}

function response(population: StatsPopulation): DeathLeaderboardResponse {
  return {
    generatedAt: "2026-08-24T16:00:00.000Z",
    population,
    coverage: {
      comprehensiveSince: "2026-08-25T14:30:00.000Z"
    },
    count: 1,
    entries: [{
      characterName: "Thalgrim",
      race: "Dwarf",
      class: "Paladin",
      level: 42,
      accountLogin: "SHANE",
      isBot: false,
      deaths: 14
    }]
  };
}

test("defaults a missing population to players and accepts both valid values", async (context) => {
  for (const [query, expected] of [["", "players"], ["?population=players", "players"], ["?population=all", "all"]] as const) {
    await context.test(query || "missing", async () => {
      let received: StatsPopulation | undefined;
      const result = await requestRoute(query, async (population) => {
        received = population;
        return response(population);
      });

      assert.equal(result.response.status, 200);
      assert.equal(result.response.headers.get("cache-control"), "no-store");
      assert.equal(received, expected);
      assert.deepEqual(result.body, response(expected));
    });
  }
});

test("returns 200 with an empty leaderboard", async () => {
  const empty: DeathLeaderboardResponse = {
    generatedAt: "2026-08-24T16:00:00.000Z",
    population: "players",
    coverage: {
      comprehensiveSince: "2026-08-25T14:30:00.000Z"
    },
    count: 0,
    entries: []
  };
  const result = await requestRoute("", async () => empty);

  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, empty);
});

test("rejects invalid, empty, and repeated population values without loading data", async (context) => {
  for (const query of ["?population=bots", "?population=", "?population=players&population=all"]) {
    await context.test(query, async () => {
      let called = false;
      const result = await requestRoute(query, async (population) => {
        called = true;
        return response(population);
      });

      assert.equal(result.response.status, 400);
      assert.deepEqual(result.body, { error: "Invalid population filter." });
      assert.equal(called, false);
    });
  }
});

test("returns a safe 503 response without raw database details", async () => {
  const originalError = console.error;
  const logs: string[] = [];
  console.error = (message?: unknown) => logs.push(String(message));

  try {
    const result = await requestRoute("?population=players", async () => {
      throw new Error("driver failed at mariadb-secret.internal with password details");
    });
    assert.equal(result.response.status, 503);
    assert.equal(result.response.headers.get("cache-control"), "no-store");
    assert.deepEqual(result.body, {
      error: "Death statistics are temporarily unavailable."
    });
    assert.equal(logs.length, 1);
    assert.doesNotMatch(logs[0] ?? "", /mariadb-secret|password|driver failed/u);
  } finally {
    console.error = originalError;
  }
});

test("fails closed on provider contract corruption with a concise safe log", async () => {
  const originalError = console.error;
  const logs: string[] = [];
  console.error = (message?: unknown) => logs.push(String(message));

  try {
    const result = await requestRoute("?population=all", async () => {
      throw new DeathLeaderboardContractIntegrityError();
    });

    assert.equal(result.response.status, 503);
    assert.deepEqual(result.body, {
      error: "Death statistics are temporarily unavailable."
    });
    assert.deepEqual(logs, ["Death statistics provider contract integrity check failed."]);
    assert.doesNotMatch(JSON.stringify(result.body), /cutoff|migration|PLAYER_DEATH/u);
  } finally {
    console.error = originalError;
  }
});
