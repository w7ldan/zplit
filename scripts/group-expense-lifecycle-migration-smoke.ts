import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/client";
import { formatSafeError, readDatabaseConfig } from "./migrate.js";

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
if (!require.cache[serverOnlyPath]) require.cache[serverOnlyPath] = { exports: {} } as never;
const { voidGroupExpenseAsPayer } = await import("../src/server/group-accounting");

const migrationDirectory = new URL("../drizzle/", import.meta.url);
const preLifecycleMigrations = readdirSync(migrationDirectory)
  .filter((file) => /^\d{4}_.+\.sql$/.test(file) && Number(file.slice(0, 4)) < 27)
  .sort();

type Fixture = {
  groupId: string;
  creatorUserId: string;
  payerUserId: string;
  creatorParticipantId: string;
  payerParticipantId: string;
  pendingExpenseId: string;
  selfPayerExpenseId: string;
  thirdPartyExpenseId: string;
  pendingShareId: string;
  selfPayerShareId: string;
  thirdPartyShareId: string;
  createdAt: Date;
  confirmedAt: Date;
};

type LifecycleEvent = {
  event_type: string;
  actor_user_id: string;
  from_state: string | null;
  to_state: string;
  created_at: Date;
};

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function migrationStatements(file: string) {
  return readFileSync(new URL(file, migrationDirectory), "utf8").split("--> statement-breakpoint").filter((statement) => statement.trim());
}

async function applyMigration(client: PoolClient, file: string) {
  const statements = migrationStatements(file);
  for (const statement of statements) await client.query(statement);
  return statements;
}

async function resetSchema(client: PoolClient) {
  await client.query("DROP SCHEMA public CASCADE");
  await client.query("CREATE SCHEMA public");
}

async function seedFixture(client: PoolClient): Promise<Fixture> {
  const fixture = {
    groupId: randomUUID(),
    creatorUserId: randomUUID(),
    payerUserId: randomUUID(),
    creatorParticipantId: randomUUID(),
    payerParticipantId: randomUUID(),
    pendingExpenseId: randomUUID(),
    selfPayerExpenseId: randomUUID(),
    thirdPartyExpenseId: randomUUID(),
    pendingShareId: randomUUID(),
    selfPayerShareId: randomUUID(),
    thirdPartyShareId: randomUUID(),
    createdAt: new Date("2026-08-27T12:00:00.000Z"),
    confirmedAt: new Date("2026-08-27T12:05:00.000Z"),
  } satisfies Fixture;
  const updatedAt = new Date("2026-08-27T12:10:00.000Z");

  await client.query(
    `INSERT INTO users (id, name, email, email_verified) VALUES
      ($1, 'Legacy Creator', $3, true),
      ($2, 'Legacy Payer', $4, true)`,
    [fixture.creatorUserId, fixture.payerUserId, `${fixture.creatorUserId}@migration.test`, `${fixture.payerUserId}@migration.test`],
  );
  await client.query(
    `INSERT INTO groups (id, name, created_by_user_id, created_at, updated_at)
     VALUES ($1, 'Legacy lifecycle migration', $2, $3, $4)`,
    [fixture.groupId, fixture.creatorUserId, fixture.createdAt, updatedAt],
  );
  await client.query(
    `INSERT INTO group_participants (id, group_id, user_id, created_at, updated_at) VALUES
      ($1, $3, $4, $5, $6),
      ($2, $3, $7, $5, $6)`,
    [fixture.creatorParticipantId, fixture.payerParticipantId, fixture.groupId, fixture.creatorUserId, fixture.createdAt, updatedAt, fixture.payerUserId],
  );
  await client.query(
    `INSERT INTO group_memberships (group_id, user_id, participant_id, role, joined_at) VALUES
      ($1, $2, $3, 'owner', $4),
      ($1, $5, $6, 'member', $4)`,
    [fixture.groupId, fixture.creatorUserId, fixture.creatorParticipantId, fixture.createdAt, fixture.payerUserId, fixture.payerParticipantId],
  );
  await client.query(
    `INSERT INTO group_expenses (id, group_id, creator_participant_id, payer_participant_id, description, occurred_at, total_amount, state, created_at, updated_at) VALUES
      ($1, $4, $5, $6, 'Legacy pending', $7, 100, 'pending', $8, $9),
      ($2, $4, $5, $5, 'Legacy self payer', $7, 100, 'pending', $8, $9),
      ($3, $4, $5, $6, 'Legacy third party', $7, 100, 'pending', $8, $9)`,
    [fixture.pendingExpenseId, fixture.selfPayerExpenseId, fixture.thirdPartyExpenseId, fixture.groupId, fixture.creatorParticipantId, fixture.payerParticipantId, fixture.createdAt, fixture.createdAt, updatedAt],
  );
  await client.query(
    `INSERT INTO group_expense_shares (id, group_id, expense_id, participant_id, amount, created_at, updated_at) VALUES
      ($1, $4, $5, $8, 100, $9, $10),
      ($2, $4, $6, $8, 100, $9, $10),
      ($3, $4, $7, $8, 100, $9, $10)`,
    [fixture.pendingShareId, fixture.selfPayerShareId, fixture.thirdPartyShareId, fixture.groupId, fixture.pendingExpenseId, fixture.selfPayerExpenseId, fixture.thirdPartyExpenseId, fixture.creatorParticipantId, fixture.createdAt, updatedAt],
  );
  await client.query(
    `UPDATE group_expenses
     SET state = 'confirmed', confirmed_at = $1, updated_at = $1
     WHERE id IN ($2, $3)`,
    [fixture.confirmedAt, fixture.selfPayerExpenseId, fixture.thirdPartyExpenseId],
  );
  await client.query(
    `INSERT INTO group_obligations (id, group_id, source_expense_id, source_share_id, debtor_participant_id, creditor_participant_id, original_amount, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 100, $7)`,
    [randomUUID(), fixture.groupId, fixture.thirdPartyExpenseId, fixture.thirdPartyShareId, fixture.creatorParticipantId, fixture.payerParticipantId, fixture.confirmedAt],
  );
  await client.query(
    "DELETE FROM group_memberships WHERE group_id = $1 AND user_id = $2",
    [fixture.groupId, fixture.payerUserId],
  );
  return fixture;
}

