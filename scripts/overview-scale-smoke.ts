import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { createDatabasePool, readRuntimeDatabaseConfig } from "../src/db/client";
import * as schema from "../src/db/schema";
import { buildLedgerSummary } from "../src/domain/ledger-summary";
import { createLedgerRepository } from "../src/domain/ledger-repository";
import { SCALE_FIXTURE_CONFIRMATION, SCALE_FIXTURE_DATABASE, generateScaleFixture } from "./scale-fixture-data";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function measure(label: string, operation: () => Promise<unknown>) {
  await operation();
  const durations = [] as number[];
  for (let index = 0; index < 7; index += 1) {
    const started = performance.now();
    await operation();
    durations.push(performance.now() - started);
  }
  const result = median(durations);
  console.log(`${label} warm median: ${result.toFixed(1)} ms`);
  assert(result <= 500, `${label} warm median exceeded 500 ms`);
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
    const ownerUserId = await resolveOwner(client, ownerEmail);
    const fixture = generateScaleFixture(ownerUserId);
    const expected = buildLedgerSummary({
      friends: fixture.friends,
      expenses: fixture.expenses,
      expenseShares: fixture.expenseShares,
      repayments: fixture.repayments,
      repaymentAllocations: fixture.repaymentAllocations,
    });
    const repository = createLedgerRepository(drizzle(client, { schema }), ownerUserId);
    const overview = await repository.getLedgerOverviewSummary();
    const activity = await repository.listRecentActivity({ limit: 6 });

    assert(overview.friendBalances.length <= 8, "overview returned more than eight friend balances");
    for (const field of [
      "totalExpenseAmount",
      "totalAssignedAmount",
      "totalRepaidAmount",
      "totalReceivedAmount",
      "totalUnallocatedRepaymentAmount",
      "totalOutstandingAmount",
      "ownerPortionAmount",
    ] as const) assert(overview[field] === expected[field], `${field} does not match the deterministic fixture`);
    assert(overview.totalAssignedFriendCount === expected.friendBalances.length, "assigned friend count does not match the deterministic fixture");
    assert(activity.length <= 6, "recent activity returned more than six records");

    await measure("overview summary", () => repository.getLedgerOverviewSummary());
    await measure("recent activity", () => repository.listRecentActivity({ limit: 6 }));
    console.log("overview scale smoke passed: read-only totals, bounded balances, activity, and warm query medians verified");
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
    console.error(error instanceof Error ? error.message : "overview scale smoke failed");
    process.exitCode = 1;
  });
}
