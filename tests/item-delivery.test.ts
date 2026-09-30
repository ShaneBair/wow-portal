import assert from "node:assert/strict";
import test from "node:test";
import { readItemDeliveryBoostConfig } from "../src/services/boost-config.js";
import {
  ItemDeliveryRepository,
  type ItemDeliveryMailMatch,
  type ItemDeliveryRecord,
  type ReserveItemDeliveryResult
} from "../src/services/item-delivery-repository.js";
import {
  buildItemTemplateQuery,
  buildSendItemDeliveryCommand,
  calculateItemMaximum,
  classifyItemDeliveryCommandResult,
  ItemDeliveryService,
  mapItemTemplateRows,
  parseItemDeliveryInput,
  parseItemId,
  isCanonicalItemDeliveryJson
} from "../src/services/item-delivery.js";
import { BoostRequestError } from "../src/services/player-boosts.js";

const requestId = "d68083f4-44f2-4fb7-890c-1c107ef16e50";
const config = { enabled: true, maximumQuantity: 200 };
const characterRow = { guid: 42, name: "Thalgrim", level: 80, race: 3, class: 2 };
const itemRow = { id: 41599, name: "Frostweave Bag", quality: 2, stackSize: 20, maxCount: 0 };
const record: ItemDeliveryRecord = {
  requestId,
  boostKey: "item-delivery-v1",
  accountId: 7,
  characterGuid: 42,
  characterName: "Thalgrim",
  itemEntry: 41599,
  itemName: "Frostweave Bag",
  itemQuantity: 4,
  itemStackSize: 20,
  status: "pending",
  createdAt: new Date("2026-09-30T12:00:00.000Z")
};

class FakeRepository extends ItemDeliveryRepository {
  reservation: ReserveItemDeliveryResult = { kind: "inserted", record };
  reserveCalls = 0;
  mailMatch: ItemDeliveryMailMatch = "absent";
  stale: ItemDeliveryRecord[] = [];
  marks: Array<[string, string, string]> = [];

  override async reserve(): Promise<ReserveItemDeliveryResult> {
    this.reserveCalls += 1;
    return this.reservation;
  }
  override async mark(id: string, status: "sent" | "failed" | "unknown", category: string): Promise<void> {
    this.marks.push([id, status, category]);
  }
  override async inspectMatchingMail(): Promise<ItemDeliveryMailMatch> { return this.mailMatch; }
  override async findStalePending(): Promise<ItemDeliveryRecord[]> { return this.stale; }
}

function serviceWith(repository = new FakeRepository(), overrides: {
  itemRows?: unknown;
  characterRows?: unknown;
  execute?: (command: string) => Promise<{ ok: boolean; output: string }>;
  now?: () => Date;
} = {}) {
  return new ItemDeliveryService({
    repository,
    getConfig: () => config,
    getWorldDatabase: () => "acore_world",
    queryItem: async () => overrides.itemRows ?? [itemRow],
    queryCharacters: async () => overrides.characterRows ?? [characterRow],
    executeCommand: overrides.execute ?? (async () => ({ ok: true, output: "Mail sent to Thalgrim" })),
    now: overrides.now
  });
}

test("item-delivery configuration fails closed and validates its ceiling", () => {
  assert.throws(() => readItemDeliveryBoostConfig({}), /MAX_QUANTITY is required/u);
  assert.deepEqual(readItemDeliveryBoostConfig({
    BOOST_ITEM_DELIVERY_ENABLED: "false",
    BOOST_ITEM_DELIVERY_MAX_QUANTITY: "200"
  }), { enabled: false, maximumQuantity: 200 });
  assert.throws(() => readItemDeliveryBoostConfig({
    BOOST_ITEM_DELIVERY_ENABLED: "yes",
    BOOST_ITEM_DELIVERY_MAX_QUANTITY: "200"
  }), /true or false/u);
  assert.throws(() => readItemDeliveryBoostConfig({
    BOOST_ITEM_DELIVERY_ENABLED: "true",
    BOOST_ITEM_DELIVERY_MAX_QUANTITY: "0"
  }), /positive whole number/u);
});

