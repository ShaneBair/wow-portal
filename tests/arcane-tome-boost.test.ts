import assert from "node:assert/strict";
import test from "node:test";
import type { SoapResult } from "../src/services/azerothcore.js";
import { readArcaneTomeBoostConfig } from "../src/services/boost-config.js";
import {
  ArcaneTomeBoostRepository,
  type ArcaneTomeBoostRecord,
  type ArcaneTomeMailMatch,
  type ReserveArcaneTomeBoostResult
} from "../src/services/arcane-tome-boost-repository.js";
import {
  ArcaneTomeBoostService,
  arcaneTomeMetadata,
  buildSendArcaneTomeCommand,
  classifyArcaneTomeCommandResult,
  parseArcaneTomeInput
} from "../src/services/arcane-tome-boost.js";
import { BoostRequestError } from "../src/services/player-boosts.js";

const requestId = "10c2a707-1ef5-4d95-b7fe-750c4bd9bfe9";
const record: ArcaneTomeBoostRecord = {
  requestId,
  boostKey: "arcane-tome-displacement-v1",
  accountId: 7,
  characterGuid: 42,
  characterName: "Thalgrim",
  itemEntry: 900_001,
  itemCount: 1,
  status: "pending",
  createdAt: new Date("2026-08-31T12:00:00.000Z")
};

class FakeRepository extends ArcaneTomeBoostRepository {
  reservation: ReserveArcaneTomeBoostResult = { kind: "inserted", record };
  reserveCalls = 0;
  mailMatch: ArcaneTomeMailMatch = "absent";
  marks: Array<[string, string, string]> = [];
  override async reserve(): Promise<ReserveArcaneTomeBoostResult> {
    this.reserveCalls += 1;
    return this.reservation;
  }
  override async mark(id: string, status: "sent" | "failed" | "unknown", category: string): Promise<void> {
    this.marks.push([id, status, category]);
  }
  override async inspectMatchingMail(): Promise<ArcaneTomeMailMatch> { return this.mailMatch; }
  override async findStalePending(): Promise<ArcaneTomeBoostRecord[]> { return []; }
}

function serviceWith(repository: FakeRepository, executeCommand?: (command: string) => Promise<SoapResult>) {
  return new ArcaneTomeBoostService({
    queryCharacters: async () => [{ guid: 42, name: "Thalgrim", level: 80, race: 3, class: 2 }],
    repository,
    getConfig: () => ({ enabled: true }),
    executeCommand: executeCommand ?? (async () => ({ ok: true, output: "Mail sent to Thalgrim" }))
  });
}

test("Arcane Tome configuration defaults off and exposes fixed metadata", () => {
  assert.deepEqual(readArcaneTomeBoostConfig({}), { enabled: false });
  assert.deepEqual(readArcaneTomeBoostConfig({ BOOST_ARCANE_TOME_ENABLED: "true" }), { enabled: true });
  assert.throws(() => readArcaneTomeBoostConfig({ BOOST_ARCANE_TOME_ENABLED: "yes" }), /must be true or false/u);
  assert.deepEqual(arcaneTomeMetadata({ enabled: true }), {
    enabled: true, name: "Tomeward Bound", itemName: "Arcane Tome of Displacement",
    itemCount: 1, repeatable: true
  });
});

test("accepts only the UUID and opaque character ID", () => {
  assert.deepEqual(parseArcaneTomeInput({ requestId, characterId: "42" }), { requestId, characterId: "42" });
  for (const body of [
    { requestId: requestId.toUpperCase(), characterId: "42" },
    { requestId, characterId: "042" },
    { requestId, characterId: "42", itemEntry: 900_001 },
    { requestId, characterId: "42", count: 1 },
    { requestId, characterId: "42", body: "override" }
  ]) assert.equal(parseArcaneTomeInput(body), undefined);
});

test("builds the exact source-owned command and recognizes only known output", () => {
  assert.equal(
    buildSendArcaneTomeCommand("Thalgrim", requestId),
    `send items Thalgrim "Tomeward Bound" "One Arcane Tome of Displacement requested through the portal. Request ID: ${requestId}" 900001:1`
  );
  assert.equal(classifyArcaneTomeCommandResult({ ok: true, output: "Mail sent to Thalgrim\r\n" }, "Thalgrim"), "sent");
  assert.equal(classifyArcaneTomeCommandResult({ ok: true, output: "Incorrect syntax." }, "Thalgrim"), "failed");
  assert.equal(classifyArcaneTomeCommandResult({ ok: true, output: "Mail sent." }, "Thalgrim"), "unknown");
});

test("sends once and never executes SOAP on confirmed replay", async () => {
  const repository = new FakeRepository();
  const commands: string[] = [];
  const service = serviceWith(repository, async (command) => {
    commands.push(command);
    return { ok: true, output: "Mail sent to Thalgrim" };
  });
  assert.equal((await service.requestArcaneTome(7, { requestId, characterId: "42" })).created, true);
  repository.reservation = { kind: "existing", record: { ...record, status: "sent" } };
  assert.equal((await service.requestArcaneTome(7, { requestId, characterId: "42" })).created, false);
  assert.equal(commands.length, 1);
  assert.deepEqual(repository.marks, [[requestId, "sent", "command_confirmed"]]);
});

test("fails closed before reservation and preserves ambiguous execution", async () => {
  const disabledRepository = new FakeRepository();
  const disabled = new ArcaneTomeBoostService({ repository: disabledRepository, getConfig: () => ({ enabled: false }) });
  await assert.rejects(disabled.requestArcaneTome(7, { requestId, characterId: "42" }),
    (error) => error instanceof BoostRequestError && error.kind === "disabled");
  assert.equal(disabledRepository.reserveCalls, 0);

  const repository = new FakeRepository();
  await assert.rejects(
    serviceWith(repository, async () => ({ ok: false, output: "" })).requestArcaneTome(7, { requestId, characterId: "42" }),
    (error) => error instanceof BoostRequestError && error.kind === "unknown" && error.requestId === requestId
  );
  assert.deepEqual(repository.marks, [[requestId, "unknown", "confirmation_missing"]]);
});
