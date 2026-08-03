import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";

const migrationLockKey = 20603018;

export type DatabaseConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
};

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function readDatabaseConfig(expectedDatabase?: string): DatabaseConfig {
  const database = requiredEnv("DB_NAME");
  if (expectedDatabase && database !== expectedDatabase) {
    throw new Error(`DB_NAME must be ${expectedDatabase}`);
  }

  const passwordFile = requiredEnv("DB_PASSWORD_FILE");
  try {
    if (!statSync(passwordFile).isFile()) throw new Error();
  } catch {
    throw new Error("DB_PASSWORD_FILE must identify a regular file");
  }

  let password: string;
  try {
    password = readFileSync(passwordFile, "utf8").trim();
  } catch {
    throw new Error("DB_PASSWORD_FILE could not be read");
  }
  if (!password) throw new Error("DB_PASSWORD_FILE must contain a non-empty password");

  const port = Number(process.env.DB_PORT?.trim() || "5432");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("DB_PORT must be a valid TCP port");
  }

  return {
    host: requiredEnv("DB_HOST"),
    port,
    database,
    user: requiredEnv("DB_USER"),
    password,
  };
}

export function createDatabasePool(config: DatabaseConfig) {
  return new Pool({ ...config, max: 1 });
}

export function formatSafeError(error: unknown, password = "") {
  const message = error instanceof Error ? error.message : "unknown error";
  return (password ? message.replaceAll(password, "[redacted]") : message)
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

export async function runMigration() {
  let pool: ReturnType<typeof createDatabasePool> | undefined;
  let client: PoolClient | undefined;
  let lockAcquired = false;
  let failure: unknown;
  let password = "";

  try {
    const config = readDatabaseConfig();
    password = config.password;
    pool = createDatabasePool(config);
    client = await pool.connect();
    await client.query("SELECT pg_advisory_lock($1::bigint)", [migrationLockKey]);
    lockAcquired = true;
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  } catch (error) {
    failure = error;
  } finally {
    if (client) {
      if (lockAcquired) {
        try {
          await client.query("SELECT pg_advisory_unlock($1::bigint)", [migrationLockKey]);
        } catch (error) {
          failure ??= error;
        }
      }
      client.release();
    }
    if (pool) {
      try {
        await pool.end();
      } catch (error) {
        failure ??= error;
      }
    }
  }

  if (failure) {
    console.error(`database migration failed: ${formatSafeError(failure, password)}`);
    process.exitCode = 1;
    return;
  }
  console.log("database migration succeeded");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void runMigration();
