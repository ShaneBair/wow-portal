import assert from "node:assert/strict";
import test from "node:test";
import {
  buildArmoryCharacterQuery,
  buildArmoryCharactersQuery,
  buildArmoryEquipmentQuery,
  mapArmoryCharacterRows,
  mapArmoryEquipmentRows,
  mapArmoryTalentRows,
  type ArmoryConfig
} from "../src/services/armory.js";

const config: ArmoryConfig = {
  charactersDatabase: "acore_characters",
  playerbotsDatabase: "acore_playerbots",
  worldDatabase: "acore_world"
};

test("builds bounded armory queries with bot, deletion, visibility, ownership, and equipment scopes", () => {
  const scope = { cacheKey: "standard", excludedAccountIds: [9, 11] } as const;
  const list = buildArmoryCharactersQuery(config, scope);
  assert.match(list.sql, /LEFT JOIN `acore_playerbots`\.`playerbots_account_type`/u);
  assert.match(list.sql, /c\.deleteInfos_Name IS NULL/u);
  assert.match(list.sql, /p\.account_id IS NULL/u);
  assert.match(list.sql, /c\.account NOT IN \(\?, \?\)/u);
  assert.match(list.sql, /LIMIT 2501$/u);
  assert.deepEqual(list.values, [9, 11]);

  const character = buildArmoryCharacterQuery(config, scope, 42);
  assert.match(character.sql, /c\.guid = \?/u);
  assert.deepEqual(character.values, [42, 9, 11]);

  const equipment = buildArmoryEquipmentQuery(config, 42);
  assert.match(equipment.sql, /ii\.owner_guid = ci\.guid/u);
  assert.match(equipment.sql, /ci\.bag = 0 AND ci\.slot BETWEEN 0 AND 18/u);
  assert.match(equipment.sql, /ScalingStatDistribution AS scalingDistribution/u);
  assert.match(equipment.sql, /ScalingStatValue AS scalingValue/u);
  assert.deepEqual(equipment.values, [42]);
});

test("maps, validates, sorts, and de-duplicates character summaries", () => {
  assert.deepEqual(mapArmoryCharacterRows([
    { characterGuid: 9, characterName: "Zed", level: 80, raceId: 1, classId: 1 },
    { characterGuid: 7, characterName: "Ari", level: 19, raceId: 4, classId: 3 }
  ]), [
    { id: "7", name: "Ari", level: 19, race: "Night Elf", class: "Hunter" },
    { id: "9", name: "Zed", level: 80, race: "Human", class: "Warrior" }
  ]);
  assert.throws(() => mapArmoryCharacterRows([
    { characterGuid: 7, characterName: "Ari", level: 19, raceId: 4, classId: 3 },
    { characterGuid: 7, characterName: "Again", level: 19, raceId: 4, classId: 3 }
  ]), /duplicates/u);
  assert.throws(() => mapArmoryCharacterRows([
    { characterGuid: 7, characterName: "Ari", level: 19, raceId: 99, classId: 3 }
  ]), /unsupported/u);
});

function equipmentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row: Record<string, unknown> = {
    slot: 0, itemEntry: 16846, durability: 80, name: "Giantstalker's Helmet", quality: 4,
    itemLevel: 66, requiredLevel: 60, inventoryType: 1, bonding: 1, armor: 343, block: 0,
    scalingDistribution: 0, scalingValue: 0,
    maxDurability: 85, description: "", damageMinimum: 0, damageMaximum: 0, delay: 1000,
    holyResistance: 0, fireResistance: 5, natureResistance: 0, frostResistance: 0,
    shadowResistance: 0, arcaneResistance: 0, socket1: 2, socket2: 0, socket3: 0
  };
  for (let index = 1; index <= 10; index += 1) {
    row[`statType${index}`] = index === 1 ? 3 : 0;
    row[`statValue${index}`] = index === 1 ? 23 : 0;
  }
  return { ...row, ...overrides };
}

