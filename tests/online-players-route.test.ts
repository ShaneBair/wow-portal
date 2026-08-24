import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { createOnlinePlayersRouter } from "../src/routes/online-players.js";
import type { OnlinePlayersResponse } from "../src/services/online-roster.js";

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
  load: () => Promise<OnlinePlayersResponse>
): Promise<{ response: Response; body: unknown }> {
  const app = express();
  app.use(createOnlinePlayersRouter(load, noLimit));
  const server = createServer(app);
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/online-players`);
    return { response, body: await response.json() };
  } finally {
    await close(server);
  }
}

test("returns 200 for empty and populated roster responses", async (context) => {
  await context.test("empty", async () => {
    const roster = { generatedAt: "2026-08-22T16:00:00.000Z", count: 0, players: [] };
    const { response, body } = await requestRoute(async () => roster);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(body, roster);
  });

  await context.test("populated", async () => {
    const roster: OnlinePlayersResponse = {
      generatedAt: "2026-08-22T16:00:00.000Z",
      count: 1,
      players: [{
        accountLogin: "SHANE",
        characterName: "Thalgrim",
        race: "Dwarf",
        class: "Paladin",
        level: 42,
        location: "Stranglethorn Vale"
      }]
    };
    const { response, body } = await requestRoute(async () => roster);
    assert.equal(response.status, 200);
    assert.deepEqual(body, roster);
  });
});

test("returns a safe 503 response when the roster is unavailable", async () => {
  const originalError = console.error;
  console.error = () => undefined;

  try {
    const { response, body } = await requestRoute(async () => {
      throw new Error("internal SOAP host and raw details");
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(body, {
      error: "Online player information is temporarily unavailable."
    });
  } finally {
    console.error = originalError;
  }
});
