import { createHash, timingSafeEqual } from "node:crypto";

const SRP_GENERATOR = 7n;
const SRP_MODULUS = BigInt(
  "0x894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7"
);
export const AZEROTHCORE_SRP6_LENGTH = 32;

function sha1(...values: Uint8Array[]): Buffer {
  const hash = createHash("sha1");
  for (const value of values) {
    hash.update(value);
  }
  return hash.digest();
}

function littleEndianToBigInt(value: Uint8Array): bigint {
  let result = 0n;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    result = (result << 8n) | BigInt(value[index]!);
  }
  return result;
}

function bigIntToFixedLittleEndian(value: bigint, length: number): Buffer {
  const result = Buffer.alloc(length);
  let remaining = value;
  for (let index = 0; index < length; index += 1) {
    result[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  if (remaining !== 0n) {
    throw new Error("SRP6 verifier does not fit the required representation.");
  }
  return result;
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let factor = base % modulus;
  let power = exponent;
  while (power > 0n) {
    if ((power & 1n) === 1n) {
      result = (result * factor) % modulus;
    }
    factor = (factor * factor) % modulus;
    power >>= 1n;
  }
  return result;
}

export function upperBasicLatin(value: string): string {
  return value.replace(/[a-z]/gu, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0x20)
  );
}

export function calculateAzerothCoreVerifier(
  username: string,
  password: string,
  salt: Uint8Array
): Buffer {
  if (salt.byteLength !== AZEROTHCORE_SRP6_LENGTH) {
    throw new Error("AzerothCore SRP6 salt must be exactly 32 bytes.");
  }

  const identityHash = sha1(Buffer.from(`${username}:${password}`, "utf8"));
  const exponent = littleEndianToBigInt(sha1(salt, identityHash));
  return bigIntToFixedLittleEndian(
    modPow(SRP_GENERATOR, exponent, SRP_MODULUS),
    AZEROTHCORE_SRP6_LENGTH
  );
}

export function verifyAzerothCorePassword(
  username: string,
  password: string,
  salt: Uint8Array,
  verifier: Uint8Array
): boolean {
  if (
    salt.byteLength !== AZEROTHCORE_SRP6_LENGTH ||
    verifier.byteLength !== AZEROTHCORE_SRP6_LENGTH
  ) {
    return false;
  }

  const candidate = calculateAzerothCoreVerifier(
    upperBasicLatin(username),
    upperBasicLatin(password),
    salt
  );
  return timingSafeEqual(candidate, Buffer.from(verifier));
}
