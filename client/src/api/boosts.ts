import { PortalApiError } from "./portal.js";

export interface BoostCharacter {
  id: string;
  name: string;
  level: number;
  race: string;
  class: string;
}

export interface MoneyBoostLimits {
  enabled: boolean;
  minimumGold: number;
  maximumGoldPerRequest: number;
  dailyGoldLimit: number;
  dailyRequestLimit: number;
}

export interface PortableHolesBoostMetadata {
  enabled: boolean;
  name: "Hole Lotta Storage";
  itemName: "Portable Hole";
  itemCount: 4;
  slotsPerBag: 24;
  repeatable: true;
}

export interface ArcaneTomeBoostMetadata {
  enabled: boolean;
  name: "Tomeward Bound";
  itemName: "Arcane Tome of Displacement";
  itemCount: 1;
  repeatable: true;
}

export interface CharacterLevelBoostMetadata {
  enabled: boolean;
  name: "Level Up, Buttercup";
  maximumLevel: 80;
  xpWillReset: true;
}

export interface BoostOverview {
  characters: BoostCharacter[];
  money: MoneyBoostLimits;
  portableHoles: PortableHolesBoostMetadata;
  arcaneTome: ArcaneTomeBoostMetadata;
  characterLevel: CharacterLevelBoostMetadata;
}

export interface SendMoneyInput {
  requestId: string;
  characterId: string;
  gold: number;
  csrfToken: string;
}

export interface SendMoneyResult {
  requestId: string;
  status: "sent";
  message: string;
}

export interface SendPortableHolesInput {
  requestId: string;
  characterId: string;
  csrfToken: string;
}

export type SendPortableHolesResult = SendMoneyResult;

export type SendArcaneTomeInput = SendPortableHolesInput;
export type SendArcaneTomeResult = SendMoneyResult;

export interface SendCharacterLevelInput {
  requestId: string;
  characterId: string;
  targetLevel: number;
  csrfToken: string;
}

export interface SendCharacterLevelResult {
  requestId: string;
  status: "applied";
  character: { id: string; name: string; level: number };
  message: string;
}

export class BoostApiError extends PortalApiError {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly deliveryStatus?: "pending" | "unknown",
    readonly requestId?: string
  ) {
    super(message);
    this.name = "BoostApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function readPublicError(value: unknown, fallback: string): string {
  if (!isRecord(value) || typeof value.error !== "string" || value.error.length > 256) {
    return fallback;
  }
  return value.error;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new BoostApiError("Boosts are temporarily unavailable.", response.status);
  }
}

function parseCharacter(value: unknown): BoostCharacter | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    typeof value.id !== "string" || !/^[1-9]\d{0,9}$/u.test(value.id) ||
    typeof value.name !== "string" || Array.from(value.name).length < 2 || Array.from(value.name).length > 12 ||
    typeof value.race !== "string" || value.race.length > 64 ||
    typeof value.class !== "string" || value.class.length > 64 ||
    !isSafePositiveInteger(value.level) || value.level > 80
  ) {
    return undefined;
  }
  return {
    id: value.id,
    name: value.name,
    level: value.level,
    race: value.race,
    class: value.class
  };
}

