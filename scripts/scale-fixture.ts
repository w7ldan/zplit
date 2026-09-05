import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { createDatabasePool, readRuntimeDatabaseConfig } from "../src/db/client";
import * as schema from "../src/db/schema";
import { getPersonalLedgerScopeId } from "../src/server/ledger-scopes";
import { readSecretFile } from "../src/server/secret-file";
import {
  generateScaleFixture,
  SCALE_FIXTURE_CONFIRMATION,
  SCALE_FIXTURE_COUNTS,
  SCALE_FIXTURE_DATABASE,
  SCALE_FIXTURE_SCENARIO_IDS,
  type ScaleFixtureData,
} from "./scale-fixture-data";

const scaleFixtureLockKey = 20603020;
const batchSize = 250;

export type ScaleCommand = "seed" | "verify" | "clear";

export type ScaleEnvironment = {
  DB_NAME?: string;
  ZPLIT_SCALE_TEST_CONFIRM?: string;
  SCALE_TEST_OWNER_EMAIL?: string;
  [name: string]: string | undefined;
};

export type ScaleFixtureDependencies = {
  readDatabaseConfig?: typeof readRuntimeDatabaseConfig;
  createPool?: typeof createDatabasePool;
};

function requiredEnvironment(environment: ScaleEnvironment, name: "SCALE_TEST_OWNER_EMAIL") {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value.toLowerCase();
}

export function parseScaleCommand(value = process.argv[2]): ScaleCommand {
  if (value === "seed" || value === "verify" || value === "clear") return value;
  throw new Error("usage: tsx scripts/scale-fixture.ts <seed|verify|clear>");
}

export function validateScaleCommandEnvironment(command: ScaleCommand, environment: ScaleEnvironment = process.env) {
  if (environment.DB_NAME?.trim() !== SCALE_FIXTURE_DATABASE) {
    throw new Error(`DB_NAME must be ${SCALE_FIXTURE_DATABASE}`);
  }
  if (command !== "verify" && environment.ZPLIT_SCALE_TEST_CONFIRM?.trim() !== SCALE_FIXTURE_CONFIRMATION) {
    throw new Error(`ZPLIT_SCALE_TEST_CONFIRM must be ${SCALE_FIXTURE_CONFIRMATION}`);
  }
  return { ownerEmail: requiredEnvironment(environment, "SCALE_TEST_OWNER_EMAIL") };
}

function count(value: string | number) {
  const result = Number(value);
  assert(Number.isSafeInteger(result), "database returned an invalid count");
  return result;
}

