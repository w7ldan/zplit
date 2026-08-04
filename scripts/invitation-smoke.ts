import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { createAuth } from "../src/auth/factory";
import { closeDatabase, createDatabasePool, readRuntimeDatabaseConfig } from "../src/db/client";
import * as schema from "../src/db/schema";
import { readSecretFile } from "../src/server/secret-file";
import { bootstrapOwner } from "./bootstrap-owner";

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
if (!require.cache[serverOnlyPath]) require.cache[serverOnlyPath] = { exports: {} } as never;
const {
  acceptInvitation,
  ACTIVE_INVITATION_ERROR,
  createInvitation,
  EXISTING_ACCOUNT_ERROR,
  findUsableInvitation,
  INVITATION_TTL_MS,
  INVITATION_UNAVAILABLE_ERROR,
  isInstallationOwner,
  listInvitations,
  revokeInvitation,
} = await import("../src/auth/invitations");

const domainTables = [
  "friends",
  "outings",
  "expenses",
  "expense_shares",
  "repayments",
  "repayment_allocations",
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function count(client: PoolClient, table: string) {
  const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "${table}"`);
  return Number(result.rows[0]?.count);
}

async function countEmail(client: PoolClient, email: string) {
  const result = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM users WHERE lower(email) = lower($1)", [email]);
  return Number(result.rows[0]?.count);
}

async function expectUnavailable(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof Error && error.message === INVITATION_UNAVAILABLE_ERROR, "invitation states were not generic");
    return error.message;
  }
  throw new Error("unavailable invitation was accepted");
}

async function runInvitationSmoke() {
  if (process.env.DB_NAME !== "zplit_test") throw new Error("invitation smoke requires DB_NAME=zplit_test");

  await bootstrapOwner();
  const databaseConfig = readRuntimeDatabaseConfig();
  const secret = readSecretFile(requiredEnv("BETTER_AUTH_SECRET_FILE"), "BETTER_AUTH_SECRET_FILE");
  const baseURL = requiredEnv("BETTER_AUTH_URL");
  const ownerPassword = readSecretFile(requiredEnv("OWNER_PASSWORD_FILE"), "OWNER_PASSWORD_FILE");
  const pool = createDatabasePool(databaseConfig);
  const db = drizzle(pool, { schema });
  let client: PoolClient | undefined;

  try {
    client = await pool.connect();
    const ownerResult = await client.query<{ id: string; created_at: Date }>("SELECT id, created_at FROM users ORDER BY created_at, id LIMIT 1");
    const ownerId = ownerResult.rows[0]?.id;
    assert(ownerId, "owner bootstrap did not create an installation owner");
    assert(await count(client, "users") === 1, "owner bootstrap created an unexpected user count");
    assert(await count(client, "accounts") === 1, "owner bootstrap did not create one account");
    assert(await count(client, "sessions") === 0, "owner bootstrap created a session");

    const existingEmail = "existing@example.com";
    await client.query(
      "INSERT INTO users (id, name, email, email_verified) VALUES ($1, $2, $3, $4)",
      [randomUUID(), "Existing User", existingEmail.toUpperCase(), true],
    );
    assert(!(await isInstallationOwner(db, randomUUID())), "an unknown user was treated as owner");
    try {
      await listInvitations(db, randomUUID());
      throw new Error("non-owner viewed invitation history");
    } catch (error) {
      assert(error instanceof Error && error.message.includes("installation owner"), "non-owner history access was not rejected");
    }
    try {
      await createInvitation(db, { email: "non-owner@example.com", suggestedName: null, createdByUserId: randomUUID() });
      throw new Error("non-owner issued an invitation");
    } catch (error) {
      assert(error instanceof Error && error.message.includes("installation owner"), "non-owner invitation issuance was not rejected");
    }

    try {
      await createInvitation(db, { email: existingEmail, suggestedName: null, createdByUserId: ownerId });
      throw new Error("existing account was invited");
    } catch (error) {
      assert(error instanceof Error && error.message === EXISTING_ACCOUNT_ERROR, "existing account rejection was unstable");
    }

    const creationNow = new Date("2026-08-04T00:00:00.000Z");
    const duplicate = await createInvitation(db, {
      email: "duplicate@example.com",
      suggestedName: "Duplicate",
      createdByUserId: ownerId,
      now: creationNow,
    });
    assert(duplicate.invitation.expiresAt.getTime() - creationNow.getTime() === INVITATION_TTL_MS, "invitation expiry is not exactly 72 hours");
    assert(/^[A-Za-z0-9_-]{43}$/.test(duplicate.token), "invitation token is not canonical base64url");
    const storedToken = await client.query<{ token_hash: string }>("SELECT token_hash FROM account_invitations WHERE id = $1", [duplicate.invitation.id]);
    assert(storedToken.rows[0]?.token_hash !== duplicate.token && /^[0-9a-f]{64}$/.test(storedToken.rows[0]?.token_hash ?? ""), "raw token was stored");
    try {
      await createInvitation(db, { email: "DUPLICATE@example.com", suggestedName: null, createdByUserId: ownerId });
      throw new Error("duplicate active invitation was accepted");
    } catch (error) {
      assert(error instanceof Error && error.message === ACTIVE_INVITATION_ERROR, "duplicate active invitation rejection was unstable");
    }

    const revokable = await createInvitation(db, { email: "revoked@example.com", suggestedName: null, createdByUserId: ownerId });
    try {
      await revokeInvitation(db, revokable.invitation.id, randomUUID());
      throw new Error("non-owner revoked an invitation");
    } catch (error) {
      assert(error instanceof Error && error.message.includes("installation owner"), "non-owner revocation was not rejected");
    }
    await revokeInvitation(db, revokable.invitation.id, ownerId);

    const accepted = await createInvitation(db, { email: "accepted@example.com", suggestedName: "Accepted", createdByUserId: ownerId });
    const acceptedUser = await acceptInvitation(db, accepted.token, { name: "Accepted User", password: ownerPassword });
    assert(await countEmail(client, acceptedUser.email) === 1, "acceptance created duplicate users");
    const credentialCount = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM accounts WHERE user_id = $1 AND provider_id = 'credential'", [acceptedUser.id]);
    assert(Number(credentialCount.rows[0]?.count) === 1, "acceptance did not create exactly one credential account");
    const acceptedSessions = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM sessions WHERE user_id = $1", [acceptedUser.id]);
    assert(Number(acceptedSessions.rows[0]?.count) === 0, "acceptance created a session");
    for (const table of domainTables) {
      const owned = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "${table}" WHERE owner_user_id = $1`, [acceptedUser.id]);
      assert(Number(owned.rows[0]?.count) === 0, "accepted ledger was not empty");
    }
    const usedError = await expectUnavailable(() => acceptInvitation(db, accepted.token, { name: "Again", password: ownerPassword }));

    const expired = await createInvitation(db, { email: "expired@example.com", suggestedName: null, createdByUserId: ownerId, now: new Date(Date.now() - INVITATION_TTL_MS - 1) });
    const expiredError = await expectUnavailable(() => acceptInvitation(db, expired.token, { name: "Expired", password: ownerPassword }));
    const revoked = await createInvitation(db, { email: "revoked-again@example.com", suggestedName: null, createdByUserId: ownerId });
    await revokeInvitation(db, revoked.invitation.id, ownerId);
    const revokedError = await expectUnavailable(() => acceptInvitation(db, revoked.token, { name: "Revoked", password: ownerPassword }));
    assert(usedError === expiredError && expiredError === revokedError, "used, expired, and revoked errors differ");
    assert(await findUsableInvitation(db, "not-a-token") === null, "malformed token was usable");

    const concurrent = await createInvitation(db, { email: "concurrent@example.com", suggestedName: null, createdByUserId: ownerId });
    const concurrentResults = await Promise.allSettled([
      acceptInvitation(db, concurrent.token, { name: "Concurrent One", password: ownerPassword }),
      acceptInvitation(db, concurrent.token, { name: "Concurrent Two", password: ownerPassword }),
    ]);
    assert(concurrentResults.filter((result) => result.status === "fulfilled").length === 1, "concurrent acceptance did not have one winner");
    assert(await countEmail(client, "concurrent@example.com") === 1, "concurrent acceptance created duplicate users");

    const interrupted = await createInvitation(db, { email: "interrupted@example.com", suggestedName: null, createdByUserId: ownerId });
    const claimTime = new Date();
    await client.query("UPDATE account_invitations SET claimed_at = $1 WHERE id = $2", [claimTime, interrupted.invitation.id]);
    const trustedAuth = createAuth({ db, secret, baseURL, enableBootstrapSignUp: true });
    await trustedAuth.api.signUpEmail({ body: { name: "Interrupted User", email: interrupted.invitation.email, password: ownerPassword } });
    const recovered = await acceptInvitation(db, interrupted.token, { name: "Retry Name", password: ownerPassword });
    assert(recovered.email === interrupted.invitation.email, "interrupted acceptance did not finalize the existing account");
    assert(await countEmail(client, interrupted.invitation.email) === 1, "interrupted acceptance duplicated the account");

    const productionAuth = createAuth({ db, secret, baseURL, enableBootstrapSignUp: false });
    try {
      await productionAuth.api.signUpEmail({ body: { name: "Public Signup", email: "public@example.com", password: ownerPassword } });
      throw new Error("public signup was accepted");
    } catch (error) {
      assert(error instanceof Error && !error.message.includes("Public Signup"), "public signup failure was unsafe");
    }

    assert((await listInvitations(db, ownerId)).length >= 1, "owner could not view invitation history");
    console.log("invitation smoke passed");
  } finally {
    client?.release();
    await pool.end();
    await closeDatabase();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runInvitationSmoke().catch(() => {
    console.error("invitation smoke failed");
    process.exitCode = 1;
  });
}