function parseOverview(value: unknown): BoostOverview | undefined {
  if (
    !isRecord(value) ||
    !Array.isArray(value.characters) ||
    !isRecord(value.money) ||
    !isRecord(value.portableHoles) ||
    !isRecord(value.arcaneTome) ||
    !isRecord(value.characterLevel)
  ) {
    return undefined;
  }
  const characters = value.characters.map(parseCharacter);
  const money = value.money;
  const portableHoles = value.portableHoles;
  const arcaneTome = value.arcaneTome;
  const characterLevel = value.characterLevel;
  if (
    characters.some((character) => character === undefined) ||
    typeof money.enabled !== "boolean" ||
    !isSafePositiveInteger(money.minimumGold) ||
    !isSafePositiveInteger(money.maximumGoldPerRequest) ||
    !isSafePositiveInteger(money.dailyGoldLimit) ||
    !isSafePositiveInteger(money.dailyRequestLimit) ||
    typeof portableHoles.enabled !== "boolean" ||
    portableHoles.name !== "Hole Lotta Storage" ||
    portableHoles.itemName !== "Portable Hole" ||
    portableHoles.itemCount !== 4 ||
    portableHoles.slotsPerBag !== 24 ||
    portableHoles.repeatable !== true ||
    typeof arcaneTome.enabled !== "boolean" ||
    arcaneTome.name !== "Tomeward Bound" ||
    arcaneTome.itemName !== "Arcane Tome of Displacement" ||
    arcaneTome.itemCount !== 1 ||
    arcaneTome.repeatable !== true ||
    typeof characterLevel.enabled !== "boolean" ||
    characterLevel.name !== "Level Up, Buttercup" ||
    characterLevel.maximumLevel !== 80 ||
    characterLevel.xpWillReset !== true
  ) {
    return undefined;
  }
  return {
    characters: characters as BoostCharacter[],
    money: {
      enabled: money.enabled,
      minimumGold: money.minimumGold,
      maximumGoldPerRequest: money.maximumGoldPerRequest,
      dailyGoldLimit: money.dailyGoldLimit,
      dailyRequestLimit: money.dailyRequestLimit
    },
    portableHoles: {
      enabled: portableHoles.enabled,
      name: portableHoles.name,
      itemName: portableHoles.itemName,
      itemCount: portableHoles.itemCount,
      slotsPerBag: portableHoles.slotsPerBag,
      repeatable: portableHoles.repeatable
    },
    arcaneTome: {
      enabled: arcaneTome.enabled,
      name: arcaneTome.name,
      itemName: arcaneTome.itemName,
      itemCount: arcaneTome.itemCount,
      repeatable: arcaneTome.repeatable
    },
    characterLevel: {
      enabled: characterLevel.enabled,
      name: characterLevel.name,
      maximumLevel: characterLevel.maximumLevel,
      xpWillReset: characterLevel.xpWillReset
    }
  };
}

export async function getBoostOverview(signal?: AbortSignal): Promise<BoostOverview> {
  const response = await fetch("/api/boosts", {
    cache: "no-store",
    credentials: "same-origin",
    signal
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new BoostApiError(readPublicError(body, "Boosts are temporarily unavailable."), response.status);
  }
  const overview = parseOverview(body);
  if (!overview) {
    throw new BoostApiError("Boosts are temporarily unavailable.", response.status);
  }
  return overview;
}

export async function sendMoneyBoost(input: SendMoneyInput): Promise<SendMoneyResult> {
  let response: Response;
  try {
    response = await fetch("/api/boosts/money", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": input.csrfToken
      },
      credentials: "same-origin",
      body: JSON.stringify({
        requestId: input.requestId,
        characterId: input.characterId,
        gold: input.gold
      })
    });
  } catch {
    throw new BoostApiError(
      "Delivery could not be confirmed. Do not send again; give this request ID to an administrator.",
      0,
      "unknown",
      input.requestId
    );
  }

  const body = await readJson(response);
  if (!response.ok) {
    const status = isRecord(body) && (body.status === "pending" || body.status === "unknown")
      ? body.status
      : undefined;
    const requestId = isRecord(body) && typeof body.requestId === "string" ? body.requestId : undefined;
    throw new BoostApiError(
      readPublicError(body, "Gold could not be sent. Try again later."),
      response.status,
      status,
      requestId
    );
  }
  if (
    !isRecord(body) ||
    typeof body.requestId !== "string" ||
    body.requestId !== input.requestId ||
    body.status !== "sent" ||
    typeof body.message !== "string" ||
    body.message.length > 256
  ) {
    throw new BoostApiError(
      "Delivery could not be confirmed. Do not send again; give this request ID to an administrator.",
      response.status,
      "unknown",
      input.requestId
    );
  }
  return { requestId: body.requestId, status: "sent", message: body.message };
}

