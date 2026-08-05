import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { createLedgerRepository } from "../src/domain/ledger-repository";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");

let parsedUrl: URL;
try {
  parsedUrl = new URL(databaseUrl);
} catch {
  throw new Error("DATABASE_URL is invalid");
}

const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
if (!databaseName || databaseName !== "zplit_recent_activity_smoke") {
  throw new Error("DATABASE_URL must name zplit_recent_activity_smoke");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function id(base: string, order: number) {
  const suffix = order.toString(16).padStart(12, "0");
  return `${base.slice(0, 8)}-${base.slice(8, 12)}-${base.slice(12, 16)}-${base.slice(16, 20)}-${suffix}`;
}

async function run() {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const database = drizzle(pool, { schema });
  const repositoryOwner = randomUUID();
  const foreignOwner = randomUUID();
  const base = randomUUID().replaceAll("-", "");
  const friendA = id(base, 401);
  const friendB = id(base, 402);
  const outingA10 = id(base, 301);
  const outingA9 = id(base, 302);
  const outingA8 = id(base, 303);
  const outingA7 = id(base, 304);
  const outingB = id(base, 305);
  const expenseIds = [1, 2, 3, 4, 5, 6].map((value) => id(base, value));
  const foreignExpense = id(base, 201);
  const repaymentIds = [101, 102, 103].map((value) => id(base, value));
  const olderRepaymentIds = [104, 105].map((value) => id(base, value));
  const foreignRepayment = id(base, 202);
  const shareE1 = id(base, 501);
  const shareE3 = id(base, 502);

  async function insertRows(table: string, columns: string, rows: unknown[][]) {
    const values = rows.map((row, rowIndex) => `(${row.map((_, columnIndex) => `$${rowIndex * row.length + columnIndex + 1}`).join(", ")})`).join(", ");
    await pool.query(`INSERT INTO ${table} (${columns}) VALUES ${values}`, rows.flat());
  }

  try {
    await insertRows("users", "id, name, email, email_verified", [
      [repositoryOwner, "Recent Activity Owner", `${repositoryOwner}@example.invalid`, true],
      [foreignOwner, "Foreign Owner", `${foreignOwner}@example.invalid`, true],
    ]);
    await insertRows("friends", "id, owner_user_id, name", [
      [friendA, repositoryOwner, "Ari"],
      [friendB, foreignOwner, "Foreign Friend"],
    ]);
    await insertRows("outings", "id, owner_user_id, title, occurred_at", [
      [outingA10, repositoryOwner, "Jakarta", "2026-08-10T00:00:00Z"],
      [outingA9, repositoryOwner, "Bandung", "2026-08-09T00:00:00Z"],
      [outingA8, repositoryOwner, "Bogor", "2026-08-08T00:00:00Z"],
      [outingA7, repositoryOwner, "Depok", "2026-08-07T00:00:00Z"],
      [outingB, foreignOwner, "Foreign outing", "2030-01-01T00:00:00Z"],
    ]);
    await insertRows("expenses", "id, owner_user_id, outing_id, description, amount, created_at", [
      [expenseIds[0], repositoryOwner, outingA10, "Dinner", 8000, "2026-08-01T00:00:00Z"],
      [expenseIds[1], repositoryOwner, outingA9, "Taxi", 7000, "2026-08-02T00:00:00Z"],
      [expenseIds[2], repositoryOwner, outingA8, "Coffee", 6000, "2026-08-03T00:00:00Z"],
      [expenseIds[3], repositoryOwner, outingA7, "Market", 5000, "2026-08-06T00:00:00Z"],
      [expenseIds[4], repositoryOwner, outingA7, "Snacks", 4000, "2026-08-06T00:00:00Z"],
      [expenseIds[5], repositoryOwner, outingA7, "Museum", 3000, "2026-08-07T00:00:00Z"],
      [foreignExpense, foreignOwner, outingB, "Foreign dinner", 9000, "2029-12-01T00:00:00Z"],
    ]);
    await insertRows("expense_shares", "id, owner_user_id, expense_id, friend_id, amount_owed", [
      [shareE1, repositoryOwner, expenseIds[0], friendA, 1000],
      [shareE3, repositoryOwner, expenseIds[2], friendA, 2000],
    ]);
    await insertRows("repayments", "id, owner_user_id, friend_id, amount, paid_at, created_at", [
      [repaymentIds[0], repositoryOwner, friendA, 1000, "2026-08-10T00:00:00Z", "2026-08-01T00:00:00Z"],
      [repaymentIds[1], repositoryOwner, friendA, 2000, "2026-08-09T00:00:00Z", "2026-08-02T00:00:00Z"],
      [repaymentIds[2], repositoryOwner, friendA, 3000, "2026-08-06T00:00:00Z", "2026-08-04T00:00:00Z"],
      [olderRepaymentIds[0], repositoryOwner, friendA, 4000, "2020-08-05T00:00:00Z", "2020-08-01T00:00:00Z"],
      [olderRepaymentIds[1], repositoryOwner, friendA, 5000, "2020-08-04T00:00:00Z", "2020-08-02T00:00:00Z"],
      [foreignRepayment, foreignOwner, friendB, 9000, "2030-01-01T00:00:00Z", "2030-01-01T00:00:00Z"],
    ]);
    await insertRows("repayment_allocations", "owner_user_id, repayment_id, expense_share_id, amount", [
      [repositoryOwner, repaymentIds[0], shareE1, 1000],
      [repositoryOwner, repaymentIds[2], shareE3, 500],
      [repositoryOwner, olderRepaymentIds[0], shareE1, 400],
      [repositoryOwner, olderRepaymentIds[1], shareE3, 500],
    ]);

    const repository = createLedgerRepository(database, repositoryOwner);
    const invalidLimit = await repository.listRecentActivity({ limit: 0 }).catch((error) => error);
    assert(invalidLimit instanceof Error && "code" in invalidLimit && invalidLimit.code === "INVALID_INPUT", "invalid limit was accepted");

    const six = await repository.listRecentActivity({ limit: 6 });
    const expectedSix = [expenseIds[0], repaymentIds[0], expenseIds[1], repaymentIds[1], expenseIds[2], expenseIds[5]];
    assert(six.length === 6, "limit six did not return exactly six records");
    assert(JSON.stringify(six.map((item) => item.id)) === JSON.stringify(expectedSix), "PostgreSQL activity ordering is wrong");
    assert(!six.some((item) => item.id === foreignExpense || item.id === foreignRepayment), "foreign-owner activity leaked");
    assert(!six.some((item) => item.id === expenseIds[3]), "the older seventh owner record was not excluded");
    assert(!six.some((item) => olderRepaymentIds.includes(item.id)), "older allocated repayments were not excluded");

    const expense = six.find((item) => item.id === expenseIds[0]);
    assert(expense?.kind === "Expense" && expense.title === "Dinner" && expense.detail === "Jakarta" && expense.amount === 8000, "expense mapping is wrong");
    assert(expense?.date.toISOString() === "2026-08-10T00:00:00.000Z", "expense date mapping is wrong");
    const allocated = six.find((item) => item.id === repaymentIds[0]);
    assert(allocated?.kind === "Repayment" && allocated.title === "Ari" && allocated.detail === "Money received" && allocated.amount === 1000, "fully allocated repayment mapping is wrong");
    const unallocated = six.find((item) => item.id === repaymentIds[1]);
    assert(unallocated?.detail === "Money received · unallocated remains open", "unallocated repayment mapping is wrong");

    const all = await repository.listRecentActivity({ limit: 20 });
    const expectedAll = [expenseIds[0], repaymentIds[0], expenseIds[1], repaymentIds[1], expenseIds[2], expenseIds[5], expenseIds[3], expenseIds[4], repaymentIds[2], olderRepaymentIds[0], olderRepaymentIds[1]];
    assert(JSON.stringify(all.map((item) => item.id)) === JSON.stringify(expectedAll), "full activity ordering is wrong");
    assert(all[6]?.id === expenseIds[3] && all[7]?.id === expenseIds[4], "same-type ID tie-breaking is wrong");

    const newest = await repository.listRecentActivity({ limit: 1 });
    assert(newest.length === 1 && newest[0]?.id === expenseIds[0], "limit one did not return the newest owner record");
    console.log("recent activity smoke passed: bounded ordering, owner isolation, mapping, allocation details, and integrity checks verified");
  } finally {
    await pool.query("DELETE FROM repayment_allocations WHERE owner_user_id IN ($1, $2)", [repositoryOwner, foreignOwner]);
    await pool.query("DELETE FROM expense_shares WHERE owner_user_id IN ($1, $2)", [repositoryOwner, foreignOwner]);
    await pool.query("DELETE FROM repayments WHERE owner_user_id IN ($1, $2)", [repositoryOwner, foreignOwner]);
    await pool.query("DELETE FROM expenses WHERE owner_user_id IN ($1, $2)", [repositoryOwner, foreignOwner]);
    await pool.query("DELETE FROM outings WHERE owner_user_id IN ($1, $2)", [repositoryOwner, foreignOwner]);
    await pool.query("DELETE FROM friends WHERE owner_user_id IN ($1, $2)", [repositoryOwner, foreignOwner]);
    await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [repositoryOwner, foreignOwner]);
    await pool.end();
  }
}

await run();
