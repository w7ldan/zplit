import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { createDatabasePool, readRuntimeDatabaseConfig } from "../src/db/client";
import * as schema from "../src/db/schema";
import {
  createLedgerRepository,
  ExpenseDeletionInvariantError,
  LedgerNotFoundError,
  OutingDeletionInvariantError,
  RepaymentDeletionInvariantError,
} from "../src/domain/ledger-repository";

if (process.env.DB_NAME !== "zplit_test") throw new Error("history-delete smoke requires DB_NAME=zplit_test");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function count(pool: ReturnType<typeof createDatabasePool>, table: string, owner: string) {
  const result = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table} WHERE owner_user_id = $1`, [owner]);
  return Number(result.rows[0]?.count ?? 0);
}

async function expectError(action: () => Promise<unknown>, errorType: new (...args: never[]) => Error, message: string) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof errorType && error.message === message, `${message} was not returned`);
    return;
  }
  throw new Error(`expected ${message}`);
}

const pool = createDatabasePool(readRuntimeDatabaseConfig());
const database = drizzle(pool, { schema });
const ownerA = randomUUID();
const ownerB = randomUUID();
const friendA = randomUUID();
const friendB = randomUUID();
const outingEmpty = randomUUID();
const outingWithExpense = randomUUID();
const outingForUnallocatedExpense = randomUUID();
const outingForAllocatedExpense = randomUUID();
const outingB = randomUUID();
const expenseUnallocated = randomUUID();
const expenseAllocated = randomUUID();
const expenseB = randomUUID();
const shareUnallocated = randomUUID();
const shareAllocated = randomUUID();
const shareB = randomUUID();
const repaymentUnallocated = randomUUID();
const repaymentAllocated = randomUUID();
const repaymentB = randomUUID();
const now = new Date("2026-08-04T00:00:00.000Z");

const repositoryA = createLedgerRepository(database, ownerA);
const repositoryB = createLedgerRepository(database, ownerB);

try {
  await pool.query(
    "INSERT INTO users (id, name, email, email_verified) VALUES ($1, $2, $3, true), ($4, $5, $6, true)",
    [ownerA, "Owner A Private", `history-a-${ownerA}@example.com`, ownerB, "Owner B Private", `history-b-${ownerB}@example.com`],
  );
  await pool.query(
    "INSERT INTO friends (id, owner_user_id, name, phone_number, notes) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)",
    [friendA, ownerA, "Friend A", "+62000000001", "private A", friendB, ownerB, "Friend B", "+62000000002", "private B"],
  );
  await pool.query(
    "INSERT INTO outings (id, owner_user_id, title, occurred_at) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8), ($9, $10, $11, $12), ($13, $14, $15, $16), ($17, $18, $19, $20)",
    [
      outingEmpty, ownerA, "Empty outing", "2026-08-01T00:00:00Z",
      outingWithExpense, ownerA, "Protected outing", "2026-08-02T00:00:00Z",
      outingForUnallocatedExpense, ownerA, "Open expense outing", "2026-08-03T00:00:00Z",
      outingForAllocatedExpense, ownerA, "Allocated expense outing", "2026-08-04T00:00:00Z",
      outingB, ownerB, "Owner B outing", "2026-08-04T00:00:00Z",
    ],
  );
  await pool.query(
    "INSERT INTO expenses (id, owner_user_id, outing_id, description, amount) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10), ($11, $12, $13, $14, $15)",
    [expenseUnallocated, ownerA, outingForUnallocatedExpense, "Open expense", 10000, expenseAllocated, ownerA, outingForAllocatedExpense, "Allocated expense", 20000, expenseB, ownerB, outingB, "Owner B expense", 5000],
  );
  await pool.query(
    "INSERT INTO expense_shares (id, owner_user_id, expense_id, friend_id, amount_owed) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10), ($11, $12, $13, $14, $15)",
    [shareUnallocated, ownerA, expenseUnallocated, friendA, 6000, shareAllocated, ownerA, expenseAllocated, friendA, 7000, shareB, ownerB, expenseB, friendB, 5000],
  );
  await pool.query(
    "INSERT INTO repayments (id, owner_user_id, friend_id, amount, paid_at, payment_method, notes) VALUES ($1, $2, $3, $4, $5, $6, $7), ($8, $9, $10, $11, $12, $13, $14), ($15, $16, $17, $18, $19, $20, $21)",
    [repaymentUnallocated, ownerA, friendA, 5000, "2026-08-03T00:00:00Z", "private", "private repayment", repaymentAllocated, ownerA, friendA, 3000, "2026-08-04T00:00:00Z", "cash", "private repayment 2", repaymentB, ownerB, friendB, 2000, "2026-08-04T00:00:00Z", "cash", "private B repayment"],
  );
  await pool.query(
    "INSERT INTO repayment_allocations (owner_user_id, repayment_id, expense_share_id, amount) VALUES ($1, $2, $3, $4)",
    [ownerA, repaymentAllocated, shareAllocated, 3000],
  );
  await pool.query(
    "INSERT INTO expenses (id, owner_user_id, outing_id, description, amount) VALUES ($1, $2, $3, $4, $5)",
    [randomUUID(), ownerA, outingWithExpense, "Protected outing expense", 1000],
  );

  const allHistory = await repositoryA.listLedgerHistory({ limit: 50 });
  assert(allHistory.items.length === 5, "owner A history is not isolated");
  assert(allHistory.items[0]?.type === "expense" && allHistory.items[1]?.type === "repayment", "same-time history ordering is not deterministic");
  const pagedIds: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await repositoryA.listLedgerHistory({ cursor, limit: 1 });
    pagedIds.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert(new Set(pagedIds).size === pagedIds.length && pagedIds.length === allHistory.items.length, "history cursor pagination duplicated or skipped records");
  assert((await repositoryA.listLedgerHistory({ type: "expense" })).items.every((item) => item.type === "expense"), "expense filter leaked repayments");
  assert((await repositoryA.listLedgerHistory({ type: "repayment" })).items.every((item) => item.type === "repayment"), "repayment filter leaked expenses");
  const publicHistory = JSON.stringify(allHistory);
  assert(!publicHistory.includes(ownerA) && !publicHistory.includes("private") && !publicHistory.includes("+620"), "history leaked private fields");
  assert((await repositoryB.listLedgerHistory()).items.every((item) => item.id === expenseB || item.id === repaymentB), "owner B saw owner A history");

  await repositoryA.deleteOuting(outingEmpty);
  await expectError(() => repositoryA.deleteOuting(outingWithExpense), OutingDeletionInvariantError, "Move or delete this outing's expenses first.");
  assert(await count(pool, "expenses", ownerA) === 3, "failed outing deletion changed expenses");

  const beforeOpenSummary = await repositoryA.getLedgerSummary();
  const beforeOpenStatement = await repositoryA.getFriendDebtorStatement(friendA, now);
  await repositoryA.deleteExpense(expenseUnallocated);
  assert((await count(pool, "expense_shares", ownerA)) === 1, "unallocated expense shares did not cascade");
  await expectError(() => repositoryA.deleteExpense(expenseAllocated), ExpenseDeletionInvariantError, "Remove repayment allocations before deleting this expense.");
  assert(await count(pool, "repayment_allocations", ownerA) === 1, "failed expense deletion changed allocations");

  await repositoryA.deleteRepayment(repaymentUnallocated);
  await expectError(() => repositoryA.deleteRepayment(repaymentAllocated), RepaymentDeletionInvariantError, "Remove this repayment's allocations before deleting it.");
  assert(await count(pool, "repayment_allocations", ownerA) === 1, "failed repayment deletion changed allocations");
  const afterOpenSummary = await repositoryA.getLedgerSummary();
  const afterOpenStatement = await repositoryA.getFriendDebtorStatement(friendA, now);
  assert(afterOpenSummary.totalExpenseAmount === beforeOpenSummary.totalExpenseAmount - 10000, "expense deletion did not update totals");
  assert(afterOpenSummary.totalReceivedAmount === beforeOpenSummary.totalReceivedAmount - 5000, "repayment deletion did not update totals");
  assert(afterOpenStatement.items.length === beforeOpenStatement.items.length - 1, "expense deletion did not update debtor statement");
  assert(afterOpenSummary.totalOutstandingAmount === beforeOpenSummary.totalOutstandingAmount - 6000, "expense deletion did not update outstanding balance");

  await expectError(() => repositoryB.deleteExpense(expenseUnallocated), LedgerNotFoundError, "Ledger record not found");
  await expectError(() => repositoryB.getExpense(expenseAllocated), LedgerNotFoundError, "Ledger record not found");
  console.log("history-delete smoke passed: two owners isolated; ordering, filters, cursors, guarded deletion, cascade integrity, totals, and debtor statements verified");
} finally {
  await pool.query("DELETE FROM repayment_allocations WHERE owner_user_id IN ($1, $2)", [ownerA, ownerB]);
  await pool.query("DELETE FROM repayments WHERE owner_user_id IN ($1, $2)", [ownerA, ownerB]);
  await pool.query("DELETE FROM expense_shares WHERE owner_user_id IN ($1, $2)", [ownerA, ownerB]);
  await pool.query("DELETE FROM expenses WHERE owner_user_id IN ($1, $2)", [ownerA, ownerB]);
  await pool.query("DELETE FROM outings WHERE owner_user_id IN ($1, $2)", [ownerA, ownerB]);
  await pool.query("DELETE FROM friends WHERE owner_user_id IN ($1, $2)", [ownerA, ownerB]);
  await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [ownerA, ownerB]);
  await pool.end();
}