export async function sendPortableHolesBoost(
  input: SendPortableHolesInput
): Promise<SendPortableHolesResult> {
  let response: Response;
  const unknownMessage =
    "Delivery could not be confirmed and may already have arrived. Check your mail before sending another bundle.";
  try {
    response = await fetch("/api/boosts/portable-holes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": input.csrfToken
      },
      credentials: "same-origin",
      body: JSON.stringify({
        requestId: input.requestId,
        characterId: input.characterId
      })
    });
  } catch {
    throw new BoostApiError(unknownMessage, 0, "unknown", input.requestId);
  }

  let body: unknown;
  try {
    body = await response.json() as unknown;
  } catch {
    throw new BoostApiError(unknownMessage, response.status, "unknown", input.requestId);
  }
  if (!response.ok) {
    const status = isRecord(body) && (body.status === "pending" || body.status === "unknown")
      ? body.status
      : undefined;
    const requestId = isRecord(body) && typeof body.requestId === "string" ? body.requestId : undefined;
    throw new BoostApiError(
      readPublicError(body, "Bags could not be sent. Try again later."),
      response.status,
      status,
      requestId
    );
  }
  if (
    !isRecord(body) ||
    body.requestId !== input.requestId ||
    body.status !== "sent" ||
    typeof body.message !== "string" ||
    body.message.length > 256
  ) {
    throw new BoostApiError(unknownMessage, response.status, "unknown", input.requestId);
  }
  return { requestId: input.requestId, status: "sent", message: body.message };
}

export async function sendArcaneTomeBoost(
  input: SendArcaneTomeInput
): Promise<SendArcaneTomeResult> {
  const unknownMessage =
    "Delivery could not be confirmed and may already have arrived. Check your in-game mail before sending another tome.";
  let response: Response;
  try {
    response = await fetch("/api/boosts/arcane-tome", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": input.csrfToken
      },
      credentials: "same-origin",
      body: JSON.stringify({ requestId: input.requestId, characterId: input.characterId })
    });
  } catch {
    throw new BoostApiError(unknownMessage, 0, "unknown", input.requestId);
  }

  let body: unknown;
  try {
    body = await response.json() as unknown;
  } catch {
    throw new BoostApiError(unknownMessage, response.status, "unknown", input.requestId);
  }
  if (!response.ok) {
    const status = isRecord(body) && (body.status === "pending" || body.status === "unknown")
      ? body.status
      : undefined;
    const requestId = isRecord(body) && typeof body.requestId === "string" ? body.requestId : undefined;
    throw new BoostApiError(
      readPublicError(body, "The tome could not be sent. Try again later."),
      response.status,
      status,
      requestId
    );
  }
  if (
    !isRecord(body) || body.requestId !== input.requestId || body.status !== "sent" ||
    typeof body.message !== "string" || body.message.length > 256
  ) {
    throw new BoostApiError(unknownMessage, response.status, "unknown", input.requestId);
  }
  return { requestId: input.requestId, status: "sent", message: body.message };
}

export async function sendCharacterLevelBoost(
  input: SendCharacterLevelInput
): Promise<SendCharacterLevelResult> {
  const unknownMessage =
    "The level change could not be confirmed. Do not submit it again; give this request ID to an administrator.";
  let response: Response;
  try {
    response = await fetch("/api/boosts/character-level", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": input.csrfToken },
      credentials: "same-origin",
      body: JSON.stringify({
        requestId: input.requestId,
        characterId: input.characterId,
        targetLevel: input.targetLevel
      })
    });
  } catch {
    throw new BoostApiError(unknownMessage, 0, "unknown", input.requestId);
  }
  let body: unknown;
  try { body = await response.json() as unknown; } catch {
    throw new BoostApiError(unknownMessage, response.status, "unknown", input.requestId);
  }
  if (!response.ok) {
    const status = isRecord(body) && (body.status === "pending" || body.status === "unknown")
      ? body.status : undefined;
    const requestId = isRecord(body) && typeof body.requestId === "string" ? body.requestId : undefined;
    throw new BoostApiError(
      readPublicError(body, "The character level could not be changed. Try again later."),
      response.status,
      status,
      requestId
    );
  }
  if (
    !isRecord(body) || body.requestId !== input.requestId || body.status !== "applied" ||
    !isRecord(body.character) || body.character.id !== input.characterId ||
    typeof body.character.name !== "string" || body.character.name.length > 12 ||
    body.character.level !== input.targetLevel || typeof body.message !== "string" || body.message.length > 256
  ) throw new BoostApiError(unknownMessage, response.status, "unknown", input.requestId);
  return {
    requestId: input.requestId,
    status: "applied",
    character: { id: body.character.id, name: body.character.name, level: body.character.level },
    message: body.message
  };
}