test("maps equipped items into all nineteen slots and builds rich tooltip data", () => {
  const equipment = mapArmoryEquipmentRows([equipmentRow()], 80);
  assert.equal(equipment.length, 19);
  assert.equal(equipment[0]!.name, "Head");
  assert.deepEqual(equipment[0]!.item, {
    entry: 16846,
    name: "Giantstalker's Helmet",
    quality: 4,
    qualityName: "Epic",
    itemLevel: 66,
    requiredLevel: 60,
    inventoryType: "Head",
    bonding: "Binds when picked up",
    armor: 343,
    block: 0,
    stats: [{ name: "Agility", value: 23 }],
    sockets: ["Red"],
    resistances: [{ name: "Fire resistance", value: 5 }],
    durability: { current: 80, maximum: 85 }
  });
  assert.equal(equipment[1]!.item, null);
  assert.throws(() => mapArmoryEquipmentRows([equipmentRow(), equipmentRow({ itemEntry: 1 })], 80), /duplicate slot/u);
  assert.throws(() => mapArmoryEquipmentRows([equipmentRow({ durability: 99 })], 80), /durability/u);
});

test("calculates AzerothCore heirloom stats and weapon damage at the character's level", () => {
  const equipment = mapArmoryEquipmentRows([equipmentRow({
    itemEntry: 44096,
    name: "Battleworn Thrash Blade",
    inventoryType: 13,
    scalingDistribution: 297,
    scalingValue: 516,
    damageMinimum: 1,
    damageMaximum: 0,
    delay: 2400
  })], 24);

  assert.equal(equipment[0]!.item?.name, "Battleworn Thrash Blade");
  assert.deepEqual(equipment[0]!.item?.stats, [{ name: "Resilience rating", value: 3 }]);
  assert.equal(equipment[0]!.item?.damage?.speedSeconds, 2.4);
  assert.equal(equipment[0]!.item?.damage?.dps, 18);
  assert.ok(Math.abs((equipment[0]!.item?.damage?.minimum ?? 0) - 30.24) < 0.0001);
  assert.ok(Math.abs((equipment[0]!.item?.damage?.maximum ?? 0) - 56.16) < 0.0001);
  assert.throws(() => mapArmoryEquipmentRows([
    equipmentRow({ damageMinimum: 20, damageMaximum: 10, delay: 2400 })
  ], 24), /damage/u);
});

test("calculates level-scaled heirloom attributes, armor, and spell power", () => {
  const shoulders = mapArmoryEquipmentRows([equipmentRow({
    itemEntry: 42949,
    name: "Polished Spaulders of Valor",
    inventoryType: 3,
    scalingDistribution: 7,
    scalingValue: 257,
    armor: 31,
    damageMinimum: 0,
    damageMaximum: 0,
    delay: 0
  })], 24)[0]!.item;

  assert.equal(shoulders?.armor, 161);
  assert.deepEqual(shoulders?.stats, [
    { name: "Strength", value: 7 },
    { name: "Stamina", value: 7 },
    { name: "Critical strike rating", value: 5 }
  ]);

  const spellItem = mapArmoryEquipmentRows([equipmentRow({
    scalingDistribution: 7,
    scalingValue: 0x00008001,
    damageMinimum: 0,
    damageMaximum: 0,
    delay: 0
  })], 24)[0]!.item;
  assert.deepEqual(spellItem?.stats.at(-1), { name: "Spell power", value: 19 });
});

test("groups known and custom talent spells into one or two loadouts", () => {
  const loadouts = mapArmoryTalentRows([
    { spell: 724, specMask: 3 },
    { spell: 999999, specMask: 2 }
  ], 2, 1);
  assert.equal(loadouts.length, 2);
  assert.equal(loadouts[0]!.active, false);
  assert.equal(loadouts[1]!.active, true);
  assert.equal(loadouts[0]!.trees[0]!.name, "Holy");
  assert.equal(loadouts[0]!.trees[0]!.talents[0]!.name, "Lightwell");
  assert.equal(loadouts[1]!.trees.find((tree) => tree.name === "Other")!.talents[0]!.name, "Talent spell 999999");
  assert.throws(() => mapArmoryTalentRows([], 2, 2), /group state/u);
});
