export interface ServerStatus {
  online: boolean;
}

export interface OnlinePlayer {
  accountLogin: string;
  characterName: string;
  race: string;
  class: string;
  level: number;
  location: string;
}

export interface OnlinePlayersResponse {
  generatedAt: string;
  count: number;
  players: OnlinePlayer[];
}

export interface RegistrationInput {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  inviteCode: string;
}

export interface RegistrationResponse {
  message: string;
}

export class PortalApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortalApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new PortalApiError("The portal returned an invalid response.");
  }
}

function readString(
  source: Record<string, unknown>,
  key: string,
  maximumLength: number
): string | undefined {
  const value = source[key];

  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return undefined;
  }

  return value;
}

export async function getServerStatus(signal?: AbortSignal): Promise<ServerStatus> {
  const response = await fetch("/api/status", { signal });
  const body = await readJson(response);

  if (
    (response.status !== 200 && response.status !== 503) ||
    !isRecord(body) ||
    typeof body.online !== "boolean"
  ) {
    throw new PortalApiError("Server status is unavailable.");
  }

  return { online: body.online };
}

function parseOnlinePlayer(value: unknown): OnlinePlayer | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const accountLogin = readString(value, "accountLogin", 128);
  const characterName = readString(value, "characterName", 128);
  const race = readString(value, "race", 128);
  const playerClass = readString(value, "class", 128);
  const location = readString(value, "location", 512);
  const level = value.level;

  if (
    !accountLogin ||
    !characterName ||
    !race ||
    !playerClass ||
    !location ||
    typeof level !== "number" ||
    !Number.isInteger(level) ||
    level < 1 ||
    level > 255
  ) {
    return undefined;
  }

  return {
    accountLogin,
    characterName,
    race,
    class: playerClass,
    level,
    location
  };
}

export async function getOnlinePlayers(signal?: AbortSignal): Promise<OnlinePlayersResponse> {
  const response = await fetch("/api/online-players", {
    cache: "no-store",
    signal
  });

  if (!response.ok) {
    throw new PortalApiError("The online roster is temporarily unavailable.");
  }

  const body = await readJson(response);

  if (
    !isRecord(body) ||
    typeof body.generatedAt !== "string" ||
    body.generatedAt.length > 64 ||
    !Number.isFinite(Date.parse(body.generatedAt)) ||
    typeof body.count !== "number" ||
    !Number.isInteger(body.count) ||
    body.count < 0 ||
    body.count > 10_000 ||
    !Array.isArray(body.players) ||
    body.players.length !== body.count
  ) {
    throw new PortalApiError("The online roster is temporarily unavailable.");
  }

  const players = body.players.map(parseOnlinePlayer);

  if (players.some((player) => player === undefined)) {
    throw new PortalApiError("The online roster is temporarily unavailable.");
  }

  return {
    generatedAt: body.generatedAt,
    count: body.count,
    players: players as OnlinePlayer[]
  };
}

export async function registerAccount(input: RegistrationInput): Promise<RegistrationResponse> {
  const response = await fetch("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const body = await readJson(response);

  if (!isRecord(body)) {
    throw new PortalApiError("Registration failed.");
  }

  if (!response.ok) {
    const error = readString(body, "error", 512);
    throw new PortalApiError(error ?? "Registration failed.");
  }

  const message = readString(body, "message", 512);

  if (response.status !== 201 || !message) {
    throw new PortalApiError("Registration failed.");
  }

  return { message };
}
