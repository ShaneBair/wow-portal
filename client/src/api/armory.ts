import { PortalApiError } from "./portal.js";

const MAX_UINT32 = 0xffff_ffff;

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
export interface ArmoryEquipmentSlot { slot: number; name: string; item: ArmoryItem | null; }
export interface ArmoryTalent { spellId: number; name: string; rank: number; maximumRank: number; tier: number; column: number; }
export interface ArmoryTalentTree { name: string; points: number; talents: ArmoryTalent[]; }
export interface ArmoryTalentLoadout { index: number; name: string; active: boolean; points: number; trees: ArmoryTalentTree[]; }
export interface ArmoryCharacterDetail extends ArmoryCharacterSummary {
  generatedAt: string;
  equipment: ArmoryEquipmentSlot[];
  talentLoadouts: ArmoryTalentLoadout[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
function finite(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}
function text(value: unknown, maximum: number, empty = false): value is string {
  return typeof value === "string" && (empty || value.length > 0) && Array.from(value).length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}
function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function canonicalDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function parseSummary(value: unknown): ArmoryCharacterSummary | undefined {
  if (!record(value) || !exactKeys(value, ["id", "name", "level", "race", "class"]) ||
    typeof value.id !== "string" || !/^[1-9]\d{0,9}$/u.test(value.id) || Number(value.id) > MAX_UINT32 ||
    !text(value.name, 12) || !integer(value.level, 1, 80) || !text(value.race, 32) || !text(value.class, 32)) return undefined;
  return { id: value.id, name: value.name, level: value.level, race: value.race, class: value.class };
}

function parseStat(value: unknown): ArmoryItemStat | undefined {
  if (!record(value) || !exactKeys(value, ["name", "value"]) || !text(value.name, 64) ||
    !integer(value.value, -1_000_000, 1_000_000)) return undefined;
  return { name: value.name, value: value.value };
}

function parseItem(value: unknown): ArmoryItem | undefined {
  if (!record(value) || !exactKeys(value, [
    "entry", "name", "quality", "qualityName", "itemLevel", "requiredLevel", "inventoryType", "bonding",
    "armor", "block", "stats", "sockets", "resistances", "damage", "damageScalesWithLevel", "durability", "description"
  ]) || !integer(value.entry, 1, MAX_UINT32) || !text(value.name, 255) || !integer(value.quality, 0, 7) ||
    !text(value.qualityName, 32) || !integer(value.itemLevel, 0, 65_535) || !integer(value.requiredLevel, 0, 255) ||
    !text(value.inventoryType, 64) || (value.bonding !== undefined && !text(value.bonding, 64)) ||
    !integer(value.armor, 0, MAX_UINT32) || !integer(value.block, 0, MAX_UINT32) || !Array.isArray(value.stats) ||
    value.stats.length > 10 || !Array.isArray(value.sockets) || value.sockets.length > 3 ||
    !value.sockets.every((entry) => text(entry, 32)) || !Array.isArray(value.resistances) || value.resistances.length > 6 ||
    (value.damageScalesWithLevel !== undefined && typeof value.damageScalesWithLevel !== "boolean") ||
    (value.description !== undefined && !text(value.description, 255, true))) return undefined;
  const stats = value.stats.map(parseStat);
  const resistances = value.resistances.map(parseStat);
  if (stats.some((entry) => !entry) || resistances.some((entry) => !entry)) return undefined;
  let damage: ArmoryItem["damage"];
  if (value.damage !== undefined) {
    if (!record(value.damage) || !exactKeys(value.damage, ["minimum", "maximum", "speedSeconds", "dps"]) ||
      !finite(value.damage.minimum, 0, 10_000_000) || !finite(value.damage.maximum, value.damage.minimum, 10_000_000) ||
      !finite(value.damage.speedSeconds, 0.001, 60) || !finite(value.damage.dps, 0, 10_000_000)) return undefined;
    damage = { minimum: value.damage.minimum, maximum: value.damage.maximum, speedSeconds: value.damage.speedSeconds, dps: value.damage.dps };
  }
  let durability: ArmoryItem["durability"];
  if (value.durability !== undefined) {
    if (!record(value.durability) || !exactKeys(value.durability, ["current", "maximum"]) ||
      !integer(value.durability.maximum, 1, 65_535) || !integer(value.durability.current, 0, value.durability.maximum)) return undefined;
    durability = { current: value.durability.current, maximum: value.durability.maximum };
  }
  return {
    entry: value.entry, name: value.name, quality: value.quality, qualityName: value.qualityName,
    itemLevel: value.itemLevel, requiredLevel: value.requiredLevel, inventoryType: value.inventoryType,
    ...(value.bonding !== undefined ? { bonding: value.bonding } : {}), armor: value.armor, block: value.block,
    stats: stats as ArmoryItemStat[], sockets: value.sockets as string[], resistances: resistances as ArmoryItemStat[],
    ...(damage ? { damage } : {}),
    ...(value.damageScalesWithLevel !== undefined ? { damageScalesWithLevel: value.damageScalesWithLevel } : {}),
    ...(durability ? { durability } : {}),
    ...(value.description !== undefined ? { description: value.description } : {})
  };
}

function parseTalent(value: unknown): ArmoryTalent | undefined {
  if (!record(value) || !exactKeys(value, ["spellId", "name", "rank", "maximumRank", "tier", "column"]) ||
    !integer(value.spellId, 1, MAX_UINT32) || !text(value.name, 100) || !integer(value.maximumRank, 1, 9) ||
    !integer(value.rank, 1, value.maximumRank) || !integer(value.tier, 0, 99) || !integer(value.column, 0, 99)) return undefined;
  return { spellId: value.spellId, name: value.name, rank: value.rank, maximumRank: value.maximumRank, tier: value.tier, column: value.column };
}

function parseLoadout(value: unknown): ArmoryTalentLoadout | undefined {
  if (!record(value) || !exactKeys(value, ["index", "name", "active", "points", "trees"]) ||
    !integer(value.index, 0, 1) || !text(value.name, 32) || typeof value.active !== "boolean" ||
    !integer(value.points, 0, 255) || !Array.isArray(value.trees) || value.trees.length > 4) return undefined;
  const trees: ArmoryTalentTree[] = [];
  let total = 0;
  for (const rawTree of value.trees) {
    if (!record(rawTree) || !exactKeys(rawTree, ["name", "points", "talents"]) || !text(rawTree.name, 100) ||
      !integer(rawTree.points, 0, 255) || !Array.isArray(rawTree.talents) || rawTree.talents.length > 100) return undefined;
    const talents = rawTree.talents.map(parseTalent);
    if (talents.some((entry) => !entry)) return undefined;
    const points = (talents as ArmoryTalent[]).reduce((sum, talent) => sum + talent.rank, 0);
    if (points !== rawTree.points) return undefined;
    total += points;
    trees.push({ name: rawTree.name, points, talents: talents as ArmoryTalent[] });
  }
  if (total !== value.points) return undefined;
  return { index: value.index, name: value.name, active: value.active, points: value.points, trees };
}

function parseDetail(value: unknown): ArmoryCharacterDetail | undefined {
  if (!record(value) || !exactKeys(value, ["id", "name", "level", "race", "class", "generatedAt", "equipment", "talentLoadouts"])) return undefined;
  const summary = parseSummary({ id: value.id, name: value.name, level: value.level, race: value.race, class: value.class });
  if (!summary || !canonicalDate(value.generatedAt) ||
    !Array.isArray(value.equipment) || value.equipment.length !== 19 || !Array.isArray(value.talentLoadouts) ||
    value.talentLoadouts.length < 1 || value.talentLoadouts.length > 2) return undefined;
  const equipment: ArmoryEquipmentSlot[] = [];
  for (const [index, raw] of value.equipment.entries()) {
    if (!record(raw) || !exactKeys(raw, ["slot", "name", "item"]) || raw.slot !== index || !text(raw.name, 32)) return undefined;
    const item = raw.item === null ? null : parseItem(raw.item);
    if (item === undefined) return undefined;
    equipment.push({ slot: index, name: raw.name, item });
  }
  const loadouts = value.talentLoadouts.map(parseLoadout);
  if (loadouts.some((entry) => !entry) || loadouts.filter((entry) => entry!.active).length !== 1) return undefined;
  return { ...summary, generatedAt: value.generatedAt, equipment, talentLoadouts: loadouts as ArmoryTalentLoadout[] };
}

export class ArmoryApiError extends PortalApiError {
  constructor(message: string, readonly httpStatus: number) { super(message); this.name = "ArmoryApiError"; }
}

async function readJson(response: Response): Promise<unknown> {
  try { return await response.json() as unknown; } catch { throw new ArmoryApiError("The armory is temporarily unavailable.", response.status); }
}

function publicError(body: unknown, fallback: string): string {
  return record(body) && typeof body.error === "string" && body.error.length <= 256 ? body.error : fallback;
}

export async function getArmoryCharacters(signal?: AbortSignal): Promise<ArmoryCharacterSummary[]> {
  let response: Response;
  try { response = await fetch("/api/armory", { cache: "no-store", credentials: "same-origin", signal }); }
  catch { throw new ArmoryApiError("The armory is temporarily unavailable.", 0); }
  const body = await readJson(response);
  if (!response.ok) throw new ArmoryApiError(publicError(body, "The armory is temporarily unavailable."), response.status);
  if (!record(body) || !exactKeys(body, ["characters"]) || !Array.isArray(body.characters) || body.characters.length > 2_500) {
    throw new ArmoryApiError("The armory is temporarily unavailable.", response.status);
  }
  const characters = body.characters.map(parseSummary);
  if (characters.some((entry) => !entry)) throw new ArmoryApiError("The armory is temporarily unavailable.", response.status);
  return characters as ArmoryCharacterSummary[];
}

export async function getArmoryCharacter(characterId: string, signal?: AbortSignal): Promise<ArmoryCharacterDetail> {
  if (!/^[1-9]\d{0,9}$/u.test(characterId) || Number(characterId) > MAX_UINT32) {
    throw new ArmoryApiError("Choose a valid character.", 400);
  }
  let response: Response;
  try { response = await fetch(`/api/armory/${characterId}`, { cache: "no-store", credentials: "same-origin", signal }); }
  catch { throw new ArmoryApiError("The armory is temporarily unavailable.", 0); }
  const body = await readJson(response);
  if (!response.ok) throw new ArmoryApiError(publicError(body, "The armory is temporarily unavailable."), response.status);
  if (!record(body) || !exactKeys(body, ["character"])) throw new ArmoryApiError("The armory is temporarily unavailable.", response.status);
  const character = parseDetail(body.character);
  if (!character) throw new ArmoryApiError("The armory is temporarily unavailable.", response.status);
  return character;
}
