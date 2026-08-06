import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { createDatabasePool, readRuntimeDatabaseConfig } from "../src/db/client";
import * as schema from "../src/db/schema";
import { createLedgerRepository } from "../src/domain/ledger-repository";
import { RECORD_PAGE_SIZE } from "../src/domain/record-retrieval";
import { SCALE_FIXTURE_CONFIRMATION, SCALE_FIXTURE_COUNTS, SCALE_FIXTURE_DATABASE, generateScaleFixture } from "./scale-fixture-data";

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
  const durations: number[] = [];
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

async function checkListing(
  label: string,
  expectedTotal: number,
  load: (page: number) => Promise<{ items: Array<{ id: string }>; pageSize: number; totalItems: number; totalPages: number }>,
) {
  const first = await load(1);
  assert(first.pageSize === RECORD_PAGE_SIZE, `${label} page size is not ${RECORD_PAGE_SIZE}`);
  assert(first.items.length <= RECORD_PAGE_SIZE, `${label} first page exceeds ${RECORD_PAGE_SIZE} rows`);
  assert(first.totalItems === expectedTotal, `${label} total count does not match the scale fixture`);

  if (expectedTotal > RECORD_PAGE_SIZE) {
    const second = await load(2);
    assert(second.items.length <= RECORD_PAGE_SIZE, `${label} second page exceeds ${RECORD_PAGE_SIZE} rows`);
    const firstIds = new Set(first.items.map((item) => item.id));
    assert(second.items.every((item) => !firstIds.has(item.id)), `${label} adjacent pages contain duplicate records`);
    assert(second.totalItems === expectedTotal, `${label} second-page total count does not match the scale fixture`);
  }
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
    const repository = createLedgerRepository(drizzle(client, { schema }), ownerUserId);

    await checkListing("Friends", fixture.friends.filter((friend) => friend.archivedAt === null).length, (page) => repository.listFriendRecords({ page }));
    await checkListing("Archived friends", fixture.friends.filter((friend) => friend.archivedAt !== null).length, (page) => repository.listFriendRecords({ archived: true, page }));
    await checkListing("Outings", fixture.outings.length, (page) => repository.listOutingRecords({ page }));
    await checkListing("Expenses", fixture.expenses.length, (page) => repository.listExpenseRecords({ page }));
    await checkListing("Repayments", fixture.repayments.length, (page) => repository.listRepaymentRecords({ page }));

    assert(fixture.friends.length === SCALE_FIXTURE_COUNTS.friends, "friend fixture count changed");
    assert(fixture.outings.length === SCALE_FIXTURE_COUNTS.outings, "outing fixture count changed");
    assert(fixture.expenses.length === SCALE_FIXTURE_COUNTS.expenses, "expense fixture count changed");
    assert(fixture.repayments.length === SCALE_FIXTURE_COUNTS.repayments, "repayment fixture count changed");

    await measure("Friends", () => repository.listFriendRecords({ page: 1 }));
    await measure("Outings", () => repository.listOutingRecords({ page: 1 }));
    await measure("Expenses", () => repository.listExpenseRecords({ page: 1 }));
    await measure("Repayments", () => repository.listRepaymentRecords({ page: 1 }));
    console.log("record-page scale smoke passed: bounded pages, distinct adjacent records, fixture totals, and warm medians verified");
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
    console.error(error instanceof Error ? error.message : "record-page scale smoke failed");
    process.exitCode = 1;
  });
}
