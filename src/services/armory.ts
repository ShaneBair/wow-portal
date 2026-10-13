import type { RowDataPacket } from "mysql2/promise";
import { WOTLK_TALENT_CATALOG } from "../data/wotlk-talent-catalog.js";
import { getClassName, getRaceName, isKnownClass, isKnownRace } from "../domain/wotlk.js";
import { buildAccountExclusionClause, type AccountVisibilityScope } from "./account-visibility.js";
import {
  getPortalDatabase,
  type PortalDatabaseConfig,
  validatePortalDatabaseIdentifier
} from "./portal-database.js";

const QUERY_TIMEOUT_MS = 8_000;
const CHARACTER_LIMIT = 2_501;
const MAX_CHARACTERS = 2_500;
const MAX_TALENTS = 250;
const MAX_UINT32 = 0xffff_ffff;

const EQUIPMENT_SLOTS = [
  "Head", "Neck", "Shoulders", "Shirt", "Chest", "Waist", "Legs", "Feet", "Wrists", "Hands",
  "Finger 1", "Finger 2", "Trinket 1", "Trinket 2", "Back", "Main hand", "Off hand", "Ranged", "Tabard"
] as const;

const QUALITY_NAMES = ["Poor", "Common", "Uncommon", "Rare", "Epic", "Legendary", "Artifact", "Heirloom"] as const;
const INVENTORY_TYPE_NAMES: Readonly<Record<number, string>> = {
  0: "Non-equippable", 1: "Head", 2: "Neck", 3: "Shoulder", 4: "Shirt", 5: "Chest", 6: "Waist",
  7: "Legs", 8: "Feet", 9: "Wrist", 10: "Hands", 11: "Finger", 12: "Trinket", 13: "One-Hand",
  14: "Shield", 15: "Ranged", 16: "Back", 17: "Two-Hand", 18: "Bag", 19: "Tabard", 20: "Robe",
  21: "Main Hand", 22: "Off Hand", 23: "Held In Off-hand", 24: "Ammo", 25: "Thrown", 26: "Ranged",
  27: "Quiver", 28: "Relic"
};
const BONDING_NAMES: Readonly<Record<number, string>> = {
  1: "Binds when picked up", 2: "Binds when equipped", 3: "Binds when used", 4: "Quest item", 5: "Quest item"
};
const STAT_NAMES: Readonly<Record<number, string>> = {
  0: "Mana", 1: "Health", 3: "Agility", 4: "Strength", 5: "Intellect", 6: "Spirit", 7: "Stamina",
  12: "Defense rating", 13: "Dodge rating", 14: "Parry rating", 15: "Block rating",
  16: "Melee hit rating", 17: "Ranged hit rating", 18: "Spell hit rating", 19: "Melee critical strike rating",
  20: "Ranged critical strike rating", 21: "Spell critical strike rating", 22: "Melee hit avoidance rating",
  23: "Ranged hit avoidance rating", 24: "Spell hit avoidance rating", 25: "Melee critical avoidance rating",
  26: "Ranged critical avoidance rating", 27: "Spell critical avoidance rating", 28: "Melee haste rating",
  29: "Ranged haste rating", 30: "Spell haste rating", 31: "Hit rating", 32: "Critical strike rating",
  33: "Hit avoidance rating", 34: "Critical avoidance rating", 35: "Resilience rating", 36: "Haste rating",
  37: "Expertise rating", 38: "Attack power", 39: "Ranged attack power", 41: "Healing power",
  42: "Spell damage", 43: "Mana per 5 sec", 44: "Armor penetration rating", 45: "Spell power",
  46: "Health regeneration", 47: "Spell penetration", 48: "Block value"
};
const SOCKET_NAMES: Readonly<Record<number, string>> = { 1: "Meta", 2: "Red", 4: "Yellow", 8: "Blue" };

export interface ArmoryConfig {
  charactersDatabase: string;
  playerbotsDatabase: string;
  worldDatabase: string;
}

export interface ArmoryCharacterSummary {
  id: string;
  name: string;
  level: number;
  race: string;
  class: string;
}

export interface ArmoryItemStat { name: string; value: number; }

export interface ArmoryItem {
  entry: number;
  name: string;
  quality: number;
  qualityName: string;
  itemLevel: number;
  requiredLevel: number;
  inventoryType: string;
  bonding?: string;
  armor: number;
  block: number;
  stats: ArmoryItemStat[];
  sockets: string[];
  resistances: ArmoryItemStat[];
  damage?: { minimum: number; maximum: number; speedSeconds: number; dps: number };
  damageScalesWithLevel?: boolean;
  durability?: { current: number; maximum: number };
  description?: string;
}

