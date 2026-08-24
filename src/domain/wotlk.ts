const RACE_NAMES: Readonly<Record<number, string>> = {
  1: "Human",
  2: "Orc",
  3: "Dwarf",
  4: "Night Elf",
  5: "Undead",
  6: "Tauren",
  7: "Gnome",
  8: "Troll",
  10: "Blood Elf",
  11: "Draenei"
};

const CLASS_NAMES: Readonly<Record<number, string>> = {
  1: "Warrior",
  2: "Paladin",
  3: "Hunter",
  4: "Rogue",
  5: "Priest",
  6: "Death Knight",
  7: "Shaman",
  8: "Mage",
  9: "Warlock",
  11: "Druid"
};

export function getRaceName(id: number): string {
  return RACE_NAMES[id] ?? `Unknown race (${id})`;
}

export function getClassName(id: number): string {
  return CLASS_NAMES[id] ?? `Unknown class (${id})`;
}

export function isKnownRace(id: number): boolean {
  return RACE_NAMES[id] !== undefined;
}

export function isKnownClass(id: number): boolean {
  return CLASS_NAMES[id] !== undefined;
}