test("builds a bounded parameterized world lookup and strips private columns", () => {
  const query = buildItemTemplateQuery("acore_world", 41599);
  assert.match(query.sql, /FROM `acore_world`\.`item_template`/u);
  assert.match(query.sql, /WHERE entry = \?/u);
  assert.deepEqual(query.values, [41599]);
  assert.doesNotMatch(query.sql, /41599/u);
  assert.deepEqual(mapItemTemplateRows([{ ...itemRow, SellPrice: 999, ScriptName: "secret" }], 41599), itemRow);
  assert.equal(mapItemTemplateRows([], 41599), undefined);
  assert.throws(() => mapItemTemplateRows([{ ...itemRow, id: 41600 }], 41599), /identity/u);
  assert.throws(() => buildItemTemplateQuery("world`; DROP TABLE item_template", 41599), /ASCII letters/u);
});

test("calculates item-specific maxima from absolute, stack, attachment, and maxcount limits", () => {
  assert.equal(calculateItemMaximum({ stackSize: 20, maxCount: 0 }, 200), 200);
  assert.equal(calculateItemMaximum({ stackSize: 5, maxCount: 0 }, 200), 60);
  assert.equal(calculateItemMaximum({ stackSize: 20, maxCount: 7 }, 200), 7);
  assert.equal(calculateItemMaximum({ stackSize: 20, maxCount: 500 }, 50), 50);
});

test("accepts only decimal lookup IDs and exact integer mutation fields", () => {
  assert.equal(parseItemId("41599"), 41599);
  for (const value of ["041599", "1e3", "1.5", " 1", "-1", "4294967296", 1.5]) {
    assert.equal(parseItemId(value), undefined);
  }
  assert.deepEqual(parseItemDeliveryInput({ requestId, characterId: "42", itemId: 41599, quantity: 4 }, config), {
    requestId, characterId: "42", itemId: 41599, quantity: 4
  });
  for (const body of [
    { requestId, characterId: "42", itemId: "41599", quantity: 4 },
    { requestId, characterId: "42", itemId: 41599, quantity: 0 },
    { requestId, characterId: "42", itemId: 41599, quantity: 201 },
    { requestId, characterId: "42", itemId: 41599, quantity: 4, command: "send items" }
  ]) assert.equal(parseItemDeliveryInput(body, config), undefined);
  assert.equal(isCanonicalItemDeliveryJson(
    `{"requestId":"${requestId}","characterId":"42","itemId":41599,"quantity":4}`
  ), true);
  assert.equal(isCanonicalItemDeliveryJson(
    `{"requestId":"${requestId}","characterId":"42","itemId":4.1599e4,"quantity":4}`
  ), false);
  assert.equal(isCanonicalItemDeliveryJson(
    `{"requestId":"${requestId}","characterId":"42","itemId":41599,"quantity":4.0}`
  ), false);
});

test("constructs one fixed command and classifies only compatible output", () => {
  assert.equal(
    buildSendItemDeliveryCommand("Thalgrim", requestId, 41599, 4),
    `send items Thalgrim "Item Delivery Service" "Items requested through the portal. Request ID: ${requestId}" 41599:4`
  );
  assert.throws(() => buildSendItemDeliveryCommand("Bad Name", requestId, 41599, 4), /not safe/u);
  assert.equal(classifyItemDeliveryCommandResult(
    { ok: true, output: "Mail sent to Thalgrim\r\n" }, "Thalgrim", 41599, 4
  ), "sent");
  assert.equal(classifyItemDeliveryCommandResult(
    { ok: true, output: "Invalid item count (4) for item 41599" }, "Thalgrim", 41599, 4
  ), "failed");
  assert.equal(classifyItemDeliveryCommandResult(
    { ok: true, output: "Mail sent." }, "Thalgrim", 41599, 4
  ), "unknown");
  assert.equal(classifyItemDeliveryCommandResult(
    { ok: false, output: "" }, "Thalgrim", 41599, 4
  ), "unknown");
});