export interface ArmoryEquipmentSlot {
  slot: number;
  name: string;
  item: ArmoryItem | null;
}

export interface ArmoryTalent {
  spellId: number;
  name: string;
  rank: number;
  maximumRank: number;
  tier: number;
  column: number;
}

export interface ArmoryTalentTree {
  name: string;
  points: number;
  talents: ArmoryTalent[];
}

export interface ArmoryTalentLoadout {
  index: number;
  name: string;
  active: boolean;
  points: number;
  trees: ArmoryTalentTree[];
}

export interface ArmoryCharacterDetail extends ArmoryCharacterSummary {
  generatedAt: string;
  equipment: ArmoryEquipmentSlot[];
  talentLoadouts: ArmoryTalentLoadout[];
}

export interface ArmoryQuery { sql: string; values: readonly number[]; }

export class ArmoryConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = "ArmoryConfigurationError"; }
}

export class ArmoryDataError extends Error {
  constructor(message: string) { super(message); this.name = "ArmoryDataError"; }
}

function qualified(database: string, table: string): string {
  return `\`${database}\`.\`${table}\``;
}

export function readArmoryConfig(
  portal: Pick<PortalDatabaseConfig, "charactersDatabase">,
  environment: NodeJS.ProcessEnv = process.env
): ArmoryConfig {
  const playerbots = environment.PORTAL_PLAYERBOTS_DATABASE?.trim();
  const world = environment.PORTAL_WORLD_DATABASE?.trim();
  if (!playerbots) throw new ArmoryConfigurationError("PORTAL_PLAYERBOTS_DATABASE is required.");
  if (!world) throw new ArmoryConfigurationError("PORTAL_WORLD_DATABASE is required.");
  return {
    charactersDatabase: validatePortalDatabaseIdentifier(portal.charactersDatabase, "PORTAL_CHARACTERS_DATABASE"),
    playerbotsDatabase: validatePortalDatabaseIdentifier(playerbots, "PORTAL_PLAYERBOTS_DATABASE"),
    worldDatabase: validatePortalDatabaseIdentifier(world, "PORTAL_WORLD_DATABASE")
  };
}

export function buildArmoryCharactersQuery(config: ArmoryConfig, visibility: AccountVisibilityScope): ArmoryQuery {
  const exclusion = buildAccountExclusionClause(visibility, "c.account", "  ");
  return {
    sql: `SELECT c.guid AS characterGuid, c.name AS characterName, c.level, c.race AS raceId, c.class AS classId
FROM ${qualified(config.charactersDatabase, "characters")} c
LEFT JOIN ${qualified(config.playerbotsDatabase, "playerbots_account_type")} p ON p.account_id = c.account
WHERE c.deleteInfos_Name IS NULL
  AND p.account_id IS NULL
${exclusion.clause}ORDER BY LOWER(c.name), c.guid
LIMIT ${CHARACTER_LIMIT}`,
    values: exclusion.values
  };
}

export function buildArmoryCharacterQuery(
  config: ArmoryConfig,
  visibility: AccountVisibilityScope,
  characterGuid: number
): ArmoryQuery {
  const exclusion = buildAccountExclusionClause(visibility, "c.account", "  ");
  return {
    sql: `SELECT c.guid AS characterGuid, c.name AS characterName, c.level, c.race AS raceId,
  c.class AS classId, c.talentGroupsCount, c.activeTalentGroup
FROM ${qualified(config.charactersDatabase, "characters")} c
LEFT JOIN ${qualified(config.playerbotsDatabase, "playerbots_account_type")} p ON p.account_id = c.account
WHERE c.guid = ?
  AND c.deleteInfos_Name IS NULL
  AND p.account_id IS NULL
${exclusion.clause}LIMIT 2`,
    values: [characterGuid, ...exclusion.values]
  };
}

