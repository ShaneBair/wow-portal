import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { createStatsBotWranglerRouter } from "../src/routes/stats-bot-wrangler.js";
import type { AccountVisibilityScope } from "../src/services/account-visibility.js";
import type { BotWranglerResponse } from "../src/services/bot-wrangler.js";
import { attachVisibility, fullVisibility } from "./fixtures/account-visibility.js";

const noLimit: RequestHandler = (_request, _response, next) => next();

function result(): BotWranglerResponse {
  return {
    generatedAt: "2026-09-29T18:00:00.000Z",
    population: "human-vs-bot",
    coverage: { firstRecordedAt: "2026-09-01T12:00:00.000Z" },
    count: 1,
    entries: [{
      characterName: "Thalgrim", race: "Dwarf", class: "Paladin", level: 80,
      accountLogin: "SHANE", botKills: 12, uniqueBotVictims: 4,
      lastBotKillAt: "2026-09-28T18:30:00.000Z"
    }]
  };
}

async function requestRoute(
  query: string,
  load: (visibility: AccountVisibilityScope) => Promise<BotWranglerResponse>,
  limiter: RequestHandler = noLimit
) {
  const app = express();
  app.use(createStatsBotWranglerRouter(load, limiter, attachVisibility(fullVisibility)));
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
    const response = await fetch(`http://127.0.0.1:${port}/api/stats/bot-wrangler${query}`);
    return { response, body: await response.json() as unknown };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("returns the fixed matchup with private response headers", async () => {
  const received = await requestRoute("", async (visibility) => {
    assert.equal(visibility, fullVisibility);
    return result();
  });
  assert.equal(received.response.status, 200);
  assert.equal(received.response.headers.get("cache-control"), "no-store");
  assert.equal(received.response.headers.get("vary"), "Cookie");
  assert.deepEqual(received.body, result());
});

test("rejects any population parameter and sanitizes dependency failures", async () => {
  for (const query of ["?population=players", "?population=", "?population=all&population=players"]) {
    let calls = 0;
    const invalid = await requestRoute(query, async () => {
      calls += 1;
      return result();
    });
    assert.equal(invalid.response.status, 400);
    assert.equal(calls, 0);
  }
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const failed = await requestRoute("", async () => {
      throw new Error("secret victim account and database row");
    });
    assert.equal(failed.response.status, 503);
    assert.deepEqual(failed.body, {
      error: "Bot Wrangler statistics are temporarily unavailable."
    });
    assert.doesNotMatch(JSON.stringify(failed.body), /secret|victim account|database row/u);
  } finally {
    console.error = originalError;
  }
});

test("uses the shared limiter before loading", async () => {
  let loaded = false;
  const limited = await requestRoute("", async () => {
    loaded = true;
    return result();
  }, (_request, response) => response.status(429).json({ error: "Too many statistics requests." }));
  assert.equal(limited.response.status, 429);
  assert.equal(loaded, false);
});
