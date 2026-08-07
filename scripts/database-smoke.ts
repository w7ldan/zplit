import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { createDatabasePool, formatSafeError, readDatabaseConfig } from "./migrate.js";

const domainTables = [
  "friends",
  "outings",
  "expenses",
  "expense_receipts",
  "expense_shares",
  "repayments",
  "repayment_allocations",
  "trips",
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
    const ownerUserId = randomUUID();
    await client.query(
      "INSERT INTO users (id, name, email, email_verified) VALUES ($1, $2, $3, $4)",
      [ownerUserId, "Smoke Owner", `smoke-${ownerUserId}@example.com`, true],
    );
    const otherOwnerUserId = randomUUID();
    await client.query(
      "INSERT INTO users (id, name, email, email_verified) VALUES ($1, $2, $3, $4)",
      [otherOwnerUserId, "Other Smoke Owner", `smoke-${otherOwnerUserId}@example.com`, true],
    );
    const trip = await client.query<{ id: string }>(
      "INSERT INTO trips (owner_user_id, name, starts_on, ends_on) VALUES ($1, $2, $3, $4) RETURNING id",
      [ownerUserId, "Smoke Trip", "2026-04-12", "2026-04-16"],
    );
    const tripId = trip.rows[0].id;
    const foreignTrip = await client.query<{ id: string }>(
      "INSERT INTO trips (owner_user_id, name) VALUES ($1, $2) RETURNING id",
      [otherOwnerUserId, "Foreign Smoke Trip"],
    );
    const friend = await client.query<{ id: string }>(
      "INSERT INTO friends (owner_user_id, name) VALUES ($1, $2) RETURNING id",
      [ownerUserId, "Smoke Friend"],
    );
    const friendId = friend.rows[0].id;
    const outing = await client.query<{ id: string }>(
      "INSERT INTO outings (owner_user_id, trip_id, title, occurred_at) VALUES ($1, $2, $3, $4) RETURNING id",
      [ownerUserId, tripId, "Smoke Outing", now],
    );
    const outingId = outing.rows[0].id;
    const expense = await client.query<{ id: string }>(
      "INSERT INTO expenses (owner_user_id, outing_id, description, amount) VALUES ($1, $2, $3, $4) RETURNING id",
      [ownerUserId, outingId, "Smoke Expense", 12500],
    );
    const expenseId = expense.rows[0].id;
    const share = await client.query<{ id: string }>(
      "INSERT INTO expense_shares (owner_user_id, expense_id, friend_id, amount_owed) VALUES ($1, $2, $3, $4) RETURNING id",
      [ownerUserId, expenseId, friendId, 7500],
    );
    const shareId = share.rows[0].id;
    const repayment = await client.query<{ id: string }>(
      "INSERT INTO repayments (owner_user_id, friend_id, amount, paid_at) VALUES ($1, $2, $3, $4) RETURNING id",
      [ownerUserId, friendId, 7500, now],
    );
    const repaymentId = repayment.rows[0].id;
    await client.query(
      "INSERT INTO repayment_allocations (owner_user_id, repayment_id, expense_share_id, amount) VALUES ($1, $2, $3, $4)",
      [ownerUserId, repaymentId, shareId, 7500],
    );

    const relationship = await client.query<{
      outing_id: string;
      share_friend_id: string;
      repayment_friend_id: string;
      allocation_amount: number;
    }>(
      `SELECT e.outing_id, es.friend_id AS share_friend_id, r.friend_id AS repayment_friend_id, ra.amount AS allocation_amount
       FROM expenses e
       JOIN expense_shares es ON es.owner_user_id = e.owner_user_id AND es.expense_id = e.id
       JOIN repayments r ON r.owner_user_id = es.owner_user_id AND r.friend_id = es.friend_id
       JOIN repayment_allocations ra ON ra.owner_user_id = r.owner_user_id AND ra.repayment_id = r.id AND ra.expense_share_id = es.id
       WHERE e.owner_user_id = $3 AND e.id = $1 AND r.id = $2`,
      [expenseId, repaymentId, ownerUserId],
    );
    assert(relationship.rowCount === 1, "inserted relationships are missing");
    assert(relationship.rows[0].outing_id === outingId, "expense outing relationship is wrong");
    assert(relationship.rows[0].share_friend_id === friendId, "expense share friend relationship is wrong");
    assert(relationship.rows[0].repayment_friend_id === friendId, "repayment friend relationship is wrong");
    assert(relationship.rows[0].allocation_amount === 7500, "repayment allocation amount is wrong");

    const unassignedOuting = await client.query(
      "INSERT INTO outings (owner_user_id, title, occurred_at, trip_id) VALUES ($1, $2, $3, NULL)",
      [ownerUserId, "Unassigned Smoke Outing", now],
    );
    assert(unassignedOuting.rowCount === 1, "nullable outing Trip is invalid");
    await expectConstraint(
      client,
      "23503",
      "INSERT INTO outings (owner_user_id, trip_id, title, occurred_at) VALUES ($1, $2, $3, $4)",
      [ownerUserId, foreignTrip.rows[0].id, "Cross-owner Trip", now],
      "smoke_cross_owner_trip",
    );

    await expectConstraint(
      client,
      "23514",
      "INSERT INTO expenses (owner_user_id, outing_id, description, amount) VALUES ($1, $2, $3, $4)",
      [ownerUserId, outingId, "Rejected Expense", 0],
      "smoke_amount_check",
    );
    await expectConstraint(
      client,
      "23502",
      "INSERT INTO expenses (owner_user_id, description, amount) VALUES ($1, $2, $3)",
      [ownerUserId, "Missing Outing", 1],
      "smoke_required_outing",
    );
    await expectConstraint(
      client,
      "23505",
      "INSERT INTO expense_shares (owner_user_id, expense_id, friend_id, amount_owed) VALUES ($1, $2, $3, $4)",
      [ownerUserId, expenseId, friendId, 1],
      "smoke_duplicate_share",
    );
    await expectConstraint(
      client,
      "23503",
      "INSERT INTO expense_shares (owner_user_id, expense_id, friend_id, amount_owed) VALUES ($1, $2, $3, $4)",
      [ownerUserId, expenseId, randomUUID(), 1],
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
