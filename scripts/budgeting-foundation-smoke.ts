import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
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

export async function runBudgetingFoundationSmoke() {
  let pool: Pool | undefined;
  let client: PoolClient | undefined;
  let password = "";
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  try {
    const config = readDatabaseConfig("zplit_test");
    password = config.password;
    pool = new Pool({ ...config, max: 4 });
    client = await pool.connect();
    const tableResult = await client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])", [tables]);
    assert.equal(new Set(tableResult.rows.map((row) => row.table_name)).size, tables.length, "budget tables are missing");
    await client.query("INSERT INTO users (id, name, email, email_verified) VALUES ($1, 'Budget Smoke A', $2, true), ($3, 'Budget Smoke B', $4, true)", [ownerA, `budget-smoke-${ownerA}@example.com`, ownerB, `budget-smoke-${ownerB}@example.com`]);

    const raceClients = await Promise.all([pool.connect(), pool.connect()]);
    const setupResults = await Promise.all(raceClients.map((raceClient) => setup(raceClient, ownerA, ["A", "B"]).then(() => true).catch((error) => {
      if (postgresCode(error) !== "23505") throw new Error(`unexpected setup race error ${postgresCode(error) ?? "unknown"}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      return false;
    }).finally(() => raceClient.release())));
    assert.equal(setupResults.filter(Boolean).length, 1, "setup race must have exactly one winner");
    const profileCount = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM budget_profiles WHERE owner_user_id = $1", [ownerA]);
    assert.equal(Number(profileCount.rows[0].count), 1);
    const ownerAPlan = await client.query<{ period_id: string; category_id: string }>("SELECT budget_period_id AS period_id, budget_category_id AS category_id FROM budget_period_categories WHERE owner_user_id = $1 ORDER BY display_order", [ownerA]);
    assert.equal(ownerAPlan.rows.length, 3, "setup must be complete");
    const periodId = ownerAPlan.rows[0].period_id;
    const categoryA = ownerAPlan.rows[1].category_id;
    const categoryB = ownerAPlan.rows[2].category_id;
    await expectConstraint(client, "23505", "INSERT INTO budget_periods (owner_user_id, ordinal, name, starts_on, ends_on, total_budget, status) VALUES ($1, 2, 'Second active', '2026-09-01', '2026-09-30', 100, 'active')", [ownerA]);

    const ownerBSetup = await setup(client, ownerB, []);
    await expectConstraint(client, "23503", "INSERT INTO budget_period_categories (owner_user_id, budget_period_id, budget_category_id, allocated_amount, display_order) VALUES ($1, $2, $3, 0, 9)", [ownerA, periodId, ownerBSetup.categoryIds[0]]);

    const allocationA = await pool.connect();
    const allocationB = await pool.connect();
    try {
      await allocationA.query("BEGIN");
      await allocationA.query("SELECT owner_user_id FROM budget_profiles WHERE owner_user_id = $1 FOR UPDATE", [ownerA]);
      await allocationA.query("SELECT id FROM budget_periods WHERE owner_user_id = $1 AND status = 'active' FOR UPDATE", [ownerA]);
      await allocationA.query("UPDATE budget_period_categories SET allocated_amount = 60 WHERE owner_user_id = $1 AND budget_period_id = $2 AND budget_category_id = $3", [ownerA, periodId, categoryA]);
      await allocationB.query("BEGIN");
      const blocked = allocationB.query("SELECT owner_user_id FROM budget_profiles WHERE owner_user_id = $1 FOR UPDATE", [ownerA]);
      await allocationA.query("COMMIT");
      await blocked;
      const current = await allocationB.query<{ total: string }>("SELECT coalesce(sum(allocated_amount), 0)::text AS total FROM budget_period_categories WHERE owner_user_id = $1 AND budget_period_id = $2", [ownerA, periodId]);
      assert(Number(current.rows[0].total) + 60 > 100, "the second allocation must see the committed first allocation and reject");
      await allocationB.query("ROLLBACK");
    } finally {
      allocationA.release();
      allocationB.release();
    }
    const finalAllocation = await client.query<{ total: string }>("SELECT coalesce(sum(allocated_amount), 0)::text AS total FROM budget_period_categories WHERE owner_user_id = $1 AND budget_period_id = $2", [ownerA, periodId]);
    assert(Number(finalAllocation.rows[0].total) <= 100, "allocation aggregate exceeded the period budget");

    const transaction = await client.query<{ id: string }>("INSERT INTO budget_transactions (owner_user_id, direction, amount, description, occurred_on, status, origin) VALUES ($1, 'outflow', 60, 'Smoke expense', '2026-09-03', 'posted', 'manual') RETURNING id", [ownerA]);
    const transactionId = transaction.rows[0].id;
    await client.query("INSERT INTO budget_impacts (owner_user_id, budget_transaction_id, budget_category_id, budget_period_id, amount, status, target_period_ordinal) VALUES ($1, $2, $3, $4, 60, 'applied', 1)", [ownerA, transactionId, categoryA, periodId]);
    await client.query("INSERT INTO budget_transactions (owner_user_id, direction, amount, description, occurred_on, status, origin) VALUES ($1, 'inflow', 20, 'Smoke credit', '2026-09-04', 'posted', 'manual') RETURNING id", [ownerA]);
    const credit = await client.query<{ id: string }>("SELECT id FROM budget_transactions WHERE owner_user_id = $1 AND direction = 'inflow'", [ownerA]);
    await client.query("INSERT INTO budget_impacts (owner_user_id, budget_transaction_id, budget_category_id, budget_period_id, amount, status, target_period_ordinal) VALUES ($1, $2, $3, $4, 20, 'applied', 1)", [ownerA, credit.rows[0].id, categoryB, periodId]);
    const net = await client.query<{ net: string }>("SELECT (sum(CASE WHEN t.direction = 'outflow' THEN i.amount ELSE 0 END) - sum(CASE WHEN t.direction = 'inflow' THEN i.amount ELSE 0 END))::text AS net FROM budget_impacts i JOIN budget_transactions t ON t.owner_user_id = i.owner_user_id AND t.id = i.budget_transaction_id WHERE i.owner_user_id = $1 AND i.budget_period_id = $2 AND i.status = 'applied' AND t.status = 'posted'", [ownerA, periodId]);
    assert.equal(Number(net.rows[0].net), 40, "inflow must reduce net spent");
    await client.query("UPDATE budget_transactions SET status = 'voided', voided_at = now() WHERE owner_user_id = $1 AND id = $2", [ownerA, transactionId]);
    const afterVoid = await client.query<{ net: string; impacts: string }>("SELECT coalesce(sum(CASE WHEN t.direction = 'outflow' THEN i.amount ELSE -i.amount END), 0)::text AS net, (SELECT count(*)::text FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2) AS impacts FROM budget_impacts i JOIN budget_transactions t ON t.owner_user_id = i.owner_user_id AND t.id = i.budget_transaction_id WHERE i.owner_user_id = $1 AND i.budget_period_id = $3 AND i.status = 'applied' AND t.status = 'posted'", [ownerA, transactionId, periodId]);
    assert.equal(Number(afterVoid.rows[0].net), -20, "voided outflow must leave only the inflow effect");
    assert.equal(Number(afterVoid.rows[0].impacts), 1, "voiding must retain impacts");
    const ownerBVisible = await client.query("SELECT 1 FROM budget_transactions WHERE owner_user_id = $1 AND id = $2", [ownerB, transactionId]);
    assert.equal(ownerBVisible.rowCount, 0, "owner data must remain isolated");
    console.log("budgeting foundation smoke passed: setup race, active-period uniqueness, owner FKs, allocation race, reporting, voiding, and isolation");
  } catch (error) {
    console.error(`budgeting foundation smoke failed: ${formatSafeError(error, password)}`);
    process.exitCode = 1;
  } finally {
    if (client) {
      await client.query("DELETE FROM users WHERE id = ANY($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
      client.release();
    }
    await pool?.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void runBudgetingFoundationSmoke();
