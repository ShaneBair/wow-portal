export const FLIGHT_PATH_MASK_WORDS = 14;
export const FLIGHT_PATH_MASK_REVISION = "wotlk-335a-b19e04c6";

export const FLIGHT_PATH_MASK_PROVENANCE = Object.freeze({
  sourceRevision: "b19e04c603fa91c2249532b2039b4730e8c526c8",
  dbcRevision: "WotLK 3.3.5a build 12340",
  taxiNodesSha256: "ba2d0c16985a5e561afa8424e1dc826ead6c8db425af127490c5f58d45429b7f",
  taxiPathSha256: "1af5ba71fca5684a432b9d3f449aaeb21e4c091532e4b5795335be200d88dd5d",
  spellSha256: "d5cce1a83550dcfa9eb2f0251dbb11fd24c272534b2b1a9b230924a44d817ab3",
  verifiedAt: "2026-10-01"
});

export interface FlightPathGrantArtifact {
  alliance: readonly number[];
  horde: readonly number[];
  deathKnight: readonly number[];
}

export const FLIGHT_PATH_GRANT_ARTIFACT: FlightPathGrantArtifact = Object.freeze({
  alliance: Object.freeze([
    3456411898, 2768835921, 813220679, 2608185305, 3417329313, 30737129, 1052807,
    1551368198, 177545232, 2151596257, 3728483, 1073741888, 256, 0
  ]),
  horde: Object.freeze([
    830166789, 1523616424, 8314040, 3869622244, 3286269610, 3825533485, 672274560,
    2877343238, 177537039, 2151579873, 3763310, 3221225536, 1048832, 4194304
  ]),
  deathKnight: Object.freeze([
    0, 0, 0, 0, 0, 0, 0, 0, 0, 67174400, 4112, 0, 0, 0
  ])
});

export function validateFlightPathGrantArtifact(artifact: FlightPathGrantArtifact): void {
  const masks: ReadonlyArray<readonly [string, readonly number[]]> = [
    ["alliance", artifact.alliance], ["horde", artifact.horde], ["deathKnight", artifact.deathKnight]
  ];
  for (const [name, words] of masks) {
    if (
      words.length !== FLIGHT_PATH_MASK_WORDS ||
      words.some((word) => !Number.isSafeInteger(word) || word < 0 || word > 0xffff_ffff) ||
      words.every((word) => word === 0xffff_ffff)
    ) throw new Error(`Flight path ${name} grant mask is invalid.`);
  }
  if (artifact.alliance.every((word) => word === 0) || artifact.horde.every((word) => word === 0)) {
    throw new Error("Flight path faction grant masks may not be empty.");
  }
}

validateFlightPathGrantArtifact(FLIGHT_PATH_GRANT_ARTIFACT);
