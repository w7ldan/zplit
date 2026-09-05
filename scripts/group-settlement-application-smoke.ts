import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "../src/db/schema";
import { closeDatabase, type Database } from "../src/db/client";
import { formatSafeError, readDatabaseConfig } from "./migrate.js";

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
if (!require.cache[serverOnlyPath]) require.cache[serverOnlyPath] = { exports: {} } as never;

const {
  confirmGroupSettlement,
  createGroupSettlement,
  getGroupSettlementBalances,
} = await import("../src/server/group-settlements");
const {
  getGroupObligationApplicationSummary,
  voidGroupExpenseAsPayer,
} = await import("../src/server/group-accounting");
const { removeGroupMember } = await import("../src/server/groups");

type Fixture = {
  groupId: string;
  senderUserId: string;
  recipientUserId: string;
  senderParticipantId: string;
  recipientParticipantId: string;
  userIds: string[];
};

type Debt = { expenseId: string; shareId: string; obligationId: string };

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? errorCode(error.cause) : undefined;
}

async function expectCode(action: Promise<unknown>, code: string) {
  try {
    await action;
  } catch (error) {
    assert(errorCode(error) === code, `expected ${code}, received ${errorCode(error) ?? "unknown"}`);
    return;
  }
  throw new Error(`expected ${code}, operation succeeded`);
}

async function insertFixture(pool: Pool): Promise<Fixture> {
  const fixture = {
    groupId: randomUUID(),
    senderUserId: randomUUID(),
    recipientUserId: randomUUID(),
    senderParticipantId: randomUUID(),
    recipientParticipantId: randomUUID(),
  } satisfies Omit<Fixture, "userIds">;
  await pool.query(
    `INSERT INTO users (id, name, email, email_verified) VALUES
      ($1, 'Application Sender', $3, true),
      ($2, 'Application Recipient', $4, true)`,
    [fixture.senderUserId, fixture.recipientUserId, `${fixture.senderUserId}@application.test`, `${fixture.recipientUserId}@application.test`],
  );
  await pool.query(
    "INSERT INTO groups (id, name, created_by_user_id) VALUES ($1, 'Settlement application smoke', $2)",
    [fixture.groupId, fixture.recipientUserId],
  );
  await pool.query(
    `INSERT INTO group_participants (id, group_id, user_id) VALUES
      ($1, $3, $4), ($2, $3, $5)`,
    [fixture.senderParticipantId, fixture.recipientParticipantId, fixture.groupId, fixture.senderUserId, fixture.recipientUserId],
  );
  await pool.query(
    `INSERT INTO group_memberships (group_id, user_id, participant_id, role) VALUES
      ($1, $2, $3, 'member'), ($1, $4, $5, 'owner')`,
    [fixture.groupId, fixture.senderUserId, fixture.senderParticipantId, fixture.recipientUserId, fixture.recipientParticipantId],
  );
  return { ...fixture, userIds: [fixture.senderUserId, fixture.recipientUserId] };
}

