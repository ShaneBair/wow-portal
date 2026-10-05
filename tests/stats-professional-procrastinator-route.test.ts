import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { createStatsProfessionalProcrastinatorRouter } from "../src/routes/stats-professional-procrastinator.js";
import type { AccountVisibilityScope } from "../src/services/account-visibility.js";
import type { ProfessionalProcrastinatorResponse, StatsPopulation } from "../src/services/professional-procrastinator.js";
import { attachVisibility, fullVisibility } from "./fixtures/account-visibility.js";

const noLimit: RequestHandler = (_request, _response, next) => next();
function result(population: StatsPopulation): ProfessionalProcrastinatorResponse {
  return { generatedAt: "2026-09-30T22:00:00.000Z", population,
    coverage: { firstRecordedAt: "2026-01-01T00:00:00.000Z" }, count: 0, entries: [] };
}
async function request(query: string, load: (population: StatsPopulation, visibility: AccountVisibilityScope) => Promise<ProfessionalProcrastinatorResponse>) {
  const app = express(); app.use(createStatsProfessionalProcrastinatorRouter(load, noLimit, attachVisibility(fullVisibility)));
  const server = createServer(app);
  const port = await new Promise<number>((resolve, reject) => server.listen(0, "127.0.0.1", () => {
    const address = server.address(); if (!address || typeof address === "string") reject(new Error("Missing port.")); else resolve(address.port);
  }));
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/stats/professional-procrastinator${query}`);
    return { response, body: await response.json() as unknown };
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}

test("defaults population and sets private response headers", async () => {
  for (const [query, population] of [["", "players"], ["?population=all", "all"]] as const) {
    const received = await request(query, async (actual, visibility) => {
      assert.equal(actual, population); assert.equal(visibility, fullVisibility); return result(actual);
    });
    assert.equal(received.response.status, 200);
    assert.equal(received.response.headers.get("cache-control"), "no-store");
    assert.equal(received.response.headers.get("vary"), "Cookie");
  }
});

test("rejects invalid populations and redacts service failures", async () => {
  let calls = 0;
  const invalid = await request("?population=bots", async (population) => { calls++; return result(population); });
  assert.equal(invalid.response.status, 400); assert.equal(calls, 0);
  const original = console.error; console.error = () => undefined;
  try {
    const failed = await request("", async () => { throw new Error("private database detail"); });
    assert.equal(failed.response.status, 503);
    assert.deepEqual(failed.body, { error: "Professional Procrastinator statistics are temporarily unavailable." });
  } finally { console.error = original; }
});
