import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";

const ENTRY_MARKER = "React entry fixture";

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

test("serves only allowlisted browser routes from the client output", async () => {
  const app = createApp({
    clientOutputDir: path.resolve(process.cwd(), "tests/fixtures/client")
  });
  const server = createServer(app);
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    for (const route of ["/", "/stats"]) {
      const response = await fetch(`${baseUrl}${route}`);
      const body = await response.text();
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/u);
      assert.match(body, new RegExp(ENTRY_MARKER, "u"));
    }

    const assetResponse = await fetch(`${baseUrl}/asset.js`);
    assert.equal(assetResponse.status, 200);
    assert.doesNotMatch(await assetResponse.text(), new RegExp(ENTRY_MARKER, "u"));

    const healthResponse = await fetch(`${baseUrl}/health`);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), { ok: true });

    for (const route of ["/api/does-not-exist", "/missing-asset.js", "/not-allowlisted"]) {
      const response = await fetch(`${baseUrl}${route}`);
      const body = await response.text();
      assert.equal(response.status, 404);
      assert.doesNotMatch(body, new RegExp(ENTRY_MARKER, "u"));
    }
  } finally {
    await close(server);
  }
});
