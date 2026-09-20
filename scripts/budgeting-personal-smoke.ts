import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type QueryResultRow } from "pg";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/client";
import { createLedgerRepository } from "../src/domain/ledger-repository";
import { createPersonalBudgetIntegration, changePersonalExpenseBudgetCategory, importPersonalActivity } from "../src/server/budgeting/sources-personal";
import { listBudgetTransactions } from "../src/server/budgeting/transactions";
import { createBudgetSetup } from "../src/server/budgeting/profiles";
import { ensurePersonalLedgerScope } from "../src/server/ledger-scopes";
import { deletionImpactRevision } from "../src/domain/ledger-repository";
import { BudgetError } from "../src/domain/budgeting/errors";
import { formatSafeError, readDatabaseConfig } from "./migrate.js";

function postgresCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

async function expectConstraint(pool: Pool, code: string, statement: string, values: unknown[]) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query(statement, values);
      throw new Error(`expected PostgreSQL error ${code}`);
    } catch (error) {
      assert.equal(postgresCode(error), code, `expected ${code}, got ${postgresCode(error) ?? "unknown"}`);
    }
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
}

async function row<T extends QueryResultRow>(pool: Pool, statement: string, values: unknown[]) {
  const result = await pool.query<T>(statement, values);
  assert.equal(result.rowCount, 1, `expected one row for ${statement}`);
  return result.rows[0]!;
}

