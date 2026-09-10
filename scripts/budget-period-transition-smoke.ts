import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type QueryResultRow } from "pg";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/client";
import { BudgetError } from "../src/domain/budgeting/errors";
import { createLedgerRepository } from "../src/domain/ledger-repository";
import { createBudgetSetup } from "../src/server/budgeting/profiles";
import { createBudgetCategory, updateBudgetPlan } from "../src/server/budgeting/categories";
import { listBudgetPeriodHistory } from "../src/server/budgeting/reporting";
import { startNextBudgetPeriod } from "../src/server/budgeting/periods";
import { changePersonalExpenseBudgetCategory, createPersonalBudgetIntegration } from "../src/server/budgeting/sources-personal";
import { createManualBudgetTransaction, spreadBudgetTransaction, voidBudgetTransaction } from "../src/server/budgeting/transactions";
import { ensurePersonalLedgerScope } from "../src/server/ledger-scopes";
import { formatSafeError, readDatabaseConfig } from "./migrate.js";

function row<T extends QueryResultRow>(pool: Pool, statement: string, values: unknown[]) {
  return pool.query<T>(statement, values).then((result) => {
    assert.equal(result.rowCount, 1, `expected one row for ${statement}`);
    return result.rows[0]!;
  });
}

async function expectBudgetError(code: BudgetError["code"], operation: Promise<unknown>) {
  await assert.rejects(operation, (error: unknown) => error instanceof BudgetError && error.code === code);
}

async function activePlan(pool: Pool, ownerUserId: string) {
  const period = await row<{ id: string; ordinal: number; starts_on: string; ends_on: string; name: string; total_budget: number; updated_at: Date }>(pool, "SELECT id, ordinal, starts_on::text, ends_on::text, name, total_budget, updated_at FROM budget_periods WHERE owner_user_id = $1 AND status = 'active'", [ownerUserId]);
  const plans = (await pool.query<{ category_id: string; name: string; allocated_amount: number; display_order: number }>("SELECT p.budget_category_id AS category_id, c.name, p.allocated_amount, p.display_order FROM budget_period_categories p JOIN budget_categories c ON c.owner_user_id = p.owner_user_id AND c.id = p.budget_category_id WHERE p.owner_user_id = $1 AND p.budget_period_id = $2 ORDER BY p.display_order", [ownerUserId, period.id])).rows;
  return { period, plans };
}

