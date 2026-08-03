import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { readSecretFile } from "../server/secret-file";

export type Database = NodePgDatabase<typeof schema>;

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

export function readRuntimeDatabaseConfig(): DatabaseConfig {
  const passwordFile = requiredEnv("DB_PASSWORD_FILE");
  const port = Number(process.env.DB_PORT?.trim() || "5432");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("DB_PORT must be a valid TCP port");

  return {
    host: requiredEnv("DB_HOST"),
    port,
    database: requiredEnv("DB_NAME"),
    user: requiredEnv("DB_USER"),
    password: readSecretFile(passwordFile, "DB_PASSWORD_FILE"),
  };
}

export function createDatabasePool(config: DatabaseConfig) {
  return new Pool({
    ...config,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
}

let pool: Pool | undefined;
let database: Database | undefined;

export function getDatabasePool() {
  return (pool ??= createDatabasePool(readRuntimeDatabaseConfig()));
}

export function getDatabase() {
  return (database ??= drizzle(getDatabasePool(), { schema }));
}

export async function closeDatabase() {
  database = undefined;
  if (pool) {
    const currentPool = pool;
    pool = undefined;
    await currentPool.end();
  }
}
