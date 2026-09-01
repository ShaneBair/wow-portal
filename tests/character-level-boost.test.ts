import assert from "node:assert/strict";
import test from "node:test";
import type { SoapResult } from "../src/services/azerothcore.js";
import { readCharacterLevelBoostConfig } from "../src/services/boost-config.js";
import {
  CharacterLevelBoostRepository,
  type CharacterLevelBoostRecord,
  type ReserveCharacterLevelBoostResult
} from "../src/services/character-level-boost-repository.js";
import {
  CharacterLevelBoostService,
  buildCharacterLevelCommand,
  characterLevelMetadata,
  classifyCharacterLevelCommandResult,
  parseCharacterLevelInput
} from "../src/services/character-level-boost.js";
import { BoostRequestError } from "../src/services/player-boosts.js";

const requestId = "77ab8034-1429-4fd5-8ee1-a1220628724a";
const baseRecord: CharacterLevelBoostRecord = {
  requestId,
  boostKey: "character-level-raise-v1",
  accountId: 7,
  characterGuid: 42,
  characterName: "Thalgrim",
  startingLevel: 39,
  targetLevel: 60,
  status: "pending",
  createdAt: new Date("2026-09-01T12:00:00.000Z")
};

class FakeRepository extends CharacterLevelBoostRepository {
  existing?: CharacterLevelBoostRecord;
  reservation: ReserveCharacterLevelBoostResult = { kind: "inserted", record: baseRecord };
  reserveCalls = 0;
  lockCalls = 0;
  marks: Array<[string, string, string, number | undefined]> = [];
  override async withCharacterLock<T>(_guid: number, operation: () => Promise<T>): Promise<T> {
    this.lockCalls += 1;
    return operation();
  }
  override async find(): Promise<CharacterLevelBoostRecord | undefined> { return this.existing; }
  override async reserve(): Promise<ReserveCharacterLevelBoostResult> {
    this.reserveCalls += 1;
    return this.reservation;
  }
  override async mark(id: string, status: "applied" | "failed" | "unknown", category: string, level?: number): Promise<void> {
    this.marks.push([id, status, category, level]);
  }
  override async findStalePending(): Promise<CharacterLevelBoostRecord[]> { return []; }
}

function characterRow(level: number) {
  return { guid: 42, name: "Thalgrim", level, race: 3, class: 2 };
}

function serviceWith(
  repository: FakeRepository,
  levels: number[],
  executeCommand?: (command: string) => Promise<SoapResult>,
  sleep: (milliseconds: number) => Promise<void> = async () => {}
) {
  let read = 0;
  return new CharacterLevelBoostService({
    repository,
    queryCharacters: async () => [characterRow(levels[Math.min(read++, levels.length - 1)] ?? 39)],
    getConfig: () => ({ enabled: true }),
    sleep,
    executeCommand: executeCommand ?? (async () => ({
      ok: true, output: "You changed level of Thalgrim to 60."
    }))
  });
}

test("character level configuration fails closed and metadata is fixed", async () => {
  assert.deepEqual(readCharacterLevelBoostConfig({}), { enabled: false });
  assert.deepEqual(readCharacterLevelBoostConfig({ BOOST_CHARACTER_LEVEL_ENABLED: "true" }), { enabled: true });
  assert.throws(() => readCharacterLevelBoostConfig({ BOOST_CHARACTER_LEVEL_ENABLED: "yes" }), /must be true or false/u);
  assert.deepEqual(characterLevelMetadata({ enabled: true }), {
    enabled: true, name: "Level Up, Buttercup", maximumLevel: 80, xpWillReset: true
  });
  const service = new CharacterLevelBoostService({ getConfig: () => { throw new Error("invalid"); } });
  assert.equal((await service.getMetadata(7)).enabled, false);
});

test("strictly parses whole targets from 2 through 80", () => {
  assert.deepEqual(parseCharacterLevelInput({ requestId, characterId: "42", targetLevel: 60 }), {
    requestId, characterId: "42", targetLevel: 60
  });
  for (const body of [
    { requestId, characterId: "42", targetLevel: 1 },
    { requestId, characterId: "42", targetLevel: 81 },
    { requestId, characterId: "42", targetLevel: 60.5 },
    { requestId, characterId: "42", targetLevel: "60" },
    { requestId, characterId: "42", targetLevel: 60, currentLevel: 39 },
    { requestId, characterId: "42", targetLevel: 60, delta: 21 }
  ]) assert.equal(parseCharacterLevelInput(body), undefined);
});

