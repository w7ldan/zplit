import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type QueryResultRow } from "pg";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/client";
import { BudgetError } from "../src/domain/budgeting/errors";
import { createLedgerRepository } from "../src/domain/ledger-repository";
import { createBudgetSetup } from "../src/server/budgeting/profiles";
import { createBudgetCategory, updateBudgetPlan } from "../src/server/budgeting/categories";
import { changePersonalExpenseBudgetCategory, createPersonalBudgetIntegration } from "../src/server/budgeting/sources-personal";
import { archiveActiveBudgetPeriod, startBudgetPeriodFromPaused, startNextBudgetPeriod } from "../src/server/budgeting/periods";
import { createManualBudgetTransaction, spreadBudgetTransaction, voidBudgetTransaction } from "../src/server/budgeting/transactions";
import { createBudgetRecurringTemplate } from "../src/server/budgeting/recurring";
import { ensurePersonalLedgerScope } from "../src/server/ledger-scopes";
import { formatSafeError, readDatabaseConfig } from "./migrate.js";

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
if (!require.cache[serverOnlyPath]) require.cache[serverOnlyPath] = { exports: {} } as never;

const { getBudgetDashboard, getBudgetOverviewSnapshot, listBudgetPeriodHistory } = await import("../src/server/budgeting/reporting");
const { createGroupExpense } = await import("../src/server/group-accounting");
const { createGroup } = await import("../src/server/groups");

function row<T extends QueryResultRow>(pool: Pool, statement: string, values: unknown[]) {
  return pool.query<T>(statement, values).then((result) => {
    assert.equal(result.rowCount, 1, `expected one row for ${statement}`);
    return result.rows[0]!;
  });
}

async function count(pool: Pool, statement: string, values: unknown[]) {
  const result = await pool.query<{ count: string }>(statement, values);
  return Number(result.rows[0]?.count ?? 0);
}

function transactionCount(pool: Pool, ownerUserId: string) {
  return count(pool, "SELECT count(*)::text AS count FROM budget_transactions WHERE owner_user_id = $1", [ownerUserId]);
}

