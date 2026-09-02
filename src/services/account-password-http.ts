import type { AccountPasswordInput } from "./account-password.js";
import { upperBasicLatin } from "./azerothcore-srp6.js";

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function validPassword(value: string, minimum: number, maximum: number): boolean {
  const length = Array.from(value).length;
  return length >= minimum && length <= maximum &&
    !/[\u0000\r\n]/u.test(value) && isWellFormedUnicode(value);
}

export function parseAccountPasswordInput(body: unknown): AccountPasswordInput | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const source = body as Record<string, unknown>;
  const keys = Object.keys(source).sort();
  if (keys.join(",") !== "confirmNewPassword,currentPassword,newPassword") return undefined;
  if (
    typeof source.currentPassword !== "string" ||
    typeof source.newPassword !== "string" ||
    typeof source.confirmNewPassword !== "string" ||
    !validPassword(source.currentPassword, 1, 64) ||
    !validPassword(source.newPassword, 8, 16) ||
    !validPassword(source.confirmNewPassword, 8, 16) ||
    source.newPassword !== source.confirmNewPassword ||
    upperBasicLatin(source.newPassword) === upperBasicLatin(source.currentPassword)
  ) return undefined;
  return {
    currentPassword: source.currentPassword,
    newPassword: source.newPassword,
    confirmNewPassword: source.confirmNewPassword
  };
}
