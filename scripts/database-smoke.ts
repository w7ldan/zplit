import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { createDatabasePool, formatSafeError, readDatabaseConfig } from "./migrate.js";
import * as schema from "../src/db/schema";
import { ensurePersonalLedgerScope } from "../src/server/ledger-scopes";

const domainTables = [
  "chat_threads",
  "chat_messages",
  "friends",
  "outings",
  "expenses",
  "expense_receipts",
  "expense_shares",
  "expense_charges",
  "expense_charge_targets",
  "repayments",
  "repayment_allocations",
  "trips",
  "organizations",
  "organization_memberships",
  "organization_avatars",
  "groups",
  "group_participants",
  "group_memberships",
  "group_avatars",
  "group_join_requests",
  "group_expenses",
  "group_expense_shares",
  "group_obligations",
  "group_settlements",
  "group_settlement_applications",
  "group_settlement_proofs",
  "group_expense_receipts",
  "group_expense_lifecycle_events",
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function postgresCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

async function expectConstraint(
  client: PoolClient,
  code: string,
  statement: string,
  values: unknown[],
  name: string,
) {
  await client.query(`SAVEPOINT ${name}`);
  try {
    await client.query(statement, values);
    throw new Error(`expected PostgreSQL error ${code}`);
  } catch (error) {
    if (postgresCode(error) !== code) throw error;
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await client.query(`RELEASE SAVEPOINT ${name}`);
  }
}

async function countRows(client: PoolClient, table: string) {
  const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "${table}"`);
  return Number(result.rows[0]?.count);
}

export async function runDatabaseSmoke() {
  let pool: ReturnType<typeof createDatabasePool> | undefined;
  let client: PoolClient | undefined;
  let transactionStarted = false;
  let password = "";

  try {
    const config = readDatabaseConfig("zplit_test");
    password = config.password;
    pool = createDatabasePool(config);
    client = await pool.connect();

    const tableResult = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
      [domainTables],
    );
    assert(
      new Set(tableResult.rows.map(({ table_name }) => table_name)).size === domainTables.length,
      "not all domain tables exist",
    );
    const journalResult = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists",
    );
    assert(journalResult.rows[0]?.exists === true, "Drizzle migration journal is missing");

    await client.query("BEGIN");
    transactionStarted = true;
    const now = new Date().toISOString();
    const database = drizzle(client, { schema });
    const userId = randomUUID();
    await client.query(
      "INSERT INTO users (id, name, email, email_verified) VALUES ($1, $2, $3, $4)",
      [userId, "Smoke Owner", `smoke-${userId}@example.com`, true],
    );
    const otherUserId = randomUUID();
    await client.query(
      "INSERT INTO users (id, name, email, email_verified) VALUES ($1, $2, $3, $4)",
      [otherUserId, "Other Smoke Owner", `smoke-${otherUserId}@example.com`, true],
    );
    const ledgerScopeId = await ensurePersonalLedgerScope(database, userId);
    const otherLedgerScopeId = await ensurePersonalLedgerScope(database, otherUserId);
    const legacyUsers = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM users WHERE username IS NULL");
    assert(Number(legacyUsers.rows[0]?.count) >= 2, "multiple legacy username-less users were not preserved");
    const usernameUserId = randomUUID();
    await client.query(
      "INSERT INTO users (id, name, email, email_verified, username) VALUES ($1, $2, $3, $4, $5)",
      [usernameUserId, "Username Smoke", `smoke-${usernameUserId}@example.com`, true, "smoke_user"],
    );
    await expectConstraint(
      client,
      "23505",
      "INSERT INTO users (id, name, email, email_verified, username) VALUES ($1, $2, $3, $4, $5)",
      [randomUUID(), "Duplicate Username", `smoke-${randomUUID()}@example.com`, true, "smoke_user"],
      "smoke_duplicate_username",
    );
    await expectConstraint(
      client,
      "23514",
      "INSERT INTO users (id, name, email, email_verified, username) VALUES ($1, $2, $3, $4, $5)",
      [randomUUID(), "Malformed Username", `smoke-${randomUUID()}@example.com`, true, "a..b"],
      "smoke_malformed_username",
    );
    const trip = await client.query<{ id: string }>(
      "INSERT INTO trips (ledger_scope_id, name, starts_on, ends_on) VALUES ($1, $2, $3, $4) RETURNING id",
      [ledgerScopeId, "Smoke Trip", "2026-04-12", "2026-04-16"],
    );
    const tripId = trip.rows[0].id;
    const foreignTrip = await client.query<{ id: string }>(
      "INSERT INTO trips (ledger_scope_id, name) VALUES ($1, $2) RETURNING id",
      [otherLedgerScopeId, "Foreign Smoke Trip"],
    );
    const friend = await client.query<{ id: string }>(
      "INSERT INTO friends (ledger_scope_id, name) VALUES ($1, $2) RETURNING id",
      [ledgerScopeId, "Smoke Friend"],
    );
    const friendId = friend.rows[0].id;
    const outing = await client.query<{ id: string }>(
      "INSERT INTO outings (ledger_scope_id, trip_id, title, occurred_at) VALUES ($1, $2, $3, $4) RETURNING id",
      [ledgerScopeId, tripId, "Smoke Outing", now],
    );
    const outingId = outing.rows[0].id;
    const expense = await client.query<{ id: string }>(
      "INSERT INTO expenses (ledger_scope_id, outing_id, description, amount) VALUES ($1, $2, $3, $4) RETURNING id",
      [ledgerScopeId, outingId, "Smoke Expense", 12500],
    );
    const expenseId = expense.rows[0].id;
    const share = await client.query<{ id: string }>(
      "INSERT INTO expense_shares (ledger_scope_id, expense_id, friend_id, base_amount, amount_owed) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [ledgerScopeId, expenseId, friendId, 7500, 7500],
    );
    const shareId = share.rows[0].id;
    const charge = await client.query<{ id: string }>(
      "INSERT INTO expense_charges (ledger_scope_id, expense_id, name, percentage_basis_points, scope) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [ledgerScopeId, expenseId, "Smoke charge", 750, "selected"],
    );
    const chargeId = charge.rows[0].id;
    await client.query(
      "INSERT INTO expense_charge_targets (ledger_scope_id, expense_id, expense_charge_id, expense_share_id) VALUES ($1, $2, $3, $4)",
      [ledgerScopeId, expenseId, chargeId, shareId],
    );
    const repayment = await client.query<{ id: string }>(
      "INSERT INTO repayments (ledger_scope_id, friend_id, amount, paid_at) VALUES ($1, $2, $3, $4) RETURNING id",
      [ledgerScopeId, friendId, 7500, now],
    );
    const repaymentId = repayment.rows[0].id;
    await client.query(
      "INSERT INTO repayment_allocations (ledger_scope_id, repayment_id, expense_share_id, amount) VALUES ($1, $2, $3, $4)",
      [ledgerScopeId, repaymentId, shareId, 7500],
    );

    const relationship = await client.query<{
      outing_id: string;
      share_friend_id: string;
      repayment_friend_id: string;
      allocation_amount: number;
    }>(
      `SELECT e.outing_id, es.friend_id AS share_friend_id, r.friend_id AS repayment_friend_id, ra.amount AS allocation_amount
       FROM expenses e
       JOIN expense_shares es ON es.ledger_scope_id = e.ledger_scope_id AND es.expense_id = e.id
       JOIN repayments r ON r.ledger_scope_id = es.ledger_scope_id AND r.friend_id = es.friend_id
       JOIN repayment_allocations ra ON ra.ledger_scope_id = r.ledger_scope_id AND ra.repayment_id = r.id AND ra.expense_share_id = es.id
       WHERE e.ledger_scope_id = $3 AND e.id = $1 AND r.id = $2`,
      [expenseId, repaymentId, ledgerScopeId],
    );
    assert(relationship.rowCount === 1, "inserted relationships are missing");
    assert(relationship.rows[0].outing_id === outingId, "expense outing relationship is wrong");
    assert(relationship.rows[0].share_friend_id === friendId, "expense share friend relationship is wrong");
    assert(relationship.rows[0].repayment_friend_id === friendId, "repayment friend relationship is wrong");
    assert(relationship.rows[0].allocation_amount === 7500, "repayment allocation amount is wrong");
    const chargeRelationship = await client.query<{ name: string; percentage_basis_points: number; friend_id: string }>(
      `SELECT c.name, c.percentage_basis_points, s.friend_id
       FROM expense_charges c
       JOIN expense_charge_targets t ON t.ledger_scope_id = c.ledger_scope_id AND t.expense_id = c.expense_id AND t.expense_charge_id = c.id
       JOIN expense_shares s ON s.ledger_scope_id = t.ledger_scope_id AND s.expense_id = t.expense_id AND s.id = t.expense_share_id
       WHERE c.ledger_scope_id = $1 AND c.id = $2`,
      [ledgerScopeId, chargeId],
    );
    assert(chargeRelationship.rowCount === 1 && chargeRelationship.rows[0].name === "Smoke charge" && Number(chargeRelationship.rows[0].percentage_basis_points) === 750 && chargeRelationship.rows[0].friend_id === friendId, "charge relationship is wrong");

    const unassignedOuting = await client.query(
      "INSERT INTO outings (ledger_scope_id, title, occurred_at, trip_id) VALUES ($1, $2, $3, NULL)",
      [ledgerScopeId, "Unassigned Smoke Outing", now],
    );
    assert(unassignedOuting.rowCount === 1, "nullable outing Trip is invalid");
    await expectConstraint(
      client,
      "23503",
      "INSERT INTO outings (ledger_scope_id, trip_id, title, occurred_at) VALUES ($1, $2, $3, $4)",
      [ledgerScopeId, foreignTrip.rows[0].id, "Cross-owner Trip", now],
      "smoke_cross_owner_trip",
    );

    await expectConstraint(
      client,
      "23514",
      "INSERT INTO expenses (ledger_scope_id, outing_id, description, amount) VALUES ($1, $2, $3, $4)",
      [ledgerScopeId, outingId, "Rejected Expense", 0],
      "smoke_amount_check",
    );
    await expectConstraint(
      client,
      "23502",
      "INSERT INTO expenses (ledger_scope_id, description, amount) VALUES ($1, $2, $3)",
      [ledgerScopeId, "Missing Outing", 1],
      "smoke_required_outing",
    );
    await expectConstraint(
      client,
      "23505",
      "INSERT INTO expense_shares (ledger_scope_id, expense_id, friend_id, base_amount, amount_owed) VALUES ($1, $2, $3, $4, $5)",
      [ledgerScopeId, expenseId, friendId, 1, 1],
      "smoke_duplicate_share",
    );
    await expectConstraint(
      client,
      "23503",
      "INSERT INTO expense_shares (ledger_scope_id, expense_id, friend_id, base_amount, amount_owed) VALUES ($1, $2, $3, $4, $5)",
      [ledgerScopeId, expenseId, randomUUID(), 1, 1],
      "smoke_invalid_foreign_key",
    );

    await client.query("ROLLBACK");
    transactionStarted = false;
    for (const table of domainTables) {
      assert((await countRows(client, table)) === 0, `${table} is not empty after rollback`);
    }
  } catch (error) {
    console.error(`database smoke failed: ${formatSafeError(error, password)}`);
    process.exitCode = 1;
    return;
  } finally {
    if (client) {
      if (transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch {}
      }
      client.release();
    }
    if (pool) await pool.end();
  }

  console.log("database smoke passed");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void runDatabaseSmoke();