function impactCount(pool: Pool, ownerUserId: string) {
  return count(pool, "SELECT count(*)::text AS count FROM budget_impacts WHERE owner_user_id = $1", [ownerUserId]);
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
  const groupIds: string[] = [];
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
    await changePersonalExpenseBudgetCategory(database, ownerA, scopeA, spreadExpense.id, travelId);
    assert.equal((await pool.query("SELECT count(*) FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2 AND budget_category_id <> $3", [ownerA, spreadExpenseTransaction.id, travelId])).rows[0].count, "0");

    const futureExpense = await repository.createExpense({ outingId: futureOutingId, description: "Future linked expense", amount: 80 });
    const futureExpenseTransaction = await row<{ id: string }>(pool, "SELECT budget_transaction_id AS id FROM budget_personal_expense_sources WHERE owner_user_id = $1 AND expense_id = $2", [ownerA, futureExpense.id]);
    assert.equal((await pool.query("SELECT count(*) FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2", [ownerA, futureExpenseTransaction.id])).rows[0].count, "0");
    const foodExpense = await repository.createExpense({ outingId: currentOutingId, description: "Food source", amount: 150 });
    const travelExpense = await repository.createExpense({ outingId: currentOutingId, description: "Travel source", amount: 150 });
    const historyExpense = await repository.createExpense({ outingId: currentOutingId, description: "Historical category move", amount: 175 });
    await repository.replaceExpenseShares(foodExpense.id, [{ friendId, baseAmount: 150 }]);
    await repository.replaceExpenseShares(travelExpense.id, [{ friendId, baseAmount: 150 }]);
    await changePersonalExpenseBudgetCategory(database, ownerA, scopeA, foodExpense.id, foodId);
    await changePersonalExpenseBudgetCategory(database, ownerA, scopeA, travelExpense.id, travelId);
    await changePersonalExpenseBudgetCategory(database, ownerA, scopeA, historyExpense.id, foodId);
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
    await changePersonalExpenseBudgetCategory(database, ownerA, scopeA, historyExpense.id, transitId);
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

    const pendingThroughPause = await createManualBudgetTransaction(database, ownerA, { direction: "outflow", amount: 600, description: "Pending through pause", occurredOn: "2026-11-10", categoryId: foodId });
    await spreadBudgetTransaction(database, ownerA, pendingThroughPause.id, 3);
    const resumeRule = await createBudgetRecurringTemplate(database, ownerA, { name: "November plan", amount: 250, categoryId: foodId, frequency: "monthly", startsOn: "2026-11-28", spreadCount: 1 });
    assert.equal((await pool.query("SELECT count(*) FROM budget_recurring_occurrences WHERE owner_user_id = $1 AND recurring_template_id = $2 AND scheduled_on = '2026-11-28'", [ownerA, resumeRule.id])).rows[0].count, "1", "the November recurring plan is materialized once before early archive");
    const futurePosted = await createManualBudgetTransaction(database, ownerA, { direction: "outflow", amount: 100, description: "Activity beyond early close", occurredOn: "2026-11-27", categoryId: foodId });
    await assert.rejects(
      archiveActiveBudgetPeriod(database, ownerA, november.period.id, "2026-11-23"),
      (error: unknown) => error instanceof BudgetError && error.code === "CONFLICT" && error.message.includes("2026-11-27"),
    );
    assert.equal((await pool.query("SELECT status, ends_on::text FROM budget_periods WHERE owner_user_id = $1 AND id = $2", [ownerA, november.period.id])).rows[0].ends_on, "2026-11-30", "an unsafe early close leaves historical dates unchanged");
    await voidBudgetTransaction(database, ownerA, futurePosted.id);
    const transactionsBeforeArchive = await transactionCount(pool, ownerA);
    const impactsBeforeArchive = await impactCount(pool, ownerA);
    await archiveActiveBudgetPeriod(database, ownerA, november.period.id, "2026-11-23");
    const earlyClosed = (await pool.query("SELECT status, ends_on::text FROM budget_periods WHERE owner_user_id = $1 AND id = $2", [ownerA, november.period.id])).rows[0];
    assert.deepEqual(earlyClosed, { status: "closed", ends_on: "2026-11-23" }, "early archive closes through the requested date");
    assert.equal((await pool.query("SELECT count(*) FROM budget_periods WHERE owner_user_id = $1 AND status = 'active'", [ownerA])).rows[0].count, "0", "archive must leave Budget paused with no active period");
    assert.equal(await transactionCount(pool, ownerA), transactionsBeforeArchive, "archive must preserve Budget transactions");
    assert.equal(await impactCount(pool, ownerA), impactsBeforeArchive, "archive must preserve Budget impacts");
    assert.equal((await pool.query("SELECT count(*) FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2 AND target_period_ordinal = 4 AND status = 'pending'", [ownerA, pendingThroughPause.id])).rows[0].count, "1", "archive must preserve pending next-period impacts");
    assert.equal((await pool.query("SELECT count(*) FROM budget_recurring_occurrences WHERE owner_user_id = $1 AND recurring_template_id = $2 AND scheduled_period_id = $3 AND status = 'due'", [ownerA, resumeRule.id, november.period.id])).rows[0].count, "1", "the unrecorded recurring plan remains attached to the closed period while Budget is paused");
    const pausedDashboard = await getBudgetDashboard(database, ownerA);
    assert(pausedDashboard.configured && pausedDashboard.period === null && pausedDashboard.pausedPeriod?.id === november.period.id, "the dashboard must expose an intentional paused state and its latest closed plan");
    assert.deepEqual(await getBudgetOverviewSnapshot(database, ownerA), { configured: true, period: null, paused: true, lastPeriod: { name: "November", startsOn: "2026-11-01", endsOn: "2026-11-23" } }, "Overview must expose paused Budget without active-period totals");
    await expectBudgetError("CONFLICT", archiveActiveBudgetPeriod(database, ownerA, november.period.id, "2026-11-23"));

    await pool.query("UPDATE budget_periods SET ends_on = '2026-11-30' WHERE owner_user_id = $1 AND id = $2 AND status = 'closed'", [ownerA, november.period.id]);

    const pausedOutingId = randomUUID();
    await pool.query("INSERT INTO outings (id, ledger_scope_id, title, occurred_at, occurred_on) VALUES ($1, $2, 'Paused Personal activity', '2026-12-05T10:00:00Z', '2026-12-05')", [pausedOutingId, scopeA]);
    const pausedExpense = await repository.createExpense({ outingId: pausedOutingId, description: "Personal during pause", amount: 125 });
    const pausedExpenseTransaction = await row<{ id: string }>(pool, "SELECT budget_transaction_id AS id FROM budget_personal_expense_sources WHERE owner_user_id = $1 AND expense_id = $2", [ownerA, pausedExpense.id]);
    assert.equal((await pool.query("SELECT count(*) FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2", [ownerA, pausedExpenseTransaction.id])).rows[0].count, "0", "Personal ledger activity must keep its linked source without a phantom paused-period impact");

    const group = await createGroup(database, ownerA, { name: "Paused Budget activity" });
    groupIds.push(group.id);
    const ownerParticipant = (await row<{ participant_id: string }>(pool, "SELECT participant_id FROM group_memberships WHERE group_id = $1 AND user_id = $2", [group.id, ownerA])).participant_id;
    const pausedGroupExpense = await createGroupExpense(database, group.id, ownerA, {
      description: "Group during pause",
      occurredAt: new Date("2026-12-06T10:00:00Z"),
      occurredOn: "2026-12-06",
      totalAmount: 250,
      payerParticipantId: ownerParticipant,
      shares: [{ participantId: ownerParticipant, amount: 250 }],
    }, { includeInBudget: true, categoryId: foodId });
    assert.equal(pausedGroupExpense.state, "confirmed");
    const pausedGroupTransaction = await row<{ id: string }>(pool, "SELECT budget_transaction_id AS id FROM budget_group_expense_sources WHERE owner_user_id = $1 AND group_expense_id = $2", [ownerA, pausedGroupExpense.id]);
    assert.equal((await pool.query("SELECT count(*) FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2", [ownerA, pausedGroupTransaction.id])).rows[0].count, "0", "Group ledger activity must keep its linked source without a phantom paused-period impact");

    const resumeInput = {
      expectedLatestPeriodId: november.period.id,
      name: "December",
      startsOn: "2026-11-24",
      endsOn: "2026-12-31",
      totalBudget: 10_000,
      allocations: november.plans.map((plan) => ({ categoryId: plan.category_id, allocatedAmount: plan.allocated_amount })),
    };
    await expectBudgetError("CONFLICT", startBudgetPeriodFromPaused(database, ownerA, { ...resumeInput, expectedLatestPeriodId: randomUUID() }));
    await assert.rejects(
      startBudgetPeriodFromPaused(database, ownerA, resumeInput),
      (error: unknown) => error instanceof BudgetError && error.code === "CONFLICT" && error.message.includes("Confirm shortening") && error.message.includes("2026-11-23"),
    );
    assert.equal((await pool.query("SELECT ends_on::text FROM budget_periods WHERE owner_user_id = $1 AND id = $2", [ownerA, november.period.id])).rows[0].ends_on, "2026-11-30", "reset requires explicit confirmation before changing a previously archived period");
    const confirmedResume = { ...resumeInput, confirmPreviousPeriodShortening: true };
    const resumeRace = await Promise.allSettled([
      startBudgetPeriodFromPaused(database, ownerA, confirmedResume),
      startBudgetPeriodFromPaused(database, ownerA, confirmedResume),
    ]);
    assert.equal(resumeRace.filter((result) => result.status === "fulfilled").length, 1, "only one concurrent paused resume may create the next period");
    const resumeLoser = resumeRace.find((result) => result.status === "rejected");
    assert(resumeLoser?.status === "rejected" && resumeLoser.reason instanceof BudgetError && resumeLoser.reason.code === "CONFLICT");
    const december = await activePlan(pool, ownerA);
    assert.equal(december.period.ordinal, 4, "resuming after archive increments the ordinal once");
    assert.equal(december.period.starts_on, "2026-11-24", "the new Budget starts on the requested day after shortening the legacy closed period");
    assert.equal((await pool.query("SELECT ends_on::text FROM budget_periods WHERE owner_user_id = $1 AND id = $2", [ownerA, november.period.id])).rows[0].ends_on, "2026-11-23", "the existing closed period ends the day before the new period");
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_periods later_period JOIN budget_periods previous_period ON previous_period.owner_user_id = later_period.owner_user_id AND previous_period.ordinal + 1 = later_period.ordinal WHERE later_period.owner_user_id = $1 AND later_period.starts_on <= previous_period.ends_on", [ownerA]), 0, "periods do not overlap after the reset");
    assert.equal((await pool.query("SELECT count(*) FROM budget_periods WHERE owner_user_id = $1 AND status = 'active'", [ownerA])).rows[0].count, "1", "the resumed Budget keeps exactly one active period");
    assert.equal((await pool.query("SELECT count(*) FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2 AND status = 'applied' AND budget_period_id = $3 AND target_period_ordinal = 4", [ownerA, pendingThroughPause.id, december.period.id])).rows[0].count, "1", "pending impacts apply once when the period starts");
    assert.equal((await pool.query("SELECT count(*) FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2 AND status = 'pending' AND target_period_ordinal = 5", [ownerA, pendingThroughPause.id])).rows[0].count, "1", "later pending impacts remain pending after resume");
    assert.equal((await pool.query("SELECT count(*) FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2 AND status = 'applied' AND budget_period_id = $3", [ownerA, pausedExpenseTransaction.id, december.period.id])).rows[0].count, "1", "eligible zero-impact Personal activity is absorbed once");
    assert.equal((await pool.query("SELECT count(*) FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2 AND status = 'applied' AND budget_period_id = $3", [ownerA, pausedGroupTransaction.id, december.period.id])).rows[0].count, "1", "eligible zero-impact Group activity is absorbed once");
    assert.equal((await pool.query("SELECT count(*) FROM budget_recurring_occurrences WHERE owner_user_id = $1 AND recurring_template_id = $2 AND scheduled_period_id = $3 AND status = 'due'", [ownerA, resumeRule.id, december.period.id])).rows[0].count, "2", "the moved November occurrence and December occurrence each belong to the resumed period exactly once");
    assert.deepEqual((await pool.query("SELECT scheduled_on::text FROM budget_recurring_occurrences WHERE owner_user_id = $1 AND recurring_template_id = $2 AND scheduled_period_id = $3 ORDER BY scheduled_on", [ownerA, resumeRule.id, december.period.id])).rows.map((item) => item.scheduled_on), ["2026-11-28", "2026-12-28"]);
    await expectBudgetError("CONFLICT", startBudgetPeriodFromPaused(database, ownerA, confirmedResume));
    const archivedHistory = await listBudgetPeriodHistory(database, ownerA);
    assert.deepEqual(archivedHistory.map((period) => [period.ordinal, period.status]), [[4, "active"], [3, "closed"], [2, "closed"], [1, "closed"]]);

    const ownerBInitial = await activePlan(pool, ownerB);
    const ownerBFoodId = ownerBInitial.plans.find((plan) => plan.name === "Food")!.category_id;
    const ownerBPosted = await createManualBudgetTransaction(database, ownerB, { direction: "outflow", amount: 100, description: "History after proposed close", occurredOn: "2026-09-27", categoryId: ownerBFoodId });
    await archiveActiveBudgetPeriod(database, ownerB, ownerBInitial.period.id, "2026-09-30");
    const ownerBReset = {
      expectedLatestPeriodId: ownerBInitial.period.id,
      name: "September reset",
      startsOn: "2026-09-24",
      endsOn: "2026-09-30",
      totalBudget: 10_000,
      allocations: ownerBInitial.plans.map((plan) => ({ categoryId: plan.category_id, allocatedAmount: plan.allocated_amount })),
      confirmPreviousPeriodShortening: true,
    };
    await assert.rejects(
      startBudgetPeriodFromPaused(database, ownerB, ownerBReset),
      (error: unknown) => error instanceof BudgetError && error.code === "CONFLICT" && error.message.includes("2026-09-27"),
    );
    assert.deepEqual((await pool.query("SELECT status, ends_on::text FROM budget_periods WHERE owner_user_id = $1 AND id = $2", [ownerB, ownerBInitial.period.id])).rows[0], { status: "closed", ends_on: "2026-09-30" }, "unsafe paused reset preserves posted historical activity and its original period range");
    assert.equal((await pool.query("SELECT status FROM budget_transactions WHERE owner_user_id = $1 AND id = $2", [ownerB, ownerBPosted.id])).rows[0].status, "posted", "unsafe reset leaves the posted transaction intact");

    console.log("budget period transition smoke passed: early archive and confirmed paused reset, posted-history safety, recurring carry-forward, atomic stale-gated transitions, pending/void handling, zero-impact absorption, multi-category repayment mapping, history, and owner isolation");
  } catch (error) {
    console.error(`budget period transition smoke failed: ${formatSafeError(error, config.password)}`);
    process.exitCode = 1;
  } finally {
    await pool.query("DELETE FROM budget_personal_expense_sources WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_personal_repayment_sources WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_group_expense_sources WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_impacts WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_transactions WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_recurring_occurrences WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_recurring_templates WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_period_categories WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_periods WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_categories WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_profiles WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    for (const groupId of groupIds) {
      await pool.query("DELETE FROM group_expense_lifecycle_events WHERE group_id = $1", [groupId]).catch(() => undefined);
      await pool.query("DELETE FROM group_obligations WHERE group_id = $1", [groupId]).catch(() => undefined);
      await pool.query("DELETE FROM group_expense_shares WHERE group_id = $1", [groupId]).catch(() => undefined);
      await pool.query("DELETE FROM group_expenses WHERE group_id = $1", [groupId]).catch(() => undefined);
      await pool.query("DELETE FROM group_memberships WHERE group_id = $1", [groupId]).catch(() => undefined);
      await pool.query("DELETE FROM group_participants WHERE group_id = $1", [groupId]).catch(() => undefined);
      await pool.query("DELETE FROM groups WHERE id = $1", [groupId]).catch(() => undefined);
    }
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
