import assert from "node:assert/strict";
import test from "node:test";
import {
  OnlineRosterService,
  parseOnlineRosterOutput
} from "../src/services/online-roster.js";

const MARKER = "PLAYERSTATS_ONLINE_V1 ";

function player(overrides: Record<string, unknown> = {}) {
  return {
    accountId: 12,
    accountLogin: "SHANE",
    characterGuid: 345,
    characterName: "Thalgrim",
    raceId: 3,
    classId: 2,
    level: 42,
    mapId: 0,
    zoneId: 33,
    areaId: 117,
    location: "Stranglethorn Vale",
    ...overrides
  };
}

function output(players: unknown[], generatedAt = 1_787_414_400): string {
  return `${MARKER}${JSON.stringify({ generatedAt, players })}`;
}

test("parses, maps, sorts, and strips integration-only player fields", () => {
  const roster = parseOnlineRosterOutput(output([
    player({
      accountId: 99,
      accountLogin: "ZED",
      characterGuid: 999,
      characterName: "zara",
      email: "must-not-leak@example.com",
      gmStatus: true
    }),
    player({ accountLogin: "BETA", characterName: "Alpha" }),
    player({ accountLogin: "ALPHA", characterName: "alpha" })
  ]));

  assert.equal(roster.generatedAt, "2026-08-22T16:00:00.000Z");
  assert.equal(roster.count, 3);
  assert.deepEqual(
    roster.players.map(({ characterName, accountLogin }) => [characterName, accountLogin]),
    [["alpha", "ALPHA"], ["Alpha", "BETA"], ["zara", "ZED"]]
  );
  assert.deepEqual(roster.players[0], {
    accountLogin: "ALPHA",
    characterName: "alpha",
    race: "Dwarf",
    class: "Paladin",
    level: 42,
    location: "Stranglethorn Vale"
  });
  assert.equal("accountId" in roster.players[0], false);
  assert.equal("characterGuid" in roster.players[0], false);
  assert.equal("mapId" in roster.players[0], false);
  assert.equal("email" in roster.players[2], false);
  assert.equal("gmStatus" in roster.players[2], false);
});

test("accepts an empty roster", () => {
  assert.deepEqual(parseOnlineRosterOutput(output([])), {
    generatedAt: "2026-08-22T16:00:00.000Z",
    count: 0,
    players: []
  });
});

test("accepts decoded SOAP carriage-return whitespace after the payload", () => {
  assert.equal(parseOnlineRosterOutput(`${output([player()])}\r`).count, 1);
});

test("uses documented labels for unknown numeric race and class IDs", () => {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (message?: unknown) => warnings.push(String(message));

  try {
    const roster = parseOnlineRosterOutput(output([player({ raceId: 99, classId: 98 })]));
    assert.equal(roster.players[0].race, "Unknown race (99)");
    assert.equal(roster.players[0].class, "Unknown class (98)");
    assert.equal(warnings.length, 2);
  } finally {
    console.warn = originalWarn;
  }
});

test("rejects missing, duplicate, and unsupported markers", () => {
  assert.throws(() => parseOnlineRosterOutput("command output only"), /marker is missing/u);
  assert.throws(
    () => parseOnlineRosterOutput(`${output([])}\n${output([])}`),
    /marker is duplicated/u
  );

  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    assert.throws(
      () => parseOnlineRosterOutput('PLAYERSTATS_ONLINE_V2 {"generatedAt":0,"players":[]}'),
      /version is unsupported/u
    );
  } finally {
    console.warn = originalWarn;
  }
});

test("rejects malformed JSON and invalid field types or numeric ranges", async (context) => {
  assert.throws(() => parseOnlineRosterOutput(`${MARKER}{not json}`), /not valid JSON/u);

  await context.test("invalid generatedAt", () => {
    assert.throws(() => parseOnlineRosterOutput(output([], -1)), /generatedAt is invalid/u);
  });

  await context.test("invalid player type", () => {
    assert.throws(() => parseOnlineRosterOutput(output(["player"])), /invalid player/u);
  });

  await context.test("invalid required string", () => {
    assert.throws(
      () => parseOnlineRosterOutput(output([player({ accountLogin: 12 })])),
      /accountLogin is invalid/u
    );
  });

  await context.test("impossible level", () => {
    assert.throws(
      () => parseOnlineRosterOutput(output([player({ level: 0 })])),
      /level is invalid/u
    );
  });

  await context.test("out-of-range unsigned ID", () => {
    assert.throws(
      () => parseOnlineRosterOutput(output([player({ zoneId: 0x1_0000_0000 })])),
      /zoneId is invalid/u
    );
  });
});

test("reuses successful cache entries for ten seconds", async () => {
  let now = 1_000;
  let calls = 0;
  const service = new OnlineRosterService(async (command) => {
    calls += 1;
    assert.equal(command, "playerstats online");
    return { ok: true, output: output([]) };
  }, () => now);

  const first = await service.getOnlinePlayers();
  now = 10_999;
  const second = await service.getOnlinePlayers();

  assert.strictEqual(second, first);
  assert.equal(calls, 1);
});

test("coalesces concurrent cache refreshes", async () => {
  let calls = 0;
  let resolveCommand: ((value: { ok: boolean; output: string }) => void) | undefined;
  const service = new OnlineRosterService(() => {
    calls += 1;
    return new Promise((resolve) => {
      resolveCommand = resolve;
    });
  });

  const first = service.getOnlinePlayers();
  const second = service.getOnlinePlayers();

  assert.equal(calls, 1);
  resolveCommand?.({ ok: true, output: output([player()]) });
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.strictEqual(firstResult, secondResult);
});

test("does not serve stale roster data after a refresh failure", async () => {
  let now = 0;
  let calls = 0;
  const service = new OnlineRosterService(async () => {
    calls += 1;
    return calls === 1
      ? { ok: true, output: output([player()]) }
      : { ok: false, output: "" };
  }, () => now);

  await service.getOnlinePlayers();
  now = 10_001;

  await assert.rejects(() => service.getOnlinePlayers(), /command failed/u);
  assert.equal(calls, 2);
});