async function run() {
  if (process.env.DB_NAME !== "zplit_test") throw new Error("Budget period transition smoke requires DB_NAME=zplit_test");
  const config = readDatabaseConfig("zplit_test");
  const pool = new Pool({ ...config, max: 8 });
  const database = drizzle(pool, { schema }) as Database;
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  let scopeA = "";
  try {
    await pool.query("INSERT INTO users (id, name, email, email_verified) VALUES ($1, 'Period Owner A', $2, true), ($3, 'Period Owner B', $4, true)", [ownerA, `period-a-${ownerA}@example.com`, ownerB, `period-b-${ownerB}@example.com`]);
    scopeA = await ensurePersonalLedgerScope(database, ownerA);
    await createBudgetSetup(database, ownerA, { periodName: "September", startsOn: "2026-09-01", endsOn: "2026-09-30", totalBudget: 10_000, categories: [{ name: "Food", allocatedAmount: 2_000 }, { name: "Travel", allocatedAmount: 2_000 }] });
    await createBudgetSetup(database, ownerB, { periodName: "Owner B", startsOn: "2026-09-01", endsOn: "2026-09-30", totalBudget: 10_000, categories: [{ name: "Food", allocatedAmount: 0 }] });
    const { period: initialPeriod, plans } = await activePlan(pool, ownerA);
    const foodId = plans.find((plan) => plan.name === "Food")!.category_id;
    const travelId = plans.find((plan) => plan.name === "Travel")!.category_id;

    const manual = await createManualBudgetTransaction(database, ownerA, { direction: "outflow", amount: 1_000, description: "Annual payment", occurredOn: "2026-09-05", categoryId: foodId });
    await spreadBudgetTransaction(database, ownerA, manual.id, 3);
    assert.deepEqual((await pool.query<{ target_period_ordinal: number; amount: number; status: string; budget_period_id: string | null }>("SELECT target_period_ordinal, amount, status, budget_period_id FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2 ORDER BY target_period_ordinal", [ownerA, manual.id])).rows, [
      { target_period_ordinal: 1, amount: 334, status: "applied", budget_period_id: initialPeriod.id },
      { target_period_ordinal: 2, amount: 333, status: "pending", budget_period_id: null },
      { target_period_ordinal: 3, amount: 333, status: "pending", budget_period_id: null },
    ]);
    await spreadBudgetTransaction(database, ownerA, manual.id, 4);
    await spreadBudgetTransaction(database, ownerA, manual.id, 1);
    assert.deepEqual((await pool.query<{ amount: number; status: string }>("SELECT amount, status FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2", [ownerA, manual.id])).rows, [{ amount: 1_000, status: "applied" }]);

    const pending = await createManualBudgetTransaction(database, ownerA, { direction: "outflow", amount: 300, description: "Three period payment", occurredOn: "2026-09-06", categoryId: foodId });
    await spreadBudgetTransaction(database, ownerA, pending.id, 3);
    const voided = await createManualBudgetTransaction(database, ownerA, { direction: "outflow", amount: 300, description: "Voided payment", occurredOn: "2026-09-07", categoryId: foodId });
    await spreadBudgetTransaction(database, ownerA, voided.id, 3);
    await voidBudgetTransaction(database, ownerA, voided.id);

    const friendId = randomUUID();
    const currentOutingId = randomUUID();
    const futureOutingId = randomUUID();
    await pool.query("INSERT INTO friends (id, ledger_scope_id, name) VALUES ($1, $2, 'Period friend')", [friendId, scopeA]);
    await pool.query("INSERT INTO outings (id, ledger_scope_id, title, occurred_at, occurred_on) VALUES ($1, $2, 'Period current', '2026-09-08T10:00:00Z', '2026-09-08'), ($3, $2, 'Period future', '2026-10-05T10:00:00Z', '2026-10-05')", [currentOutingId, scopeA, futureOutingId]);
    const repository = createLedgerRepository(database, scopeA, { personalBudget: createPersonalBudgetIntegration(ownerA, scopeA) });
    const spreadExpense = await repository.createExpense({ outingId: currentOutingId, description: "Linked spread expense", amount: 1_000 });
    const spreadExpenseTransaction = await row<{ id: string }>(pool, "SELECT budget_transaction_id AS id FROM budget_personal_expense_sources WHERE owner_user_id = $1 AND expense_id = $2", [ownerA, spreadExpense.id]);
    await spreadBudgetTransaction(database, ownerA, spreadExpenseTransaction.id, 3);
    await repository.updateExpense(spreadExpense.id, { outingId: currentOutingId, description: "Linked spread expense updated", amount: 1_300 });
    assert.deepEqual((await pool.query<{ amount: number; target_period_ordinal: number }>("SELECT amount, target_period_ordinal FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2 ORDER BY target_period_ordinal", [ownerA, spreadExpenseTransaction.id])).rows, [{ amount: 434, target_period_ordinal: 1 }, { amount: 433, target_period_ordinal: 2 }, { amount: 433, target_period_ordinal: 3 }]);
    await changePersonalExpenseBudgetCategory(database, ownerA, scopeA, spreadExpenseTransaction.id, travelId);
    assert.equal((await pool.query("SELECT count(*) FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2 AND budget_category_id <> $3", [ownerA, spreadExpenseTransaction.id, travelId])).rows[0].count, "0");

    const futureExpense = await repository.createExpense({ outingId: futureOutingId, description: "Future linked expense", amount: 80 });
    const futureExpenseTransaction = await row<{ id: string }>(pool, "SELECT budget_transaction_id AS id FROM budget_personal_expense_sources WHERE owner_user_id = $1 AND expense_id = $2", [ownerA, futureExpense.id]);
    assert.equal((await pool.query("SELECT count(*) FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2", [ownerA, futureExpenseTransaction.id])).rows[0].count, "0");
    const foodExpense = await repository.createExpense({ outingId: currentOutingId, description: "Food source", amount: 150 });
    const travelExpense = await repository.createExpense({ outingId: currentOutingId, description: "Travel source", amount: 150 });
    const historyExpense = await repository.createExpense({ outingId: currentOutingId, description: "Historical category move", amount: 175 });
    await repository.replaceExpenseShares(foodExpense.id, [{ friendId, baseAmount: 150 }]);
    await repository.replaceExpenseShares(travelExpense.id, [{ friendId, baseAmount: 150 }]);
    const foodTransaction = await row<{ id: string }>(pool, "SELECT budget_transaction_id AS id FROM budget_personal_expense_sources WHERE owner_user_id = $1 AND expense_id = $2", [ownerA, foodExpense.id]);
    const travelTransaction = await row<{ id: string }>(pool, "SELECT budget_transaction_id AS id FROM budget_personal_expense_sources WHERE owner_user_id = $1 AND expense_id = $2", [ownerA, travelExpense.id]);
    const historyTransaction = await row<{ id: string }>(pool, "SELECT budget_transaction_id AS id FROM budget_personal_expense_sources WHERE owner_user_id = $1 AND expense_id = $2", [ownerA, historyExpense.id]);
    await changePersonalExpenseBudgetCategory(database, ownerA, scopeA, foodTransaction.id, foodId);
    await changePersonalExpenseBudgetCategory(database, ownerA, scopeA, travelTransaction.id, travelId);
    await changePersonalExpenseBudgetCategory(database, ownerA, scopeA, historyTransaction.id, foodId);
    const foodShare = (await repository.listExpenseShares(foodExpense.id))[0]!;
    const travelShare = (await repository.listExpenseShares(travelExpense.id))[0]!;
    const futureRepayment = await repository.createRepaymentWithAllocations({ friendId, amount: 300, paidAt: new Date("2026-10-06T10:00:00Z"), paidOn: "2026-10-06", paymentMethod: "Cash", notes: null }, [{ expenseShareId: foodShare.id, amount: 150 }, { expenseShareId: travelShare.id, amount: 150 }]);
    const futureRepaymentTransaction = await row<{ id: string }>(pool, "SELECT budget_transaction_id AS id FROM budget_personal_repayment_sources WHERE owner_user_id = $1 AND repayment_id = $2", [ownerA, futureRepayment.id]);
    assert.equal((await pool.query("SELECT count(*) FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2", [ownerA, futureRepaymentTransaction.id])).rows[0].count, "0");

    const transitionInput = (periodId: string, startsOn: string, endsOn: string, name: string, planRows = plans) => ({ expectedActivePeriodId: periodId, name, startsOn, endsOn, totalBudget: 10_000, allocations: planRows.map((plan) => ({ categoryId: plan.category_id, allocatedAmount: plan.allocated_amount })) });
    const transition = transitionInput(initialPeriod.id, "2026-10-01", "2026-10-31", "October");
    const race = await Promise.allSettled([startNextBudgetPeriod(database, ownerA, transition), startNextBudgetPeriod(database, ownerA, transition)]);
    assert.equal(race.filter((result) => result.status === "fulfilled").length, 1, "one concurrent transition must win");
    const loser = race.find((result) => result.status === "rejected");
    assert(loser?.status === "rejected" && loser.reason instanceof BudgetError && loser.reason.code === "CONFLICT");
    assert.equal((await pool.query("SELECT count(*) FROM budget_periods WHERE owner_user_id = $1", [ownerA])).rows[0].count, "2");
    const october = await activePlan(pool, ownerA);
    assert.equal(october.period.ordinal, 2);
    assert.equal((await pool.query("SELECT count(*) FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2 AND status = 'applied' AND budget_period_id = $3", [ownerA, pending.id, october.period.id])).rows[0].count, "1");
    assert.equal((await pool.query("SELECT count(*) FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2 AND status = 'pending' AND target_period_ordinal = 3", [ownerA, pending.id])).rows[0].count, "1");
    assert.equal((await pool.query("SELECT count(*) FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2", [ownerA, voided.id])).rows[0].count, "3");
    assert.equal((await pool.query("SELECT count(*) FROM budget_impacts i JOIN budget_transactions t ON t.owner_user_id = i.owner_user_id AND t.id = i.budget_transaction_id WHERE i.owner_user_id = $1 AND i.budget_transaction_id = $2 AND i.status = 'applied'", [ownerA, voided.id])).rows[0].count, "1");
    assert.equal((await pool.query("SELECT count(*) FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2 AND budget_period_id = $3", [ownerA, futureExpenseTransaction.id, october.period.id])).rows[0].count, "1", "future linked expense must be absorbed once");
    const repaymentCategories = await pool.query<{ name: string; amount: number }>("SELECT c.name, i.amount FROM budget_impacts i JOIN budget_categories c ON c.owner_user_id = i.owner_user_id AND c.id = i.budget_category_id WHERE i.owner_user_id = $1 AND i.budget_transaction_id = $2 ORDER BY c.name", [ownerA, futureRepaymentTransaction.id]);
    assert.deepEqual(repaymentCategories.rows, [{ name: "Food", amount: 150 }, { name: "Travel", amount: 150 }], "multi-category repayment must not multiply spread source categories");

    const periodOneBeforeRecategorization = (await listBudgetPeriodHistory(database, ownerA)).find((period) => period.ordinal === 1);
    assert(periodOneBeforeRecategorization);
    const foodBeforeRecategorization = periodOneBeforeRecategorization.categories.find((category) => category.name === "Food");
    assert(foodBeforeRecategorization);
    await createBudgetCategory(database, ownerA, "Transit", 0);
    const octoberWithImpactOnlyCategory = await activePlan(pool, ownerA);
    const transitId = octoberWithImpactOnlyCategory.plans.find((plan) => plan.name === "Transit")!.category_id;
    await changePersonalExpenseBudgetCategory(database, ownerA, scopeA, historyTransaction.id, transitId);
    assert.equal((await pool.query("SELECT count(*) FROM budget_period_categories WHERE owner_user_id = $1 AND budget_period_id = $2 AND budget_category_id = $3", [ownerA, initialPeriod.id, transitId])).rows[0].count, "0", "recategorization must not add a retroactive historical plan row");

    const third = transitionInput(october.period.id, "2026-11-01", "2026-11-30", "November", octoberWithImpactOnlyCategory.plans);
    await startNextBudgetPeriod(database, ownerA, third);
    const november = await activePlan(pool, ownerA);
    assert.equal((await pool.query("SELECT count(*) FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2 AND status = 'applied' AND budget_period_id = $3", [ownerA, pending.id, november.period.id])).rows[0].count, "1");
    await expectBudgetError("CONFLICT", spreadBudgetTransaction(database, ownerA, pending.id, 1));
    const history = await listBudgetPeriodHistory(database, ownerA);
    assert.deepEqual(history.map((period) => [period.ordinal, period.status]), [[3, "active"], [2, "closed"], [1, "closed"]]);
    const periodOne = history.find((period) => period.ordinal === 1);
    assert(periodOne);
    assert.equal(periodOne.netSpent, periodOneBeforeRecategorization.netSpent, "recategorization must preserve period net spent");
    const transitCategories = periodOne.categories.filter((category) => category.name === "Transit");
    assert.equal(transitCategories.length, 1, "impact-only historical category must appear exactly once");
    assert.deepEqual(transitCategories[0], { id: transitId, name: "Transit", allocatedAmount: 0, outflowApplied: historyExpense.amount, inflowApplied: 0, netSpent: historyExpense.amount, remaining: -historyExpense.amount });
    assert.equal(periodOne.categories.find((category) => category.name === "Food")?.netSpent, foodBeforeRecategorization.netSpent - historyExpense.amount, "moved spending must leave its former category");
    assert.equal(periodOne.categories.reduce((sum, category) => sum + category.netSpent, 0), periodOne.netSpent, "category history must reconcile to period history");
    await expectBudgetError("CONFLICT", spreadBudgetTransaction(database, ownerB, pending.id, 2));
    await expectBudgetError("CONFLICT", startNextBudgetPeriod(database, ownerB, { ...transition, expectedActivePeriodId: initialPeriod.id }));
    assert.equal((await listBudgetPeriodHistory(database, ownerB)).length, 1, "period history must remain owner-private");
    const novemberPlan = transitionInput(november.period.id, "2026-10-15", "2026-11-30", "November", november.plans);
    await assert.rejects(
      updateBudgetPlan(database, ownerA, { period: { name: novemberPlan.name, startsOn: novemberPlan.startsOn, endsOn: novemberPlan.endsOn, totalBudget: novemberPlan.totalBudget }, expectedPeriodUpdatedAt: november.period.updated_at.toISOString(), categories: novemberPlan.allocations.map((allocation) => ({ id: allocation.categoryId, name: november.plans.find((plan) => plan.category_id === allocation.categoryId)!.name, allocatedAmount: allocation.allocatedAmount })) }),
      (error: unknown) => error instanceof BudgetError && error.code === "CONFLICT" && error.message.includes("overlaps the previous closed period"),
    );
    console.log("budget period transition smoke passed: integer spread, source rebalancing, category preservation, atomic stale-gated transitions, pending/void handling, zero-impact absorption, multi-category repayment mapping, history, and owner isolation");
  } catch (error) {
    console.error(`budget period transition smoke failed: ${formatSafeError(error, config.password)}`);
    process.exitCode = 1;
  } finally {
    await pool.query("DELETE FROM budget_personal_expense_sources WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_personal_repayment_sources WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_impacts WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_transactions WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_period_categories WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_periods WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_categories WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_profiles WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    if (scopeA) {
      await pool.query("DELETE FROM repayment_allocations WHERE ledger_scope_id = $1", [scopeA]).catch(() => undefined);
      await pool.query("DELETE FROM repayments WHERE ledger_scope_id = $1", [scopeA]).catch(() => undefined);
      await pool.query("DELETE FROM expense_shares WHERE ledger_scope_id = $1", [scopeA]).catch(() => undefined);
      await pool.query("DELETE FROM expenses WHERE ledger_scope_id = $1", [scopeA]).catch(() => undefined);
      await pool.query("DELETE FROM outings WHERE ledger_scope_id = $1", [scopeA]).catch(() => undefined);
      await pool.query("DELETE FROM friends WHERE ledger_scope_id = $1", [scopeA]).catch(() => undefined);
      await pool.query("DELETE FROM ledger_scopes WHERE id = $1", [scopeA]).catch(() => undefined);
    }
    await pool.query("DELETE FROM users WHERE id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void run();