async function insertDebt(
  pool: Pool,
  fixture: Fixture,
  amount: number,
  createdAt: Date,
  direction: "forward" | "reverse" = "forward",
  ids = { expenseId: randomUUID(), shareId: randomUUID(), obligationId: randomUUID() },
): Promise<Debt> {
  const debtor = direction === "forward" ? fixture.senderParticipantId : fixture.recipientParticipantId;
  const creditor = direction === "forward" ? fixture.recipientParticipantId : fixture.senderParticipantId;
  await pool.query(
    `INSERT INTO group_expenses (id, group_id, creator_participant_id, payer_participant_id, description, occurred_at, total_amount, state, confirmed_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NULL, $6, $6)`,
    [ids.expenseId, fixture.groupId, fixture.recipientParticipantId, creditor, `Debt ${ids.expenseId}`, createdAt, amount],
  );
  await pool.query(
    `INSERT INTO group_expense_shares (id, group_id, expense_id, participant_id, amount, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [ids.shareId, fixture.groupId, ids.expenseId, debtor, amount, createdAt],
  );
  await pool.query(
    "UPDATE group_expenses SET state = 'confirmed', confirmed_at = $2, updated_at = $2 WHERE id = $1",
    [ids.expenseId, createdAt],
  );
  await pool.query(
    `INSERT INTO group_obligations (id, group_id, source_expense_id, source_share_id, debtor_participant_id, creditor_participant_id, original_amount, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [ids.obligationId, fixture.groupId, ids.expenseId, ids.shareId, debtor, creditor, amount, createdAt],
  );
  return ids;
}

async function confirmPayment(database: Database, fixture: Fixture, amount: number) {
  const pending = await createGroupSettlement(database, fixture.groupId, fixture.senderUserId, {
    senderParticipantId: fixture.senderParticipantId,
    recipientParticipantId: fixture.recipientParticipantId,
    amount,
    paymentMethod: "Bank transfer",
  });
  return confirmGroupSettlement(database, fixture.groupId, pending.id, fixture.recipientUserId);
}

async function applicationRows(pool: Pool, settlementId: string) {
  const result = await pool.query<{ obligation_id: string; applied_amount: number }>(
    `SELECT applications.obligation_id, applications.applied_amount
     FROM group_settlement_applications applications
     JOIN group_obligations obligations ON obligations.group_id = applications.group_id AND obligations.id = applications.obligation_id
     WHERE applications.settlement_id = $1
     ORDER BY obligations.created_at, obligations.id`,
    [settlementId],
  );
  return result.rows;
}

async function runAllocationChecks(pool: Pool, database: Database, fixtures: Fixture[]) {
  const fixture = await insertFixture(pool);
  fixtures.push(fixture);
  const first = await insertDebt(pool, fixture, 60, new Date("2026-08-01T00:00:00Z"));
  const second = await insertDebt(pool, fixture, 70, new Date("2026-08-02T00:00:00Z"));
  const settlement = await confirmPayment(database, fixture, 100);
  assert(JSON.stringify(await applicationRows(pool, settlement.id)) === JSON.stringify([
    { obligation_id: first.obligationId, applied_amount: 60 },
    { obligation_id: second.obligationId, applied_amount: 40 },
  ]), "multi-obligation allocation was not oldest-first");
  const firstSummary = await getGroupObligationApplicationSummary(database, fixture.groupId, first.obligationId, fixture.recipientUserId);
  assert(firstSummary.originalAmount === 60 && firstSummary.explanatoryUnappliedAmount === 0 && !("collectibleAmount" in firstSummary), "obligation read model is incorrect");
  const secondSummary = await getGroupObligationApplicationSummary(database, fixture.groupId, second.obligationId, fixture.recipientUserId);
  assert(secondSummary.explanatoryUnappliedAmount === 30 && secondSummary.applications[0]?.appliedAmount === 40, "partial obligation read model is incorrect");
  assert((await getGroupSettlementBalances(database, fixture.groupId, fixture.recipientUserId)).find((row) => row.debtorParticipantId === fixture.senderParticipantId)?.amount === 30, "applications changed canonical balance semantics");
}

async function runReadModelInterpretationChecks(pool: Pool, database: Database, fixtures: Fixture[]) {
  const fixture = await insertFixture(pool);
  fixtures.push(fixture);
  const forward = await insertDebt(pool, fixture, 100, new Date("2026-08-01T00:00:00Z"));
  await insertDebt(pool, fixture, 80, new Date("2026-08-02T00:00:00Z"), "reverse");
  const summary = await getGroupObligationApplicationSummary(database, fixture.groupId, forward.obligationId, fixture.recipientUserId);
  const balance = (await getGroupSettlementBalances(database, fixture.groupId, fixture.recipientUserId)).find((row) => row.debtorParticipantId === fixture.senderParticipantId && row.creditorParticipantId === fixture.recipientParticipantId);
  assert(summary.explanatoryUnappliedAmount === 100 && !("collectibleAmount" in summary), "obligation read model exposed a canonical debt field");
  assert(balance?.amount === 20, "canonical bilateral balance did not net reciprocal obligations");
}

async function runProgressiveChecks(pool: Pool, database: Database, fixtures: Fixture[]) {
  const fixture = await insertFixture(pool);
  fixtures.push(fixture);
  const first = await insertDebt(pool, fixture, 60, new Date("2026-08-01T00:00:00Z"));
  const second = await insertDebt(pool, fixture, 70, new Date("2026-08-02T00:00:00Z"));
  const firstSettlement = await confirmPayment(database, fixture, 50);
  const secondSettlement = await confirmPayment(database, fixture, 40);
  assert(JSON.stringify(await applicationRows(pool, firstSettlement.id)) === JSON.stringify([{ obligation_id: first.obligationId, applied_amount: 50 }]), "partial settlement allocation was incorrect");
  assert(JSON.stringify(await applicationRows(pool, secondSettlement.id)) === JSON.stringify([
    { obligation_id: first.obligationId, applied_amount: 10 },
    { obligation_id: second.obligationId, applied_amount: 30 },
  ]), "progressive settlement allocation was incorrect");
  const original = await pool.query<{ original_amount: number }>("SELECT original_amount FROM group_obligations WHERE id = $1", [first.obligationId]);
  assert(original.rows[0]?.original_amount === 60, "application mutated the original obligation");
}

async function runIntegrityChecks(pool: Pool, database: Database, fixtures: Fixture[]) {
  const fixture = await insertFixture(pool);
  fixtures.push(fixture);
  const debt = await insertDebt(pool, fixture, 100, new Date("2026-08-01T00:00:00Z"));
  const reverseDebt = await insertDebt(pool, fixture, 20, new Date("2026-08-02T00:00:00Z"), "reverse");
  const settlement = await confirmPayment(database, fixture, 50);
  await expectCode(pool.query(
    `INSERT INTO group_settlement_applications (group_id, settlement_id, obligation_id, applied_amount)
     VALUES ($1, $2, $3, 1)`,
    [fixture.groupId, settlement.id, reverseDebt.obligationId],
  ), "P0001");
  const other = await insertFixture(pool);
  fixtures.push(other);
  const otherDebt = await insertDebt(pool, other, 10, new Date("2026-08-01T00:00:00Z"));
  await expectCode(pool.query(
    `INSERT INTO group_settlement_applications (group_id, settlement_id, obligation_id, applied_amount)
     VALUES ($1, $2, $3, 1)`,
    [fixture.groupId, settlement.id, otherDebt.obligationId],
  ), "P0001");
  const application = await pool.query<{ id: string }>("SELECT id FROM group_settlement_applications WHERE settlement_id = $1 LIMIT 1", [settlement.id]);
  assert(application.rows[0], "expected a settlement application");
  await expectCode(pool.query("UPDATE group_settlement_applications SET applied_amount = 2 WHERE settlement_id = $1", [settlement.id]), "P0001");
  await expectCode(pool.query("UPDATE group_settlement_applications SET settlement_id = $2 WHERE settlement_id = $1", [settlement.id, randomUUID()]), "P0001");
  await expectCode(pool.query("UPDATE group_settlement_applications SET obligation_id = $2 WHERE settlement_id = $1", [settlement.id, reverseDebt.obligationId]), "P0001");
  await expectCode(pool.query("DELETE FROM group_settlement_applications WHERE id = $1", [application.rows[0].id]), "P0001");
  await expectCode(pool.query(
    `INSERT INTO group_settlement_applications (group_id, settlement_id, obligation_id, applied_amount)
     VALUES ($1, $2, $3, 1)`,
    [fixture.groupId, settlement.id, debt.obligationId],
  ), "P0001");
  await expectCode(pool.query(
    `INSERT INTO group_settlement_applications (group_id, settlement_id, obligation_id, applied_amount)
     VALUES ($1, $2, $3, 0)`,
    [fixture.groupId, settlement.id, debt.obligationId],
  ), "23514");
}

async function runRollbackAndVoidChecks(pool: Pool, database: Database, fixtures: Fixture[]) {
  const fixture = await insertFixture(pool);
  fixtures.push(fixture);
  const debt = await insertDebt(pool, fixture, 100, new Date("2026-08-01T00:00:00Z"));
  const pending = await createGroupSettlement(database, fixture.groupId, fixture.senderUserId, {
    senderParticipantId: fixture.senderParticipantId,
    recipientParticipantId: fixture.recipientParticipantId,
    amount: 50,
    paymentMethod: "Cash",
  });
  await expectCode(pool.query(
    `INSERT INTO group_settlement_applications (group_id, settlement_id, obligation_id, applied_amount)
     VALUES ($1, $2, $3, 1)`,
    [fixture.groupId, pending.id, debt.obligationId],
  ), "P0001");
  await pool.query("CREATE OR REPLACE FUNCTION zplit_smoke_fail_group_settlement_application() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced application insert failure'; END; $$");
  await pool.query("CREATE TRIGGER zplit_smoke_fail_group_settlement_application BEFORE INSERT ON group_settlement_applications FOR EACH ROW EXECUTE FUNCTION zplit_smoke_fail_group_settlement_application()");
  await expectCode(confirmGroupSettlement(database, fixture.groupId, pending.id, fixture.recipientUserId), "financial_integrity");
  await pool.query("DROP TRIGGER zplit_smoke_fail_group_settlement_application ON group_settlement_applications");
  const state = await pool.query<{ state: string; applications: string }>(
    `SELECT settlements.state, count(applications.id)::text AS applications
     FROM group_settlements settlements
     LEFT JOIN group_settlement_applications applications ON applications.settlement_id = settlements.id
     WHERE settlements.id = $1 GROUP BY settlements.state`,
    [pending.id],
  );
  assert(state.rows[0]?.state === "pending" && state.rows[0]?.applications === "0", "application failure did not roll back confirmation");
  const confirmed = await confirmPayment(database, fixture, 50);
  await voidGroupExpenseAsPayer(database, fixture.groupId, debt.expenseId, fixture.recipientUserId);
  const summary = await getGroupObligationApplicationSummary(database, fixture.groupId, debt.obligationId, fixture.recipientUserId);
  assert(confirmed.state === "confirmed" && summary.sourceExpenseState === "voided" && summary.applications.length === 1 && !("collectibleAmount" in summary), "voiding an obligation lost application history");
  await removeGroupMember(database, fixture.groupId, fixture.recipientUserId, fixture.senderUserId);
  const preserved = await getGroupObligationApplicationSummary(database, fixture.groupId, debt.obligationId, fixture.recipientUserId);
  assert(preserved.applications.length === 1 && preserved.debtor.status === "former", "membership removal lost application history");
}

async function cleanup(pool: Pool, fixtures: Fixture[]) {
  if (!fixtures.length) return;
  const groupIds = fixtures.map(({ groupId }) => groupId);
  const userIds = fixtures.flatMap(({ userIds }) => userIds);
  for (const statement of [
    "DROP TRIGGER IF EXISTS group_settlement_applications_totals ON group_settlement_applications",
    "DROP TRIGGER IF EXISTS group_settlements_applications_complete ON group_settlements",
    "DROP TRIGGER IF EXISTS group_settlement_applications_integrity ON group_settlement_applications",
    "DROP TRIGGER IF EXISTS zplit_smoke_fail_group_settlement_application ON group_settlement_applications",
    "DROP TRIGGER IF EXISTS group_settlements_historical_facts ON group_settlements",
  ]) await pool.query(statement);
  try {
    await pool.query("DELETE FROM group_settlement_applications WHERE group_id = ANY($1::uuid[])", [groupIds]);
    await pool.query("DELETE FROM group_settlements WHERE group_id = ANY($1::uuid[])", [groupIds]);
    await pool.query("DELETE FROM notifications WHERE metadata->>'groupId' = ANY($1::text[])", [groupIds]);
    await pool.query("DELETE FROM group_expense_lifecycle_events WHERE group_id = ANY($1::uuid[])", [groupIds]);
    await pool.query("DELETE FROM group_obligations WHERE group_id = ANY($1::uuid[])", [groupIds]);
    await pool.query("DELETE FROM group_expense_shares WHERE group_id = ANY($1::uuid[])", [groupIds]);
    await pool.query("DELETE FROM group_expenses WHERE group_id = ANY($1::uuid[])", [groupIds]);
    await pool.query("DELETE FROM group_memberships WHERE group_id = ANY($1::uuid[])", [groupIds]);
    await pool.query("DELETE FROM group_participants WHERE group_id = ANY($1::uuid[])", [groupIds]);
    await pool.query("DELETE FROM groups WHERE id = ANY($1::uuid[])", [groupIds]);
    await pool.query("DELETE FROM users WHERE id = ANY($1::text[])", [userIds]);
  } finally {
    await pool.query("CREATE TRIGGER group_settlement_applications_integrity BEFORE INSERT OR UPDATE OR DELETE ON group_settlement_applications FOR EACH ROW EXECUTE FUNCTION zplit_validate_group_settlement_application()");
    await pool.query("CREATE CONSTRAINT TRIGGER group_settlements_applications_complete AFTER INSERT OR UPDATE ON group_settlements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zplit_validate_group_settlement_application_totals()");
    await pool.query("CREATE CONSTRAINT TRIGGER group_settlement_applications_totals AFTER INSERT ON group_settlement_applications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zplit_validate_group_settlement_application_totals()");
    await pool.query("CREATE TRIGGER group_settlements_historical_facts BEFORE INSERT OR UPDATE OR DELETE ON group_settlements FOR EACH ROW EXECUTE FUNCTION zplit_validate_group_settlement()");
  }
}

function migrationStatements(file: string) {
  return readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8").split("--> statement-breakpoint").filter((statement) => statement.trim());
}

async function applyMigration(client: PoolClient, file: string) {
  for (const statement of migrationStatements(file)) await client.query(statement);
}

async function tableSnapshot(client: PoolClient, table: string, groupId: string) {
  const scope = table === "groups" ? "rows.id = $1" : "rows.group_id = $1";
  const result = await client.query<{ value: string }>(`SELECT COALESCE(jsonb_agg(to_jsonb(rows) ORDER BY to_jsonb(rows)::text), '[]')::text AS value FROM "${table}" rows WHERE ${scope}`, [groupId]);
  return result.rows[0]?.value;
}

async function seedMigrationFixture(client: PoolClient) {
  const ids = {
    groupId: randomUUID(),
    senderUserId: randomUUID(),
    recipientUserId: randomUUID(),
    senderParticipantId: randomUUID(),
    recipientParticipantId: randomUUID(),
  };
  await client.query(
    `INSERT INTO users (id, name, email, email_verified) VALUES ($1, 'Migration Sender', $3, true), ($2, 'Migration Recipient', $4, true)`,
    [ids.senderUserId, ids.recipientUserId, `${ids.senderUserId}@migration-application.test`, `${ids.recipientUserId}@migration-application.test`],
  );
  await client.query("INSERT INTO groups (id, name, created_by_user_id) VALUES ($1, 'Migration application group', $2)", [ids.groupId, ids.recipientUserId]);
  await client.query("INSERT INTO group_participants (id, group_id, user_id) VALUES ($1, $3, $4), ($2, $3, $5)", [ids.senderParticipantId, ids.recipientParticipantId, ids.groupId, ids.senderUserId, ids.recipientUserId]);
  await client.query("INSERT INTO group_memberships (group_id, user_id, participant_id, role) VALUES ($1, $2, $3, 'member'), ($1, $4, $5, 'owner')", [ids.groupId, ids.senderUserId, ids.senderParticipantId, ids.recipientUserId, ids.recipientParticipantId]);
  const addLegacyDebt = async (amount: number, createdAt: string, obligationId = randomUUID()) => {
    const expenseId = randomUUID();
    const shareId = randomUUID();
    await client.query(
      `INSERT INTO group_expenses (id, group_id, creator_participant_id, payer_participant_id, description, occurred_at, total_amount, state, confirmed_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NULL, $6, $6)`,
      [expenseId, ids.groupId, ids.recipientParticipantId, ids.recipientParticipantId, `Legacy debt ${obligationId}`, createdAt, amount],
    );
    await client.query("INSERT INTO group_expense_shares (id, group_id, expense_id, participant_id, amount, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)", [shareId, ids.groupId, expenseId, ids.senderParticipantId, amount, createdAt]);
    await client.query("UPDATE group_expenses SET state = 'confirmed', confirmed_at = $2 WHERE id = $1", [expenseId, createdAt]);
    await client.query("INSERT INTO group_obligations (id, group_id, source_expense_id, source_share_id, debtor_participant_id, creditor_participant_id, original_amount, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [obligationId, ids.groupId, expenseId, shareId, ids.senderParticipantId, ids.recipientParticipantId, amount, createdAt]);
    return obligationId;
  };
  const first = await addLegacyDebt(60, "2026-08-01T00:00:00Z");
  const second = await addLegacyDebt(70, "2026-08-02T00:00:00Z");
  const later = await addLegacyDebt(10, "2026-08-05T00:00:00Z");
  const voided = await addLegacyDebt(30, "2026-08-06T00:00:00Z");
  const addSettlement = async (amount: number, confirmedAt: string) => {
    const id = randomUUID();
    await client.query("INSERT INTO group_settlements (id, group_id, sender_participant_id, recipient_participant_id, amount, payment_method, state, created_at) VALUES ($1, $2, $3, $4, $5, 'Cash', 'pending', $6)", [id, ids.groupId, ids.senderParticipantId, ids.recipientParticipantId, amount, confirmedAt]);
    await client.query("UPDATE group_settlements SET state = 'confirmed', confirmed_at = $2 WHERE id = $1", [id, confirmedAt]);
    return id;
  };
  const firstSettlement = await addSettlement(100, "2026-08-03T00:00:00Z");
  const secondSettlement = await addSettlement(30, "2026-08-04T00:00:00Z");
  const laterSettlement = await addSettlement(10, "2026-08-06T12:00:00Z");
  const voidedSettlement = await addSettlement(30, "2026-08-07T00:00:00Z");
  await client.query("INSERT INTO group_settlements (id, group_id, sender_participant_id, recipient_participant_id, amount, payment_method, state, created_at) VALUES ($1, $2, $3, $4, 5, 'Cash', 'pending', '2026-08-08T00:00:00Z')", [randomUUID(), ids.groupId, ids.senderParticipantId, ids.recipientParticipantId]);
  await client.query("UPDATE group_expenses SET state = 'voided' WHERE id = (SELECT source_expense_id FROM group_obligations WHERE id = $1)", [voided]);
  await client.query("UPDATE group_obligations SET voided_at = '2026-08-07T12:00:00Z' WHERE id = $1", [voided]);
  return { ...ids, first, second, later, voided, firstSettlement, secondSettlement, laterSettlement, voidedSettlement };
}

async function runMigrationSmoke(config: ReturnType<typeof readDatabaseConfig>) {
  const temporaryDatabase = `zplit_application_${randomUUID().replaceAll("-", "")}`;
  const adminPool = new Pool({ ...config, database: "postgres", max: 1 });
  let pool: Pool | undefined;
  try {
    await adminPool.query(`CREATE DATABASE "${temporaryDatabase}"`);
    pool = new Pool({ ...config, database: temporaryDatabase, max: 1 });
    const client = await pool.connect();
    try {
      const migrationFiles = readdirSync(new URL("../drizzle/", import.meta.url)).filter((file) => /^\d{4}_.+\.sql$/.test(file) && Number(file.slice(0, 4)) < 29).sort();
      for (const file of migrationFiles) await applyMigration(client, file);
      assert((await client.query("SELECT to_regclass('group_settlement_applications') AS table_name")).rows[0]?.table_name === null, "pre-0029 database already has applications");
      const fixture = await seedMigrationFixture(client);
      const tables = ["groups", "group_participants", "group_memberships", "group_expenses", "group_expense_shares", "group_obligations", "group_settlements"];
      const before = new Map(await Promise.all(tables.map(async (table) => [table, await tableSnapshot(client, table, fixture.groupId)] as const)));
      await applyMigration(client, "0029_wealthy_nighthawk.sql");
      for (const table of tables) assert(await tableSnapshot(client, table, fixture.groupId) === before.get(table), `${table} changed during application backfill`);
      const rows = await client.query<{ settlement_id: string; obligation_id: string; applied_amount: number }>("SELECT settlement_id, obligation_id, applied_amount FROM group_settlement_applications WHERE group_id = $1 ORDER BY settlement_id, created_at, id", [fixture.groupId]);
      const allocation = new Map<string, string>();
      for (const row of rows.rows) allocation.set(`${row.settlement_id}:${row.obligation_id}`, String(row.applied_amount));
      assert(allocation.get(`${fixture.firstSettlement}:${fixture.first}`) === "60" && allocation.get(`${fixture.firstSettlement}:${fixture.second}`) === "40", "migration did not backfill oldest-first allocation");
      assert(allocation.get(`${fixture.secondSettlement}:${fixture.second}`) === "30", "migration did not account for earlier applications");
      assert(allocation.get(`${fixture.laterSettlement}:${fixture.later}`) === "10", "migration did not respect event-time obligation eligibility");
      assert(allocation.get(`${fixture.voidedSettlement}:${fixture.voided}`) === "30", "migration did not preserve an obligation voided after payment");
      const pending = await client.query("SELECT count(*)::text AS count FROM group_settlement_applications applications JOIN group_settlements settlements ON settlements.id = applications.settlement_id WHERE settlements.state = 'pending'");
      assert(pending.rows[0]?.count === "0", "migration attached applications to a pending settlement");
      const totals = await client.query("SELECT count(*)::text AS count FROM group_settlement_applications WHERE group_id = $1", [fixture.groupId]);
      assert(totals.rows[0]?.count === "5", "migration application count is incorrect");
    } finally {
      client.release();
    }
  } finally {
    await pool?.end();
    await adminPool.query(`DROP DATABASE IF EXISTS "${temporaryDatabase}"`);
    await adminPool.end();
  }
}

export async function runGroupSettlementApplicationSmoke() {
  const config = readDatabaseConfig("zplit_test");
  const pool = new Pool({ ...config, max: 8, connectionTimeoutMillis: 5_000 });
  const database = drizzle(pool, { schema }) as Database;
  const fixtures: Fixture[] = [];
  try {
    await runAllocationChecks(pool, database, fixtures);
    await runReadModelInterpretationChecks(pool, database, fixtures);
    await runProgressiveChecks(pool, database, fixtures);
    await runIntegrityChecks(pool, database, fixtures);
    await runRollbackAndVoidChecks(pool, database, fixtures);
    await runMigrationSmoke(config);
    console.log("group settlement application smoke passed");
  } catch (error) {
    console.error(`group settlement application smoke failed: ${formatSafeError(error, config.password)}`);
    process.exitCode = 1;
  } finally {
    await cleanup(pool, fixtures).catch((error) => {
      console.error(`group settlement application smoke cleanup failed: ${formatSafeError(error, config.password)}`);
      process.exitCode = 1;
    });
    await pool.end();
    await closeDatabase();
  }
}

if (process.argv[1]?.endsWith("group-settlement-application-smoke.ts")) await runGroupSettlementApplicationSmoke();