export function buildArmoryEquipmentQuery(config: ArmoryConfig, characterGuid: number): ArmoryQuery {
  const item = qualified(config.worldDatabase, "item_template");
  return {
    sql: `SELECT ci.slot, ii.itemEntry, ii.durability,
  it.name, it.Quality AS quality, it.ItemLevel AS itemLevel, it.RequiredLevel AS requiredLevel,
  it.InventoryType AS inventoryType, it.bonding, it.armor, it.block, it.MaxDurability AS maxDurability,
  it.description, it.dmg_min1 AS damageMinimum, it.dmg_max1 AS damageMaximum, it.delay,
  it.holy_res AS holyResistance, it.fire_res AS fireResistance, it.nature_res AS natureResistance,
  it.frost_res AS frostResistance, it.shadow_res AS shadowResistance, it.arcane_res AS arcaneResistance,
  it.socketColor_1 AS socket1, it.socketColor_2 AS socket2, it.socketColor_3 AS socket3,
  it.stat_type1 AS statType1, it.stat_value1 AS statValue1,
  it.stat_type2 AS statType2, it.stat_value2 AS statValue2,
  it.stat_type3 AS statType3, it.stat_value3 AS statValue3,
  it.stat_type4 AS statType4, it.stat_value4 AS statValue4,
  it.stat_type5 AS statType5, it.stat_value5 AS statValue5,
  it.stat_type6 AS statType6, it.stat_value6 AS statValue6,
  it.stat_type7 AS statType7, it.stat_value7 AS statValue7,
  it.stat_type8 AS statType8, it.stat_value8 AS statValue8,
  it.stat_type9 AS statType9, it.stat_value9 AS statValue9,
  it.stat_type10 AS statType10, it.stat_value10 AS statValue10
FROM ${qualified(config.charactersDatabase, "character_inventory")} ci
INNER JOIN ${qualified(config.charactersDatabase, "item_instance")} ii
  ON ii.guid = ci.item AND ii.owner_guid = ci.guid
LEFT JOIN ${item} it ON it.entry = ii.itemEntry
WHERE ci.guid = ? AND ci.bag = 0 AND ci.slot BETWEEN 0 AND 18
ORDER BY ci.slot
LIMIT 20`,
    values: [characterGuid]
  };
}

export function buildArmoryTalentsQuery(config: ArmoryConfig, characterGuid: number): ArmoryQuery {
  return {
    sql: `SELECT spell, specMask FROM ${qualified(config.charactersDatabase, "character_talent")}
WHERE guid = ?
ORDER BY specMask, spell
LIMIT ${MAX_TALENTS + 1}`,
    values: [characterGuid]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown, key: string, minimum: number, maximum: number): number {
  const parsed = typeof value === "string" || typeof value === "bigint" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ArmoryDataError(`Armory ${key} is invalid.`);
  }
  return parsed;
}

function decimal(value: unknown, key: string, minimum: number, maximum: number): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new ArmoryDataError(`Armory ${key} is invalid.`);
  }
  return parsed;
}

function text(value: unknown, key: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || Array.from(value).length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value)) throw new ArmoryDataError(`Armory ${key} is invalid.`);
  return value;
}

function summaryFromRow(value: unknown): ArmoryCharacterSummary & { guid: number } {
  if (!isRecord(value)) throw new ArmoryDataError("Armory character row is invalid.");
  const guid = integer(value.characterGuid, "character GUID", 1, MAX_UINT32);
  const raceId = integer(value.raceId, "race", 1, 255);
  const classId = integer(value.classId, "class", 1, 255);
  if (!isKnownRace(raceId) || !isKnownClass(classId)) throw new ArmoryDataError("Armory character identity is unsupported.");
  return {
    guid,
    id: String(guid),
    name: text(value.characterName, "character name", 12),
    level: integer(value.level, "level", 1, 80),
    race: getRaceName(raceId),
    class: getClassName(classId)
  };
}

export function mapArmoryCharacterRows(rows: unknown): ArmoryCharacterSummary[] {
  if (!Array.isArray(rows) || rows.length > MAX_CHARACTERS) throw new ArmoryDataError("Armory character result is invalid.");
  const seen = new Set<number>();
  return rows.map((row) => {
    const summary = summaryFromRow(row);
    if (seen.has(summary.guid)) throw new ArmoryDataError("Armory character result contains duplicates.");
    seen.add(summary.guid);
    const { guid: _, ...publicSummary } = summary;
    return publicSummary;
  }).sort((left, right) => left.name.localeCompare(right.name, "en", { sensitivity: "base" }) || Number(left.id) - Number(right.id));
}

function mapStats(row: Record<string, unknown>): ArmoryItemStat[] {
  const stats: ArmoryItemStat[] = [];
  for (let index = 1; index <= 10; index += 1) {
    const type = integer(row[`statType${index}`], `item stat type ${index}`, 0, 255);
    const value = integer(row[`statValue${index}`], `item stat value ${index}`, -1_000_000, 1_000_000);
    if (value === 0) continue;
    stats.push({ name: STAT_NAMES[type] ?? `Stat ${type}`, value });
  }
  return stats;
}

function mapSockets(row: Record<string, unknown>): string[] {
  return [1, 2, 3].flatMap((index) => {
    const color = integer(row[`socket${index}`], `socket ${index}`, 0, 255);
    return color === 0 ? [] : [SOCKET_NAMES[color] ?? `Socket ${color}`];
  });
}

