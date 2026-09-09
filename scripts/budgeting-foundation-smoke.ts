import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/client";
import { BudgetError } from "../src/domain/budgeting/errors";
import { createBudgetSetup } from "../src/server/budgeting/profiles";
import { createBudgetCategory, updateBudgetPlan } from "../src/server/budgeting/categories";
import { updateActiveBudgetPeriod } from "../src/server/budgeting/periods";
import { getBudgetDashboard } from "../src/server/budgeting/reporting";
import { createManualBudgetTransaction, voidManualBudgetTransaction } from "../src/server/budgeting/transactions";
import { formatSafeError, readDatabaseConfig } from "./migrate.js";

const tables = ["budget_profiles", "budget_periods", "budget_categories", "budget_period_categories", "budget_transactions", "budget_impacts"];

function postgresCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

async function expectConstraint(client: PoolClient, code: string, statement: string, values: unknown[]) {
  try {
    await client.query(statement, values);
    throw new Error(`expected PostgreSQL error ${code}`);
  } catch (error) {
    if (postgresCode(error) !== code) throw new Error(`expected ${code}, got ${postgresCode(error) ?? "unknown"} for ${statement}`, { cause: error });
  }
}

async function expectBudgetError(code: BudgetError["code"], operation: Promise<unknown>) {
  await assert.rejects(operation, (error: unknown) => error instanceof BudgetError && error.code === code);
}