async function eventsFor(client: PoolClient, fixture: Fixture, expenseId: string) {
  const result = await client.query<LifecycleEvent>(
    `SELECT event_type, actor_user_id, from_state, to_state, created_at
     FROM group_expense_lifecycle_events
     WHERE group_id = $1 AND expense_id = $2
     ORDER BY created_at, id`,
    [fixture.groupId, expenseId],
  );
  return result.rows;
}

function assertEvent(event: LifecycleEvent | undefined, expected: Omit<LifecycleEvent, "created_at">, timestamp: Date) {
  assert(event, `missing ${expected.event_type} lifecycle event`);
  assert(event.event_type === expected.event_type, `unexpected lifecycle event type: ${event.event_type}`);
  assert(event.actor_user_id === expected.actor_user_id, `unexpected ${expected.event_type} actor`);
  assert(event.from_state === expected.from_state && event.to_state === expected.to_state, `unexpected ${expected.event_type} transition`);
  assert(event.created_at.getTime() === timestamp.getTime(), `unexpected ${expected.event_type} timestamp`);
}

async function cleanup(client: PoolClient, fixture: Fixture) {
  await client.query("DELETE FROM group_expense_lifecycle_events WHERE group_id = $1", [fixture.groupId]);
  await client.query("DELETE FROM group_obligations WHERE group_id = $1", [fixture.groupId]);
  await client.query("DELETE FROM group_expense_shares WHERE group_id = $1", [fixture.groupId]);
  await client.query("DELETE FROM group_expenses WHERE group_id = $1", [fixture.groupId]);
  await client.query("DELETE FROM group_memberships WHERE group_id = $1", [fixture.groupId]);
  await client.query("DELETE FROM group_participants WHERE group_id = $1", [fixture.groupId]);
  await client.query("DELETE FROM groups WHERE id = $1", [fixture.groupId]);
  await client.query("DELETE FROM users WHERE id IN ($1, $2)", [fixture.creatorUserId, fixture.payerUserId]);
}

