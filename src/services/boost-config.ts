const DEFAULT_MAX_GOLD_PER_REQUEST = 10_000;
const DEFAULT_DAILY_GOLD_LIMIT = 20_000;
const DEFAULT_DAILY_REQUEST_LIMIT = 5;
const MAX_COMMAND_GOLD = 214_748;

export interface MoneyBoostConfig {
  enabled: boolean;
  minimumGold: 1;
  maximumGoldPerRequest: number;
  dailyGoldLimit: number;
  dailyRequestLimit: number;
}

export interface PortableHolesBoostConfig {
  enabled: boolean;
}

export class BoostConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoostConfigurationError";
  }
}

function readEnabled(value: string | undefined, key: string): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "false") {
    return false;
  }
  if (normalized === "true") {
    return true;
  }
  throw new BoostConfigurationError(`${key} must be true or false.`);
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  key: string,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  const normalized = value?.trim() || String(fallback);
  const parsed = Number(normalized);
  if (
    !/^\d+$/u.test(normalized) ||
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > maximum
  ) {
    throw new BoostConfigurationError(`${key} must be a positive whole number no greater than ${maximum}.`);
  }
  return parsed;
}

export function readMoneyBoostConfig(
  environment: NodeJS.ProcessEnv = process.env
): MoneyBoostConfig {
  const maximumGoldPerRequest = readPositiveInteger(
    environment.BOOST_MONEY_MAX_GOLD_PER_REQUEST,
    DEFAULT_MAX_GOLD_PER_REQUEST,
    "BOOST_MONEY_MAX_GOLD_PER_REQUEST",
    MAX_COMMAND_GOLD
  );
  const dailyGoldLimit = readPositiveInteger(
    environment.BOOST_MONEY_DAILY_GOLD_LIMIT,
    DEFAULT_DAILY_GOLD_LIMIT,
    "BOOST_MONEY_DAILY_GOLD_LIMIT"
  );
  const dailyRequestLimit = readPositiveInteger(
    environment.BOOST_MONEY_DAILY_REQUEST_LIMIT,
    DEFAULT_DAILY_REQUEST_LIMIT,
    "BOOST_MONEY_DAILY_REQUEST_LIMIT"
  );

  return {
    enabled: readEnabled(environment.BOOST_MONEY_ENABLED, "BOOST_MONEY_ENABLED"),
    minimumGold: 1,
    maximumGoldPerRequest,
    dailyGoldLimit,
    dailyRequestLimit
  };
}

export function readPortableHolesBoostConfig(
  environment: NodeJS.ProcessEnv = process.env
): PortableHolesBoostConfig {
  return {
    enabled: readEnabled(
      environment.BOOST_PORTABLE_HOLES_ENABLED,
      "BOOST_PORTABLE_HOLES_ENABLED"
    )
  };
}