function mapResistances(row: Record<string, unknown>): ArmoryItemStat[] {
  return ([
    ["Holy resistance", "holyResistance"], ["Fire resistance", "fireResistance"],
    ["Nature resistance", "natureResistance"], ["Frost resistance", "frostResistance"],
    ["Shadow resistance", "shadowResistance"], ["Arcane resistance", "arcaneResistance"]
  ] as const).flatMap(([name, key]) => {
    const value = integer(row[key] ?? 0, key, 0, 65_535);
    return value === 0 ? [] : [{ name, value }];
  });
}

export function mapArmoryEquipmentRows(rows: unknown): ArmoryEquipmentSlot[] {
  if (!Array.isArray(rows) || rows.length > EQUIPMENT_SLOTS.length) throw new ArmoryDataError("Armory equipment result is invalid.");
  const bySlot = new Map<number, ArmoryItem>();
  for (const raw of rows) {
    if (!isRecord(raw)) throw new ArmoryDataError("Armory equipment row is invalid.");
    const slot = integer(raw.slot, "equipment slot", 0, 18);
    if (bySlot.has(slot)) throw new ArmoryDataError("Armory equipment contains a duplicate slot.");
    const quality = integer(raw.quality, "item quality", 0, 7);
    const maxDurability = integer(raw.maxDurability, "maximum durability", 0, 65_535);
    const currentDurability = integer(raw.durability, "durability", 0, 65_535);
    if (currentDurability > maxDurability && maxDurability > 0) throw new ArmoryDataError("Armory item durability is inconsistent.");
    const minimum = decimal(raw.damageMinimum, "damage minimum", 0, 10_000_000);
    const maximum = decimal(raw.damageMaximum, "damage maximum", 0, 10_000_000);
    const delay = integer(raw.delay, "weapon delay", 0, 60_000);
    const bonding = integer(raw.bonding, "item bonding", 0, 5);
    const description = text(raw.description, "item description", 255, true);
    const item: ArmoryItem = {
      entry: integer(raw.itemEntry, "item entry", 1, MAX_UINT32),
      name: text(raw.name, "item name", 255),
      quality,
      qualityName: QUALITY_NAMES[quality]!,
      itemLevel: integer(raw.itemLevel, "item level", 0, 65_535),
      requiredLevel: integer(raw.requiredLevel, "required level", 0, 255),
      inventoryType: INVENTORY_TYPE_NAMES[integer(raw.inventoryType, "inventory type", 0, 28)] ?? "Equipment",
      armor: integer(raw.armor, "armor", 0, MAX_UINT32),
      block: integer(raw.block, "block", 0, MAX_UINT32),
      stats: mapStats(raw),
      sockets: mapSockets(raw),
      resistances: mapResistances(raw)
    };
    const bondingName = BONDING_NAMES[bonding];
    if (bondingName) item.bonding = bondingName;
    if (minimum > 0 || maximum > 0) {
      // AzerothCore heirlooms can use min=1/max=0 with a nonzero delay as a
      // level-scaling sentinel. Their final damage is not stored in item_template,
      // so leave the static damage line out instead of rejecting the character.
      const scalingDamageSentinel = minimum > 0 && maximum === 0 && delay > 0;
      if (!scalingDamageSentinel && (maximum < minimum || delay === 0)) {
        throw new ArmoryDataError("Armory weapon damage is inconsistent.");
      }
      if (!scalingDamageSentinel) {
        const speedSeconds = delay / 1_000;
        item.damage = {
          minimum,
          maximum,
          speedSeconds,
          dps: Math.round((((minimum + maximum) / 2) / speedSeconds) * 10) / 10
        };
      } else {
        item.damageScalesWithLevel = true;
      }
    }
    if (maxDurability > 0) item.durability = { current: currentDurability, maximum: maxDurability };
    if (description) item.description = description;
    bySlot.set(slot, item);
  }
  return EQUIPMENT_SLOTS.map((name, slot) => ({ slot, name, item: bySlot.get(slot) ?? null }));
}

