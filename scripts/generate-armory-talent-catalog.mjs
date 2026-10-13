import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function readDbc(filePath) {
  const bytes = readFileSync(filePath);
  if (bytes.toString("ascii", 0, 4) !== "WDBC" || bytes.length < 20) {
    throw new Error(`${filePath} is not a supported WDBC file.`);
  }
  const recordCount = bytes.readUInt32LE(4);
  const fieldCount = bytes.readUInt32LE(8);
  const recordSize = bytes.readUInt32LE(12);
  const stringSize = bytes.readUInt32LE(16);
  if (recordSize !== fieldCount * 4 || 20 + recordCount * recordSize + stringSize !== bytes.length) {
    throw new Error(`${filePath} has an unexpected WDBC layout.`);
  }
  const recordsOffset = 20;
  const stringsOffset = recordsOffset + recordCount * recordSize;
  function word(record, field) {
    if (record < 0 || record >= recordCount || field < 0 || field >= fieldCount) {
      throw new Error(`${filePath} record access is out of range.`);
    }
    return bytes.readUInt32LE(recordsOffset + record * recordSize + field * 4);
  }
  function string(record, field) {
    const offset = word(record, field);
    if (offset >= stringSize) throw new Error(`${filePath} string offset is out of range.`);
    const start = stringsOffset + offset;
    const end = bytes.indexOf(0, start);
    if (end < 0 || end >= stringsOffset + stringSize) {
      throw new Error(`${filePath} string is not terminated.`);
    }
    return bytes.toString("utf8", start, end);
  }
  return { recordCount, fieldCount, word, string };
}

const [dbcDirectory, outputFile] = process.argv.slice(2);
if (!dbcDirectory || !outputFile) {
  throw new Error("Usage: node scripts/generate-armory-talent-catalog.mjs <dbc-directory> <output-file>");
}

const talents = readDbc(path.join(dbcDirectory, "Talent.dbc"));
const tabs = readDbc(path.join(dbcDirectory, "TalentTab.dbc"));
const spells = readDbc(path.join(dbcDirectory, "Spell.dbc"));
if (talents.fieldCount < 23 || tabs.fieldCount < 24 || spells.fieldCount < 234) {
  throw new Error("The DBC files are not compatible with the expected WotLK 3.3.5a layouts.");
}

const talentRows = [];
const wantedSpells = new Set();
for (let record = 0; record < talents.recordCount; record += 1) {
  const ranks = Array.from({ length: 5 }, (_, index) => talents.word(record, 4 + index)).filter(Boolean);
  for (const spellId of ranks) wantedSpells.add(spellId);
  talentRows.push({
    talentId: talents.word(record, 0),
    treeId: talents.word(record, 1),
    tier: talents.word(record, 2),
    column: talents.word(record, 3),
    ranks
  });
}

const treeById = new Map();
for (let record = 0; record < tabs.recordCount; record += 1) {
  const treeId = tabs.word(record, 0);
  treeById.set(treeId, {
    name: tabs.string(record, 1),
    classMask: tabs.word(record, 20),
    order: tabs.word(record, 22)
  });
}

const spellById = new Map();
for (let record = 0; record < spells.recordCount; record += 1) {
  const spellId = spells.word(record, 0);
  if (!wantedSpells.has(spellId)) continue;
  spellById.set(spellId, {
    name: spells.string(record, 136),
    rankLabel: spells.string(record, 153)
  });
}

const catalog = {};
for (const talent of talentRows) {
  const tree = treeById.get(talent.treeId);
  if (!tree || !tree.name) throw new Error(`Talent tree ${talent.treeId} is missing.`);
  talent.ranks.forEach((spellId, index) => {
    const spell = spellById.get(spellId);
    if (!spell || !spell.name) throw new Error(`Talent spell ${spellId} is missing.`);
    catalog[String(spellId)] = {
      talentId: talent.talentId,
      treeId: talent.treeId,
      treeName: tree.name,
      treeOrder: tree.order,
      tier: talent.tier,
      column: talent.column,
      rank: index + 1,
      maxRank: talent.ranks.length,
      name: spell.name,
      rankLabel: spell.rankLabel
    };
  });
}

const orderedCatalog = Object.fromEntries(
  Object.entries(catalog).sort(([left], [right]) => Number(left) - Number(right))
);
const source = `// Generated from the deployed WotLK 3.3.5a Talent.dbc, TalentTab.dbc, and Spell.dbc.\n` +
  `// Regenerate with scripts/generate-armory-talent-catalog.mjs; do not hand-edit.\n` +
  `export interface ArmoryTalentCatalogEntry {\n` +
  `  talentId: number; treeId: number; treeName: string; treeOrder: number;\n` +
  `  tier: number; column: number; rank: number; maxRank: number; name: string; rankLabel: string;\n` +
  `}\n\n` +
  `export const WOTLK_TALENT_CATALOG: Readonly<Record<number, ArmoryTalentCatalogEntry>> = ` +
  `${JSON.stringify(orderedCatalog, null, 2)};\n`;
writeFileSync(outputFile, source, "utf8");
console.log(`Wrote ${Object.keys(orderedCatalog).length} ranked talent spells to ${outputFile}.`);
