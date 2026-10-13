// Generated from the deployed WotLK 3.3.5a ScalingStatDistribution.dbc and ScalingStatValues.dbc.
// Regenerate with scripts/generate-armory-scaling-catalog.mjs; do not hand-edit.
export interface ArmoryScalingDistribution {
  statTypes: readonly number[]; modifiers: readonly number[]; maxLevel: number;
}

export interface ArmoryScalingValues {
  multipliers: readonly number[]; armor: readonly number[]; dps: readonly number[];
  spellPower: number; multiplier2: number; multiplier3: number; armor2: readonly number[];
}

export const WOTLK_SCALING_DISTRIBUTIONS: Readonly<Record<number, ArmoryScalingDistribution>> = {
  "1": {
    "statTypes": [
      4,
      7,
      32,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      5259,
      7888,
      5259,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "2": {
    "statTypes": [
      38,
      3,
      31,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      14532,
      4106,
      3193,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "3": {
    "statTypes": [
      38,
      7,
      32,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      10518,
      7888,
      5259,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "4": {
    "statTypes": [
      38,
      32,
      31,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      13332,
      4767,
      3900,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "5": {
    "statTypes": [
      7,
      5,
      32,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      7150,
      5850,
      4766,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "6": {
    "statTypes": [
      7,
      5,
      43,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      5067,
      7601,
      1350,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "7": {
    "statTypes": [
      4,
      7,
      32,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      6666,
      6666,
      4445,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "8": {
    "statTypes": [
      38,
      3,
      7,
      5,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      10518,
      5258,
      5641,
      3076,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "9": {
    "statTypes": [
      45,
      7,
      5,
      43,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      5201,
      6666,
      4444,
      1778,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "10": {
    "statTypes": [
      38,
      31,
      7,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      14532,
      4106,
      4789,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "11": {
    "statTypes": [
      45,
      7,
      5,
      6,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      6153,
      3996,
      3997,
      5258,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "12": {
    "statTypes": [
      0,
      5,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "modifiers": [
      5000,
      5000,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 10
  },
  "13": {
    "statTypes": [
      42,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "modifiers": [
      10000,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 10
  },
  "14": {
    "statTypes": [
      38,
      39,
      40,
      41,
      42,
      43,
      0,
      0,
      0,
      0
    ],
    "modifiers": [
      6500,
      6500,
      10000,
      10000,
      10000,
      10000,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 15
  },
  "15": {
    "statTypes": [
      40,
      41,
      42,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "modifiers": [
      4200,
      5200,
      6200,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 10
  },
  "16": {
    "statTypes": [
      45,
      7,
      5,
      6,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      6153,
      3996,
      3997,
      5258,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "21": {
    "statTypes": [
      12,
      13,
      14,
      15,
      16,
      0,
      0,
      0,
      0,
      0
    ],
    "modifiers": [
      5000,
      6000,
      7000,
      8000,
      9000,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 10
  },
  "41": {
    "statTypes": [
      3,
      4,
      5,
      6,
      7,
      12,
      13,
      14,
      15,
      16
    ],
    "modifiers": [
      10000,
      10000,
      10000,
      10000,
      10000,
      10000,
      10000,
      10000,
      10000,
      10000
    ],
    "maxLevel": 10
  },
  "42": {
    "statTypes": [
      17,
      18,
      19,
      20,
      21,
      22,
      23,
      24,
      25,
      26
    ],
    "modifiers": [
      10000,
      10000,
      10000,
      10000,
      10000,
      10000,
      10000,
      10000,
      10000,
      10000
    ],
    "maxLevel": 10
  },
  "43": {
    "statTypes": [
      27,
      28,
      29,
      30,
      31,
      32,
      33,
      34,
      35,
      36
    ],
    "modifiers": [
      10000,
      10000,
      10000,
      10000,
      10000,
      10000,
      10000,
      10000,
      10000,
      10000
    ],
    "maxLevel": 10
  },
  "102": {
    "statTypes": [
      44,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "modifiers": [
      10000,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 15
  },
  "103": {
    "statTypes": [
      3,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      10000,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 0
  },
  "104": {
    "statTypes": [
      32,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      10000,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "105": {
    "statTypes": [
      13,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      10000,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 0
  },
  "221": {
    "statTypes": [
      4,
      7,
      32,
      36,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      4844,
      7266,
      4106,
      3193,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "222": {
    "statTypes": [
      3,
      44,
      7,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      5259,
      3506,
      5259,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "223": {
    "statTypes": [
      7,
      5,
      32,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      4859,
      5732,
      2519,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "224": {
    "statTypes": [
      38,
      3,
      31,
      7,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      9688,
      4844,
      3193,
      6159,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "241": {
    "statTypes": [
      45,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "modifiers": [
      10000,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "251": {
    "statTypes": [
      36,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      6666,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "271": {
    "statTypes": [
      45,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      7800,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "291": {
    "statTypes": [
      38,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      23252,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 0
  },
  "292": {
    "statTypes": [
      38,
      7,
      35,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      10518,
      7888,
      5258,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "293": {
    "statTypes": [
      4,
      7,
      35,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      7266,
      4789,
      4106,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "294": {
    "statTypes": [
      38,
      32,
      35,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      8212,
      7266,
      3193,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "295": {
    "statTypes": [
      7,
      35,
      43,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      6666,
      6666,
      1777,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "296": {
    "statTypes": [
      7,
      31,
      35,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      7888,
      5259,
      5258,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "297": {
    "statTypes": [
      35,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      5259,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "298": {
    "statTypes": [
      35,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      6667,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "299": {
    "statTypes": [
      35,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      6667,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "300": {
    "statTypes": [
      4,
      7,
      35,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      5259,
      7888,
      5258,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "301": {
    "statTypes": [
      45,
      7,
      43,
      35,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      5200,
      6666,
      1776,
      4444,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "302": {
    "statTypes": [
      38,
      3,
      7,
      35,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      8888,
      4444,
      6668,
      4444,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "303": {
    "statTypes": [
      45,
      7,
      5,
      35,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      6153,
      5259,
      3506,
      5258,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "304": {
    "statTypes": [
      38,
      3,
      7,
      35,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      8888,
      3899,
      6666,
      4767,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "305": {
    "statTypes": [
      45,
      7,
      6,
      35,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      6153,
      5259,
      3506,
      5258,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "306": {
    "statTypes": [
      45,
      7,
      32,
      35,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      6153,
      5259,
      3506,
      5258,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "311": {
    "statTypes": [
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 0
  },
  "331": {
    "statTypes": [
      38,
      3,
      7,
      5,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      10518,
      5258,
      5259,
      3506,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "332": {
    "statTypes": [
      45,
      7,
      5,
      43,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      6153,
      3997,
      3997,
      2629,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "333": {
    "statTypes": [
      4,
      7,
      32,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      5996,
      5996,
      5258,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "334": {
    "statTypes": [
      45,
      7,
      5,
      6,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      6153,
      3997,
      3997,
      5259,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "335": {
    "statTypes": [
      38,
      7,
      31,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      10518,
      7888,
      5259,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "336": {
    "statTypes": [
      45,
      7,
      5,
      6,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      6153,
      3997,
      3997,
      5259,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "351": {
    "statTypes": [
      3,
      38,
      7,
      32,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      5259,
      7012,
      7889,
      3506,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "352": {
    "statTypes": [
      3,
      44,
      7,
      38,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      5259,
      3506,
      7889,
      7012,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  },
  "371": {
    "statTypes": [
      32,
      31,
      7,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1
    ],
    "modifiers": [
      7266,
      4106,
      4789,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "maxLevel": 80
  }
};

export const WOTLK_SCALING_VALUES: Readonly<Record<number, ArmoryScalingValues>> = {
  "1": {
    "multipliers": [
      2,
      2,
      1,
      1
    ],
    "armor": [
      10,
      32,
      32,
      64
    ],
    "dps": [
      6,
      8,
      6,
      8,
      6,
      8
    ],
    "spellPower": 1,
    "multiplier2": 3,
    "multiplier3": 1,
    "armor2": [
      7,
      13,
      43,
      43,
      85
    ]
  },
  "2": {
    "multipliers": [
      3,
      3,
      1,
      1
    ],
    "armor": [
      12,
      35,
      35,
      70
    ],
    "dps": [
      6,
      9,
      6,
      9,
      7,
      9
    ],
    "spellPower": 2,
    "multiplier2": 3,
    "multiplier3": 2,
    "armor2": [
      8,
      16,
      47,
      47,
      93
    ]
  },
  "3": {
    "multipliers": [
      3,
      3,
      1,
      1
    ],
    "armor": [
      13,
      39,
      39,
      76
    ],
    "dps": [
      7,
      9,
      7,
      9,
      7,
      10
    ],
    "spellPower": 3,
    "multiplier2": 4,
    "multiplier3": 2,
    "armor2": [
      9,
      17,
      52,
      52,
      101
    ]
  },
  "4": {
    "multipliers": [
      3,
      3,
      1,
      1
    ],
    "armor": [
      14,
      42,
      42,
      83
    ],
    "dps": [
      7,
      10,
      7,
      10,
      8,
      11
    ],
    "spellPower": 3,
    "multiplier2": 4,
    "multiplier3": 2,
    "armor2": [
      9,
      19,
      56,
      56,
      111
    ]
  },
  "5": {
    "multipliers": [
      4,
      4,
      2,
      2
    ],
    "armor": [
      16,
      45,
      45,
      89
    ],
    "dps": [
      8,
      10,
      8,
      10,
      8,
      12
    ],
    "spellPower": 4,
    "multiplier2": 5,
    "multiplier3": 3,
    "armor2": [
      11,
      21,
      60,
      60,
      119
    ]
  },
  "6": {
    "multipliers": [
      4,
      4,
      2,
      2
    ],
    "armor": [
      17,
      48,
      48,
      95
    ],
    "dps": [
      8,
      11,
      8,
      11,
      9,
      12
    ],
    "spellPower": 5,
    "multiplier2": 5,
    "multiplier3": 3,
    "armor2": [
      11,
      23,
      64,
      64,
      127
    ]
  },
  "7": {
    "multipliers": [
      4,
      4,
      3,
      2
    ],
    "armor": [
      19,
      51,
      51,
      101
    ],
    "dps": [
      9,
      11,
      9,
      11,
      9,
      13
    ],
    "spellPower": 6,
    "multiplier2": 6,
    "multiplier3": 3,
    "armor2": [
      13,
      25,
      68,
      68,
      135
    ]
  },
  "8": {
    "multipliers": [
      5,
      5,
      3,
      2
    ],
    "armor": [
      20,
      54,
      54,
      107
    ],
    "dps": [
      9,
      12,
      9,
      12,
      9,
      14
    ],
    "spellPower": 7,
    "multiplier2": 7,
    "multiplier3": 4,
    "armor2": [
      13,
      27,
      72,
      72,
      143
    ]
  },
  "9": {
    "multipliers": [
      5,
      5,
      3,
      2
    ],
    "armor": [
      22,
      56,
      56,
      113
    ],
    "dps": [
      10,
      13,
      10,
      13,
      10,
      15
    ],
    "spellPower": 7,
    "multiplier2": 7,
    "multiplier3": 4,
    "armor2": [
      15,
      29,
      75,
      75,
      151
    ]
  },
  "10": {
    "multipliers": [
      6,
      6,
      3,
      2
    ],
    "armor": [
      23,
      57,
      57,
      119
    ],
    "dps": [
      10,
      13,
      10,
      13,
      10,
      16
    ],
    "spellPower": 8,
    "multiplier2": 8,
    "multiplier3": 4,
    "armor2": [
      15,
      31,
      76,
      76,
      159
    ]
  },
  "11": {
    "multipliers": [
      6,
      6,
      4,
      3
    ],
    "armor": [
      24,
      59,
      59,
      125
    ],
    "dps": [
      11,
      14,
      11,
      14,
      11,
      16
    ],
    "spellPower": 9,
    "multiplier2": 8,
    "multiplier3": 5,
    "armor2": [
      16,
      32,
      79,
      79,
      167
    ]
  },
  "12": {
    "multipliers": [
      7,
      7,
      4,
      3
    ],
    "armor": [
      25,
      60,
      60,
      131
    ],
    "dps": [
      11,
      15,
      11,
      15,
      12,
      17
    ],
    "spellPower": 10,
    "multiplier2": 9,
    "multiplier3": 5,
    "armor2": [
      17,
      33,
      80,
      80,
      175
    ]
  },
  "13": {
    "multipliers": [
      7,
      7,
      4,
      3
    ],
    "armor": [
      26,
      61,
      61,
      133
    ],
    "dps": [
      12,
      16,
      12,
      16,
      12,
      18
    ],
    "spellPower": 10,
    "multiplier2": 9,
    "multiplier3": 5,
    "armor2": [
      17,
      35,
      81,
      81,
      177
    ]
  },
  "14": {
    "multipliers": [
      8,
      8,
      4,
      3
    ],
    "armor": [
      27,
      63,
      63,
      136
    ],
    "dps": [
      12,
      16,
      12,
      16,
      13,
      19
    ],
    "spellPower": 11,
    "multiplier2": 10,
    "multiplier3": 6,
    "armor2": [
      18,
      36,
      84,
      84,
      181
    ]
  },
  "15": {
    "multipliers": [
      8,
      8,
      5,
      3
    ],
    "armor": [
      28,
      64,
      64,
      138
    ],
    "dps": [
      13,
      17,
      13,
      17,
      13,
      20
    ],
    "spellPower": 12,
    "multiplier2": 11,
    "multiplier3": 6,
    "armor2": [
      19,
      37,
      85,
      85,
      184
    ]
  },
  "16": {
    "multipliers": [
      8,
      8,
      5,
      4
    ],
    "armor": [
      29,
      65,
      65,
      141
    ],
    "dps": [
      14,
      18,
      14,
      18,
      14,
      21
    ],
    "spellPower": 13,
    "multiplier2": 11,
    "multiplier3": 6,
    "armor2": [
      19,
      39,
      87,
      87,
      188
    ]
  },
  "17": {
    "multipliers": [
      9,
      9,
      5,
      4
    ],
    "armor": [
      30,
      67,
      67,
      143
    ],
    "dps": [
      14,
      19,
      14,
      19,
      14,
      22
    ],
    "spellPower": 14,
    "multiplier2": 12,
    "multiplier3": 7,
    "armor2": [
      20,
      40,
      89,
      89,
      191
    ]
  },
  "18": {
    "multipliers": [
      9,
      9,
      5,
      4
    ],
    "armor": [
      30,
      68,
      68,
      146
    ],
    "dps": [
      15,
      19,
      15,
      19,
      15,
      23
    ],
    "spellPower": 14,
    "multiplier2": 12,
    "multiplier3": 7,
    "armor2": [
      20,
      40,
      91,
      91,
      195
    ]
  },
  "19": {
    "multipliers": [
      10,
      10,
      6,
      4
    ],
    "armor": [
      31,
      69,
      69,
      148
    ],
    "dps": [
      15,
      20,
      15,
      20,
      15,
      24
    ],
    "spellPower": 15,
    "multiplier2": 13,
    "multiplier3": 7,
    "armor2": [
      21,
      41,
      92,
      92,
      197
    ]
  },
  "20": {
    "multipliers": [
      10,
      10,
      6,
      4
    ],
    "armor": [
      32,
      71,
      71,
      151
    ],
    "dps": [
      16,
      21,
      16,
      21,
      16,
      25
    ],
    "spellPower": 16,
    "multiplier2": 14,
    "multiplier3": 8,
    "armor2": [
      21,
      43,
      95,
      95,
      201
    ]
  },
  "21": {
    "multipliers": [
      11,
      11,
      6,
      5
    ],
    "armor": [
      33,
      72,
      72,
      153
    ],
    "dps": [
      16,
      21,
      16,
      21,
      16,
      26
    ],
    "spellPower": 17,
    "multiplier2": 14,
    "multiplier3": 8,
    "armor2": [
      22,
      44,
      96,
      96,
      204
    ]
  },
  "22": {
    "multipliers": [
      11,
      11,
      6,
      5
    ],
    "armor": [
      34,
      73,
      73,
      156
    ],
    "dps": [
      17,
      22,
      17,
      22,
      17,
      27
    ],
    "spellPower": 18,
    "multiplier2": 15,
    "multiplier3": 8,
    "armor2": [
      23,
      45,
      97,
      97,
      208
    ]
  },
  "23": {
    "multipliers": [
      12,
      12,
      7,
      5
    ],
    "armor": [
      34,
      75,
      75,
      158
    ],
    "dps": [
      17,
      23,
      17,
      23,
      17,
      28
    ],
    "spellPower": 18,
    "multiplier2": 15,
    "multiplier3": 9,
    "armor2": [
      23,
      45,
      100,
      100,
      211
    ]
  },
  "24": {
    "multipliers": [
      12,
      12,
      7,
      5
    ],
    "armor": [
      35,
      76,
      76,
      161
    ],
    "dps": [
      18,
      23,
      18,
      23,
      18,
      29
    ],
    "spellPower": 19,
    "multiplier2": 16,
    "multiplier3": 9,
    "armor2": [
      23,
      47,
      101,
      101,
      215
    ]
  },
  "25": {
    "multipliers": [
      12,
      12,
      7,
      5
    ],
    "armor": [
      35,
      77,
      77,
      163
    ],
    "dps": [
      19,
      24,
      19,
      24,
      19,
      29
    ],
    "spellPower": 20,
    "multiplier2": 17,
    "multiplier3": 9,
    "armor2": [
      23,
      47,
      103,
      103,
      217
    ]
  },
  "26": {
    "multipliers": [
      13,
      13,
      7,
      5
    ],
    "armor": [
      36,
      78,
      78,
      166
    ],
    "dps": [
      19,
      25,
      19,
      25,
      19,
      30
    ],
    "spellPower": 21,
    "multiplier2": 17,
    "multiplier3": 10,
    "armor2": [
      24,
      48,
      104,
      104,
      221
    ]
  },
  "27": {
    "multipliers": [
      13,
      13,
      8,
      6
    ],
    "armor": [
      37,
      80,
      80,
      168
    ],
    "dps": [
      20,
      26,
      20,
      26,
      20,
      31
    ],
    "spellPower": 22,
    "multiplier2": 18,
    "multiplier3": 10,
    "armor2": [
      25,
      49,
      107,
      107,
      224
    ]
  },
  "28": {
    "multipliers": [
      14,
      14,
      8,
      6
    ],
    "armor": [
      37,
      81,
      81,
      171
    ],
    "dps": [
      21,
      27,
      21,
      27,
      21,
      32
    ],
    "spellPower": 22,
    "multiplier2": 18,
    "multiplier3": 10,
    "armor2": [
      25,
      49,
      108,
      108,
      228
    ]
  },
  "29": {
    "multipliers": [
      14,
      14,
      8,
      6
    ],
    "armor": [
      38,
      82,
      82,
      173
    ],
    "dps": [
      22,
      29,
      22,
      29,
      22,
      32
    ],
    "spellPower": 23,
    "multiplier2": 19,
    "multiplier3": 11,
    "armor2": [
      25,
      51,
      109,
      109,
      231
    ]
  },
  "30": {
    "multipliers": [
      15,
      15,
      8,
      6
    ],
    "armor": [
      38,
      84,
      84,
      176
    ],
    "dps": [
      23,
      30,
      23,
      30,
      22,
      33
    ],
    "spellPower": 24,
    "multiplier2": 20,
    "multiplier3": 11,
    "armor2": [
      25,
      51,
      112,
      112,
      235
    ]
  },
  "31": {
    "multipliers": [
      15,
      15,
      9,
      6
    ],
    "armor": [
      39,
      85,
      85,
      178
    ],
    "dps": [
      24,
      31,
      24,
      31,
      23,
      34
    ],
    "spellPower": 25,
    "multiplier2": 20,
    "multiplier3": 11,
    "armor2": [
      26,
      52,
      113,
      113,
      237
    ]
  },
  "32": {
    "multipliers": [
      16,
      16,
      9,
      7
    ],
    "armor": [
      40,
      86,
      86,
      181
    ],
    "dps": [
      25,
      32,
      25,
      32,
      24,
      34
    ],
    "spellPower": 25,
    "multiplier2": 21,
    "multiplier3": 12,
    "armor2": [
      27,
      53,
      115,
      115,
      241
    ]
  },
  "33": {
    "multipliers": [
      16,
      16,
      9,
      7
    ],
    "armor": [
      41,
      88,
      88,
      184
    ],
    "dps": [
      25,
      33,
      25,
      33,
      25,
      35
    ],
    "spellPower": 26,
    "multiplier2": 21,
    "multiplier3": 12,
    "armor2": [
      27,
      55,
      117,
      117,
      245
    ]
  },
  "34": {
    "multipliers": [
      16,
      16,
      9,
      7
    ],
    "armor": [
      43,
      90,
      90,
      187
    ],
    "dps": [
      26,
      34,
      26,
      34,
      26,
      36
    ],
    "spellPower": 27,
    "multiplier2": 22,
    "multiplier3": 12,
    "armor2": [
      29,
      57,
      120,
      120,
      249
    ]
  },
  "35": {
    "multipliers": [
      17,
      17,
      10,
      7
    ],
    "armor": [
      44,
      91,
      91,
      190
    ],
    "dps": [
      27,
      35,
      27,
      35,
      26,
      37
    ],
    "spellPower": 28,
    "multiplier2": 23,
    "multiplier3": 13,
    "armor2": [
      29,
      59,
      121,
      121,
      253
    ]
  },
  "36": {
    "multipliers": [
      17,
      17,
      10,
      7
    ],
    "armor": [
      44,
      93,
      93,
      193
    ],
    "dps": [
      28,
      36,
      28,
      36,
      27,
      38
    ],
    "spellPower": 29,
    "multiplier2": 23,
    "multiplier3": 13,
    "armor2": [
      29,
      59,
      124,
      124,
      257
    ]
  },
  "37": {
    "multipliers": [
      18,
      18,
      10,
      8
    ],
    "armor": [
      46,
      95,
      95,
      196
    ],
    "dps": [
      28,
      37,
      28,
      37,
      28,
      39
    ],
    "spellPower": 29,
    "multiplier2": 24,
    "multiplier3": 13,
    "armor2": [
      31,
      61,
      127,
      127,
      261
    ]
  },
  "38": {
    "multipliers": [
      18,
      18,
      10,
      8
    ],
    "armor": [
      47,
      97,
      97,
      199
    ],
    "dps": [
      29,
      38,
      29,
      38,
      28,
      40
    ],
    "spellPower": 30,
    "multiplier2": 24,
    "multiplier3": 14,
    "armor2": [
      31,
      63,
      129,
      129,
      265
    ]
  },
  "39": {
    "multipliers": [
      19,
      19,
      11,
      8
    ],
    "armor": [
      48,
      99,
      99,
      202
    ],
    "dps": [
      29,
      38,
      29,
      38,
      29,
      41
    ],
    "spellPower": 31,
    "multiplier2": 25,
    "multiplier3": 14,
    "armor2": [
      32,
      64,
      132,
      132,
      269
    ]
  },
  "40": {
    "multipliers": [
      19,
      19,
      11,
      8
    ],
    "armor": [
      49,
      100,
      205,
      360
    ],
    "dps": [
      30,
      39,
      30,
      39,
      30,
      42
    ],
    "spellPower": 32,
    "multiplier2": 26,
    "multiplier3": 14,
    "armor2": [
      33,
      65,
      133,
      273,
      480
    ]
  },
  "41": {
    "multipliers": [
      20,
      20,
      11,
      8
    ],
    "armor": [
      50,
      102,
      209,
      368
    ],
    "dps": [
      31,
      40,
      31,
      40,
      30,
      43
    ],
    "spellPower": 33,
    "multiplier2": 26,
    "multiplier3": 15,
    "armor2": [
      33,
      67,
      136,
      279,
      491
    ]
  },
  "42": {
    "multipliers": [
      20,
      20,
      11,
      8
    ],
    "armor": [
      51,
      104,
      213,
      375
    ],
    "dps": [
      31,
      41,
      31,
      41,
      31,
      44
    ],
    "spellPower": 33,
    "multiplier2": 27,
    "multiplier3": 15,
    "armor2": [
      34,
      68,
      139,
      284,
      500
    ]
  },
  "43": {
    "multipliers": [
      20,
      20,
      12,
      9
    ],
    "armor": [
      52,
      106,
      217,
      382
    ],
    "dps": [
      32,
      41,
      32,
      41,
      31,
      45
    ],
    "spellPower": 34,
    "multiplier2": 27,
    "multiplier3": 15,
    "armor2": [
      35,
      69,
      141,
      289,
      509
    ]
  },
  "44": {
    "multipliers": [
      21,
      21,
      12,
      9
    ],
    "armor": [
      53,
      108,
      221,
      389
    ],
    "dps": [
      32,
      42,
      32,
      42,
      32,
      47
    ],
    "spellPower": 35,
    "multiplier2": 28,
    "multiplier3": 16,
    "armor2": [
      35,
      71,
      144,
      295,
      519
    ]
  },
  "45": {
    "multipliers": [
      21,
      21,
      12,
      9
    ],
    "armor": [
      54,
      109,
      225,
      396
    ],
    "dps": [
      33,
      43,
      33,
      43,
      33,
      48
    ],
    "spellPower": 36,
    "multiplier2": 28,
    "multiplier3": 16,
    "armor2": [
      36,
      72,
      145,
      300,
      528
    ]
  },
  "46": {
    "multipliers": [
      22,
      22,
      12,
      9
    ],
    "armor": [
      55,
      111,
      229,
      403
    ],
    "dps": [
      34,
      44,
      34,
      44,
      33,
      50
    ],
    "spellPower": 37,
    "multiplier2": 29,
    "multiplier3": 16,
    "armor2": [
      37,
      73,
      148,
      305,
      537
    ]
  },
  "47": {
    "multipliers": [
      22,
      22,
      13,
      9
    ],
    "armor": [
      56,
      113,
      233,
      410
    ],
    "dps": [
      34,
      45,
      34,
      45,
      34,
      51
    ],
    "spellPower": 37,
    "multiplier2": 30,
    "multiplier3": 17,
    "armor2": [
      37,
      75,
      151,
      311,
      547
    ]
  },
  "48": {
    "multipliers": [
      23,
      23,
      13,
      10
    ],
    "armor": [
      57,
      115,
      238,
      418
    ],
    "dps": [
      35,
      45,
      35,
      45,
      34,
      52
    ],
    "spellPower": 38,
    "multiplier2": 30,
    "multiplier3": 17,
    "armor2": [
      38,
      76,
      153,
      317,
      557
    ]
  },
  "49": {
    "multipliers": [
      23,
      23,
      13,
      10
    ],
    "armor": [
      58,
      117,
      242,
      425
    ],
    "dps": [
      35,
      46,
      35,
      46,
      35,
      53
    ],
    "spellPower": 39,
    "multiplier2": 31,
    "multiplier3": 17,
    "armor2": [
      39,
      77,
      156,
      323,
      567
    ]
  },
  "50": {
    "multipliers": [
      24,
      24,
      13,
      10
    ],
    "armor": [
      59,
      118,
      246,
      433
    ],
    "dps": [
      36,
      47,
      36,
      47,
      36,
      54
    ],
    "spellPower": 40,
    "multiplier2": 31,
    "multiplier3": 18,
    "armor2": [
      39,
      79,
      157,
      328,
      577
    ]
  },
  "51": {
    "multipliers": [
      24,
      24,
      14,
      10
    ],
    "armor": [
      60,
      120,
      250,
      440
    ],
    "dps": [
      37,
      48,
      37,
      48,
      36,
      54
    ],
    "spellPower": 40,
    "multiplier2": 32,
    "multiplier3": 18,
    "armor2": [
      40,
      80,
      160,
      333,
      587
    ]
  },
  "52": {
    "multipliers": [
      24,
      24,
      14,
      10
    ],
    "armor": [
      61,
      122,
      254,
      448
    ],
    "dps": [
      37,
      49,
      37,
      49,
      37,
      55
    ],
    "spellPower": 41,
    "multiplier2": 33,
    "multiplier3": 18,
    "armor2": [
      41,
      81,
      163,
      339,
      597
    ]
  },
  "53": {
    "multipliers": [
      25,
      25,
      14,
      11
    ],
    "armor": [
      62,
      124,
      258,
      455
    ],
    "dps": [
      38,
      49,
      38,
      49,
      38,
      57
    ],
    "spellPower": 42,
    "multiplier2": 33,
    "multiplier3": 19,
    "armor2": [
      41,
      83,
      165,
      344,
      607
    ]
  },
  "54": {
    "multipliers": [
      25,
      25,
      14,
      11
    ],
    "armor": [
      63,
      126,
      262,
      463
    ],
    "dps": [
      38,
      50,
      38,
      50,
      38,
      58
    ],
    "spellPower": 43,
    "multiplier2": 34,
    "multiplier3": 19,
    "armor2": [
      42,
      84,
      168,
      349,
      617
    ]
  },
  "55": {
    "multipliers": [
      26,
      26,
      15,
      11
    ],
    "armor": [
      64,
      127,
      266,
      470
    ],
    "dps": [
      39,
      51,
      39,
      51,
      39,
      59
    ],
    "spellPower": 44,
    "multiplier2": 34,
    "multiplier3": 19,
    "armor2": [
      43,
      85,
      169,
      355,
      627
    ]
  },
  "56": {
    "multipliers": [
      26,
      26,
      15,
      11
    ],
    "armor": [
      65,
      129,
      270,
      478
    ],
    "dps": [
      40,
      52,
      40,
      52,
      39,
      61
    ],
    "spellPower": 44,
    "multiplier2": 35,
    "multiplier3": 20,
    "armor2": [
      43,
      87,
      172,
      360,
      637
    ]
  },
  "57": {
    "multipliers": [
      27,
      27,
      15,
      11
    ],
    "armor": [
      66,
      131,
      274,
      485
    ],
    "dps": [
      40,
      53,
      40,
      53,
      40,
      62
    ],
    "spellPower": 45,
    "multiplier2": 36,
    "multiplier3": 20,
    "armor2": [
      44,
      88,
      175,
      365,
      647
    ]
  },
  "58": {
    "multipliers": [
      34,
      34,
      19,
      14
    ],
    "armor": [
      83,
      159,
      344,
      611
    ],
    "dps": [
      50,
      65,
      46,
      60,
      48,
      85
    ],
    "spellPower": 46,
    "multiplier2": 46,
    "multiplier3": 25,
    "armor2": [
      55,
      111,
      212,
      459,
      815
    ]
  },
  "59": {
    "multipliers": [
      36,
      36,
      20,
      15
    ],
    "armor": [
      86,
      164,
      356,
      633
    ],
    "dps": [
      51,
      67,
      47,
      61,
      50,
      88
    ],
    "spellPower": 52,
    "multiplier2": 47,
    "multiplier3": 27,
    "armor2": [
      57,
      115,
      219,
      475,
      844
    ]
  },
  "60": {
    "multipliers": [
      37,
      37,
      21,
      16
    ],
    "armor": [
      88,
      169,
      368,
      655
    ],
    "dps": [
      53,
      68,
      47,
      62,
      51,
      91
    ],
    "spellPower": 57,
    "multiplier2": 49,
    "multiplier3": 28,
    "armor2": [
      59,
      117,
      225,
      491,
      873
    ]
  },
  "61": {
    "multipliers": [
      39,
      39,
      22,
      16
    ],
    "armor": [
      91,
      174,
      380,
      677
    ],
    "dps": [
      54,
      70,
      48,
      63,
      52,
      94
    ],
    "spellPower": 63,
    "multiplier2": 51,
    "multiplier3": 29,
    "armor2": [
      61,
      121,
      232,
      507,
      903
    ]
  },
  "62": {
    "multipliers": [
      40,
      40,
      22,
      17
    ],
    "armor": [
      94,
      178,
      392,
      699
    ],
    "dps": [
      55,
      72,
      49,
      64,
      53,
      97
    ],
    "spellPower": 68,
    "multiplier2": 53,
    "multiplier3": 30,
    "armor2": [
      63,
      125,
      237,
      523,
      932
    ]
  },
  "63": {
    "multipliers": [
      41,
      41,
      23,
      17
    ],
    "armor": [
      97,
      183,
      404,
      721
    ],
    "dps": [
      56,
      73,
      50,
      65,
      54,
      100
    ],
    "spellPower": 73,
    "multiplier2": 54,
    "multiplier3": 31,
    "armor2": [
      65,
      129,
      244,
      539,
      961
    ]
  },
  "64": {
    "multipliers": [
      42,
      42,
      24,
      18
    ],
    "armor": [
      100,
      187,
      416,
      742
    ],
    "dps": [
      58,
      75,
      50,
      66,
      55,
      104
    ],
    "spellPower": 80,
    "multiplier2": 55,
    "multiplier3": 31,
    "armor2": [
      67,
      133,
      249,
      555,
      989
    ]
  },
  "65": {
    "multipliers": [
      43,
      43,
      24,
      18
    ],
    "armor": [
      102,
      192,
      428,
      764
    ],
    "dps": [
      60,
      78,
      52,
      67,
      57,
      109
    ],
    "spellPower": 89,
    "multiplier2": 57,
    "multiplier3": 32,
    "armor2": [
      68,
      136,
      256,
      571,
      1019
    ]
  },
  "66": {
    "multipliers": [
      44,
      44,
      25,
      18
    ],
    "armor": [
      105,
      197,
      440,
      786
    ],
    "dps": [
      62,
      81,
      53,
      69,
      59,
      113
    ],
    "spellPower": 98,
    "multiplier2": 58,
    "multiplier3": 33,
    "armor2": [
      70,
      140,
      263,
      587,
      1048
    ]
  },
  "67": {
    "multipliers": [
      45,
      45,
      25,
      19
    ],
    "armor": [
      108,
      203,
      452,
      808
    ],
    "dps": [
      65,
      84,
      54,
      71,
      61,
      117
    ],
    "spellPower": 107,
    "multiplier2": 59,
    "multiplier3": 34,
    "armor2": [
      72,
      144,
      271,
      603,
      1077
    ]
  },
  "68": {
    "multipliers": [
      62,
      62,
      36,
      26
    ],
    "armor": [
      157,
      294,
      654,
      1169
    ],
    "dps": [
      91,
      119,
      70,
      91,
      82,
      168
    ],
    "spellPower": 220,
    "multiplier2": 84,
    "multiplier3": 47,
    "armor2": [
      105,
      209,
      392,
      872,
      1559
    ]
  },
  "69": {
    "multipliers": [
      64,
      64,
      37,
      27
    ],
    "armor": [
      161,
      303,
      675,
      1206
    ],
    "dps": [
      93,
      121,
      71,
      92,
      84,
      172
    ],
    "spellPower": 228,
    "multiplier2": 87,
    "multiplier3": 48,
    "armor2": [
      107,
      215,
      404,
      900,
      1608
    ]
  },
  "70": {
    "multipliers": [
      67,
      67,
      39,
      28
    ],
    "armor": [
      166,
      312,
      695,
      1242
    ],
    "dps": [
      95,
      124,
      72,
      94,
      86,
      175
    ],
    "spellPower": 238,
    "multiplier2": 90,
    "multiplier3": 50,
    "armor2": [
      111,
      221,
      416,
      927,
      1656
    ]
  },
  "71": {
    "multipliers": [
      69,
      69,
      40,
      29
    ],
    "armor": [
      171,
      321,
      715,
      1278
    ],
    "dps": [
      97,
      127,
      73,
      95,
      88,
      179
    ],
    "spellPower": 246,
    "multiplier2": 93,
    "multiplier3": 52,
    "armor2": [
      114,
      228,
      428,
      953,
      1704
    ]
  },
  "72": {
    "multipliers": [
      72,
      72,
      42,
      30
    ],
    "armor": [
      176,
      331,
      736,
      1315
    ],
    "dps": [
      99,
      129,
      75,
      97,
      90,
      183
    ],
    "spellPower": 255,
    "multiplier2": 97,
    "multiplier3": 54,
    "armor2": [
      117,
      235,
      441,
      981,
      1753
    ]
  },
  "73": {
    "multipliers": [
      75,
      75,
      43,
      32
    ],
    "armor": [
      181,
      340,
      756,
      1351
    ],
    "dps": [
      102,
      132,
      76,
      99,
      92,
      187
    ],
    "spellPower": 265,
    "multiplier2": 101,
    "multiplier3": 56,
    "armor2": [
      121,
      241,
      453,
      1008,
      1801
    ]
  },
  "74": {
    "multipliers": [
      78,
      78,
      45,
      33
    ],
    "armor": [
      186,
      349,
      776,
      1387
    ],
    "dps": [
      104,
      135,
      77,
      100,
      94,
      191
    ],
    "spellPower": 275,
    "multiplier2": 104,
    "multiplier3": 58,
    "armor2": [
      124,
      248,
      465,
      1035,
      1849
    ]
  },
  "75": {
    "multipliers": [
      81,
      81,
      46,
      34
    ],
    "armor": [
      191,
      358,
      797,
      1423
    ],
    "dps": [
      106,
      138,
      79,
      102,
      96,
      196
    ],
    "spellPower": 285,
    "multiplier2": 108,
    "multiplier3": 60,
    "armor2": [
      127,
      255,
      477,
      1063,
      1897
    ]
  },
  "76": {
    "multipliers": [
      84,
      84,
      48,
      35
    ],
    "armor": [
      196,
      367,
      817,
      1460
    ],
    "dps": [
      109,
      141,
      80,
      104,
      98,
      200
    ],
    "spellPower": 296,
    "multiplier2": 113,
    "multiplier3": 63,
    "armor2": [
      131,
      261,
      489,
      1089,
      1947
    ]
  },
  "77": {
    "multipliers": [
      87,
      87,
      50,
      37
    ],
    "armor": [
      200,
      376,
      837,
      1496
    ],
    "dps": [
      111,
      145,
      81,
      106,
      101,
      205
    ],
    "spellPower": 307,
    "multiplier2": 117,
    "multiplier3": 65,
    "armor2": [
      133,
      267,
      501,
      1116,
      1995
    ]
  },
  "78": {
    "multipliers": [
      90,
      90,
      52,
      38
    ],
    "armor": [
      205,
      386,
      858,
      1532
    ],
    "dps": [
      114,
      148,
      83,
      108,
      103,
      210
    ],
    "spellPower": 319,
    "multiplier2": 121,
    "multiplier3": 68,
    "armor2": [
      137,
      273,
      515,
      1144,
      2043
    ]
  },
  "79": {
    "multipliers": [
      94,
      94,
      54,
      40
    ],
    "armor": [
      208,
      390,
      868,
      1551
    ],
    "dps": [
      117,
      152,
      85,
      110,
      105,
      215
    ],
    "spellPower": 331,
    "multiplier2": 126,
    "multiplier3": 71,
    "armor2": [
      139,
      277,
      520,
      1157,
      2068
    ]
  },
  "80": {
    "multipliers": [
      97,
      97,
      56,
      41
    ],
    "armor": [
      210,
      395,
      878,
      1570
    ],
    "dps": [
      120,
      156,
      86,
      112,
      108,
      220
    ],
    "spellPower": 343,
    "multiplier2": 131,
    "multiplier3": 73,
    "armor2": [
      140,
      280,
      527,
      1171,
      2093
    ]
  }
};
