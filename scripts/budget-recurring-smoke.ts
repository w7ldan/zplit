import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type QueryResultRow } from "pg";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/client";
import { BudgetError } from "../src/domain/budgeting/errors";
import { createBudgetSetup } from "../src/server/budgeting/profiles";
import { listBudgetPeriodHistory } from "../src/server/budgeting/reporting";
import { startNextBudgetPeriod } from "../src/server/budgeting/periods";
import {
  archiveBudgetRecurringTemplate,
  createBudgetRecurringTemplate,
  getBudgetRecurringDashboardSummary,
  recordBudgetRecurringOccurrence,
  skipBudgetRecurringOccurrence,
  updateBudgetRecurringTemplate,
} from "../src/server/budgeting/recurring";
import { voidBudgetTransaction } from "../src/server/budgeting/transactions";
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

async function expectDatabaseCode(code: string, operation: () => Promise<unknown>) {
  await assert.rejects(operation, (error: unknown) => {
    const candidate = error as { code?: string; cause?: { code?: string } };
    return candidate.code === code || candidate.cause?.code === code;
  });
}

async function activePlan(pool: Pool, ownerUserId: string) {
  const period = await row<{ id: string; ordinal: number; starts_on: string; ends_on: string; name: string; total_budget: number }>(pool, "SELECT id, ordinal, starts_on::text, ends_on::text, name, total_budget FROM budget_periods WHERE owner_user_id = $1 AND status = 'active'", [ownerUserId]);
  const plans = (await pool.query<{ category_id: string; name: string; allocated_amount: number; display_order: number }>("SELECT p.budget_category_id AS category_id, c.name, p.allocated_amount, p.display_order FROM budget_period_categories p JOIN budget_categories c ON c.owner_user_id = p.owner_user_id AND c.id = p.budget_category_id WHERE p.owner_user_id = $1 AND p.budget_period_id = $2 ORDER BY p.display_order", [ownerUserId, period.id])).rows;
  return { period, plans };
}

async function transactionCount(pool: Pool, ownerUserId: string) {
  return Number((await row<{ count: string }>(pool, "SELECT count(*)::text AS count FROM budget_transactions WHERE owner_user_id = $1", [ownerUserId])).count);
}

async function impactCount(pool: Pool, ownerUserId: string) {
  return Number((await row<{ count: string }>(pool, "SELECT count(*)::text AS count FROM budget_impacts WHERE owner_user_id = $1", [ownerUserId])).count);
}