async function setup(client: PoolClient, userId: string, categoryNames: string[]) {
  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO budget_profiles (owner_user_id) VALUES ($1)", [userId]);
    const categoryIds: string[] = [];
    const uncategorized = await client.query<{ id: string }>("INSERT INTO budget_categories (owner_user_id, name, normalized_name, system_key) VALUES ($1, 'Uncategorized', 'uncategorized', 'uncategorized') RETURNING id", [userId]);
    categoryIds.push(uncategorized.rows[0].id);
    for (const name of categoryNames) {
      const category = await client.query<{ id: string }>("INSERT INTO budget_categories (owner_user_id, name, normalized_name) VALUES ($1, $2, lower($2::varchar)) RETURNING id", [userId, name]);
      categoryIds.push(category.rows[0].id);
    }
    const period = await client.query<{ id: string }>("INSERT INTO budget_periods (owner_user_id, ordinal, name, starts_on, ends_on, total_budget, status) VALUES ($1, 1, 'Smoke period', '2026-09-01', '2026-09-30', 100, 'active') RETURNING id", [userId]);
    for (const [index, categoryId] of categoryIds.entries()) await client.query("INSERT INTO budget_period_categories (owner_user_id, budget_period_id, budget_category_id, allocated_amount, display_order) VALUES ($1, $2, $3, 0, $4)", [userId, period.rows[0].id, categoryId, index]);
    await client.query("COMMIT");
    return { periodId: period.rows[0].id, categoryIds };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

type SmokePlanRow = { period_id: string; category_id: string; name: string; system_key: string | null; allocated_amount: string; period_updated_at: string };

function planInput(rows: SmokePlanRow[], changedCategoryId?: string): Parameters<typeof updateBudgetPlan>[2] {
  return {
    period: { name: "Smoke period", startsOn: "2026-09-01", endsOn: "2026-09-30", totalBudget: 100 },
    expectedPeriodUpdatedAt: new Date(rows[0].period_updated_at).toISOString(),
    categories: rows.map((row) => ({
      id: row.category_id,
      name: row.name,
      allocatedAmount: row.category_id === changedCategoryId ? 60 : Number(row.allocated_amount),
    })),
  };
}

export async function runBudgetingFoundationSmoke() {
  let pool: Pool | undefined;
  let client: PoolClient | undefined;
  let password = "";
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const ownerC = randomUUID();
  try {
    const config = readDatabaseConfig("zplit_test");
    password = config.password;
    pool = new Pool({ ...config, max: 6 });
    const database = drizzle(pool, { schema }) as Database;
    client = await pool.connect();
    const tableResult = await client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])", [tables]);
    assert.equal(new Set(tableResult.rows.map((row) => row.table_name)).size, tables.length, "budget tables are missing");
    await client.query("INSERT INTO users (id, name, email, email_verified) VALUES ($1, 'Budget Smoke A', $2, true), ($3, 'Budget Smoke B', $4, true), ($5, 'Budget Smoke C', $6, true)", [ownerA, `budget-smoke-${ownerA}@example.com`, ownerB, `budget-smoke-${ownerB}@example.com`, ownerC, `budget-smoke-${ownerC}@example.com`]);

    const raceClients = await Promise.all([pool.connect(), pool.connect()]);
    const setupResults = await Promise.all(raceClients.map((raceClient) => setup(raceClient, ownerA, ["A", "B"]).then(() => true).catch((error) => {
      if (postgresCode(error) !== "23505") throw new Error(`unexpected setup race error ${postgresCode(error) ?? "unknown"}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      return false;
    }).finally(() => raceClient.release())));
    assert.equal(setupResults.filter(Boolean).length, 1, "setup race must have exactly one winner");
    const profileCount = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM budget_profiles WHERE owner_user_id = $1", [ownerA]);
    assert.equal(Number(profileCount.rows[0].count), 1);
    const ownerAPlan = await client.query<SmokePlanRow>("SELECT p.budget_period_id AS period_id, p.budget_category_id AS category_id, c.name, c.system_key, p.allocated_amount::text, period.updated_at::text AS period_updated_at FROM budget_period_categories p JOIN budget_categories c ON c.owner_user_id = p.owner_user_id AND c.id = p.budget_category_id JOIN budget_periods period ON period.owner_user_id = p.owner_user_id AND period.id = p.budget_period_id WHERE p.owner_user_id = $1 ORDER BY p.display_order", [ownerA]);
    assert.equal(ownerAPlan.rows.length, 3, "setup must be complete");
    const ownerASetupCounts = await client.query<{ periods: string; categories: string }>("SELECT (SELECT count(*)::text FROM budget_periods WHERE owner_user_id = $1) AS periods, (SELECT count(*)::text FROM budget_categories WHERE owner_user_id = $1) AS categories", [ownerA]);
    assert.deepEqual(ownerASetupCounts.rows[0], { periods: "1", categories: "3" }, "losing setup must leave no partial rows");
    const periodId = ownerAPlan.rows[0].period_id;
    const categoryA = ownerAPlan.rows[1].category_id;
    const categoryB = ownerAPlan.rows[2].category_id;
    await updateBudgetPlan(database, ownerA, planInput(ownerAPlan.rows));
    const refreshedPeriod = await client.query<{ updated_at: string }>("SELECT updated_at::text FROM budget_periods WHERE owner_user_id = $1 AND id = $2", [ownerA, periodId]);
    for (const row of ownerAPlan.rows) row.period_updated_at = refreshedPeriod.rows[0].updated_at;
    await expectConstraint(client, "23505", "INSERT INTO budget_periods (owner_user_id, ordinal, name, starts_on, ends_on, total_budget, status) VALUES ($1, 2, 'Second active', '2026-09-01', '2026-09-30', 100, 'active')", [ownerA]);

    const ownerBSetup = await setup(client, ownerB, ["Foreign"]);
    await expectConstraint(client, "23503", "INSERT INTO budget_period_categories (owner_user_id, budget_period_id, budget_category_id, allocated_amount, display_order) VALUES ($1, $2, $3, 0, 9)", [ownerA, periodId, ownerBSetup.categoryIds[0]]);

    await createBudgetSetup(database, ownerC, {
      periodName: "Identity period",
      startsOn: "2026-09-01",
      endsOn: "2026-09-30",
      totalBudget: 1_000,
      categories: [
        { name: "Food", allocatedAmount: 100 },
        { name: "Transport", allocatedAmount: 200 },
        { name: "Fun", allocatedAmount: 300 },
      ],
    });
    const identityRows = await client.query<{ name: string; allocated_amount: string }>("SELECT c.name, p.allocated_amount::text FROM budget_period_categories p JOIN budget_categories c ON c.owner_user_id = p.owner_user_id AND c.id = p.budget_category_id JOIN budget_periods period ON period.owner_user_id = p.owner_user_id AND period.id = p.budget_period_id WHERE p.owner_user_id = $1 ORDER BY c.name", [ownerC]);
    assert.deepEqual(Object.fromEntries(identityRows.rows.filter((row) => row.name !== "Uncategorized").map((row) => [row.name, Number(row.allocated_amount)])), { Food: 100, Fun: 300, Transport: 200 });

    const allocationResults = await Promise.allSettled([
      updateBudgetPlan(database, ownerA, planInput(ownerAPlan.rows, categoryA)),
      updateBudgetPlan(database, ownerA, planInput(ownerAPlan.rows, categoryB)),
    ]);
    assert.equal(allocationResults.filter((result) => result.status === "fulfilled").length, 1, "allocation race must have one winner");
    const allocationFailure = allocationResults.find((result) => result.status === "rejected");
    assert(allocationFailure?.status === "rejected");
    assert(allocationFailure.reason instanceof BudgetError);
    assert.equal(allocationFailure.reason.code, "ALLOCATION_EXCEEDS_BUDGET");
    const finalAllocation = await client.query<{ total: string }>("SELECT coalesce(sum(allocated_amount), 0)::text AS total FROM budget_period_categories WHERE owner_user_id = $1 AND budget_period_id = $2", [ownerA, periodId]);
    assert(Number(finalAllocation.rows[0].total) <= 100, "allocation aggregate exceeded the period budget");

    const foreignCategoryId = ownerBSetup.categoryIds[1];
    await expectBudgetError("NOT_FOUND", createManualBudgetTransaction(database, ownerA, { direction: "outflow", amount: 10, description: "Foreign category", occurredOn: "2026-09-03", categoryId: foreignCategoryId }));
    await expectBudgetError("NOT_FOUND", updateBudgetPlan(database, ownerA, { ...planInput(ownerAPlan.rows), categories: planInput(ownerAPlan.rows).categories.map((category, index) => index === 2 ? { ...category, id: foreignCategoryId } : category) }));
    await expectBudgetError("SYSTEM_CATEGORY_IMMUTABLE", updateBudgetPlan(database, ownerA, { ...planInput(ownerAPlan.rows), categories: planInput(ownerAPlan.rows).categories.map((category, index) => index === 0 ? { ...category, name: "Renamed" } : category) }));
    await expectBudgetError("INVALID_INPUT", updateBudgetPlan(database, ownerA, { ...planInput(ownerAPlan.rows), categories: planInput(ownerAPlan.rows).categories.map((category, index) => index === 1 ? { ...category, name: " Uncategorized " } : category) }));
    await expectBudgetError("INVALID_INPUT", createBudgetCategory(database, ownerA, " UNCATEGORIZED "));

    await expectBudgetError("ALLOCATION_EXCEEDS_BUDGET", updateActiveBudgetPeriod(database, ownerA, { name: "Smoke period", startsOn: "2026-09-01", endsOn: "2026-09-30", totalBudget: 50 }));
    const unchangedTotal = await client.query<{ total_budget: number }>("SELECT total_budget FROM budget_periods WHERE owner_user_id = $1 AND id = $2", [ownerA, periodId]);
    assert.equal(unchangedTotal.rows[0].total_budget, 100);

    const outflow = await createManualBudgetTransaction(database, ownerA, { direction: "outflow", amount: 100, description: "Smoke expense", occurredOn: "2026-09-05", categoryId: categoryA });
    const outflowShape = await client.query<{ transactions: string; impacts: string; origin: string; status: string; impact_status: string; amount: string; budget_period_id: string; target_period_ordinal: string }>("SELECT count(DISTINCT t.id)::text AS transactions, count(i.id)::text AS impacts, t.origin, t.status, i.status AS impact_status, i.amount::text, i.budget_period_id, i.target_period_ordinal::text FROM budget_transactions t JOIN budget_impacts i ON i.owner_user_id = t.owner_user_id AND i.budget_transaction_id = t.id WHERE t.owner_user_id = $1 AND t.id = $2 GROUP BY t.origin, t.status, i.status, i.amount, i.budget_period_id, i.target_period_ordinal", [ownerA, outflow.id]);
    assert.deepEqual(outflowShape.rows[0], { transactions: "1", impacts: "1", origin: "manual", status: "posted", impact_status: "applied", amount: "100", budget_period_id: periodId, target_period_ordinal: "1" });
    await expectBudgetError("CONFLICT", updateActiveBudgetPeriod(database, ownerA, { name: "Smoke period", startsOn: "2026-09-06", endsOn: "2026-09-30", totalBudget: 100 }));
    const inflow = await createManualBudgetTransaction(database, ownerA, { direction: "inflow", amount: 40, description: "Smoke credit", occurredOn: "2026-09-04", categoryId: categoryB });
    const dashboardBeforeVoid = await getBudgetDashboard(database, ownerA);
    assert(dashboardBeforeVoid.configured && dashboardBeforeVoid.period);
    assert.equal(dashboardBeforeVoid.period.netSpent, 60, "inflow must reduce net spent through applied impacts");

    const ownerBTransaction = await createManualBudgetTransaction(database, ownerB, { direction: "outflow", amount: 10, description: "Owner B expense", occurredOn: "2026-09-03", categoryId: foreignCategoryId });
    await expectBudgetError("NOT_FOUND", voidManualBudgetTransaction(database, ownerA, ownerBTransaction.id));
    await voidManualBudgetTransaction(database, ownerA, outflow.id);
    const afterVoid = await client.query<{ status: string; impact_count: string }>("SELECT t.status, (SELECT count(*)::text FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2) AS impact_count FROM budget_transactions t WHERE t.owner_user_id = $1 AND t.id = $2", [ownerA, outflow.id]);
    assert.deepEqual(afterVoid.rows[0], { status: "voided", impact_count: "1" });
    const dashboardAfterVoid = await getBudgetDashboard(database, ownerA);
    assert(dashboardAfterVoid.configured && dashboardAfterVoid.period);
    assert.equal(dashboardAfterVoid.period.netSpent, -40, "voided outflow must leave only the inflow effect");
    await expectBudgetError("NOT_FOUND", voidManualBudgetTransaction(database, ownerA, outflow.id));
    assert.equal(inflow.direction, "inflow");

    console.log(["budgeting foundation smoke passed", "SETUP RACE: one complete setup, no partial setup", "ALLOCATION RACE: production updateBudgetPlan calls concurrently, one succeeds and one rejects, final aggregate <= total", "OWNER ISOLATION: foreign category and transaction mutations rejected", "TRANSACTION LIFECYCLE: manual transaction/impact, inflow, void, and reporting effect verified"].join("\n"));
  } catch (error) {
    console.error(`budgeting foundation smoke failed: ${formatSafeError(error, password)}`);
    process.exitCode = 1;
  } finally {
    if (client) {
      await client.query("DELETE FROM users WHERE id = ANY($1::text[])", [[ownerA, ownerB, ownerC]]).catch(() => undefined);
      client.release();
    }
    await pool?.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void runBudgetingFoundationSmoke();
