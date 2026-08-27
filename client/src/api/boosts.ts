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

export interface BoostOverview {
  characters: BoostCharacter[];
  money: MoneyBoostLimits;
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
  if (!isRecord(value) || !Array.isArray(value.characters) || !isRecord(value.money)) {
    return undefined;
  }
  const characters = value.characters.map(parseCharacter);
  const money = value.money;
  if (
    characters.some((character) => character === undefined) ||
    typeof money.enabled !== "boolean" ||
    !isSafePositiveInteger(money.minimumGold) ||
    !isSafePositiveInteger(money.maximumGoldPerRequest) ||
    !isSafePositiveInteger(money.dailyGoldLimit) ||
    !isSafePositiveInteger(money.dailyRequestLimit)
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
