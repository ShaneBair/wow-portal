import mysql, { type Pool } from "mysql2/promise";

const DATABASE_IDENTIFIER = /^[A-Za-z0-9_]+$/u;
const DEFAULT_PORT = 3306;
const MAX_PORT = 65_535;

export interface PortalDatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  authDatabase: string;
  charactersDatabase: string;
  stateDatabase: string;
}

export class PortalDatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortalDatabaseConfigurationError";
  }
}

function requireValue(environment: NodeJS.ProcessEnv, key: string): string {
  const value = environment[key]?.trim();
  if (!value) {
    throw new PortalDatabaseConfigurationError(`${key} is required.`);
  }
  return value;
}

function readPort(value: string | undefined): number {
  const normalized = value?.trim() || String(DEFAULT_PORT);
  const port = Number(normalized);
  if (!/^\d+$/u.test(normalized) || !Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    throw new PortalDatabaseConfigurationError("PORTAL_DB_PORT must be a valid TCP port.");
  }
  return port;
}

export function validatePortalDatabaseIdentifier(value: string, key: string): string {
  if (!DATABASE_IDENTIFIER.test(value)) {
    throw new PortalDatabaseConfigurationError(
      `${key} may contain only ASCII letters, digits, and underscores.`
    );
  }
  return value;
}

function requireIdentifier(environment: NodeJS.ProcessEnv, key: string): string {
  return validatePortalDatabaseIdentifier(requireValue(environment, key), key);
}

export function readPortalDatabaseConfig(
  environment: NodeJS.ProcessEnv = process.env
): PortalDatabaseConfig {
  return {
    host: requireValue(environment, "PORTAL_DB_HOST"),
    port: readPort(environment.PORTAL_DB_PORT),
    user: requireValue(environment, "PORTAL_DB_USER"),
    password: requireValue(environment, "PORTAL_DB_PASSWORD"),
    authDatabase: requireIdentifier(environment, "PORTAL_AUTH_DATABASE"),
    charactersDatabase: requireIdentifier(environment, "PORTAL_CHARACTERS_DATABASE"),
    stateDatabase: requireIdentifier(environment, "PORTAL_STATE_DATABASE")
  };
}

let portalPool: Pool | undefined;
let portalPoolConfig: PortalDatabaseConfig | undefined;

export function getPortalDatabase(): { pool: Pool; config: PortalDatabaseConfig } {
  if (!portalPool || !portalPoolConfig) {
    const config = readPortalDatabaseConfig();
    portalPool = mysql.createPool({
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
    portalPoolConfig = config;
  }

  return { pool: portalPool, config: portalPoolConfig };
}

export async function closePortalDatabasePool(): Promise<void> {
  const pool = portalPool;
  portalPool = undefined;
  portalPoolConfig = undefined;
  if (pool) {
    await pool.end();
  }
}