async function insertBatches(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: readonly (readonly unknown[])[],
) {
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values: unknown[] = [];
    const placeholders = batch.map((row, rowIndex) => {
      assert(row.length === columns.length, `${table} row has the wrong number of columns`);
      return `(${row.map((_value, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(", ")})`;
    });
    for (const row of batch) values.push(...row);
    await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders.join(", ")}`,
      values,
    );
  }
}

function fixtureIds(fixture: ScaleFixtureData) {
  return {
    friendIds: fixture.friends.map((row) => row.id),
    outingIds: fixture.outings.map((row) => row.id),
    expenseIds: fixture.expenses.map((row) => row.id),
    shareIds: fixture.expenseShares.map((row) => row.id),
    repaymentIds: fixture.repayments.map((row) => row.id),
    receiptIds: fixture.receipts.map((row) => row.id),
  };
}

async function deleteFixture(client: PoolClient, fixture: ScaleFixtureData, ledgerScopeId: string) {
  const ids = fixtureIds(fixture);
  await client.query(
    "DELETE FROM repayment_allocations WHERE ledger_scope_id = $1 AND repayment_id = ANY($2::uuid[]) AND expense_share_id = ANY($3::uuid[])",
    [ledgerScopeId, ids.repaymentIds, ids.shareIds],
  );
  await client.query("DELETE FROM expense_receipts WHERE ledger_scope_id = $1 AND id = ANY($2::uuid[])", [ledgerScopeId, ids.receiptIds]);
  await client.query("DELETE FROM expense_shares WHERE ledger_scope_id = $1 AND id = ANY($2::uuid[])", [ledgerScopeId, ids.shareIds]);
  await client.query("DELETE FROM repayments WHERE ledger_scope_id = $1 AND id = ANY($2::uuid[])", [ledgerScopeId, ids.repaymentIds]);
  await client.query("DELETE FROM expenses WHERE ledger_scope_id = $1 AND id = ANY($2::uuid[])", [ledgerScopeId, ids.expenseIds]);
  await client.query("DELETE FROM outings WHERE ledger_scope_id = $1 AND id = ANY($2::uuid[])", [ledgerScopeId, ids.outingIds]);
  await client.query("DELETE FROM friends WHERE ledger_scope_id = $1 AND id = ANY($2::uuid[])", [ledgerScopeId, ids.friendIds]);
}

async function seedFixture(client: PoolClient, fixture: ScaleFixtureData, ledgerScopeId: string) {
  await deleteFixture(client, fixture, ledgerScopeId);
  await insertBatches(client, '"friends"', ["id", "ledger_scope_id", "name", "phone_number", "notes", "archived_at", "created_at", "updated_at"], fixture.friends.map((row) => [row.id, ledgerScopeId, row.name, row.phoneNumber, row.notes, row.archivedAt, row.createdAt, row.updatedAt]));
  await insertBatches(client, '"outings"', ["id", "ledger_scope_id", "title", "occurred_at", "notes", "created_at", "updated_at"], fixture.outings.map((row) => [row.id, ledgerScopeId, row.title, row.occurredAt, row.notes, row.createdAt, row.updatedAt]));
  await insertBatches(client, '"expenses"', ["id", "ledger_scope_id", "outing_id", "description", "amount", "created_at", "updated_at"], fixture.expenses.map((row) => [row.id, ledgerScopeId, row.outingId, row.description, row.amount, row.createdAt, row.updatedAt]));
  await insertBatches(client, '"expense_shares"', ["id", "ledger_scope_id", "expense_id", "friend_id", "base_amount", "amount_owed", "created_at"], fixture.expenseShares.map((row) => [row.id, ledgerScopeId, row.expenseId, row.friendId, row.amountOwed, row.amountOwed, row.createdAt]));
  await insertBatches(client, '"repayments"', ["id", "ledger_scope_id", "friend_id", "amount", "paid_at", "payment_method", "notes", "created_at"], fixture.repayments.map((row) => [row.id, ledgerScopeId, row.friendId, row.amount, row.paidAt, row.paymentMethod, row.notes, row.createdAt]));
  await insertBatches(client, '"repayment_allocations"', ["ledger_scope_id", "repayment_id", "expense_share_id", "amount", "created_at"], fixture.repaymentAllocations.map((row) => [ledgerScopeId, row.repaymentId, row.expenseShareId, row.amount, row.createdAt]));
  await insertBatches(client, '"expense_receipts"', ["id", "ledger_scope_id", "expense_id", "original_filename", "media_type", "byte_size", "sha256", "content", "created_at"], fixture.receipts.map((row) => [row.id, ledgerScopeId, row.expenseId, row.originalFilename, row.mediaType, row.byteSize, row.sha256, row.content, row.createdAt]));
}

async function resolveOwner(client: PoolClient, email: string) {
  const result = await client.query<{ id: string; email: string }>("SELECT id, email FROM users WHERE lower(email) = lower($1)", [email]);
  assert(result.rows.length === 1, "SCALE_TEST_OWNER_EMAIL must resolve exactly one existing test user");
  return result.rows[0]!;
}

async function verifyCounts(client: PoolClient, fixture: ScaleFixtureData, ledgerScopeId: string) {
  const ids = fixtureIds(fixture);
  const tables = [
    ["friends", "id", ids.friendIds, fixture.friends.length],
    ["outings", "id", ids.outingIds, fixture.outings.length],
    ["expenses", "id", ids.expenseIds, fixture.expenses.length],
    ["expense_shares", "id", ids.shareIds, fixture.expenseShares.length],
    ["repayments", "id", ids.repaymentIds, fixture.repayments.length],
    ["expense_receipts", "id", ids.receiptIds, fixture.receipts.length],
  ] as const;
  for (const [table, column, tableIds, expected] of tables) {
    const result = await client.query<{ total: string; owned: string }>(
      `SELECT count(*)::text AS total, count(*) FILTER (WHERE ledger_scope_id = $1)::text AS owned FROM "${table}" WHERE "${column}" = ANY($2::uuid[])`,
      [ledgerScopeId, tableIds],
    );
    const row = result.rows[0]!;
    assert(count(row.total) === expected && count(row.owned) === expected, `${table} fixture count or ownership mismatch`);
  }
  const allocationResult = await client.query<{ total: string; owned: string }>(
    "SELECT count(*)::text AS total, count(*) FILTER (WHERE ledger_scope_id = $1)::text AS owned FROM repayment_allocations WHERE repayment_id = ANY($2::uuid[]) AND expense_share_id = ANY($3::uuid[])",
    [ledgerScopeId, ids.repaymentIds, ids.shareIds],
  );
  assert(count(allocationResult.rows[0]!.total) === fixture.repaymentAllocations.length && count(allocationResult.rows[0]!.owned) === fixture.repaymentAllocations.length, "repayment allocation fixture count or ownership mismatch");
}

async function verifyRelationships(client: PoolClient, fixture: ScaleFixtureData, ledgerScopeId: string) {
  const ids = fixtureIds(fixture);
  const result = await client.query<Record<string, string>>(
    `SELECT
      (SELECT count(*) FROM expenses e WHERE e.ledger_scope_id = $1 AND e.id = ANY($2::uuid[]) AND NOT EXISTS (SELECT 1 FROM outings o WHERE o.ledger_scope_id = e.ledger_scope_id AND o.id = e.outing_id AND o.id = ANY($6::uuid[]))) AS expense_outing,
      (SELECT count(*) FROM expense_shares s WHERE s.ledger_scope_id = $1 AND s.id = ANY($3::uuid[]) AND (NOT EXISTS (SELECT 1 FROM expenses e WHERE e.ledger_scope_id = s.ledger_scope_id AND e.id = s.expense_id AND e.id = ANY($2::uuid[])) OR NOT EXISTS (SELECT 1 FROM friends f WHERE f.ledger_scope_id = s.ledger_scope_id AND f.id = s.friend_id AND f.id = ANY($7::uuid[])))) AS share_parent,
      (SELECT count(*) FROM repayments r WHERE r.ledger_scope_id = $1 AND r.id = ANY($4::uuid[]) AND NOT EXISTS (SELECT 1 FROM friends f WHERE f.ledger_scope_id = r.ledger_scope_id AND f.id = r.friend_id AND f.id = ANY($7::uuid[]))) AS repayment_friend,
      (SELECT count(*) FROM expense_receipts r WHERE r.ledger_scope_id = $1 AND r.id = ANY($5::uuid[]) AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.ledger_scope_id = r.ledger_scope_id AND e.id = r.expense_id AND e.id = ANY($2::uuid[]))) AS receipt_expense,
      (SELECT count(*) FROM repayment_allocations a WHERE a.ledger_scope_id = $1 AND a.repayment_id = ANY($4::uuid[]) AND a.expense_share_id = ANY($3::uuid[]) AND (NOT EXISTS (SELECT 1 FROM repayments r WHERE r.ledger_scope_id = a.ledger_scope_id AND r.id = a.repayment_id AND r.id = ANY($4::uuid[])) OR NOT EXISTS (SELECT 1 FROM expense_shares s WHERE s.ledger_scope_id = a.ledger_scope_id AND s.id = a.expense_share_id AND s.id = ANY($3::uuid[])))) AS allocation_parent,
      (SELECT count(*) FROM repayment_allocations a JOIN repayments r ON r.ledger_scope_id = a.ledger_scope_id AND r.id = a.repayment_id JOIN expense_shares s ON s.ledger_scope_id = a.ledger_scope_id AND s.id = a.expense_share_id WHERE a.ledger_scope_id = $1 AND a.repayment_id = ANY($4::uuid[]) AND a.expense_share_id = ANY($3::uuid[]) AND r.friend_id <> s.friend_id) AS cross_friend`,
    [ledgerScopeId, ids.expenseIds, ids.shareIds, ids.repaymentIds, ids.receiptIds, ids.outingIds, ids.friendIds],
  );
  for (const [name, value] of Object.entries(result.rows[0]!)) assert(count(value) === 0, `${name} relationship violations found`);
}

async function verifyFinancialInvariants(client: PoolClient, fixture: ScaleFixtureData, ledgerScopeId: string) {
  const ids = fixtureIds(fixture);
  const result = await client.query<Record<string, string>>(
    `SELECT
      (SELECT count(*) FROM (SELECT s.expense_id FROM expense_shares s JOIN expenses e ON e.ledger_scope_id = s.ledger_scope_id AND e.id = s.expense_id WHERE s.ledger_scope_id = $1 AND s.id = ANY($2::uuid[]) GROUP BY s.expense_id, e.amount HAVING sum(s.amount_owed) > e.amount) invalid) AS shares_over_expense,
      (SELECT count(*) FROM (SELECT a.repayment_id FROM repayment_allocations a JOIN repayments r ON r.ledger_scope_id = a.ledger_scope_id AND r.id = a.repayment_id WHERE a.ledger_scope_id = $1 AND a.repayment_id = ANY($3::uuid[]) AND a.expense_share_id = ANY($2::uuid[]) GROUP BY a.repayment_id, r.amount HAVING sum(a.amount) > r.amount) invalid) AS allocations_over_repayment,
      (SELECT count(*) FROM (SELECT a.expense_share_id FROM repayment_allocations a JOIN expense_shares s ON s.ledger_scope_id = a.ledger_scope_id AND s.id = a.expense_share_id WHERE a.ledger_scope_id = $1 AND a.repayment_id = ANY($3::uuid[]) AND a.expense_share_id = ANY($2::uuid[]) GROUP BY a.expense_share_id, s.amount_owed HAVING sum(a.amount) > s.amount_owed) invalid) AS allocations_over_share`,
    [ledgerScopeId, ids.shareIds, ids.repaymentIds],
  );
  for (const [name, value] of Object.entries(result.rows[0]!)) assert(count(value) === 0, `${name} financial invariant violations found`);
}

async function verifyScenarios(client: PoolClient, fixture: ScaleFixtureData, ledgerScopeId: string) {
  const ids = fixtureIds(fixture);
  const scenario = SCALE_FIXTURE_SCENARIO_IDS;
  const result = await client.query<Record<string, string>>(
    `WITH share_totals AS (
      SELECT s.expense_id, sum(s.amount_owed)::bigint AS amount, count(DISTINCT s.friend_id)::int AS friends
      FROM expense_shares s WHERE s.ledger_scope_id = $1 AND s.expense_id = ANY($2::uuid[]) GROUP BY s.expense_id
    ), allocation_totals AS (
      SELECT s.expense_id, sum(a.amount)::bigint AS amount
      FROM expense_shares s JOIN repayment_allocations a ON a.ledger_scope_id = s.ledger_scope_id AND a.expense_share_id = s.id
      WHERE s.ledger_scope_id = $1 AND s.expense_id = ANY($2::uuid[]) GROUP BY s.expense_id
    ), repayment_totals AS (
      SELECT r.id, r.amount, coalesce(sum(a.amount), 0)::bigint AS allocated
      FROM repayments r LEFT JOIN repayment_allocations a ON a.ledger_scope_id = r.ledger_scope_id AND a.repayment_id = r.id
      WHERE r.ledger_scope_id = $1 AND r.id = ANY($3::uuid[]) GROUP BY r.id, r.amount
    )
    SELECT
      (SELECT count(*) FROM expenses e WHERE e.ledger_scope_id = $1 AND e.id = $4::uuid AND NOT EXISTS (SELECT 1 FROM expense_shares s WHERE s.ledger_scope_id = e.ledger_scope_id AND s.expense_id = e.id)) AS no_shares,
      (SELECT count(*) FROM share_totals s JOIN allocation_totals a USING (expense_id) WHERE s.expense_id = $5::uuid AND s.amount = a.amount AND s.amount > 0) AS fully_paid,
      (SELECT count(*) FROM share_totals s JOIN allocation_totals a USING (expense_id) WHERE s.expense_id = $6::uuid AND a.amount > 0 AND a.amount < s.amount) AS partially_paid,
      (SELECT count(*) FROM share_totals s WHERE s.expense_id = $7::uuid AND NOT EXISTS (SELECT 1 FROM allocation_totals a WHERE a.expense_id = s.expense_id)) AS unpaid,
      (SELECT count(*) FROM repayment_totals WHERE id = $8::uuid AND allocated > 0 AND amount > allocated) AS overpaid,
      (SELECT count(*) FROM repayment_totals WHERE id = $9::uuid AND allocated = 0) AS unallocated,
      (SELECT count(*) FROM share_totals WHERE expense_id = $10::uuid AND friends >= 2) AS several_friends,
      (SELECT count(*) FROM friends f WHERE f.ledger_scope_id = $1 AND f.id = $11::uuid AND char_length(f.name) >= 120) AS long_friend,
      (SELECT count(*) FROM outings o WHERE o.ledger_scope_id = $1 AND o.id = $12::uuid AND char_length(o.title) >= 160 AND o.occurred_at = $13::timestamptz) AS long_outing_boundary,
      (SELECT count(*) FROM expenses e WHERE e.ledger_scope_id = $1 AND e.id = $14::uuid AND char_length(e.description) >= 200) AS long_expense`,
    [
      ledgerScopeId,
      ids.expenseIds,
      ids.repaymentIds,
      scenario.noSharesExpenseId,
      scenario.fullyPaidExpenseId,
      scenario.partiallyPaidExpenseId,
      scenario.unpaidExpenseId,
      scenario.overpaidRepaymentId,
      scenario.unallocatedRepaymentId,
      scenario.severalFriendsExpenseId,
      fixture.friends[0]!.id,
      fixture.outings[0]!.id,
      fixture.outings[0]!.occurredAt,
      fixture.expenses[0]!.id,
    ],
  );
  for (const [name, value] of Object.entries(result.rows[0]!)) assert(count(value) === 1, `${name} scenario is missing`);
}

async function verifyFixture(client: PoolClient, fixture: ScaleFixtureData, ledgerScopeId: string) {
  await verifyCounts(client, fixture, ledgerScopeId);
  await verifyRelationships(client, fixture, ledgerScopeId);
  await verifyFinancialInvariants(client, fixture, ledgerScopeId);
  await verifyScenarios(client, fixture, ledgerScopeId);
}

export async function runScaleCommand(
  command: ScaleCommand,
  environment: ScaleEnvironment = process.env,
  dependencies: ScaleFixtureDependencies = {},
) {
  const { ownerEmail } = validateScaleCommandEnvironment(command, environment);
  const config = (dependencies.readDatabaseConfig ?? readRuntimeDatabaseConfig)();
  const pool = (dependencies.createPool ?? createDatabasePool)(config);
  let client: PoolClient | undefined;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    if (command === "verify") await client.query("SET TRANSACTION READ ONLY");
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [scaleFixtureLockKey]);
    const user = await resolveOwner(client, ownerEmail);
    const ledgerScopeId = await getPersonalLedgerScopeId(drizzle(client, { schema }), user.id);
    const fixture = generateScaleFixture(user.id);
    if (command === "seed") await seedFixture(client, fixture, ledgerScopeId);
    if (command === "clear") await deleteFixture(client, fixture, ledgerScopeId);
    if (command === "verify") await verifyFixture(client, fixture, ledgerScopeId);
    await client.query("COMMIT");
    transactionStarted = false;
    return { command, ownerEmail: user.email, counts: SCALE_FIXTURE_COUNTS };
  } catch (error) {
    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original failure.
      }
    }
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

export function redactScaleError(error: unknown, secrets: string[]) {
  let message = error instanceof Error ? error.message : "unknown error";
  for (const secret of secrets) if (secret) message = message.replaceAll(secret, "[redacted]");
  return message.replace(/\s+/g, " ").slice(0, 240);
}

async function main() {
  const command = parseScaleCommand();
  const result = await runScaleCommand(command);
  console.log(`scale fixture ${result.command} succeeded for ${result.ownerEmail}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    const secrets = process.env.DB_PASSWORD_FILE ? (() => {
      try {
        return [readSecretFile(process.env.DB_PASSWORD_FILE!, "DB_PASSWORD_FILE")];
      } catch {
        return [];
      }
    })() : [];
    console.error(`scale fixture failed: ${redactScaleError(error, secrets)}`);
    process.exitCode = 1;
  });
}
