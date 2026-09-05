import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { createAuth } from "../src/auth/factory";
import { bootstrapOwner } from "./bootstrap-owner";
import { createDatabasePool, readRuntimeDatabaseConfig } from "../src/db/client";
import * as schema from "../src/db/schema";
import { readSecretFile } from "../src/server/secret-file";

const domainTables = [
  "friends",
  "outings",
  "expenses",
  "expense_shares",
  "repayments",
  "repayment_allocations",
];
const authTables = ["users", "sessions", "accounts", "verifications"];

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

function cookieHeaders(response: Response) {
  const headers = "getSetCookie" in response.headers && typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  return headers.filter(Boolean);
}

async function authRequest(auth: ReturnType<typeof createAuth>, baseURL: string, path: string, body: Record<string, unknown>, cookie = "") {
  return auth.handler(new Request(`${baseURL}/api/auth/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseURL,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  }));
}

async function count(client: PoolClient, table: string) {
  const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "${table}"`);
  return Number(result.rows[0]?.count);
}

async function expectRejected(action: () => Promise<unknown>, message: string) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof Error || typeof error === "object", message);
    return;
  }
  throw new Error(message);
}

async function runAuthSmoke() {
  if (process.env.DB_NAME !== "zplit_test") throw new Error("auth smoke requires DB_NAME=zplit_test");

  const config = readRuntimeDatabaseConfig();
  const secret = readSecretFile(requiredEnv("BETTER_AUTH_SECRET_FILE"), "BETTER_AUTH_SECRET_FILE");
  const baseURL = requiredEnv("BETTER_AUTH_URL");
  const ownerName = readSecretFile(requiredEnv("OWNER_NAME_FILE"), "OWNER_NAME_FILE");
  const ownerEmail = readSecretFile(requiredEnv("OWNER_EMAIL_FILE"), "OWNER_EMAIL_FILE").toLowerCase();
  const ownerPassword = readSecretFile(requiredEnv("OWNER_PASSWORD_FILE"), "OWNER_PASSWORD_FILE");
  const pool = createDatabasePool(config);
  const db = drizzle(pool, { schema });
  let client: PoolClient | undefined;

  try {
    client = await pool.connect();
    const tableResult = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
      [authTables],
    );
    assert(new Set(tableResult.rows.map(({ table_name }) => table_name)).size === authTables.length, "auth tables are incomplete");

    const bootstrapAuth = createAuth({ db, secret, baseURL, enableBootstrapSignUp: true });
    const signup = await bootstrapAuth.api.signUpEmail({
      body: { name: ownerName, email: ownerEmail, password: ownerPassword },
    });
    assert(signup.token === null, "bootstrap sign-up created a session token");
    assert(await count(client, "users") === 1, "bootstrap did not create one user");
    assert(await count(client, "accounts") === 1, "bootstrap did not create one account");
    assert(await count(client, "sessions") === 0, "bootstrap created a session");

    const beforeSecondBootstrap = await Promise.all([count(client, "users"), count(client, "accounts"), count(client, "sessions")]);
    await expectRejected(() => bootstrapOwner(), "second bootstrap was accepted");
    const afterSecondBootstrap = await Promise.all([count(client, "users"), count(client, "accounts"), count(client, "sessions")]);
    assert(JSON.stringify(beforeSecondBootstrap) === JSON.stringify(afterSecondBootstrap), "second bootstrap changed row counts");

    const productionAuth = createAuth({ db, secret, baseURL, enableBootstrapSignUp: false });
    await expectRejected(
      () => productionAuth.api.signUpEmail({ body: { name: "Unexpected", email: "unexpected@example.com", password: ownerPassword } }),
      "production sign-up was accepted",
    );
    assert(await count(client, "users") === 1, "production sign-up changed user count");

    const wrongPassword = await authRequest(productionAuth, baseURL, "sign-in/email", { email: ownerEmail, password: `${ownerPassword}wrong` });
    assert(!wrongPassword.ok, "incorrect password succeeded");
    assert(cookieHeaders(wrongPassword).length === 0, "incorrect password set a cookie");

    const signIn = await authRequest(productionAuth, baseURL, "sign-in/email", { email: ownerEmail, password: ownerPassword, rememberMe: true });
    assert(signIn.ok, "correct credentials failed");
    const setCookies = cookieHeaders(signIn);
    const sessionCookie = setCookies.find((value) => value.includes("session_token="));
    assert(sessionCookie, "sign-in did not set a session cookie");
    const cookie = sessionCookie.split(";", 1)[0];
    const session = await productionAuth.api.getSession({ headers: new Headers({ cookie }) });
    assert(session?.user.email === ownerEmail, "session lookup did not return the owner");
    assert(await count(client, "sessions") === 1, "sign-in did not create one session");

    const signOut = await authRequest(productionAuth, baseURL, "sign-out", {}, cookie);
    assert(signOut.ok, "sign-out failed");
    assert(await productionAuth.api.getSession({ headers: new Headers({ cookie }) }) === null, "sign-out did not invalidate the session");
    assert(await count(client, "sessions") === 0, "sign-out left an active session");
    assert(await count(client, "verifications") === 0, "unexpected verification rows exist");
    for (const table of domainTables) assert(await count(client, table) === 0, `${table} is not empty`);
  } finally {
    client?.release();
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runAuthSmoke().catch((error) => {
    const values = [
      process.env.BETTER_AUTH_SECRET_FILE,
      process.env.OWNER_PASSWORD_FILE,
      process.env.DB_PASSWORD_FILE,
    ].flatMap((filePath) => {
      if (!filePath) return [];
      try {
        return [readSecretFile(filePath)];
      } catch {
        return [];
      }
    });
    console.error(`auth smoke failed: ${safeError(error, values)}`);
    process.exitCode = 1;
  });
}