export async function runGroupExpenseLifecycleMigrationSmoke() {
  const config = readDatabaseConfig("zplit_test");
  const pool = new Pool({ ...config, max: 8, connectionTimeoutMillis: 5_000 });
  let client: PoolClient | undefined;
  let fixture: Fixture | undefined;

  try {
    client = await pool.connect();
    await resetSchema(client);
    for (const file of preLifecycleMigrations) await applyMigration(client, file);
    fixture = await seedFixture(client);
    const lifecycleMigration = await applyMigration(client, "0027_misty_timeslip.sql");

    const states = await client.query<{ id: string; state: string }>(
      "SELECT id, state FROM group_expenses WHERE id = ANY($1::uuid[])",
      [[fixture.pendingExpenseId, fixture.selfPayerExpenseId, fixture.thirdPartyExpenseId]],
    );
    const stateById = new Map(states.rows.map((row) => [row.id, row.state]));
    assert(stateById.get(fixture.pendingExpenseId) === "pending", "legacy pending expense changed state");
    assert(stateById.get(fixture.selfPayerExpenseId) === "confirmed", "legacy self-payer expense changed state");
    assert(stateById.get(fixture.thirdPartyExpenseId) === "confirmed", "legacy third-party expense changed state");

    const pendingEvents = await eventsFor(client, fixture, fixture.pendingExpenseId);
    assert(pendingEvents.length === 1, "legacy pending expense has duplicate or missing lifecycle events");
    assertEvent(pendingEvents[0], { event_type: "created", actor_user_id: fixture.creatorUserId, from_state: null, to_state: "pending" }, fixture.createdAt);

    const selfPayerEvents = await eventsFor(client, fixture, fixture.selfPayerExpenseId);
    assert(selfPayerEvents.length === 1, "legacy self-payer expense has duplicate or missing lifecycle events");
    assertEvent(selfPayerEvents[0], { event_type: "created", actor_user_id: fixture.creatorUserId, from_state: null, to_state: "confirmed" }, fixture.createdAt);

    const thirdPartyEvents = await eventsFor(client, fixture, fixture.thirdPartyExpenseId);
    assert(thirdPartyEvents.length === 2, "legacy third-party expense has duplicate or missing lifecycle events");
    assert(thirdPartyEvents.map((event) => event.event_type).join(",") === "created,payer_confirmed", "legacy third-party lifecycle order is wrong");
    assertEvent(thirdPartyEvents[0], { event_type: "created", actor_user_id: fixture.creatorUserId, from_state: null, to_state: "pending" }, fixture.createdAt);
    assertEvent(thirdPartyEvents[1], { event_type: "payer_confirmed", actor_user_id: fixture.payerUserId, from_state: "pending", to_state: "confirmed" }, fixture.confirmedAt);

    const replay = lifecycleMigration.find((statement) => statement.includes("INSERT INTO group_expense_lifecycle_events"));
    assert(replay, "migration backfill statement was not found");
    await client.query(replay);
    assert((await eventsFor(client, fixture, fixture.pendingExpenseId)).length === 1, "pending backfill is not deduplicated");
    assert((await eventsFor(client, fixture, fixture.selfPayerExpenseId)).length === 1, "self-payer backfill is not deduplicated");
    assert((await eventsFor(client, fixture, fixture.thirdPartyExpenseId)).length === 2, "third-party backfill is not deduplicated");

    await client.query(
      "INSERT INTO group_memberships (group_id, user_id, participant_id, role, joined_at) VALUES ($1, $2, $3, 'member', $4)",
      [fixture.groupId, fixture.payerUserId, fixture.payerParticipantId, fixture.confirmedAt],
    );
    const database = drizzle(pool, { schema }) as Database;
    const voided = await voidGroupExpenseAsPayer(database, fixture.groupId, fixture.thirdPartyExpenseId, fixture.payerUserId);
    assert(voided.state === "voided", "backfilled confirmed expense was not voided");
    assert(voided.lifecycleEvents.map((event) => event.eventType).join(",") === "created,payer_confirmed,voided", "void did not append to backfilled lifecycle history");
    assert(voided.obligations.length === 1 && voided.obligations[0]?.voidedAt !== null, "void did not reverse the historical obligation");
    const obligationState = await client.query<{ active: string; total: string }>(
      "SELECT count(*) FILTER (WHERE voided_at IS NULL)::text AS active, count(*)::text AS total FROM group_obligations WHERE group_id = $1 AND source_expense_id = $2",
      [fixture.groupId, fixture.thirdPartyExpenseId],
    );
    assert(obligationState.rows[0]?.active === "0" && obligationState.rows[0]?.total === "1", "void reversed the historical obligation more than once");
    try {
      await voidGroupExpenseAsPayer(database, fixture.groupId, fixture.thirdPartyExpenseId, fixture.payerUserId);
      throw new Error("second void unexpectedly succeeded");
    } catch (error) {
      assert(errorCode(error) === "invalid_state", "second void did not preserve exactly-once reversal");
    }
    console.log("group expense lifecycle migration smoke passed");
  } catch (error) {
    console.error(`group expense lifecycle migration smoke failed: ${formatSafeError(error, config.password)}`);
    process.exitCode = 1;
  } finally {
    if (client && fixture) await cleanup(client, fixture).catch(() => undefined);
    client?.release();
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("group-expense-lifecycle-migration-smoke.ts")) await runGroupExpenseLifecycleMigrationSmoke();
