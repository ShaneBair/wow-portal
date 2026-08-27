import assert from "node:assert/strict";
import test from "node:test";
import { readMoneyBoostConfig } from "../src/services/boost-config.js";
import {
  type MoneyBoostRecord,
  MoneyBoostRepository,
  type ReserveMoneyBoostResult
} from "../src/services/money-boost-repository.js";
import {
  BoostRequestError,
  buildOwnedCharactersQuery,
  buildSendMoneyCommand,
  classifyMoneyCommandResult,
  goldToCopper,
  mapOwnedCharacterRows,
  parseMoneyBoostInput,
  PlayerBoostService
} from "../src/services/player-boosts.js";

const requestId = "0d6202eb-15c0-4e62-9cc2-f7697dd5866f";
const config = {
  enabled: true,
  minimumGold: 1 as const,
  maximumGoldPerRequest: 10_000,
  dailyGoldLimit: 20_000,
  dailyRequestLimit: 5
};
const characterRow = { guid: 42, name: "Thalgrim", level: 80, race: 3, class: 2 };
const record: MoneyBoostRecord = {
  requestId,
  accountId: 7,
  characterGuid: 42,
  characterName: "Thalgrim",
  gold: 500,
  copper: 5_000_000,
  status: "pending",
  createdAt: new Date("2026-08-27T12:00:00.000Z")
};

class FakeRepository extends MoneyBoostRepository {
  reservation: ReserveMoneyBoostResult = { kind: "inserted", record };
  reserveCalls = 0;
  mailMatches = 0;
  stale: MoneyBoostRecord[] = [];
  marks: Array<[string, string, string]> = [];

  override async reserve(): Promise<ReserveMoneyBoostResult> {
    this.reserveCalls += 1;
    return this.reservation;
  }

  override async mark(id: string, status: "sent" | "failed" | "unknown", category: string): Promise<void> {
    this.marks.push([id, status, category]);
  }

  override async countMatchingMail(): Promise<number> {
    return this.mailMatches;
  }

  override async findStalePending(): Promise<MoneyBoostRecord[]> {
    return this.stale;
  }
}

test("validates boost defaults and command-safe limits", () => {
  assert.deepEqual(readMoneyBoostConfig({}), {
    enabled: false,
    minimumGold: 1,
    maximumGoldPerRequest: 10_000,
    dailyGoldLimit: 20_000,
    dailyRequestLimit: 5
  });
  assert.equal(readMoneyBoostConfig({ BOOST_MONEY_ENABLED: "true" }).enabled, true);
  assert.throws(() => readMoneyBoostConfig({ BOOST_MONEY_ENABLED: "yes" }), /true or false/u);
  assert.throws(
    () => readMoneyBoostConfig({ BOOST_MONEY_MAX_GOLD_PER_REQUEST: "214749" }),
    /214748/u
  );
});

test("builds parameterized ownership queries and strips private character fields", () => {
  const query = buildOwnedCharactersQuery({ charactersDatabase: "acore_characters" }, 7, 42);
  assert.match(query.sql, /account = \?/u);
  assert.match(query.sql, /deleteInfos_Name IS NULL/u);
  assert.match(query.sql, /guid = \?/u);
  assert.deepEqual(query.values, [7, 42]);

  const mapped = mapOwnedCharacterRows([
    { guid: 44, name: "Zed", level: 10, race: 99, class: 98, account: 999, money: 123 },
    characterRow
  ]);
  assert.deepEqual(mapped.map(({ guid: _guid, ...entry }) => entry), [
    { id: "42", name: "Thalgrim", level: 80, race: "Dwarf", class: "Paladin" },
    { id: "44", name: "Zed", level: 10, race: "Unknown race (99)", class: "Unknown class (98)" }
  ]);
  assert.equal("account" in mapped[0]!, false);
  assert.equal("money" in mapped[0]!, false);
});

test("validates UUID, opaque character ID, whole gold, and copper conversion", () => {
  assert.deepEqual(parseMoneyBoostInput({ requestId, characterId: "42", gold: 500 }, config), {
    requestId,
    characterId: "42",
    gold: 500
  });
  for (const body of [
    { requestId: requestId.toUpperCase(), characterId: "42", gold: 500 },
    { requestId, characterId: "042", gold: 500 },
    { requestId, characterId: "42", gold: 1.5 },
    { requestId, characterId: "42", gold: 10_001 },
    { requestId, characterId: "42", gold: 500, accountId: 7 }
  ]) {
    assert.equal(parseMoneyBoostInput(body, config), undefined);
  }
  assert.equal(goldToCopper(500), 5_000_000);
  assert.throws(() => goldToCopper(214_749), /represented safely/u);
});

