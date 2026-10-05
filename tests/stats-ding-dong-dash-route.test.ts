import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { createStatsDingDongDashRouter } from "../src/routes/stats-ding-dong-dash.js";
import type { AccountVisibilityScope } from "../src/services/account-visibility.js";
import type { DingDongDashResponse, StatsPopulation } from "../src/services/ding-dong-dash.js";
import { attachVisibility, fullVisibility } from "./fixtures/account-visibility.js";

const noLimit: RequestHandler = (_request, _response, next) => next();
function result(population: StatsPopulation): DingDongDashResponse {
  return { generatedAt: "2026-10-01T15:42:00.000Z", population,
    coverage: { firstRecordedAt: "2026-01-01T00:00:00.000Z" }, count: 0, entries: [] };
}
async function request(query: string, load: (population: StatsPopulation, visibility: AccountVisibilityScope) => Promise<DingDongDashResponse>) {
  const app = express(); app.use(createStatsDingDongDashRouter(load, noLimit, attachVisibility(fullVisibility)));
  const server = createServer(app);
  const port = await new Promise<number>((resolve, reject) => server.listen(0, "127.0.0.1", () => {
    const address = server.address(); if (!address || typeof address === "string") reject(new Error("Missing port.")); else resolve(address.port);
  }));
  try { const response = await fetch(`http://127.0.0.1:${port}/api/stats/ding-dong-dash${query}`);
    return { response, body: await response.json() as unknown }; }
  finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
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

test("rejects invalid population and redacts failures", async () => {
  let calls = 0;
  const invalid = await request("?population=bots", async (population) => { calls++; return result(population); });
  assert.equal(invalid.response.status, 400); assert.equal(calls, 0);
  const original = console.error; console.error = () => undefined;
  try { const failed = await request("", async () => { throw new Error("private database detail"); });
    assert.equal(failed.response.status, 503);
    assert.deepEqual(failed.body, { error: "Ding Dong Dash statistics are temporarily unavailable." }); }
  finally { console.error = original; }
});
