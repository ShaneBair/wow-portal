import { PortalApiError } from "./portal.js";

const MAX_UINT32 = 0xffff_ffff;

export interface RosterCharacter {
  characterName: string;
  level: number;
  class: string;
  race: string;
  totalPlayedSeconds: number;
}

export interface RosterAccount {
  accountLogin: string;
  characters: RosterCharacter[];
}

export interface AccountRosterResponse {
  generatedAt: string;
  accountCount: number;
  characterCount: number;
  accounts: RosterAccount[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && Array.from(value).length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}

function validInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function parseCharacter(value: unknown): RosterCharacter | undefined {
  if (!isRecord(value) || !validText(value.characterName, 12) ||
    !validInteger(value.level, 1, 255) || !validText(value.class, 64) ||
    !validText(value.race, 64) || !validInteger(value.totalPlayedSeconds, 0, MAX_UINT32)) return undefined;
  if (Object.keys(value).some((key) => !["characterName", "level", "class", "race", "totalPlayedSeconds"].includes(key))) return undefined;
  return {
    characterName: value.characterName,
    level: value.level,
    class: value.class,
    race: value.race,
    totalPlayedSeconds: value.totalPlayedSeconds
  };
}

function parseRoster(value: unknown): AccountRosterResponse | undefined {
  if (!isRecord(value) || Object.keys(value).some((key) =>
    !["generatedAt", "accountCount", "characterCount", "accounts"].includes(key)
  ) || typeof value.generatedAt !== "string" || !Array.isArray(value.accounts) ||
    !validInteger(value.accountCount, 0, 250) || !validInteger(value.characterCount, 0, 2_500)) return undefined;
  const date = new Date(value.generatedAt);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value.generatedAt) return undefined;
  const accountNames = new Set<string>();
  const characterNames = new Set<string>();
  let characterCount = 0;
  const accounts: RosterAccount[] = [];
  for (const rawAccount of value.accounts) {
    if (!isRecord(rawAccount) || Object.keys(rawAccount).some((key) => !["accountLogin", "characters"].includes(key)) ||
      !validText(rawAccount.accountLogin, 16) || !Array.isArray(rawAccount.characters) || rawAccount.characters.length === 0) return undefined;
    const normalizedAccount = rawAccount.accountLogin.toLocaleLowerCase("en");
    if (accountNames.has(normalizedAccount)) return undefined;
    accountNames.add(normalizedAccount);
    const characters = rawAccount.characters.map(parseCharacter);
    if (characters.some((character) => character === undefined)) return undefined;
    for (const character of characters as RosterCharacter[]) {
      const normalizedCharacter = character.characterName.toLocaleLowerCase("en");
      if (characterNames.has(normalizedCharacter)) return undefined;
      characterNames.add(normalizedCharacter);
    }
    characterCount += characters.length;
    accounts.push({ accountLogin: rawAccount.accountLogin, characters: characters as RosterCharacter[] });
  }
  if (value.accountCount !== accounts.length || value.characterCount !== characterCount) return undefined;
  return { generatedAt: value.generatedAt, accountCount: value.accountCount, characterCount, accounts };
}

export class RosterApiError extends PortalApiError {
  constructor(message: string, readonly httpStatus: number) {
    super(message);
    this.name = "RosterApiError";
  }
}

export async function getAccountRoster(signal?: AbortSignal): Promise<AccountRosterResponse> {
  let response: Response;
  try {
    response = await fetch("/api/roster", { cache: "no-store", credentials: "same-origin", signal });
  } catch {
    throw new RosterApiError("The roster is temporarily unavailable.", 0);
  }
  let body: unknown;
  try { body = await response.json() as unknown; } catch {
    throw new RosterApiError("The roster is temporarily unavailable.", response.status);
  }
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string" && body.error.length <= 256
      ? body.error : "The roster is temporarily unavailable.";
    throw new RosterApiError(message, response.status);
  }
  const roster = parseRoster(body);
  if (!roster) throw new RosterApiError("The roster is temporarily unavailable.", response.status);
  return roster;
}
