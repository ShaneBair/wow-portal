import assert from "node:assert/strict";
import test from "node:test";
import type { SoapResult } from "../src/services/azerothcore.js";
import { readPortableHolesBoostConfig } from "../src/services/boost-config.js";
import {
  PortableHoleBoostRepository,
  type PortableHoleBoostRecord,
  type PortableHoleMailMatch,
  type ReservePortableHoleBoostResult
} from "../src/services/portable-hole-boost-repository.js";
import {
  buildSendPortableHolesCommand,
  classifyPortableHolesCommandResult,
  parsePortableHolesInput,
  portableHolesMetadata,
  PortableHoleBoostService
} from "../src/services/portable-hole-boost.js";
import { BoostRequestError } from "../src/services/player-boosts.js";

const requestId = "10c2a707-1ef5-4d95-b7fe-750c4bd9bfe9";
const secondRequestId = "6dbce848-1db7-41d7-8106-bfe090c88066";
const characterRow = { guid: 42, name: "Thalgrim", level: 80, race: 3, class: 2 };
const record: PortableHoleBoostRecord = {
  requestId,
  boostKey: "portable-holes-v1",
  accountId: 7,
  characterGuid: 42,
  characterName: "Thalgrim",
  itemEntry: 51_809,
  itemCount: 4,
  status: "pending",
  createdAt: new Date("2026-08-27T12:00:00.000Z")
};

class FakeRepository extends PortableHoleBoostRepository {
  reservation: ReservePortableHoleBoostResult = { kind: "inserted", record };
  reserveCalls = 0;
  mailMatch: PortableHoleMailMatch = "absent";
  stale: PortableHoleBoostRecord[] = [];
  marks: Array<[string, string, string]> = [];

  override async reserve(): Promise<ReservePortableHoleBoostResult> {
    this.reserveCalls += 1;
    return this.reservation;
  }

  override async mark(id: string, status: "sent" | "failed" | "unknown", category: string): Promise<void> {
    this.marks.push([id, status, category]);
  }

  override async inspectMatchingMail(): Promise<PortableHoleMailMatch> {
    return this.mailMatch;
  }

  override async findStalePending(): Promise<PortableHoleBoostRecord[]> {
    return this.stale;
  }
}

function serviceWith(
  repository: FakeRepository,
  executeCommand: (command: string) => Promise<SoapResult> = async () => ({
    ok: true,
    output: "Mail sent to Thalgrim"
  })
) {
  return new PortableHoleBoostService({
    queryCharacters: async (accountId, guid) => {
      assert.equal(accountId, 7);
      assert.equal(guid, 42);
      return [characterRow];
    },
    repository,
    getConfig: () => ({ enabled: true }),
    executeCommand
  });
}

test("Portable Holes configuration defaults off and metadata is fixed", () => {
  assert.deepEqual(readPortableHolesBoostConfig({}), { enabled: false });
  assert.deepEqual(readPortableHolesBoostConfig({ BOOST_PORTABLE_HOLES_ENABLED: "true" }), {
    enabled: true
  });
  assert.throws(
    () => readPortableHolesBoostConfig({ BOOST_PORTABLE_HOLES_ENABLED: "yes" }),
    /BOOST_PORTABLE_HOLES_ENABLED must be true or false/u
  );
  assert.deepEqual(portableHolesMetadata({ enabled: true }), {
    enabled: true,
    name: "Hole Lotta Storage",
    itemName: "Portable Hole",
    itemCount: 4,
    slotsPerBag: 24,
    repeatable: true
  });
});

test("accepts only request ID and opaque character ID from the browser", () => {
  assert.deepEqual(parsePortableHolesInput({ requestId, characterId: "42" }), {
    requestId,
    characterId: "42"
  });
  for (const body of [
    { requestId: requestId.toUpperCase(), characterId: "42" },
    { requestId, characterId: "042" },
    { requestId, characterId: "42", itemEntry: 51_809 },
    { requestId, characterId: "42", count: 4 },
    { requestId, characterId: "42", subject: "anything" }
  ]) {
    assert.equal(parsePortableHolesInput(body), undefined);
  }
});

test("builds the fixed send-items command and recognizes only exact known output", () => {
  assert.equal(
    buildSendPortableHolesCommand("Thalgrim", requestId),
    `send items Thalgrim "Hole Lotta Storage" "Four Portable Holes requested through the portal. Request ID: ${requestId}" 51809:4`
  );
  assert.throws(() => buildSendPortableHolesCommand("Bad Name", requestId), /not safe/u);
  assert.equal(
    classifyPortableHolesCommandResult({ ok: true, output: "Mail sent to Thalgrim\r\n" }, "Thalgrim"),
    "sent"
  );
  assert.equal(
    classifyPortableHolesCommandResult({ ok: true, output: "Incorrect syntax." }, "Thalgrim"),
    "failed"
  );
  assert.equal(
    classifyPortableHolesCommandResult({ ok: true, output: "Mail sent." }, "Thalgrim"),
    "unknown"
  );
  assert.equal(classifyPortableHolesCommandResult({ ok: false, output: "" }, "Thalgrim"), "unknown");
});

