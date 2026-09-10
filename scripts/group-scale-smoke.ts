import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { createDatabasePool, readRuntimeDatabaseConfig } from "../src/db/client";
import * as schema from "../src/db/schema";
import { RECORD_PAGE_SIZE } from "../src/domain/record-retrieval";
import { getPersonalLedgerScopeId } from "../src/server/ledger-scopes";
import { SCALE_FIXTURE_CONFIRMATION, SCALE_FIXTURE_DATABASE } from "./scale-fixture-data";

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
if (!require.cache[serverOnlyPath]) require.cache[serverOnlyPath] = { exports: {} } as never;
const { getGroupForMember, listGroupParticipants, listGroups } = await import("../src/server/groups");
const { createGroupAccountingRepository } = await import("../src/server/group-accounting");
const { listGroupSettlements } = await import("../src/server/group-settlements");

const BUDGETS = {
  list: 800,
  detail: 500,
  participants: 500,
  expenses: 800,
  balances: 800,
  settlements: 500,
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

    const summaries = await listGroups(database, userId);
    assert(summaries.length >= 20, "group list does not contain the scale fixture groups");
    const dense = summaries.find((group) => group.name === "Japan Trip 2026");
    assert(dense, "dense Japan Trip 2026 group is missing");
    const repository = createGroupAccountingRepository(database, dense.id);

    const detail = await getGroupForMember(database, dense.id, userId);
    assert(detail.participantCount >= 30, "dense group participant count does not match the fixture");
    const participants = await listGroupParticipants(database, dense.id, userId);
    assert(participants.length === detail.participantCount, "participant listing is not complete");
    assert(participants.some((participant) => participant.userId === null), "external participants are missing");

    const first = await repository.listExpenses(userId, 1);
    assert(first.pageSize === RECORD_PAGE_SIZE, "group expense page size changed");
    assert(first.items.length <= RECORD_PAGE_SIZE, "group expense page is not bounded");
    assert(first.totalItems >= 300, "dense group expense total does not match the fixture");
    const second = await repository.listExpenses(userId, 2);
    const firstIds = new Set(first.items.map((item) => item.id));
    assert(second.items.every((item) => !firstIds.has(item.id)), "adjacent group expense pages overlap");

    const balances = await repository.getBalances(userId);
    assert(Array.isArray(balances), "group balances did not return a collection");
    assert(balances.every((balance) => balance.amount > 0), "group balance contains a non-positive amount");

    const settlements = await listGroupSettlements(database, dense.id, userId, 1);
    assert(settlements.items.length <= RECORD_PAGE_SIZE, "settlement page is not bounded");
    assert(settlements.totalItems > 0, "dense group has no settlements");

    await measure("Group list", BUDGETS.list, () => listGroups(database, userId));
    await measure("Group detail", BUDGETS.detail, () => getGroupForMember(database, dense.id, userId));
    await measure("Group participants", BUDGETS.participants, () => listGroupParticipants(database, dense.id, userId));
    await measure("Group expenses", BUDGETS.expenses, () => repository.listExpenses(userId, 1));
    await measure("Group balances", BUDGETS.balances, () => repository.getBalances(userId));
    await measure("Group settlements", BUDGETS.settlements, () => listGroupSettlements(database, dense.id, userId, 1));
    console.log("group scale smoke passed: owner-scoped list, dense detail, bounded pages, balances, and warm medians verified");
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
    console.error(error instanceof Error ? error.message : "group scale smoke failed");
    process.exitCode = 1;
  });
}
