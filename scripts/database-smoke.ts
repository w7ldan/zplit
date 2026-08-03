import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { createDatabasePool, formatSafeError, readDatabaseConfig } from "./migrate.js";

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
    const friend = await client.query<{ id: string }>(
      "INSERT INTO friends (name) VALUES ($1) RETURNING id",
      ["Smoke Friend"],
    );
    const friendId = friend.rows[0].id;
    const outing = await client.query<{ id: string }>(
      "INSERT INTO outings (title, occurred_at) VALUES ($1, $2) RETURNING id",
      ["Smoke Outing", now],
    );
    const outingId = outing.rows[0].id;
    const expense = await client.query<{ id: string }>(
      "INSERT INTO expenses (outing_id, description, amount, occurred_at) VALUES ($1, $2, $3, $4) RETURNING id",
      [outingId, "Smoke Expense", 12500, now],
    );
    const expenseId = expense.rows[0].id;
    const share = await client.query<{ id: string }>(
      "INSERT INTO expense_shares (expense_id, friend_id, amount_owed) VALUES ($1, $2, $3) RETURNING id",
      [expenseId, friendId, 7500],
    );
    const shareId = share.rows[0].id;
    const repayment = await client.query<{ id: string }>(
      "INSERT INTO repayments (friend_id, amount, paid_at) VALUES ($1, $2, $3) RETURNING id",
      [friendId, 7500, now],
    );
    const repaymentId = repayment.rows[0].id;
    await client.query(
      "INSERT INTO repayment_allocations (repayment_id, expense_share_id, amount) VALUES ($1, $2, $3)",
      [repaymentId, shareId, 7500],
    );

    const relationship = await client.query<{
      outing_id: string;
      share_friend_id: string;
      repayment_friend_id: string;
      allocation_amount: number;
    }>(
      `SELECT e.outing_id, es.friend_id AS share_friend_id, r.friend_id AS repayment_friend_id, ra.amount AS allocation_amount
       FROM expenses e
       JOIN expense_shares es ON es.expense_id = e.id
       JOIN repayments r ON r.friend_id = es.friend_id
       JOIN repayment_allocations ra ON ra.repayment_id = r.id AND ra.expense_share_id = es.id
       WHERE e.id = $1 AND r.id = $2`,
      [expenseId, repaymentId],
    );
    assert(relationship.rowCount === 1, "inserted relationships are missing");
    assert(relationship.rows[0].outing_id === outingId, "expense outing relationship is wrong");
    assert(relationship.rows[0].share_friend_id === friendId, "expense share friend relationship is wrong");
    assert(relationship.rows[0].repayment_friend_id === friendId, "repayment friend relationship is wrong");
    assert(relationship.rows[0].allocation_amount === 7500, "repayment allocation amount is wrong");

    await expectConstraint(
      client,
      "23514",
      "INSERT INTO expenses (description, amount, occurred_at) VALUES ($1, $2, $3)",
      ["Rejected Expense", 0, now],
      "smoke_amount_check",
    );
    await expectConstraint(
      client,
      "23505",
      "INSERT INTO expense_shares (expense_id, friend_id, amount_owed) VALUES ($1, $2, $3)",
      [expenseId, friendId, 1],
      "smoke_duplicate_share",
    );
    await expectConstraint(
      client,
      "23503",
      "INSERT INTO expense_shares (expense_id, friend_id, amount_owed) VALUES ($1, $2, $3)",
      [expenseId, randomUUID(), 1],
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
