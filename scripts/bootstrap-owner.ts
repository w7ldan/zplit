import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { createAuth } from "../src/auth/factory";
import { createDatabasePool, readRuntimeDatabaseConfig } from "../src/db/client";
import * as schema from "../src/db/schema";
import { readSecretFile } from "../src/server/secret-file";

const bootstrapLockKey = 20603019;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function safeError(error: unknown, secrets: string[]) {
  let message = error instanceof Error ? error.message : "unknown error";
  for (const secret of secrets) if (secret) message = message.replaceAll(secret, "[redacted]");
  return message.replace(/\s+/g, " ").slice(0, 240);
}

function optionalFileValue(filePath: string | undefined) {
  if (!filePath) return "";
  try {
    return readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

export async function bootstrapOwner() {
  const databaseConfig = readRuntimeDatabaseConfig();
  const secret = readSecretFile(requiredEnv("BETTER_AUTH_SECRET_FILE"), "BETTER_AUTH_SECRET_FILE");
  const baseURL = requiredEnv("BETTER_AUTH_URL");
  const ownerName = readSecretFile(requiredEnv("OWNER_NAME_FILE"), "OWNER_NAME_FILE");
  const ownerEmail = readSecretFile(requiredEnv("OWNER_EMAIL_FILE"), "OWNER_EMAIL_FILE").toLowerCase();
  const ownerPassword = readSecretFile(requiredEnv("OWNER_PASSWORD_FILE"), "OWNER_PASSWORD_FILE");
  const pool = createDatabasePool(databaseConfig);
  const db = drizzle(pool, { schema });
  let client: PoolClient | undefined;
  let lockAcquired = false;
  let failure: unknown;

  try {
    client = await pool.connect();
    await client.query("SELECT pg_advisory_lock($1::bigint)", [bootstrapLockKey]);
    lockAcquired = true;

    const userCount = Number((await client.query("SELECT count(*)::int AS count FROM users")).rows[0].count);
    if (userCount !== 0) throw new Error("owner bootstrap refused: users already exist");

    const auth = createAuth({
      db,
      secret,
      baseURL,
      enableBootstrapSignUp: true,
    });
    await auth.api.signUpEmail({
      body: {
        name: ownerName,
        email: ownerEmail,
        password: ownerPassword,
      },
    });
    const counts = await client.query(
      `SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM accounts WHERE provider_id = 'credential') AS credential_accounts,
        (SELECT count(*)::int FROM accounts) AS accounts,
        (SELECT count(*)::int FROM sessions) AS sessions,
        (SELECT count(*)::int FROM verifications) AS verifications,
        (SELECT count(*)::int FROM users WHERE email = $1) AS owner_users`,
      [ownerEmail],
    );
    const row = counts.rows[0];
    if (
      Number(row.users) !== 1 ||
      Number(row.credential_accounts) !== 1 ||
      Number(row.accounts) !== 1 ||
      Number(row.sessions) !== 0 ||
      Number(row.verifications) !== 0 ||
      Number(row.owner_users) !== 1
    ) {
      throw new Error("owner bootstrap verification failed");
    }
  } finally {
    if (client) {
      if (lockAcquired) {
        try {
          await client.query("SELECT pg_advisory_unlock($1::bigint)", [bootstrapLockKey]);
        } catch (error) {
          failure ??= error;
        }
      }
      client.release();
    }
    try {
      await pool.end();
    } catch (error) {
      failure ??= error;
    }
  }

  if (failure) throw failure;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void bootstrapOwner().catch((error) => {
    const secretValues = [
      optionalFileValue(process.env.DB_PASSWORD_FILE),
      optionalFileValue(process.env.BETTER_AUTH_SECRET_FILE),
      optionalFileValue(process.env.OWNER_PASSWORD_FILE),
    ];
    console.error(`owner bootstrap failed: ${safeError(error, secretValues)}`);
    process.exitCode = 1;
  });
}