test("sends once and returns a confirmed exact replay without SOAP", async () => {
  const repository = new FakeRepository();
  const commands: string[] = [];
  const service = serviceWith(repository, async (command) => {
    commands.push(command);
    return { ok: true, output: "Mail sent to Thalgrim" };
  });

  const first = await service.requestPortableHoles(7, { requestId, characterId: "42" });
  assert.equal(first.created, true);
  assert.equal(first.message, "Four Portable Holes were sent to Thalgrim by in-game mail.");
  assert.equal(commands.length, 1);
  assert.deepEqual(repository.marks, [[requestId, "sent", "command_confirmed"]]);

  repository.reservation = { kind: "existing", record: { ...record, status: "sent" } };
  const replay = await service.requestPortableHoles(7, { requestId, characterId: "42" });
  assert.equal(replay.created, false);
  assert.equal(commands.length, 1);
});

test("fails disabled, ownership, unsafe names, and request conflicts before SOAP", async () => {
  const disabledRepository = new FakeRepository();
  const disabled = new PortableHoleBoostService({
    repository: disabledRepository,
    getConfig: () => ({ enabled: false })
  });
  await assert.rejects(
    disabled.requestPortableHoles(7, { requestId, characterId: "42" }),
    (error) => error instanceof BoostRequestError && error.kind === "disabled"
  );
  assert.equal(disabledRepository.reserveCalls, 0);

  for (const rows of [[], [{ ...characterRow, name: "Bad Name" }]]) {
    const repository = new FakeRepository();
    const service = new PortableHoleBoostService({
      queryCharacters: async () => rows,
      repository,
      getConfig: () => ({ enabled: true })
    });
    await assert.rejects(
      service.requestPortableHoles(7, { requestId, characterId: "42" }),
      (error) => error instanceof BoostRequestError && ["ownership", "failed"].includes(error.kind)
    );
    assert.equal(repository.reserveCalls, 0);
  }

  const conflictingRepository = new FakeRepository();
  conflictingRepository.reservation = { kind: "conflict" };
  await assert.rejects(
    serviceWith(conflictingRepository).requestPortableHoles(7, { requestId, characterId: "42" }),
    (error) => error instanceof BoostRequestError && error.kind === "conflict"
  );
});

test("reconciles exact mail and preserves absent or partial outcomes as unknown", async () => {
  for (const mailMatch of ["exact", "absent", "ambiguous"] as const) {
    const repository = new FakeRepository();
    repository.mailMatch = mailMatch;
    const service = serviceWith(repository, async () => ({ ok: false, output: "" }));
    if (mailMatch === "exact") {
      const result = await service.requestPortableHoles(7, { requestId, characterId: "42" });
      assert.equal(result.status, "sent");
      assert.deepEqual(repository.marks, [[requestId, "sent", "mail_reconciled"]]);
    } else {
      await assert.rejects(
        service.requestPortableHoles(7, { requestId, characterId: "42" }),
        (error) => error instanceof BoostRequestError && error.kind === "unknown" &&
          error.requestId === requestId && /may already have arrived/u.test(error.message)
      );
      assert.deepEqual(repository.marks, [[
        requestId,
        "unknown",
        mailMatch === "ambiguous" ? "mail_ambiguous" : "confirmation_missing"
      ]]);
    }
  }
});

test("reconciles stale pending requests and treats different UUIDs as independent", async () => {
  const repository = new FakeRepository();
  repository.stale = [record];
  repository.mailMatch = "exact";
  const service = serviceWith(repository);
  assert.equal((await service.getMetadata(7)).repeatable, true);
  assert.deepEqual(repository.marks, [[requestId, "sent", "mail_reconciled"]]);

  const commands: string[] = [];
  const repeatRepository = new FakeRepository();
  const repeatService = serviceWith(repeatRepository, async (command) => {
    commands.push(command);
    return { ok: true, output: "Mail sent to Thalgrim" };
  });
  await repeatService.requestPortableHoles(7, { requestId, characterId: "42" });
  repeatRepository.reservation = {
    kind: "inserted",
    record: { ...record, requestId: secondRequestId }
  };
  await repeatService.requestPortableHoles(7, { requestId: secondRequestId, characterId: "42" });
  assert.equal(commands.length, 2);
  assert.match(commands[1] ?? "", new RegExp(secondRequestId, "u"));
});