test("builds and classifies only the exact deployed command contract", () => {
  assert.equal(buildCharacterLevelCommand("Thalgrim", 60), "character level Thalgrim 60");
  assert.throws(() => buildCharacterLevelCommand("Bad Name", 60), /not safe/u);
  assert.throws(() => buildCharacterLevelCommand("Thalgrim", 81), /target is invalid/u);
  assert.equal(classifyCharacterLevelCommandResult({
    ok: true, output: "You changed level of Thalgrim to 60.\r\n"
  }, "Thalgrim", 60), "accepted");
  assert.equal(classifyCharacterLevelCommandResult({ ok: true, output: "Incorrect syntax." }, "Thalgrim", 60), "failed");
  assert.equal(classifyCharacterLevelCommandResult({ ok: true, output: "Level changed." }, "Thalgrim", 60), "unknown");
});

test("reserves under the character lock, executes once, and confirms the authoritative level", async () => {
  const repository = new FakeRepository();
  const commands: string[] = [];
  const service = serviceWith(repository, [39, 60], async (command) => {
    commands.push(command);
    return { ok: true, output: "You changed level of Thalgrim to 60." };
  });
  const result = await service.requestCharacterLevel(7, { requestId, characterId: "42", targetLevel: 60 });
  assert.equal(result.created, true);
  assert.equal(result.message, "Thalgrim is now level 60.");
  assert.deepEqual(result.character, { id: "42", name: "Thalgrim", level: 60 });
  assert.deepEqual(commands, ["character level Thalgrim 60"]);
  assert.equal(repository.lockCalls, 1);
  assert.deepEqual(repository.marks, [[requestId, "applied", "level_confirmed", 60]]);
});

test("waits for the asynchronous offline level update before declaring a mismatch", async () => {
  const repository = new FakeRepository();
  const delays: number[] = [];
  const service = serviceWith(
    repository,
    [39, 39, 39, 60],
    undefined,
    async (milliseconds) => { delays.push(milliseconds); }
  );
  const result = await service.requestCharacterLevel(7, {
    requestId,
    characterId: "42",
    targetLevel: 60
  });
  assert.equal(result.created, true);
  assert.deepEqual(delays, [50, 100]);
  assert.deepEqual(repository.marks, [[requestId, "applied", "level_confirmed", 60]]);
});

test("returns confirmed replay without SOAP and rejects a freshly non-increasing target", async () => {
  const replayRepository = new FakeRepository();
  replayRepository.existing = { ...baseRecord, status: "applied", resultingLevel: 60 };
  let commands = 0;
  const replay = await serviceWith(replayRepository, [60], async () => {
    commands += 1;
    return { ok: true, output: "" };
  }).requestCharacterLevel(7, { requestId, characterId: "42", targetLevel: 60 });
  assert.equal(replay.created, false);
  assert.equal(commands, 0);

  const staleRepository = new FakeRepository();
  await assert.rejects(
    serviceWith(staleRepository, [60]).requestCharacterLevel(7, { requestId, characterId: "42", targetLevel: 60 }),
    (error) => error instanceof BoostRequestError && error.kind === "conflict"
  );
  assert.equal(staleRepository.reserveCalls, 0);
});

test("never reports ambiguous or mismatched execution as success", async () => {
  const repository = new FakeRepository();
  await assert.rejects(
    serviceWith(repository, [39, 41], async () => ({ ok: false, output: "" }))
      .requestCharacterLevel(7, { requestId, characterId: "42", targetLevel: 60 }),
    (error) => error instanceof BoostRequestError && error.kind === "unknown" && error.requestId === requestId
  );
  assert.deepEqual(repository.marks, [[requestId, "unknown", "level_mismatch", 41]]);
});

test("rejects disabled and unowned requests before reservation or SOAP", async () => {
  const disabledRepository = new FakeRepository();
  const disabled = new CharacterLevelBoostService({
    repository: disabledRepository,
    getConfig: () => ({ enabled: false })
  });
  await assert.rejects(
    disabled.requestCharacterLevel(7, { requestId, characterId: "42", targetLevel: 60 }),
    (error) => error instanceof BoostRequestError && error.kind === "disabled"
  );
  assert.equal(disabledRepository.lockCalls, 0);

  const ownershipRepository = new FakeRepository();
  let commands = 0;
  const ownership = new CharacterLevelBoostService({
    repository: ownershipRepository,
    getConfig: () => ({ enabled: true }),
    queryCharacters: async () => [],
    executeCommand: async () => { commands += 1; return { ok: true, output: "" }; }
  });
  await assert.rejects(
    ownership.requestCharacterLevel(7, { requestId, characterId: "42", targetLevel: 60 }),
    (error) => error instanceof BoostRequestError && error.kind === "ownership"
  );
  assert.equal(ownershipRepository.reserveCalls, 0);
  assert.equal(commands, 0);
});