async function run() {
  if (process.env.DB_NAME !== "zplit_test") throw new Error("Budget recurring smoke requires DB_NAME=zplit_test");
  const config = readDatabaseConfig("zplit_test");
  const pool = new Pool({ ...config, max: 8 });
  const database = drizzle(pool, { schema }) as Database;
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  try {
    await pool.query("INSERT INTO users (id, name, email, email_verified) VALUES ($1, 'Recurring Owner A', $2, true), ($3, 'Recurring Owner B', $4, true)", [ownerA, `recurring-a-${ownerA}@example.com`, ownerB, `recurring-b-${ownerB}@example.com`]);
    await createBudgetSetup(database, ownerA, { periodName: "September", startsOn: "2026-09-01", endsOn: "2026-09-30", totalBudget: 20_000, categories: [{ name: "Food", allocatedAmount: 5_000 }, { name: "Travel", allocatedAmount: 5_000 }] });
    await createBudgetSetup(database, ownerB, { periodName: "Long period", startsOn: "2026-01-01", endsOn: "2026-04-30", totalBudget: 20_000, categories: [{ name: "Food", allocatedAmount: 5_000 }] });
    const september = await activePlan(pool, ownerA);
    const foodId = september.plans.find((plan) => plan.name === "Food")!.category_id;
    const travelId = september.plans.find((plan) => plan.name === "Travel")!.category_id;
    const april = await activePlan(pool, ownerB);
    const ownerBFoodId = april.plans.find((plan) => plan.name === "Food")!.category_id;

    const beforeHistory = (await listBudgetPeriodHistory(database, ownerA)).find((period) => period.ordinal === 1);
    assert(beforeHistory);
    assert.equal(beforeHistory.netSpent, 0);

    const gym = await createBudgetRecurringTemplate(database, ownerA, { name: "Gym", amount: 3_000, categoryId: foodId, frequency: "every_budget_period", startsOn: "2026-09-05", spreadCount: 1 });
    const gymOccurrence = await row<{ id: string; scheduled_on: string; amount: number; category_id: string; status: string }>(pool, "SELECT id, scheduled_on::text, amount, category_id, status FROM budget_recurring_occurrences WHERE owner_user_id = $1 AND recurring_template_id = $2", [ownerA, gym.id]);
    assert.deepEqual(gymOccurrence, { id: gymOccurrence.id, scheduled_on: "2026-09-05", amount: 3_000, category_id: foodId, status: "due" });
    assert.equal(await transactionCount(pool, ownerA), 0, "creating a template must not create cash");
    assert.equal(await impactCount(pool, ownerA), 0, "creating a template must not create impacts");
    assert.deepEqual(await getBudgetRecurringDashboardSummary(database, ownerA), { dueCount: 1, expectedAmount: 3_000, nextDueOn: "2026-09-05" });
    const afterTemplateHistory = (await listBudgetPeriodHistory(database, ownerA)).find((period) => period.ordinal === 1);
    assert.equal(afterTemplateHistory?.netSpent, beforeHistory.netSpent, "a due occurrence must not change net spent");

    const future = await createBudgetRecurringTemplate(database, ownerA, { name: "Future", amount: 2_000, categoryId: foodId, frequency: "every_budget_period", startsOn: "2026-10-10", spreadCount: 1 });
    assert.equal(Number((await row<{ count: string }>(pool, "SELECT count(*)::text AS count FROM budget_recurring_occurrences WHERE owner_user_id = $1 AND recurring_template_id = $2", [ownerA, future.id])).count), 0, "a future starts_on produces no current-period occurrence");

    const monthly = await createBudgetRecurringTemplate(database, ownerB, { name: "Rent", amount: 12_000, categoryId: ownerBFoodId, frequency: "monthly", startsOn: "2026-01-31", spreadCount: 1 });
    assert.deepEqual((await pool.query<{ scheduled_on: string }>("SELECT scheduled_on::text FROM budget_recurring_occurrences WHERE owner_user_id = $1 AND recurring_template_id = $2 ORDER BY scheduled_on", [ownerB, monthly.id])).rows.map((occurrence) => occurrence.scheduled_on), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);

    await expectBudgetError("NOT_FOUND", startNextBudgetPeriod(database, ownerA, {
      expectedActivePeriodId: september.period.id,
      name: "October",
      startsOn: "2026-10-01",
      endsOn: "2026-10-31",
      totalBudget: 20_000,
      allocations: september.plans.map((plan) => ({ categoryId: plan.category_id, allocatedAmount: plan.allocated_amount })),
      recurrence: [{ templateId: randomUUID(), scheduledOn: "2026-10-01", selected: true, categoryId: null }],
    }));
    assert.equal(Number((await row<{ count: string }>(pool, "SELECT count(*)::text AS count FROM budget_periods WHERE owner_user_id = $1", [ownerA])).count), 1, "an invalid selection must roll back the transition");

    const octoberInput = (recurrence: Array<{ templateId: string; scheduledOn: string; selected: boolean; categoryId: string | null }>) => ({
      expectedActivePeriodId: september.period.id,
      name: "October",
      startsOn: "2026-10-01",
      endsOn: "2026-10-31",
      totalBudget: 20_000,
      allocations: september.plans.map((plan) => ({ categoryId: plan.category_id, allocatedAmount: plan.allocated_amount })),
      recurrence,
    });
    await expectBudgetError("INVALID_INPUT", startNextBudgetPeriod(database, ownerA, octoberInput([{ templateId: gym.id, scheduledOn: "2026-10-01", selected: true, categoryId: randomUUID() }])));
    await startNextBudgetPeriod(database, ownerA, octoberInput([
      { templateId: gym.id, scheduledOn: "2026-10-01", selected: true, categoryId: travelId },
      { templateId: future.id, scheduledOn: "2026-10-10", selected: false, categoryId: null },
    ]));
    const october = await activePlan(pool, ownerA);
    assert.equal(october.period.ordinal, 2);
    const octoberRecurring = (await pool.query<{ recurring_template_id: string; scheduled_on: string; status: string; category_id: string }>("SELECT recurring_template_id, scheduled_on::text, status, category_id FROM budget_recurring_occurrences WHERE owner_user_id = $1 AND scheduled_period_id = $2 ORDER BY scheduled_on", [ownerA, october.period.id])).rows;
    assert.deepEqual(octoberRecurring, [
      { recurring_template_id: gym.id, scheduled_on: "2026-10-01", status: "due", category_id: travelId },
      { recurring_template_id: future.id, scheduled_on: "2026-10-10", status: "skipped", category_id: foodId },
    ]);
    await expectBudgetError("CONFLICT", startNextBudgetPeriod(database, ownerA, octoberInput([])));
    assert.equal(Number((await row<{ count: string }>(pool, "SELECT count(*)::text AS count FROM budget_periods WHERE owner_user_id = $1", [ownerA])).count), 2, "transition retry must not duplicate periods or occurrences");

    const octoberGymOccurrenceId = octoberRecurring.find((occurrence) => occurrence.recurring_template_id === gym.id)!.status === "due"
      ? (await row<{ id: string }>(pool, "SELECT id FROM budget_recurring_occurrences WHERE owner_user_id = $1 AND recurring_template_id = $2 AND scheduled_on = '2026-10-01'", [ownerA, gym.id])).id
      : "";
    await recordBudgetRecurringOccurrence(database, ownerA, octoberGymOccurrenceId, "2026-10-03");
    const gymTransaction = await row<{ id: string; origin: string; amount: number; description: string; status: string }>(pool, "SELECT t.id, t.origin, t.amount, t.description, t.status FROM budget_transactions t JOIN budget_recurring_occurrences o ON o.owner_user_id = t.owner_user_id AND o.budget_transaction_id = t.id WHERE o.owner_user_id = $1 AND o.id = $2", [ownerA, octoberGymOccurrenceId]);
    assert.deepEqual(gymTransaction, { id: gymTransaction.id, origin: "recurring", amount: 3_000, description: "Gym", status: "posted" });
    assert.deepEqual((await pool.query<{ status: string; budget_transaction_id: string | null; scheduled_on: string }>("SELECT status, budget_transaction_id, scheduled_on::text FROM budget_recurring_occurrences WHERE owner_user_id = $1 AND id = $2", [ownerA, octoberGymOccurrenceId])).rows[0], { status: "recorded", budget_transaction_id: gymTransaction.id, scheduled_on: "2026-10-01" });
    assert.deepEqual((await pool.query<{ status: string; amount: number; budget_period_id: string }>("SELECT status, amount, budget_period_id FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2", [ownerA, gymTransaction.id])).rows, [{ status: "applied", amount: 3_000, budget_period_id: october.period.id }]);
    assert.deepEqual(await getBudgetRecurringDashboardSummary(database, ownerA), { dueCount: 1, expectedAmount: 3_000, nextDueOn: "2026-09-05" }, "the earlier unresolved occurrence remains resolvable");

    const water = await createBudgetRecurringTemplate(database, ownerA, { name: "Water", amount: 500, categoryId: foodId, frequency: "every_budget_period", startsOn: "2026-10-15", spreadCount: 1 });
    const waterOccurrence = await row<{ id: string }>(pool, "SELECT id FROM budget_recurring_occurrences WHERE owner_user_id = $1 AND recurring_template_id = $2", [ownerA, water.id]);
    await skipBudgetRecurringOccurrence(database, ownerA, waterOccurrence.id);
    assert.equal(await transactionCount(pool, ownerA), 1, "skipping must not create cash");
    await expectBudgetError("CONFLICT", recordBudgetRecurringOccurrence(database, ownerA, waterOccurrence.id, "2026-10-16"));

    const annual = await createBudgetRecurringTemplate(database, ownerA, { name: "Annual", amount: 1_000, categoryId: foodId, frequency: "every_budget_period", startsOn: "2026-10-20", spreadCount: 3 });
    const annualOccurrence = await row<{ id: string }>(pool, "SELECT id FROM budget_recurring_occurrences WHERE owner_user_id = $1 AND recurring_template_id = $2", [ownerA, annual.id]);
    await recordBudgetRecurringOccurrence(database, ownerA, annualOccurrence.id, "2026-10-21");
    const annualTransaction = await row<{ id: string }>(pool, "SELECT budget_transaction_id AS id FROM budget_recurring_occurrences WHERE owner_user_id = $1 AND id = $2", [ownerA, annualOccurrence.id]);
    assert.deepEqual((await pool.query<{ target_period_ordinal: number; amount: number; status: string }>("SELECT target_period_ordinal, amount, status FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2 ORDER BY target_period_ordinal", [ownerA, annualTransaction.id])).rows, [
      { target_period_ordinal: 2, amount: 334, status: "applied" },
      { target_period_ordinal: 3, amount: 333, status: "pending" },
      { target_period_ordinal: 4, amount: 333, status: "pending" },
    ]);
    assert.equal(Number((await row<{ count: string }>(pool, "SELECT count(*)::text AS count FROM budget_transactions WHERE owner_user_id = $1 AND id = $2", [ownerA, annualTransaction.id])).count), 1, "one spread payment is one transaction");

    const concurrent = await createBudgetRecurringTemplate(database, ownerA, { name: "Concurrent", amount: 100, categoryId: foodId, frequency: "every_budget_period", startsOn: "2026-10-22", spreadCount: 1 });
    const concurrentOccurrence = await row<{ id: string }>(pool, "SELECT id FROM budget_recurring_occurrences WHERE owner_user_id = $1 AND recurring_template_id = $2", [ownerA, concurrent.id]);
    const race = await Promise.allSettled([
      recordBudgetRecurringOccurrence(database, ownerA, concurrentOccurrence.id, "2026-10-23"),
      recordBudgetRecurringOccurrence(database, ownerA, concurrentOccurrence.id, "2026-10-23"),
    ]);
    assert.equal(race.filter((result) => result.status === "fulfilled").length, 1, "one concurrent record request must win");
    const loser = race.find((result) => result.status === "rejected");
    assert(loser?.status === "rejected" && loser.reason instanceof BudgetError && loser.reason.code === "CONFLICT");
    assert.equal(Number((await row<{ count: string }>(pool, "SELECT count(*)::text AS count FROM budget_transactions WHERE owner_user_id = $1 AND description = 'Concurrent'", [ownerA])).count), 1);

    const outside = await createBudgetRecurringTemplate(database, ownerA, { name: "Outside", amount: 800, categoryId: foodId, frequency: "every_budget_period", startsOn: "2026-10-25", spreadCount: 2 });
    const outsideOccurrence = await row<{ id: string }>(pool, "SELECT id FROM budget_recurring_occurrences WHERE owner_user_id = $1 AND recurring_template_id = $2", [ownerA, outside.id]);
    await recordBudgetRecurringOccurrence(database, ownerA, outsideOccurrence.id, "2026-12-15");
    const outsideTransaction = await row<{ id: string }>(pool, "SELECT budget_transaction_id AS id FROM budget_recurring_occurrences WHERE owner_user_id = $1 AND id = $2", [ownerA, outsideOccurrence.id]);
    assert.equal(Number((await row<{ count: string }>(pool, "SELECT count(*)::text AS count FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2", [ownerA, outsideTransaction.id])).count), 0, "an outside-period payment records cash without guessing absorption");

    await expectBudgetError("NOT_FOUND", recordBudgetRecurringOccurrence(database, ownerB, octoberGymOccurrenceId, "2026-10-04"));
    await expectBudgetError("NOT_FOUND", skipBudgetRecurringOccurrence(database, ownerB, waterOccurrence.id));
    await expectBudgetError("NOT_FOUND", archiveBudgetRecurringTemplate(database, ownerB, gym.id));
    await expectBudgetError("NOT_FOUND", createBudgetRecurringTemplate(database, ownerB, { name: "Foreign", amount: 100, categoryId: travelId, frequency: "every_budget_period", startsOn: "2026-01-05", spreadCount: 1 }));

    const octoberBeforeEdit = (await listBudgetPeriodHistory(database, ownerA)).find((period) => period.ordinal === 2);
    assert(octoberBeforeEdit);
    await updateBudgetRecurringTemplate(database, ownerA, gym.id, { name: "Gym Plus", amount: 4_000, categoryId: travelId, frequency: "every_budget_period", startsOn: "2026-09-05", spreadCount: 1 });
    assert.equal((await row<{ amount: number; description: string }>(pool, "SELECT amount, description FROM budget_transactions WHERE owner_user_id = $1 AND id = $2", [ownerA, gymTransaction.id])).amount, 3_000, "editing a template must not rewrite recorded cash");
    assert.equal((await listBudgetPeriodHistory(database, ownerA)).find((period) => period.ordinal === 2)?.netSpent, octoberBeforeEdit.netSpent, "editing a template must not rewrite existing occurrence reporting");
    await archiveBudgetRecurringTemplate(database, ownerA, future.id);

    await startNextBudgetPeriod(database, ownerA, {
      expectedActivePeriodId: october.period.id,
      name: "November",
      startsOn: "2026-11-01",
      endsOn: "2026-11-30",
      totalBudget: 20_000,
      allocations: october.plans.map((plan) => ({ categoryId: plan.category_id, allocatedAmount: plan.allocated_amount })),
    });
    const november = await activePlan(pool, ownerA);
    assert.equal(november.period.ordinal, 3);
    assert.equal(Number((await row<{ count: string }>(pool, "SELECT count(*)::text AS count FROM budget_recurring_occurrences WHERE owner_user_id = $1 AND recurring_template_id = $2 AND scheduled_period_id = $3", [ownerA, future.id, november.period.id])).count), 0, "an archived template must not generate future occurrences");
    assert.deepEqual((await pool.query<{ amount: number; status: string }>("SELECT amount, status FROM budget_recurring_occurrences WHERE owner_user_id = $1 AND recurring_template_id = $2 AND scheduled_period_id = $3", [ownerA, gym.id, november.period.id])).rows, [{ amount: 4_000, status: "due" }], "an edited template applies to future materialization");
    assert.equal((await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM budget_recurring_occurrences WHERE owner_user_id = $1 AND recurring_template_id = $2 AND scheduled_period_id = $3 AND status = 'skipped'", [ownerA, future.id, october.period.id])).rows[0]!.count, "1", "an old skipped snapshot remains");

    await startNextBudgetPeriod(database, ownerA, {
      expectedActivePeriodId: november.period.id,
      name: "December",
      startsOn: "2026-12-01",
      endsOn: "2026-12-31",
      totalBudget: 20_000,
      allocations: november.plans.map((plan) => ({ categoryId: plan.category_id, allocatedAmount: plan.allocated_amount })),
    });
    const december = await activePlan(pool, ownerA);
    const outsideImpacts = (await pool.query<{ status: string; amount: number; budget_period_id: string | null; target_period_ordinal: number }>("SELECT status, amount, budget_period_id, target_period_ordinal FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2 ORDER BY target_period_ordinal", [ownerA, outsideTransaction.id])).rows;
    assert.deepEqual(outsideImpacts, [
      { status: "applied", amount: 400, budget_period_id: december.period.id, target_period_ordinal: 4 },
      { status: "pending", amount: 400, budget_period_id: null, target_period_ordinal: 5 },
    ]);
    assert.equal(outsideImpacts.reduce((sum, impact) => sum + impact.amount, 0), 800, "a zero-impact recurring payment absorbs exactly once with its spread");

    const octoberBeforeVoid = (await listBudgetPeriodHistory(database, ownerA)).find((period) => period.ordinal === 2);
    assert(octoberBeforeVoid);
    await voidBudgetTransaction(database, ownerA, gymTransaction.id);
    const octoberAfterVoid = (await listBudgetPeriodHistory(database, ownerA)).find((period) => period.ordinal === 2);
    assert(octoberAfterVoid);
    assert.equal(octoberAfterVoid.netSpent, octoberBeforeVoid.netSpent - 3_000, "voiding a recurring payment removes its reporting impact");
    assert.equal((await row<{ status: string; budget_transaction_id: string }>(pool, "SELECT status, budget_transaction_id FROM budget_recurring_occurrences WHERE owner_user_id = $1 AND id = $2", [ownerA, octoberGymOccurrenceId])).status, "recorded");
    assert.equal((await row<{ status: string }>(pool, "SELECT status FROM budget_transactions WHERE owner_user_id = $1 AND id = $2", [ownerA, gymTransaction.id])).status, "voided");
    assert.equal(Number((await row<{ count: string }>(pool, "SELECT count(*)::text AS count FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2", [ownerA, gymTransaction.id])).count), 1, "voiding keeps historical impacts");

    await expectDatabaseCode("23505", () => pool.query("INSERT INTO budget_recurring_occurrences (owner_user_id, recurring_template_id, scheduled_period_id, scheduled_on, amount, category_id, spread_count, status) VALUES ($1, $2, $3, '2026-09-05', 3000, $4, 1, 'due')", [ownerA, gym.id, september.period.id, foodId]));
    await expectDatabaseCode("23514", () => pool.query("INSERT INTO budget_recurring_occurrences (owner_user_id, recurring_template_id, scheduled_period_id, scheduled_on, amount, category_id, spread_count, status) VALUES ($1, $2, $3, '2026-07-15', 3000, $4, 1, 'recorded')", [ownerA, gym.id, september.period.id, foodId]));
    await expectDatabaseCode("23503", () => pool.query("INSERT INTO budget_recurring_occurrences (owner_user_id, recurring_template_id, scheduled_period_id, scheduled_on, amount, category_id, spread_count, status) VALUES ($1, $2, $3, '2026-07-16', 100, $4, 1, 'due')", [ownerA, monthly.id, april.period.id, ownerBFoodId]));

    console.log("budget recurring smoke passed: pure schedules, no fake cash, transition select/map, record/skip lifecycle, spread composition, outside-period absorption, archive/edit snapshots, void history, concurrency, owner-safe FKs");
  } catch (error) {
    console.error(`budget recurring smoke failed: ${formatSafeError(error, config.password)}`);
    process.exitCode = 1;
  } finally {
    await pool.query("DELETE FROM budget_recurring_occurrences WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_recurring_templates WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_impacts WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_transactions WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_period_categories WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_periods WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_categories WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM budget_profiles WHERE owner_user_id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("DELETE FROM users WHERE id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void run();
