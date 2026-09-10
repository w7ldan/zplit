import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { createDatabasePool, readRuntimeDatabaseConfig } from "../src/db/client";
import * as schema from "../src/db/schema";
import { createLedgerRepository } from "../src/domain/ledger-repository";
import { getOrganizationLedgerScopeId, getPersonalLedgerScopeId } from "../src/server/ledger-scopes";
import { SCALE_FIXTURE_CONFIRMATION, SCALE_FIXTURE_DATABASE } from "./scale-fixture-data";

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
if (!require.cache[serverOnlyPath]) require.cache[serverOnlyPath] = { exports: {} } as never;
const { getOrganizationForMember, listOrganizations } = await import("../src/server/organizations");
const { listOrganizationMembers } = await import("../src/server/organization-invitations");

const BUDGETS = {
  list: 800,
  detail: 500,
  members: 500,
  ledgerOverview: 800,
  ledgerPage: 500,
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

    const summaries = await listOrganizations(database, userId);
    assert(summaries.length >= 8, "organization list does not contain the scale fixture organizations");
    const dense = summaries.find((organization) => organization.name === "Engineering Guild");
    assert(dense, "dense Engineering Guild organization is missing");

    const detail = await getOrganizationForMember(database, dense.id, userId);
    assert(detail.memberCount >= 40, "dense organization member count does not match the fixture");
    const members = await listOrganizationMembers(database, dense.id, userId);
    assert(members.length > 0, "dense organization has no members");
    assert(members.length <= detail.memberCount, "member listing exceeds the organization size");

    const ledgerScopeId = await getOrganizationLedgerScopeId(database, dense.id);
    const repository = createLedgerRepository(database, ledgerScopeId);
    const overview = await repository.getLedgerOverviewSummary();
    assert(overview.totalExpenseAmount > 0, "dense organization ledger has no expenses");
    const friends = await repository.listFriendRecords({ page: 1 });
    assert(friends.items.length > 0 && friends.items.length <= friends.pageSize, "organization friend page is not bounded");
    assert(friends.totalItems >= 20, "dense organization friend total does not match the fixture");

    await measure("Organization list", BUDGETS.list, () => listOrganizations(database, userId));
    await measure("Organization detail", BUDGETS.detail, () => getOrganizationForMember(database, dense.id, userId));
    await measure("Organization members", BUDGETS.members, () => listOrganizationMembers(database, dense.id, userId));
    await measure("Organization ledger overview", BUDGETS.ledgerOverview, () => repository.getLedgerOverviewSummary());
    await measure("Organization ledger page", BUDGETS.ledgerPage, () => repository.listFriendRecords({ page: 1 }));
    console.log("organization scale smoke passed: owner-scoped list, dense detail, members, ledger reads, and warm medians verified");
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
    console.error(error instanceof Error ? error.message : "organization scale smoke failed");
    process.exitCode = 1;
  });
}