test("builds the one fixed command and recognizes only the exact compatible success", () => {
  const command = buildSendMoneyCommand("Thalgrim", requestId, 5_000_000);
  assert.equal(
    command,
    `send money Thalgrim "DaBoysZeroth Boost" "Free Money requested through the portal. Request ID: ${requestId}" 5000000`
  );
  assert.throws(() => buildSendMoneyCommand("Bad Name", requestId, 5_000_000), /not safe/u);
  assert.equal(classifyMoneyCommandResult({ ok: true, output: "Mail sent to Thalgrim\r\n" }, "Thalgrim"), "sent");
  assert.equal(classifyMoneyCommandResult({ ok: true, output: "Incorrect syntax." }, "Thalgrim"), "failed");
  assert.equal(classifyMoneyCommandResult({ ok: true, output: "Mail sent." }, "Thalgrim"), "unknown");
  assert.equal(classifyMoneyCommandResult({ ok: false, output: "" }, "Thalgrim"), "unknown");
});

test("sends one command for a first request and returns exact sent replays without SOAP", async () => {
  const repository = new FakeRepository();
  const commands: string[] = [];
  const service = new PlayerBoostService({
    queryCharacters: async (accountId, guid) => {
      assert.equal(accountId, 7);
      assert.equal(guid, 42);
      return [characterRow];
    },
    repository,
    getConfig: () => config,
    executeCommand: async (command) => {
      commands.push(command);
      return { ok: true, output: "Mail sent to Thalgrim" };
    }
  });

  const first = await service.requestMoney(7, { requestId, characterId: "42", gold: 500 });
  assert.equal(first.created, true);
  assert.equal(first.message, "500 gold was sent to Thalgrim by in-game mail.");
  assert.equal(commands.length, 1);
  assert.deepEqual(repository.marks, [[requestId, "sent", "command_confirmed"]]);

  repository.reservation = { kind: "existing", record: { ...record, status: "sent" } };
  const replay = await service.requestMoney(7, { requestId, characterId: "42", gold: 500 });
  assert.equal(replay.created, false);
  assert.equal(commands.length, 1);
});

test("fails ownership and conflicts before SOAP", async () => {
  let commands = 0;
  const repository = new FakeRepository();
  const service = new PlayerBoostService({
    queryCharacters: async () => [],
    repository,
    getConfig: () => config,
    executeCommand: async () => {
      commands += 1;
      return { ok: true, output: "Mail sent to Thalgrim" };
    }
  });
  await assert.rejects(
    service.requestMoney(7, { requestId, characterId: "42", gold: 500 }),
    (error) => error instanceof BoostRequestError && error.kind === "ownership"
  );
  assert.equal(commands, 0);

  repository.reservation = { kind: "conflict" };
  const conflicting = new PlayerBoostService({
    queryCharacters: async () => [characterRow],
    repository,
    getConfig: () => config,
    executeCommand: async () => {
      commands += 1;
      return { ok: true, output: "Mail sent to Thalgrim" };
    }
  });
  await assert.rejects(
    conflicting.requestMoney(7, { requestId, characterId: "42", gold: 500 }),
    (error) => error instanceof BoostRequestError && error.kind === "conflict"
  );
  assert.equal(commands, 0);
});

test("rejects an unproven character-name representation before durable reservation", async () => {
  const repository = new FakeRepository();
  const service = new PlayerBoostService({
    queryCharacters: async () => [{ ...characterRow, name: "Bad Name" }],
    repository,
    getConfig: () => config
  });
  await assert.rejects(
    service.requestMoney(7, { requestId, characterId: "42", gold: 500 }),
    (error) => error instanceof BoostRequestError && error.kind === "failed"
  );
  assert.equal(repository.reserveCalls, 0);
});

test("reconciles ambiguous command outcomes and never resends unknown requests", async () => {
  const repository = new FakeRepository();
  repository.mailMatches = 1;
  const service = new PlayerBoostService({
    queryCharacters: async () => [characterRow],
    repository,
    getConfig: () => config,
    executeCommand: async () => ({ ok: false, output: "" })
  });
  const reconciled = await service.requestMoney(7, { requestId, characterId: "42", gold: 500 });
  assert.equal(reconciled.status, "sent");
  assert.deepEqual(repository.marks, [[requestId, "sent", "mail_reconciled"]]);

  repository.marks = [];
  repository.mailMatches = 0;
  repository.reservation = { kind: "existing", record: { ...record, status: "unknown" } };
  await assert.rejects(
    service.requestMoney(7, { requestId, characterId: "42", gold: 500 }),
    (error) => error instanceof BoostRequestError && error.kind === "unknown" && error.requestId === requestId
  );
  assert.deepEqual(repository.marks, [[requestId, "unknown", "confirmation_missing"]]);
});

test("reconciles stale pending requests while loading the overview", async () => {
  const repository = new FakeRepository();
  repository.stale = [record];
  repository.mailMatches = 0;
  const service = new PlayerBoostService({
    queryCharacters: async () => [characterRow],
    repository,
    getConfig: () => ({ ...config, enabled: false })
  });
  const overview = await service.getOverview(7);
  assert.equal(overview.money.enabled, false);
  assert.equal(overview.characters[0]?.name, "Thalgrim");
  assert.deepEqual(repository.marks, [[requestId, "unknown", "stale_pending"]]);
});
