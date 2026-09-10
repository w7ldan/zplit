import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { createDatabasePool, readRuntimeDatabaseConfig } from "../src/db/client";
import * as schema from "../src/db/schema";
import { getPersonalLedgerScopeId } from "../src/server/ledger-scopes";
import { SCALE_FIXTURE_CONFIRMATION, SCALE_FIXTURE_DATABASE } from "./scale-fixture-data";

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
if (!require.cache[serverOnlyPath]) require.cache[serverOnlyPath] = { exports: {} } as never;
const { getBudgetDashboard, getBudgetOverviewSnapshot, listBudgetPeriodHistory } = await import("../src/server/budgeting/reporting");
const { listBudgetTransactions } = await import("../src/server/budgeting/transactions");
const { getBudgetRecurringDashboardSummary, listBudgetRecurringTemplates, listDueBudgetRecurringOccurrences } = await import("../src/server/budgeting/recurring");

const BUDGETS = {
  dashboard: 1000,
  snapshot: 300,
  history: 500,
  transactions: 500,
  recurring: 500,
} as const;

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function measure(label: string, budget: number, operation: () => Promise<unknown>) {
  await operation();
  const durations: number[] = [];
  for (let index = 0; index < 7; index += 1) {
    const started = performance.now();
    await operation();
    durations.push(performance.now() - started);
  }
  const result = median(durations);
  console.log(`${label} warm median: ${result.toFixed(1)} ms (budget ${budget} ms)`);
  assert(result <= budget, `${label} warm median exceeded ${budget} ms`);
}

async function resolveOwner(client: PoolClient, email: string) {
  const result = await client.query<{ id: string }>("SELECT id FROM users WHERE lower(email) = lower($1)", [email]);
  assert(result.rows.length === 1, "SCALE_TEST_OWNER_EMAIL must resolve exactly one existing test user");
  return result.rows[0]!.id;
}

async function run() {
  assert(process.env.DB_NAME?.trim() === SCALE_FIXTURE_DATABASE, `DB_NAME must be ${SCALE_FIXTURE_DATABASE}`);
  assert(process.env.ZPLIT_SCALE_TEST_CONFIRM?.trim() === SCALE_FIXTURE_CONFIRMATION, `ZPLIT_SCALE_TEST_CONFIRM must be ${SCALE_FIXTURE_CONFIRMATION}`);
  const ownerEmail = required("SCALE_TEST_OWNER_EMAIL");
  const pool = createDatabasePool(readRuntimeDatabaseConfig());
  let client: PoolClient | undefined;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    transactionStarted = true;
    const userId = await resolveOwner(client, ownerEmail);
    const database = drizzle(client, { schema });
    await getPersonalLedgerScopeId(database, userId);

    const dashboard = await getBudgetDashboard(database, userId);
    assert(dashboard.configured === true && dashboard.period !== null, "scale owner has no active budget period");
    assert(dashboard.period.name === "September Budget", "active budget period is not the fixture anchor");
    assert(dashboard.period.categories.length >= 8, "active budget has too few categories");
    assert(dashboard.period.totalAllocated > 0, "active budget has no allocations");
    assert(dashboard.period.unallocatedBudget > 0, "active budget has no unallocated amount");
    assert(dashboard.period.categories.some((category) => category.netSpent > category.allocatedAmount), "no overspent category in the active budget");

    const snapshot = await getBudgetOverviewSnapshot(database, userId);
    assert(snapshot.configured === true, "budget overview snapshot is not configured");

    const history = await listBudgetPeriodHistory(database, userId);
    assert(history.length >= 15, "budget period history does not contain the fixture periods");

    const transactions = await listBudgetTransactions(database, userId);
    assert(transactions.length > 0 && transactions.length <= 100, "budget transaction history is not bounded");

    const recurringSummary = await getBudgetRecurringDashboardSummary(database, userId);
    assert(recurringSummary.dueCount > 0, "no due recurring occurrences");
    const templates = await listBudgetRecurringTemplates(database, userId);
    assert(templates.length >= 50 && templates.length <= 200, "active recurring template count is outside the expected range");
    const due = await listDueBudgetRecurringOccurrences(database, userId);
    assert(due.length > 0 && due.length <= 100, "due recurring occurrences are not bounded");

    await measure("Budget dashboard", BUDGETS.dashboard, () => getBudgetDashboard(database, userId));
    await measure("Budget overview snapshot", BUDGETS.snapshot, () => getBudgetOverviewSnapshot(database, userId));
    await measure("Budget period history", BUDGETS.history, () => listBudgetPeriodHistory(database, userId));
    await measure("Budget transactions", BUDGETS.transactions, () => listBudgetTransactions(database, userId));
    await measure("Budget recurring", BUDGETS.recurring, () => getBudgetRecurringDashboardSummary(database, userId));
    console.log("budget scale smoke passed: dashboard authority, history, recurrence, and warm medians verified");
    await client.query("ROLLBACK");
    transactionStarted = false;
  } finally {
    if (client && transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
    client?.release();
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void run().catch((error) => {
    console.error(error instanceof Error ? error.message : "budget scale smoke failed");
    process.exitCode = 1;
  });
}
