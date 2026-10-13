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
  function unsigned(record, field) {
    if (record < 0 || record >= recordCount || field < 0 || field >= fieldCount) {
      throw new Error(`${filePath} record access is out of range.`);
    }
    return bytes.readUInt32LE(20 + record * recordSize + field * 4);
  }
  function signed(record, field) {
    return unsigned(record, field) | 0;
  }
  return { recordCount, fieldCount, unsigned, signed };
}

const [dbcDirectory, outputFile] = process.argv.slice(2);
if (!dbcDirectory || !outputFile) {
  throw new Error("Usage: node scripts/generate-armory-scaling-catalog.mjs <dbc-directory> <output-file>");
}

const distributionsDbc = readDbc(path.join(dbcDirectory, "ScalingStatDistribution.dbc"));
const valuesDbc = readDbc(path.join(dbcDirectory, "ScalingStatValues.dbc"));
if (distributionsDbc.fieldCount !== 22 || valuesDbc.fieldCount !== 24) {
  throw new Error("The DBC files are not compatible with the expected WotLK 3.3.5a layouts.");
}

const distributions = {};
for (let record = 0; record < distributionsDbc.recordCount; record += 1) {
  const id = distributionsDbc.unsigned(record, 0);
  distributions[String(id)] = {
    statTypes: Array.from({ length: 10 }, (_, index) => distributionsDbc.signed(record, 1 + index)),
    modifiers: Array.from({ length: 10 }, (_, index) => distributionsDbc.unsigned(record, 11 + index)),
    maxLevel: distributionsDbc.unsigned(record, 21)
  };
}

const values = {};
for (let record = 0; record < valuesDbc.recordCount; record += 1) {
  const level = valuesDbc.unsigned(record, 1);
  values[String(level)] = {
    multipliers: Array.from({ length: 4 }, (_, index) => valuesDbc.unsigned(record, 2 + index)),
    armor: Array.from({ length: 4 }, (_, index) => valuesDbc.unsigned(record, 6 + index)),
    dps: Array.from({ length: 6 }, (_, index) => valuesDbc.unsigned(record, 10 + index)),
    spellPower: valuesDbc.unsigned(record, 16),
    multiplier2: valuesDbc.unsigned(record, 17),
    multiplier3: valuesDbc.unsigned(record, 18),
    armor2: Array.from({ length: 5 }, (_, index) => valuesDbc.unsigned(record, 19 + index))
  };
}

const source = `// Generated from the deployed WotLK 3.3.5a ScalingStatDistribution.dbc and ScalingStatValues.dbc.\n` +
  `// Regenerate with scripts/generate-armory-scaling-catalog.mjs; do not hand-edit.\n` +
  `export interface ArmoryScalingDistribution {\n` +
  `  statTypes: readonly number[]; modifiers: readonly number[]; maxLevel: number;\n` +
  `}\n\n` +
  `export interface ArmoryScalingValues {\n` +
  `  multipliers: readonly number[]; armor: readonly number[]; dps: readonly number[];\n` +
  `  spellPower: number; multiplier2: number; multiplier3: number; armor2: readonly number[];\n` +
  `}\n\n` +
  `export const WOTLK_SCALING_DISTRIBUTIONS: Readonly<Record<number, ArmoryScalingDistribution>> = ` +
  `${JSON.stringify(distributions, null, 2)};\n\n` +
  `export const WOTLK_SCALING_VALUES: Readonly<Record<number, ArmoryScalingValues>> = ` +
  `${JSON.stringify(values, null, 2)};\n`;

writeFileSync(outputFile, source, "utf8");
console.log(`Wrote ${Object.keys(distributions).length} distributions and ${Object.keys(values).length} level rows to ${outputFile}.`);