test("looks up previews and revalidates item limits and ownership before reserving", async () => {
  const repository = new FakeRepository();
  const service = serviceWith(repository);
  assert.deepEqual(await service.lookupItem(41599), {
    id: 41599, name: "Frostweave Bag", quality: 2, maximumQuantity: 200
  });
  await assert.rejects(
    serviceWith(repository, { itemRows: [] }).requestItem(7, { requestId, characterId: "42", itemId: 41599, quantity: 4 }),
    (error) => error instanceof BoostRequestError && error.kind === "not-found"
  );
  await assert.rejects(
    serviceWith(repository, { itemRows: [{ ...itemRow, stackSize: 1 }] })
      .requestItem(7, { requestId, characterId: "42", itemId: 41599, quantity: 13 }),
    (error) => error instanceof BoostRequestError && error.kind === "invalid"
  );
  await assert.rejects(
    serviceWith(repository, { characterRows: [] })
      .requestItem(7, { requestId, characterId: "42", itemId: 41599, quantity: 4 }),
    (error) => error instanceof BoostRequestError && error.kind === "ownership"
  );
  assert.equal(repository.reserveCalls, 0);
});

test("sends once, returns exact replay, and rejects conflicting UUID reuse", async () => {
  const repository = new FakeRepository();
  const commands: string[] = [];
  const service = serviceWith(repository, { execute: async (command) => {
    commands.push(command);
    return { ok: true, output: "Mail sent to Thalgrim" };
  } });
  const first = await service.requestItem(7, { requestId, characterId: "42", itemId: 41599, quantity: 4 });
  assert.equal(first.created, true);
  assert.equal(first.message, "4 Frostweave Bags were sent to Thalgrim by in-game mail.");
  assert.equal(commands.length, 1);
  assert.deepEqual(repository.marks, [[requestId, "sent", "command_confirmed"]]);

  repository.reservation = { kind: "existing", record: { ...record, status: "sent" } };
  const replay = await service.requestItem(7, { requestId, characterId: "42", itemId: 41599, quantity: 4 });
  assert.equal(replay.created, false);
  assert.equal(commands.length, 1);

  repository.reservation = { kind: "conflict" };
  await assert.rejects(
    service.requestItem(7, { requestId, characterId: "42", itemId: 41599, quantity: 4 }),
    (error) => error instanceof BoostRequestError && error.kind === "conflict"
  );
  assert.equal(commands.length, 1);
});

test("reconciles exact mail and never resends unknown or stale requests", async () => {
  for (const mailMatch of ["exact", "absent", "ambiguous"] as const) {
    const repository = new FakeRepository();
    repository.mailMatch = mailMatch;
    const service = serviceWith(repository, { execute: async () => ({ ok: false, output: "" }) });
    if (mailMatch === "exact") {
      assert.equal((await service.requestItem(7, {
        requestId, characterId: "42", itemId: 41599, quantity: 4
      })).status, "sent");
      assert.deepEqual(repository.marks, [[requestId, "sent", "mail_reconciled"]]);
    } else {
      await assert.rejects(
        service.requestItem(7, { requestId, characterId: "42", itemId: 41599, quantity: 4 }),
        (error) => error instanceof BoostRequestError && error.kind === "unknown" && error.requestId === requestId
      );
    }
  }

  const staleRepository = new FakeRepository();
  staleRepository.stale = [record];
  staleRepository.mailMatch = "absent";
  const metadata = await serviceWith(staleRepository).getMetadata(7);
  assert.equal(metadata.enabled, true);
  assert.deepEqual(staleRepository.marks, [[requestId, "unknown", "stale_pending"]]);

  staleRepository.marks = [];
  staleRepository.reservation = { kind: "existing", record: { ...record, status: "unknown" } };
  await assert.rejects(
    serviceWith(staleRepository).requestItem(7, { requestId, characterId: "42", itemId: 41599, quantity: 4 }),
    (error) => error instanceof BoostRequestError && error.kind === "unknown"
  );
});