async function run() {
  if (process.env.DB_NAME !== "zplit_test") throw new Error("personal budgeting smoke requires DB_NAME=zplit_test");
  const config = readDatabaseConfig("zplit_test");
  const pool = new Pool({ ...config, max: 8 });
  const database = drizzle(pool, { schema }) as Database;
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  let scopeA = "";
  let scopeB = "";
  const ids = {
    friendA: randomUUID(),
    friendB: randomUUID(),
    outingA: randomUUID(),
    outingB: randomUUID(),
    outingImport: randomUUID(),
    outingDelete: randomUUID(),
    outingNull: randomUUID(),
    expenseA: randomUUID(),
    expenseB: randomUUID(),
    expenseDelete: randomUUID(),
    expenseImport: randomUUID(),
    expenseConcurrent: randomUUID(),
    expenseNull: randomUUID(),
    repaymentNull: randomUUID(),
  };
  try {
    await pool.query("INSERT INTO users (id, name, email, email_verified) VALUES ($1, 'B2 Owner A', $2, true), ($3, 'B2 Owner B', $4, true)", [ownerA, `b2-a-${ownerA}@example.com`, ownerB, `b2-b-${ownerB}@example.com`]);
    scopeA = await ensurePersonalLedgerScope(database, ownerA);
    scopeB = await ensurePersonalLedgerScope(database, ownerB);
    await createBudgetSetup(database, ownerA, { periodName: "B2 period", startsOn: "2026-09-01", endsOn: "2026-09-30", totalBudget: 10_000, categories: [{ name: "Food", allocatedAmount: 0 }, { name: "Transport", allocatedAmount: 0 }, { name: "Dining", allocatedAmount: 0 }] });
    const categories = await pool.query<{ id: string; name: string }>("SELECT id, name FROM budget_categories WHERE owner_user_id = $1 ORDER BY name", [ownerA]);
    const foodId = categories.rows.find((category) => category.name === "Food")!.id;
    const transportId = categories.rows.find((category) => category.name === "Transport")!.id;
    const diningId = categories.rows.find((category) => category.name === "Dining")!.id;
    const repository = createLedgerRepository(database, scopeA, { personalBudget: createPersonalBudgetIntegration(ownerA, scopeA) });
    const ownerBRepository = createLedgerRepository(database, scopeB, { personalBudget: createPersonalBudgetIntegration(ownerB, scopeB) });
    await pool.query("INSERT INTO friends (id, ledger_scope_id, name) VALUES ($1, $2, 'Friend A'), ($3, $4, 'Friend B')", [ids.friendA, scopeA, ids.friendB, scopeB]);
    await pool.query("INSERT INTO outings (id, ledger_scope_id, title, occurred_at, occurred_on) VALUES ($1, $2, 'B2 outing', '2026-09-05T10:00:00Z', '2026-09-05'), ($3, $4, 'B2 owner B outing', '2026-09-05T10:00:00Z', '2026-09-05'), ($5, $2, 'Legacy outing', '2026-09-06T10:00:00Z', NULL), ($6, $2, 'Import outing', '2026-09-09T10:00:00Z', '2026-09-09'), ($7, $2, 'Delete outing', '2026-09-09T10:00:00Z', '2026-09-09')", [ids.outingA, scopeA, ids.outingB, scopeB, ids.outingNull, ids.outingImport, ids.outingDelete]);

    const expenseA = await repository.createExpense({ outingId: ids.outingA, description: "Dinner", amount: 600, });
    await repository.replaceExpenseShares(expenseA.id, [{ friendId: ids.friendA, baseAmount: 200 }]);
    const expenseB = await repository.createExpense({ outingId: ids.outingA, description: "Taxi", amount: 400 });
    await repository.replaceExpenseShares(expenseB.id, [{ friendId: ids.friendA, baseAmount: 100 }]);
    const expenseTarget = await repository.createExpense({ outingId: ids.outingA, description: "Open target", amount: 400 });
    await repository.replaceExpenseShares(expenseTarget.id, [{ friendId: ids.friendA, baseAmount: 300 }]);
    const expenseTransaction = await row<{ id: string }>(pool, "SELECT budget_transaction_id AS id FROM budget_personal_expense_sources WHERE owner_user_id = $1 AND expense_id = $2", [ownerA, expenseA.id]);
    const initialExpenseImpact = await row<{ direction: string; amount: number; category_id: string; status: string; origin: string }>(pool, "SELECT t.direction, t.amount, i.budget_category_id AS category_id, i.status, t.origin FROM budget_transactions t JOIN budget_impacts i ON i.owner_user_id = t.owner_user_id AND i.budget_transaction_id = t.id WHERE t.owner_user_id = $1 AND t.id = $2", [ownerA, expenseTransaction.id]);
    assert.deepEqual(initialExpenseImpact, { direction: "outflow", amount: 600, category_id: initialExpenseImpact.category_id, status: "applied", origin: "linked" });
    await changePersonalExpenseBudgetCategory(database, ownerA, scopeA, expenseA.id, foodId);
    await changePersonalExpenseBudgetCategory(database, ownerA, scopeA, expenseB.id, transportId);
    await changePersonalExpenseBudgetCategory(database, ownerA, scopeA, expenseTarget.id, foodId);
    const shares = await pool.query<{ id: string; expense_id: string }>("SELECT id, expense_id FROM expense_shares WHERE ledger_scope_id = $1 ORDER BY expense_id", [scopeA]);
    const repayment = await repository.createRepaymentWithAllocations({ friendId: ids.friendA, amount: 350, paidAt: new Date("2026-09-07T10:00:00Z"), paidOn: "2026-09-07", paymentMethod: "Cash", notes: null }, [{ expenseShareId: shares.rows.find((share) => share.expense_id === expenseA.id)!.id, amount: 200 }, { expenseShareId: shares.rows.find((share) => share.expense_id === expenseB.id)!.id, amount: 100 }]);
    const repaymentImpacts = await pool.query<{ name: string; amount: number }>("SELECT c.name, i.amount FROM budget_personal_repayment_sources s JOIN budget_impacts i ON i.owner_user_id = s.owner_user_id AND i.budget_transaction_id = s.budget_transaction_id JOIN budget_categories c ON c.owner_user_id = i.owner_user_id AND c.id = i.budget_category_id WHERE s.owner_user_id = $1 AND s.repayment_id = $2 ORDER BY c.name", [ownerA, repayment.id]);
    assert.deepEqual(repaymentImpacts.rows, [{ name: "Food", amount: 200 }, { name: "Transport", amount: 100 }, { name: "Uncategorized", amount: 50 }]);
    await changePersonalExpenseBudgetCategory(database, ownerA, scopeA, expenseA.id, diningId);
    const recategorized = await pool.query<{ name: string; amount: number }>("SELECT c.name, i.amount FROM budget_personal_repayment_sources s JOIN budget_impacts i ON i.owner_user_id = s.owner_user_id AND i.budget_transaction_id = s.budget_transaction_id JOIN budget_categories c ON c.owner_user_id = i.owner_user_id AND c.id = i.budget_category_id WHERE s.owner_user_id = $1 AND s.repayment_id = $2 ORDER BY c.name", [ownerA, repayment.id]);
    assert.deepEqual(recategorized.rows, [{ name: "Dining", amount: 200 }, { name: "Transport", amount: 100 }, { name: "Uncategorized", amount: 50 }]);

    await repository.updateRepayment(repayment.id, { friendId: ids.friendA, amount: 400, paidAt: new Date("2026-09-07T10:00:00Z"), paidOn: "2026-09-07", paymentMethod: "Cash", notes: null });
    const updatedRepaymentImpacts = await pool.query<{ name: string; amount: number }>("SELECT c.name, i.amount FROM budget_personal_repayment_sources s JOIN budget_impacts i ON i.owner_user_id = s.owner_user_id AND i.budget_transaction_id = s.budget_transaction_id JOIN budget_categories c ON c.owner_user_id = i.owner_user_id AND c.id = i.budget_category_id WHERE s.owner_user_id = $1 AND s.repayment_id = $2 ORDER BY c.name", [ownerA, repayment.id]);
    assert.deepEqual(updatedRepaymentImpacts.rows, [{ name: "Dining", amount: 200 }, { name: "Transport", amount: 100 }, { name: "Uncategorized", amount: 100 }]);
    await repository.replaceRepaymentAllocations(repayment.id, [{ expenseShareId: shares.rows.find((share) => share.expense_id === expenseA.id)!.id, amount: 200 }, { expenseShareId: shares.rows.find((share) => share.expense_id === expenseB.id)!.id, amount: 100 }]);
    const replacedRepaymentImpacts = await pool.query<{ name: string; amount: number }>("SELECT c.name, i.amount FROM budget_personal_repayment_sources s JOIN budget_impacts i ON i.owner_user_id = s.owner_user_id AND i.budget_transaction_id = s.budget_transaction_id JOIN budget_categories c ON c.owner_user_id = i.owner_user_id AND c.id = i.budget_category_id WHERE s.owner_user_id = $1 AND s.repayment_id = $2 ORDER BY c.name", [ownerA, repayment.id]);
    assert.deepEqual(replacedRepaymentImpacts.rows, [{ name: "Dining", amount: 200 }, { name: "Transport", amount: 100 }, { name: "Uncategorized", amount: 100 }]);
    await repository.replaceExpenseShares(expenseA.id, []);
    const canonicalAllocationsAfterShareRemoval = await pool.query<{ expense_id: string; amount: number }>("SELECT s.expense_id, a.amount FROM repayment_allocations a JOIN expense_shares s ON s.ledger_scope_id = a.ledger_scope_id AND s.id = a.expense_share_id WHERE a.ledger_scope_id = $1 AND a.repayment_id = $2 ORDER BY s.expense_id", [scopeA, repayment.id]);
    assert.deepEqual(canonicalAllocationsAfterShareRemoval.rows, [{ expense_id: expenseB.id, amount: 100 }], "share replacement must preserve canonical FK-cascade allocation semantics");
    const allocationSideEffectImpacts = await pool.query<{ name: string; amount: number }>("SELECT c.name, i.amount FROM budget_personal_repayment_sources s JOIN budget_impacts i ON i.owner_user_id = s.owner_user_id AND i.budget_transaction_id = s.budget_transaction_id JOIN budget_categories c ON c.owner_user_id = i.owner_user_id AND c.id = i.budget_category_id WHERE s.owner_user_id = $1 AND s.repayment_id = $2 ORDER BY c.name", [ownerA, repayment.id]);
    assert.deepEqual(allocationSideEffectImpacts.rows, [{ name: "Transport", amount: 100 }, { name: "Uncategorized", amount: 300 }]);
    const repaymentTransaction = await row<{ id: string }>(pool, "SELECT budget_transaction_id AS id FROM budget_personal_repayment_sources WHERE owner_user_id = $1 AND repayment_id = $2", [ownerA, repayment.id]);
    const repaymentDeleteImpact = await repository.getRepaymentDeletionImpact(repayment.id);
    await repository.deleteRepayment(repayment.id, { cascadeDependents: true, expectedImpactRevision: deletionImpactRevision(repaymentDeleteImpact) });
    const repaymentVoided = await row<{ status: string }>(pool, "SELECT status FROM budget_transactions WHERE owner_user_id = $1 AND id = $2", [ownerA, repaymentTransaction.id]);
    assert.equal(repaymentVoided.status, "voided", "repayment deletion must void the linked inflow");
    const repaymentHistory = (await listBudgetTransactions(database, ownerA)).find((transaction) => transaction.id === repaymentTransaction.id);
    assert.equal(repaymentHistory?.status, "voided");
    assert.equal(repaymentHistory?.origin, "linked");
    assert.equal(repaymentHistory?.sourceType, "personal_repayment", "deleted linked inflows must retain Personal repayment history identity");
    assert.notEqual(repaymentHistory?.sourceType, "manual");

    await repository.updateExpense(expenseA.id, { outingId: ids.outingA, description: "Dinner updated", amount: 650 });
    const updatedExpense = await row<{ amount: number; description: string }>(pool, "SELECT t.amount, t.description FROM budget_personal_expense_sources s JOIN budget_transactions t ON t.owner_user_id = s.owner_user_id AND t.id = s.budget_transaction_id WHERE s.owner_user_id = $1 AND s.expense_id = $2", [ownerA, expenseA.id]);
    assert.deepEqual(updatedExpense, { amount: 650, description: "Dinner updated" });
    await repository.updateOuting(ids.outingA, { title: "B2 outing moved", occurredAt: new Date("2026-10-01T10:00:00Z"), occurredOn: "2026-10-01", notes: null, tripId: null });
    const movedDate = await row<{ occurred_on: string; impact_period: string }>(pool, "SELECT t.occurred_on::text, i.budget_period_id AS impact_period FROM budget_personal_expense_sources s JOIN budget_transactions t ON t.owner_user_id = s.owner_user_id AND t.id = s.budget_transaction_id JOIN budget_impacts i ON i.owner_user_id = t.owner_user_id AND i.budget_transaction_id = t.id WHERE s.owner_user_id = $1 AND s.expense_id = $2", [ownerA, expenseA.id]);
    assert.equal(movedDate.occurred_on, "2026-10-01");
    assert(movedDate.impact_period, "date edits must preserve the assigned impact period");

    const deleteExpense = await repository.createExpense({ outingId: ids.outingA, description: "Delete me", amount: 75 });
    const deleteTransaction = await row<{ id: string }>(pool, "SELECT budget_transaction_id AS id FROM budget_personal_expense_sources WHERE owner_user_id = $1 AND expense_id = $2", [ownerA, deleteExpense.id]);
    await changePersonalExpenseBudgetCategory(database, ownerA, scopeA, deleteExpense.id, foodId);
    const deleteImpact = await repository.getExpenseDeletionImpact(deleteExpense.id);
    await repository.deleteExpense(deleteExpense.id, { cascadeDependents: false, expectedImpactRevision: deletionImpactRevision(deleteImpact) });
    const deletedSource = await pool.query("SELECT 1 FROM budget_personal_expense_sources WHERE owner_user_id = $1 AND expense_id = $2", [ownerA, deleteExpense.id]);
    assert.equal(deletedSource.rowCount, 0, "source deletion must cascade only the link");
    const voided = await row<{ status: string; impact_count: string }>(pool, "SELECT t.status, (SELECT count(*)::text FROM budget_impacts i WHERE i.owner_user_id = t.owner_user_id AND i.budget_transaction_id = t.id) AS impact_count FROM budget_transactions t WHERE t.owner_user_id = $1 AND t.id = $2", [ownerA, deleteTransaction.id]);
    assert.deepEqual(voided, { status: "voided", impact_count: "1" });
    const expenseHistory = (await listBudgetTransactions(database, ownerA)).find((transaction) => transaction.id === deleteTransaction.id);
    assert.equal(expenseHistory?.status, "voided");
    assert.equal(expenseHistory?.origin, "linked");
    assert.equal(expenseHistory?.sourceType, "personal_expense", "deleted linked outflows must retain Personal expense history identity");
    assert.notEqual(expenseHistory?.sourceType, "manual");

    const outingDeleteExpense = await repository.createExpense({ outingId: ids.outingDelete, description: "Delete outing expense", amount: 45 });
    const outingDeleteTransaction = await row<{ id: string }>(pool, "SELECT budget_transaction_id AS id FROM budget_personal_expense_sources WHERE owner_user_id = $1 AND expense_id = $2", [ownerA, outingDeleteExpense.id]);
    const outingDeleteImpact = await repository.getOutingDeletionImpact(ids.outingDelete);
    await repository.deleteOuting(ids.outingDelete, { cascadeDependents: true, expectedImpactRevision: deletionImpactRevision(outingDeleteImpact) });
    const outingVoided = await row<{ status: string }>(pool, "SELECT status FROM budget_transactions WHERE owner_user_id = $1 AND id = $2", [ownerA, outingDeleteTransaction.id]);
    assert.equal(outingVoided.status, "voided", "outing deletion must void linked expenses before source cascade");

    await pool.query("INSERT INTO expenses (id, ledger_scope_id, outing_id, description, amount) VALUES ($1, $2, $3, 'Legacy expense', 80)", [ids.expenseNull, scopeA, ids.outingNull]);
    assert.equal((await pool.query("SELECT 1 FROM budget_personal_expense_sources WHERE expense_id = $1", [ids.expenseNull])).rowCount, 0);
    await repository.updateOuting(ids.outingNull, { title: "Legacy outing confirmed", occurredAt: new Date("2026-09-06T10:00:00Z"), occurredOn: "2026-09-06", notes: null, tripId: null });
    assert.equal((await pool.query("SELECT 1 FROM budget_personal_expense_sources WHERE owner_user_id = $1 AND expense_id = $2", [ownerA, ids.expenseNull])).rowCount, 1, "explicit date confirmation must make a legacy Expense eligible");
    await pool.query("INSERT INTO repayments (id, ledger_scope_id, friend_id, amount, paid_at, paid_on) VALUES ($1, $2, $3, 90, '2026-09-08T10:00:00Z', NULL)", [ids.repaymentNull, scopeA, ids.friendA]);
    assert.equal((await pool.query("SELECT 1 FROM budget_personal_repayment_sources WHERE repayment_id = $1", [ids.repaymentNull])).rowCount, 0);
    await repository.updateRepayment(ids.repaymentNull, { friendId: ids.friendA, amount: 90, paidAt: new Date("2026-09-08T10:00:00Z"), paidOn: "2026-09-08", paymentMethod: "Cash", notes: null });
    assert.equal((await pool.query("SELECT 1 FROM budget_personal_repayment_sources WHERE owner_user_id = $1 AND repayment_id = $2", [ownerA, ids.repaymentNull])).rowCount, 1, "explicit date confirmation must make a legacy Repayment eligible");

    await pool.query("INSERT INTO expenses (id, ledger_scope_id, outing_id, description, amount) VALUES ($1, $2, $3, 'Import expense', 55), ($4, $2, $3, 'Concurrent expense', 65)", [ids.expenseImport, scopeA, ids.outingImport, ids.expenseConcurrent]);
    const imported = await importPersonalActivity(database, ownerA, scopeA);
    assert(imported.expenseCount >= 2, "current-period canonical-date expenses must import");
    const repeated = await importPersonalActivity(database, ownerA, scopeA);
    assert.equal(repeated.expenseCount, 0, "import is idempotent");
    const duplicateCounts = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM budget_personal_expense_sources WHERE owner_user_id = $1 AND expense_id IN ($2, $3)", [ownerA, ids.expenseImport, ids.expenseConcurrent]);
    assert.equal(duplicateCounts.rows[0].count, "2");
    await pool.query("INSERT INTO expenses (id, ledger_scope_id, outing_id, description, amount) VALUES ($1, $2, $3, 'Race expense', 70)", [randomUUID(), scopeA, ids.outingA]);
    const raceExpense = await row<{ id: string }>(pool, "SELECT id FROM expenses WHERE ledger_scope_id = $1 AND description = 'Race expense'", [scopeA]);
    const integration = createPersonalBudgetIntegration(ownerA, scopeA);
    await Promise.all([importPersonalActivity(database, ownerA, scopeA), database.transaction(async (transaction) => integration.reconcileExpense(transaction as never, raceExpense.id))]);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM budget_personal_expense_sources WHERE owner_user_id = $1 AND expense_id = $2", [ownerA, raceExpense.id])).rows[0].count, 1, "concurrent import/live reconciliation must converge");

    await expectConstraint(pool, "23503", "INSERT INTO budget_personal_expense_sources (owner_user_id, budget_transaction_id, expense_id) VALUES ($1, $2, $3)", [ownerA, randomUUID(), randomUUID()]);
    await expectConstraint(pool, "23505", "INSERT INTO budget_personal_expense_sources (owner_user_id, budget_transaction_id, expense_id) SELECT $1, budget_transaction_id, expense_id FROM budget_personal_expense_sources WHERE owner_user_id = $1 AND expense_id = $2", [ownerA, expenseA.id]);
    await assert.rejects(changePersonalExpenseBudgetCategory(database, ownerA, scopeB, expenseA.id, foodId), (error: unknown) => error instanceof BudgetError && error.code === "NOT_FOUND");
    const ownerBExpense = await ownerBRepository.createExpense({ outingId: ids.outingB, description: "No profile expense", amount: 25 });
    await ownerBRepository.replaceExpenseShares(ownerBExpense.id, [{ friendId: ids.friendB, baseAmount: 25 }]);
    const ownerBTargetExpense = await ownerBRepository.createExpense({ outingId: ids.outingB, description: "No profile target", amount: 25 });
    await ownerBRepository.replaceExpenseShares(ownerBTargetExpense.id, [{ friendId: ids.friendB, baseAmount: 25 }]);
    const ownerBShares = await pool.query<{ id: string; expense_id: string }>("SELECT id, expense_id FROM expense_shares WHERE ledger_scope_id = $1 AND expense_id IN ($2, $3) ORDER BY expense_id", [scopeB, ownerBExpense.id, ownerBTargetExpense.id]);
    const noProfileAllocatedRepayment = await ownerBRepository.createRepaymentWithAllocations({ friendId: ids.friendB, amount: 25, paidAt: new Date("2026-09-08T10:00:00Z"), paidOn: "2026-09-08", paymentMethod: "Cash", notes: null }, [{ expenseShareId: ownerBShares.rows.find((share) => share.expense_id === ownerBExpense.id)!.id, amount: 25 }]);
    await ownerBRepository.replaceExpenseShares(ownerBExpense.id, []);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM repayment_allocations WHERE ledger_scope_id = $1 AND repayment_id = $2", [scopeB, noProfileAllocatedRepayment.id])).rows[0].count, 0, "no-profile share removal must retain canonical allocation deletion semantics");
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM repayment_allocations a JOIN expense_shares s ON s.ledger_scope_id = a.ledger_scope_id AND s.id = a.expense_share_id WHERE a.ledger_scope_id = $1 AND s.expense_id = $2", [scopeB, ownerBTargetExpense.id])).rows[0].count, 0, "no-profile share removal must not reallocate to an unrelated share");
    const noProfileRepayment = await ownerBRepository.createRepayment({ friendId: ids.friendB, amount: 15, paidAt: new Date("2026-09-08T11:00:00Z"), paidOn: "2026-09-08", paymentMethod: "Cash", notes: null });
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM repayments WHERE ledger_scope_id = $1 AND id = $2", [scopeB, noProfileRepayment.id])).rows[0].count, 1, "no-profile repayment must remain canonical");
    await expectConstraint(pool, "23503", "INSERT INTO budget_personal_expense_sources (owner_user_id, budget_transaction_id, expense_id) VALUES ($1, $2, $3)", [ownerB, expenseTransaction.id, ownerBExpense.id]);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM budget_transactions WHERE owner_user_id = $1", [ownerB])).rows[0].count, 0, "no-profile Personal mutations must not create Budget rows");
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM budget_impacts WHERE owner_user_id = $1", [ownerB])).rows[0].count, 0, "no-profile Personal repayments must not create Budget impacts");
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM budget_personal_repayment_sources WHERE owner_user_id = $1", [ownerB])).rows[0].count, 0, "no-profile Personal repayments must not create Budget source links");
    assert(ownerBExpense.id, "owner B source mutation should still succeed");
    console.log("personal budgeting smoke passed: typed links, atomic lifecycle, full cash semantics, date/null rules, allocation mapping, recategorization, void history, import idempotency/concurrency, FK/owner isolation, and no-profile behavior verified");
  } catch (error) {
    console.error(`personal budgeting smoke failed: ${formatSafeError(error, config.password)}`);
    process.exitCode = 1;
  } finally {
    if (scopeA || scopeB) {
      await pool.query("DELETE FROM budget_personal_expense_sources WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
      await pool.query("DELETE FROM budget_personal_repayment_sources WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
      await pool.query("DELETE FROM budget_impacts WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
      await pool.query("DELETE FROM budget_transactions WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
      await pool.query("DELETE FROM budget_period_categories WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
      await pool.query("DELETE FROM budget_periods WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
      await pool.query("DELETE FROM budget_categories WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
      await pool.query("DELETE FROM budget_profiles WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
      await pool.query("DELETE FROM repayment_allocations WHERE ledger_scope_id = ANY($1::uuid[])", [[scopeA, scopeB]]).catch(() => undefined);
      await pool.query("DELETE FROM repayments WHERE ledger_scope_id = ANY($1::uuid[])", [[scopeA, scopeB]]).catch(() => undefined);
      await pool.query("DELETE FROM expense_shares WHERE ledger_scope_id = ANY($1::uuid[])", [[scopeA, scopeB]]).catch(() => undefined);
      await pool.query("DELETE FROM expenses WHERE ledger_scope_id = ANY($1::uuid[])", [[scopeA, scopeB]]).catch(() => undefined);
      await pool.query("DELETE FROM outings WHERE ledger_scope_id = ANY($1::uuid[])", [[scopeA, scopeB]]).catch(() => undefined);
      await pool.query("DELETE FROM friends WHERE ledger_scope_id = ANY($1::uuid[])", [[scopeA, scopeB]]).catch(() => undefined);
      await pool.query("DELETE FROM ledger_scopes WHERE id = ANY($1::uuid[])", [[scopeA, scopeB]]).catch(() => undefined);
      await pool.query("DELETE FROM users WHERE id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    }
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void run();
