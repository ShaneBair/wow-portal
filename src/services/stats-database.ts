import mysql, { type Pool } from "mysql2/promise";

const DATABASE_IDENTIFIER = /^[A-Za-z0-9_]+$/u;
const DEFAULT_PORT = 3306;
const MAX_PORT = 65_535;

export interface StatsDatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  charactersDatabase: string;
  authDatabase: string;
}

export interface StatsWorldDatabaseConfig {
  worldDatabase: string;
}

export class StatsDatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatsDatabaseConfigurationError";
  }
}

function requireValue(
  environment: NodeJS.ProcessEnv,
  key: keyof NodeJS.ProcessEnv
): string {
  const value = environment[key]?.trim();

  if (!value) {
    throw new StatsDatabaseConfigurationError(`${key} is required.`);
  }

  return value;
}

function readPort(value: string | undefined): number {
  const normalized = value?.trim() || String(DEFAULT_PORT);
  const port = Number(normalized);

  if (!/^\d+$/u.test(normalized) || !Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    throw new StatsDatabaseConfigurationError("STATS_DB_PORT must be a valid TCP port.");
  }

  return port;
}

export function validateStatsDatabaseIdentifier(value: string, key: string): string {
  if (!DATABASE_IDENTIFIER.test(value)) {
    throw new StatsDatabaseConfigurationError(
      `${key} may contain only ASCII letters, digits, and underscores.`
    );
  }

  return value;
}

function requireDatabaseIdentifier(
  environment: NodeJS.ProcessEnv,
  key: "STATS_CHARACTERS_DATABASE" | "STATS_AUTH_DATABASE"
): string {
  return validateStatsDatabaseIdentifier(requireValue(environment, key), key);
}

export function readStatsDatabaseConfig(
  environment: NodeJS.ProcessEnv = process.env
): StatsDatabaseConfig {
  return {
    host: requireValue(environment, "STATS_DB_HOST"),
    port: readPort(environment.STATS_DB_PORT),
    user: requireValue(environment, "STATS_DB_USER"),
    password: requireValue(environment, "STATS_DB_PASSWORD"),
    charactersDatabase: requireDatabaseIdentifier(environment, "STATS_CHARACTERS_DATABASE"),
    authDatabase: requireDatabaseIdentifier(environment, "STATS_AUTH_DATABASE")
  };
}

export function readStatsWorldDatabaseConfig(
  environment: NodeJS.ProcessEnv = process.env
): StatsWorldDatabaseConfig {
  return {
    worldDatabase: validateStatsDatabaseIdentifier(
      requireValue(environment, "STATS_WORLD_DATABASE"),
      "STATS_WORLD_DATABASE"
    )
  };
}

let statsPool: Pool | undefined;
let statsPoolConfig: StatsDatabaseConfig | undefined;

export function getStatsDatabase(): { pool: Pool; config: StatsDatabaseConfig } {
  if (!statsPool || !statsPoolConfig) {
    const config = readStatsDatabaseConfig();
    statsPool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      waitForConnections: true,
      connectionLimit: 4,
      maxIdle: 4,
      idleTimeout: 60_000,
      queueLimit: 8,
      connectTimeout: 5_000,
      timezone: "Z",
      enableKeepAlive: true
    });
    statsPoolConfig = config;
  }

  return { pool: statsPool, config: statsPoolConfig };
}

export async function closeStatsDatabasePool(): Promise<void> {
  const pool = statsPool;
  statsPool = undefined;
  statsPoolConfig = undefined;

  if (pool) {
    await pool.end();
  }
}