export function mapArmoryTalentRows(
  rows: unknown,
  groupCount: number,
  activeGroup: number
): ArmoryTalentLoadout[] {
  if (!Array.isArray(rows) || rows.length > MAX_TALENTS) throw new ArmoryDataError("Armory talent result is invalid.");
  if (![1, 2].includes(groupCount) || activeGroup < 0 || activeGroup >= groupCount) {
    throw new ArmoryDataError("Armory talent group state is invalid.");
  }
  const mapped = rows.map((raw) => {
    if (!isRecord(raw)) throw new ArmoryDataError("Armory talent row is invalid.");
    const spellId = integer(raw.spell, "talent spell", 1, MAX_UINT32);
    const specMask = integer(raw.specMask, "talent spec mask", 1, 3);
    const catalog = WOTLK_TALENT_CATALOG[spellId];
    return {
      specMask,
      treeName: catalog?.treeName ?? "Other",
      treeOrder: catalog?.treeOrder ?? 99,
      talent: {
        spellId,
        name: catalog?.name ?? `Talent spell ${spellId}`,
        rank: catalog?.rank ?? 1,
        maximumRank: catalog?.maxRank ?? 1,
        tier: catalog?.tier ?? 99,
        column: catalog?.column ?? 99
      }
    };
  });
  return Array.from({ length: groupCount }, (_, index) => {
    const treeMap = new Map<string, { order: number; talents: ArmoryTalent[] }>();
    for (const row of mapped) {
      if ((row.specMask & (1 << index)) === 0) continue;
      const tree = treeMap.get(row.treeName) ?? { order: row.treeOrder, talents: [] };
      tree.talents.push(row.talent);
      treeMap.set(row.treeName, tree);
    }
    const trees = [...treeMap.entries()].map(([name, tree]): ArmoryTalentTree => ({
      name,
      points: tree.talents.reduce((total, talent) => total + talent.rank, 0),
      talents: tree.talents.sort((left, right) => left.tier - right.tier || left.column - right.column || left.spellId - right.spellId)
    })).sort((left, right) => (treeMap.get(left.name)!.order - treeMap.get(right.name)!.order) || left.name.localeCompare(right.name));
    return {
      index,
      name: groupCount === 1 ? "Talents" : `Talent loadout ${index + 1}`,
      active: index === activeGroup,
      points: trees.reduce((total, tree) => total + tree.points, 0),
      trees
    };
  });
}

export type QueryArmoryRows = (query: ArmoryQuery) => Promise<unknown>;

async function executeArmoryQuery(query: ArmoryQuery): Promise<unknown> {
  const { pool } = getPortalDatabase();
  const [rows] = await pool.execute<RowDataPacket[]>({ sql: query.sql, values: [...query.values], timeout: QUERY_TIMEOUT_MS });
  return rows;
}

export class ArmoryService {
  constructor(
    private readonly queryRows: QueryArmoryRows = executeArmoryQuery,
    private readonly getConfiguration: () => ArmoryConfig = () => {
      const { config } = getPortalDatabase();
      return readArmoryConfig(config);
    },
    private readonly now: () => Date = () => new Date()
  ) {}

  async getCharacters(visibility: AccountVisibilityScope): Promise<{ characters: ArmoryCharacterSummary[] }> {
    const config = this.getConfiguration();
    return { characters: mapArmoryCharacterRows(await this.queryRows(buildArmoryCharactersQuery(config, visibility))) };
  }

  async getCharacter(characterGuid: number, visibility: AccountVisibilityScope): Promise<ArmoryCharacterDetail | undefined> {
    if (!Number.isSafeInteger(characterGuid) || characterGuid < 1 || characterGuid > MAX_UINT32) {
      throw new ArmoryDataError("Armory character ID is invalid.");
    }
    const config = this.getConfiguration();
    const rawCharacter = await this.queryRows(buildArmoryCharacterQuery(config, visibility, characterGuid));
    if (!Array.isArray(rawCharacter) || rawCharacter.length > 1) throw new ArmoryDataError("Armory character result is invalid.");
    if (rawCharacter.length === 0) return undefined;
    const row = rawCharacter[0];
    if (!isRecord(row)) throw new ArmoryDataError("Armory character row is invalid.");
    const summary = summaryFromRow(row);
    const groupCount = integer(row.talentGroupsCount, "talent group count", 1, 2);
    const activeGroup = integer(row.activeTalentGroup, "active talent group", 0, 1);
    const [equipmentRows, talentRows] = await Promise.all([
      this.queryRows(buildArmoryEquipmentQuery(config, summary.guid)),
      this.queryRows(buildArmoryTalentsQuery(config, summary.guid))
    ]);
    const { guid: _, ...publicSummary } = summary;
    return {
      ...publicSummary,
      generatedAt: this.now().toISOString(),
      equipment: mapArmoryEquipmentRows(equipmentRows),
      talentLoadouts: mapArmoryTalentRows(talentRows, groupCount, activeGroup)
    };
  }
}

export const armoryService = new ArmoryService();
