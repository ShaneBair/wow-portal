import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateFlightPathGrant,
  factionForRace,
  FlightPathBoostService,
  parseFlightPathInput,
  parseTaxiMask,
  serializeTaxiMask
} from "../src/services/flight-path-boost.js";
import type { FlightPathBoostRepositoryPort } from "../src/services/flight-path-boost-repository.js";
import { FlightPathBoostRepository } from "../src/services/flight-path-boost-repository.js";
import {
  FLIGHT_PATH_GRANT_ARTIFACT,
  FLIGHT_PATH_MASK_REVISION,
  validateFlightPathGrantArtifact
} from "../src/services/flight-path-masks.js";
import { BoostRequestError } from "../src/services/player-boosts.js";

const requestId = "0d6202eb-15c0-4e62-9cc2-f7697dd5866f";

test("validates the exact revisioned 14-word grant artifact", () => {
  assert.equal(FLIGHT_PATH_MASK_REVISION, "wotlk-335a-b19e04c6");
  assert.deepEqual(Object.values(FLIGHT_PATH_GRANT_ARTIFACT).map((mask) => mask.length), [14, 14, 14]);
  validateFlightPathGrantArtifact(FLIGHT_PATH_GRANT_ARTIFACT);
  assert.throws(() => validateFlightPathGrantArtifact({
    ...FLIGHT_PATH_GRANT_ARTIFACT, alliance: Array(14).fill(0xffff_ffff)
  }), /invalid/u);
});

test("parses core-compatible masks and emits canonical trailing-space form", () => {
  assert.deepEqual(parseTaxiMask(""), Array(14).fill(0));
  assert.deepEqual(parseTaxiMask("0 4294967295 ").slice(0, 3), [0, 4294967295, 0]);
  assert.equal(serializeTaxiMask([1, ...Array(13).fill(0)]), `1 ${Array(13).fill(0).join(" ")} `);
  for (const invalid of ["-1", "4294967296", "1  2", "1x", `${Array(15).fill(0).join(" ")} `]) {
    assert.throws(() => parseTaxiMask(invalid), /malformed/u);
  }
});

test("derives faction authoritatively, preserves bits, and adds Death Knight nodes", () => {
  assert.equal(factionForRace(3), "alliance");
  assert.equal(factionForRace(10), "horde");
  assert.throws(() => factionForRace(9), /race/u);
  const alliance = calculateFlightPathGrant({ raceId: 3, classId: 2, online: false, taxiMask: "1 " });
  const allianceWords = parseTaxiMask(alliance.newMask);
  assert.equal(alliance.faction, "alliance");
  assert.equal(allianceWords[0]! & 1, 1);
  assert.equal(allianceWords[9], FLIGHT_PATH_GRANT_ARTIFACT.alliance[9]);
  const deathKnight = calculateFlightPathGrant({ raceId: 2, classId: 6, online: false, taxiMask: "" });
  const deathKnightWords = parseTaxiMask(deathKnight.newMask);
  assert.equal(deathKnightWords[9], (FLIGHT_PATH_GRANT_ARTIFACT.horde[9]! | FLIGHT_PATH_GRANT_ARTIFACT.deathKnight[9]!) >>> 0);
  assert.equal(calculateFlightPathGrant({ raceId: 2, classId: 6, online: false, taxiMask: deathKnight.newMask }).result, "already-known");
});

test("fails closed for online, unsupported, malformed, and browser-expanded requests", () => {
  assert.throws(
    () => calculateFlightPathGrant({ raceId: 3, classId: 2, online: true, taxiMask: "" }),
    (error) => error instanceof BoostRequestError && error.kind === "conflict"
  );
  assert.throws(() => calculateFlightPathGrant({ raceId: 3, classId: 10, online: false, taxiMask: "" }), /class/u);
  assert.deepEqual(parseFlightPathInput({ requestId, characterId: "42" }), { requestId, characterId: "42" });
  assert.equal(parseFlightPathInput({ requestId, characterId: "42", faction: "alliance" }), undefined);
  assert.equal(parseFlightPathInput({ requestId: requestId.toUpperCase(), characterId: "42" }), undefined);
});

test("returns learned and replay results while keeping mutation inputs server-owned", async () => {
  const calls: unknown[] = [];
  const repository: FlightPathBoostRepositoryPort = {
    apply: async (input, decide) => {
      calls.push(input);
      const decision = decide({
        guid: 42, accountId: 7, name: "Thalgrim", raceId: 3, classId: 2,
        online: false, taxiMask: ""
      });
      return { kind: "applied", created: calls.length === 1, record: {
        requestId: input.requestId, boostKey: input.boostKey, accountId: input.accountId,
        characterGuid: input.characterGuid, characterName: "Thalgrim", faction: decision.faction,
        classId: 2, maskRevision: input.maskRevision, result: decision.result, status: "applied"
      } };
    }
  };
  const service = new FlightPathBoostService({ repository, getConfig: () => ({ enabled: true }) });
  const first = await service.requestFlightPaths(7, { requestId, characterId: "42" });
  const replay = await service.requestFlightPaths(7, { requestId, characterId: "42" });
  assert.equal(first.created, true);
  assert.equal(first.message, "Thalgrim learned all available Alliance flight paths.");
  assert.equal(replay.created, false);
  assert.deepEqual(calls, [
    { requestId, boostKey: "flight-paths-v1", accountId: 7, characterGuid: 42, maskRevision: FLIGHT_PATH_MASK_REVISION },
    { requestId, boostKey: "flight-paths-v1", accountId: 7, characterGuid: 42, maskRevision: FLIGHT_PATH_MASK_REVISION }
  ]);
});

test("locks, compares, updates, audits, and commits the character in one transaction", async () => {
  const sql: string[] = [];
  const values: unknown[][] = [];
  const lifecycle: string[] = [];
  const results: unknown[] = [
    [[]],
    [[{ guid: 42, accountId: 7, name: "Thalgrim", raceId: 3, classId: 2, online: 0, taxiMask: "0 " }]],
    [{ affectedRows: 1 }],
    [{ affectedRows: 1 }],
    [{ affectedRows: 1 }]
  ];
  const connection = {
    beginTransaction: async () => { lifecycle.push("begin"); },
    commit: async () => { lifecycle.push("commit"); },
    rollback: async () => { lifecycle.push("rollback"); },
    release: () => { lifecycle.push("release"); },
    execute: async (query: { sql: string; values?: unknown[] }) => {
      sql.push(query.sql); values.push(query.values ?? []);
      return results.shift();
    }
  };
  const repository = new FlightPathBoostRepository((() => ({
    pool: { getConnection: async () => connection },
    config: {
      host: "db", port: 3306, user: "portal", password: "secret",
      authDatabase: "auth", charactersDatabase: "characters", stateDatabase: "portal"
    }
  })) as never);
  const result = await repository.apply({
    requestId, boostKey: "flight-paths-v1", accountId: 7, characterGuid: 42,
    maskRevision: FLIGHT_PATH_MASK_REVISION
  }, (character) => calculateFlightPathGrant(character));
  assert.equal(result.kind, "applied");
  assert.deepEqual(lifecycle, ["begin", "commit", "release"]);
  assert.match(sql[0]!, /flight_path_boost_requests[\s\S]+FOR UPDATE/u);
  assert.match(sql[1]!, /guid = \? AND account = \?[\s\S]+deleteInfos_Name IS NULL[\s\S]+FOR UPDATE/u);
  assert.match(sql[3]!, /SET taximask = \?[\s\S]+online = 0 AND taximask = \?/u);
  assert.match(sql[4]!, /status = 'applied'/u);
  assert.equal(values[3]![1], 42);
  assert.equal(values[3]![2], 7);
  assert.equal(values[3]![3], "0 ");
  assert.equal(String(values[3]![0]).split(" ").filter(Boolean).length, 14);
});
