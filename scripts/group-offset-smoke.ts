import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import * as schema from "../src/db/schema";
import { closeDatabase, type Database } from "../src/db/client";
import { formatSafeError, readDatabaseConfig, type DatabaseConfig } from "./migrate.js";

const require = (await import("node:module")).createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
if (!require.cache[serverOnlyPath]) require.cache[serverOnlyPath] = { exports: {} } as never;

const { createGroupOffset, confirmGroupOffset, getGroupOffset } = await import("../src/server/group-offsets");
const { createGroupSettlement, confirmGroupSettlement, getGroupSettlementBalances } = await import("../src/server/group-settlements");
const { confirmGroupExpenseAsPayer, voidGroupExpenseAsPayer } = await import("../src/server/group-accounting");
const { removeGroupMember } = await import("../src/server/groups");

type Fixture = {
  groupId: string;
  ownerUserId: string;
  firstUserId: string;
  secondUserId: string;
  ownerParticipantId: string;
  firstParticipantId: string;
  secondParticipantId: string;
  userIds: string[];
};

type Debt = { expenseId: string; obligationId: string };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? errorCode(error.cause) : undefined;
}

async function expectCode(action: Promise<unknown>, expected: string) {
  try {
    await action;
  } catch (error) {
    assert(errorCode(error) === expected, `expected ${expected}, received ${errorCode(error) ?? "unknown"}`);
    return;
  }
  throw new Error(`expected ${expected}, operation succeeded`);
}

async function insertFixture(pool: Pool): Promise<Fixture> {
  const fixture = {
    groupId: randomUUID(),
    ownerUserId: randomUUID(),
    firstUserId: randomUUID(),
    secondUserId: randomUUID(),
    ownerParticipantId: randomUUID(),
    firstParticipantId: randomUUID(),
    secondParticipantId: randomUUID(),
  } satisfies Omit<Fixture, "userIds">;
  const users = [
    [fixture.ownerUserId, "Offset Owner"],
    [fixture.firstUserId, "Offset First"],
    [fixture.secondUserId, "Offset Second"],
  ];
  for (const [userId, name] of users) {
    await pool.query(
      "INSERT INTO users (id, name, email, email_verified) VALUES ($1, $2, $3, true)",
      [userId, name, `${userId}@group-offset.test`],
    );
  }
  await pool.query(
    "INSERT INTO groups (id, name, created_by_user_id) VALUES ($1, $2, $3)",
    [fixture.groupId, "Offset smoke group", fixture.ownerUserId],
  );
  await pool.query(
    `INSERT INTO group_participants (id, group_id, user_id) VALUES
      ($1, $4, $5), ($2, $4, $6), ($3, $4, $7)`,
    [fixture.ownerParticipantId, fixture.firstParticipantId, fixture.secondParticipantId, fixture.groupId, fixture.ownerUserId, fixture.firstUserId, fixture.secondUserId],
  );
  await pool.query(
    `INSERT INTO group_memberships (group_id, user_id, participant_id, role) VALUES
      ($1, $2, $3, 'owner'), ($1, $4, $5, 'member'), ($1, $6, $7, 'member')`,
    [fixture.groupId, fixture.ownerUserId, fixture.ownerParticipantId, fixture.firstUserId, fixture.firstParticipantId, fixture.secondUserId, fixture.secondParticipantId],
  );
  return { ...fixture, userIds: users.map(([userId]) => userId) };
}

function participantUser(fixture: Fixture, participantId: string) {
  if (participantId === fixture.firstParticipantId) return fixture.firstUserId;
  if (participantId === fixture.secondParticipantId) return fixture.secondUserId;
  return fixture.ownerUserId;
}

async function insertDebt(pool: Pool, fixture: Fixture, debtorParticipantId: string, creditorParticipantId: string, amount: number, createdAt: Date): Promise<Debt> {
  const debt = { expenseId: randomUUID(), obligationId: randomUUID() };
  const shareId = randomUUID();
  await pool.query(
    `INSERT INTO group_expenses (id, group_id, creator_participant_id, payer_participant_id, description, occurred_at, total_amount, state, confirmed_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NULL, $6, $6)`,
    [debt.expenseId, fixture.groupId, fixture.ownerParticipantId, creditorParticipantId, `Debt ${debt.obligationId}`, createdAt, amount],
  );
  await pool.query(
    `INSERT INTO group_expense_shares (id, group_id, expense_id, participant_id, amount, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [shareId, fixture.groupId, debt.expenseId, debtorParticipantId, amount, createdAt],
  );
  await pool.query(
    "UPDATE group_expenses SET state = 'confirmed', confirmed_at = $2, updated_at = $2 WHERE id = $1",
    [debt.expenseId, createdAt],
  );
  await pool.query(
    `INSERT INTO group_obligations (id, group_id, source_expense_id, source_share_id, debtor_participant_id, creditor_participant_id, original_amount, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [debt.obligationId, fixture.groupId, debt.expenseId, shareId, debtorParticipantId, creditorParticipantId, amount, createdAt],
  );
  return debt;
}

async function insertPendingDebt(pool: Pool, fixture: Fixture, debtorParticipantId: string, creditorParticipantId: string, amount: number, createdAt: Date): Promise<Debt> {
  const debt = { expenseId: randomUUID(), obligationId: randomUUID() };
  const shareId = randomUUID();
  await pool.query(
    `INSERT INTO group_expenses (id, group_id, creator_participant_id, payer_participant_id, description, occurred_at, total_amount, state, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $6, $6)`,
    [debt.expenseId, fixture.groupId, fixture.ownerParticipantId, creditorParticipantId, `Pending ${debt.obligationId}`, createdAt, amount],
  );
  await pool.query(
    "INSERT INTO group_expense_shares (id, group_id, expense_id, participant_id, amount, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)",
    [shareId, fixture.groupId, debt.expenseId, debtorParticipantId, amount, createdAt],
  );
  return debt;
}

async function createOffset(database: Database, fixture: Fixture, initiatorParticipantId: string, counterpartyParticipantId: string) {
  return createGroupOffset(database, fixture.groupId, participantUser(fixture, initiatorParticipantId), { counterpartyParticipantId });
}

async function createPayment(database: Database, fixture: Fixture, senderParticipantId: string, recipientParticipantId: string, amount: number) {
  return createGroupSettlement(database, fixture.groupId, participantUser(fixture, senderParticipantId), {
    senderParticipantId,
    recipientParticipantId,
    amount,
    paymentMethod: "Cash",
  });
}

async function confirmPayment(database: Database, fixture: Fixture, settlementId: string, recipientParticipantId: string) {
  return confirmGroupSettlement(database, fixture.groupId, settlementId, participantUser(fixture, recipientParticipantId));
}

async function balance(database: Database, fixture: Fixture, debtorParticipantId: string, creditorParticipantId: string) {
  const balances = await getGroupSettlementBalances(database, fixture.groupId, fixture.ownerUserId);
  return balances.find((row) => row.debtorParticipantId === debtorParticipantId && row.creditorParticipantId === creditorParticipantId)?.amount ?? 0;
}

async function applicationRows(pool: Pool, offsetId: string) {
  return pool.query<{ debtor_participant_id: string; creditor_participant_id: string; applied_amount: number }>(
    `SELECT obligations.debtor_participant_id, obligations.creditor_participant_id, applications.applied_amount
     FROM group_offset_applications applications
     INNER JOIN group_obligations obligations ON obligations.group_id = applications.group_id AND obligations.id = applications.obligation_id
     WHERE applications.offset_settlement_id = $1
     ORDER BY obligations.created_at, obligations.id, applications.id`,
    [offsetId],
  ).then((result) => result.rows);
}

async function runCoreChecks(pool: Pool, database: Database, fixtures: Fixture[]) {
  const tableCheck = await pool.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
    [["group_offset_settlements", "group_offset_applications"]],
  );
  assert(tableCheck.rows.length === 2, "offset migration did not create both tables");

  const noCapacity = await insertFixture(pool);
  fixtures.push(noCapacity);
  await insertDebt(pool, noCapacity, noCapacity.firstParticipantId, noCapacity.secondParticipantId, 100, new Date("2026-08-01T00:00:00Z"));
  await expectCode(createOffset(database, noCapacity, noCapacity.firstParticipantId, noCapacity.secondParticipantId), "no_capacity");

  const fixture = await insertFixture(pool);
  fixtures.push(fixture);
  const forward = await insertDebt(pool, fixture, fixture.firstParticipantId, fixture.secondParticipantId, 100, new Date("2026-08-01T00:00:00Z"));
  const reverse = await insertDebt(pool, fixture, fixture.secondParticipantId, fixture.firstParticipantId, 60, new Date("2026-08-02T00:00:00Z"));
  const before = await balance(database, fixture, fixture.firstParticipantId, fixture.secondParticipantId);
  const pending = await createOffset(database, fixture, fixture.firstParticipantId, fixture.secondParticipantId);
  assert(pending.amount === 60 && pending.state === "pending" && pending.confirmedAt === null, "offset proposal did not store the minimum reciprocal capacity as pending");
  assert(pending.applications.length === 0 && await balance(database, fixture, fixture.firstParticipantId, fixture.secondParticipantId) === before, "pending offset had a financial effect");
  const notification = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM notifications WHERE recipient_user_id = $1 AND type = 'group.offset.confirmation' AND dedupe_key = $2", [fixture.secondUserId, `group-offset-confirmation:${pending.id}`]);
  assert(notification.rows[0]?.count === "1", "offset confirmation notification was not deduplicated");
  await expectCode(confirmGroupOffset(database, fixture.groupId, pending.id, fixture.ownerUserId), "forbidden");
  const confirmed = await confirmGroupOffset(database, fixture.groupId, pending.id, fixture.secondUserId);
  assert(confirmed.state === "confirmed" && confirmed.applications.reduce((total, application) => total + application.appliedAmount, 0) === 120, "offset did not apply the full amount in both directions");
  assert(await balance(database, fixture, fixture.firstParticipantId, fixture.secondParticipantId) === before, "confirmed offset changed the canonical pair net");
  const originals = await pool.query<{ id: string; original_amount: number }>("SELECT id, original_amount FROM group_obligations WHERE id = ANY($1::uuid[]) ORDER BY id", [[forward.obligationId, reverse.obligationId]]);
  assert(originals.rows.some((row) => row.id === forward.obligationId && row.original_amount === 100) && originals.rows.some((row) => row.id === reverse.obligationId && row.original_amount === 60), "offset changed original obligation amounts");
  const repeated = await confirmGroupOffset(database, fixture.groupId, pending.id, fixture.secondUserId);
  assert(repeated.applications.length === 2, "repeated confirmation changed the application set");
  await expectCode(pool.query("UPDATE group_offset_settlements SET amount = 1 WHERE id = $1", [pending.id]), "P0001");
  await expectCode(pool.query("DELETE FROM group_offset_settlements WHERE id = $1", [pending.id]), "P0001");
  await expectCode(pool.query("UPDATE group_offset_applications SET applied_amount = 1 WHERE offset_settlement_id = $1", [pending.id]), "P0001");
  await expectCode(pool.query("DELETE FROM group_offset_applications WHERE offset_settlement_id = $1", [pending.id]), "P0001");

  await voidGroupExpenseAsPayer(database, fixture.groupId, reverse.expenseId, fixture.firstUserId);
  const voided = await getGroupOffset(database, fixture.groupId, pending.id, fixture.ownerUserId);
  assert(voided.applications.some((application) => application.sourceExpenseState === "voided" && application.obligationVoidedAt !== null), "voiding a source expense lost offset history");

  const allocationFixture = await insertFixture(pool);
  fixtures.push(allocationFixture);
  await insertDebt(pool, allocationFixture, allocationFixture.firstParticipantId, allocationFixture.secondParticipantId, 50, new Date("2026-08-01T00:00:00Z"));
  await insertDebt(pool, allocationFixture, allocationFixture.firstParticipantId, allocationFixture.secondParticipantId, 70, new Date("2026-08-02T00:00:00Z"));
  await insertDebt(pool, allocationFixture, allocationFixture.secondParticipantId, allocationFixture.firstParticipantId, 40, new Date("2026-08-03T00:00:00Z"));
  await insertDebt(pool, allocationFixture, allocationFixture.secondParticipantId, allocationFixture.firstParticipantId, 60, new Date("2026-08-04T00:00:00Z"));
  const allocated = await createOffset(database, allocationFixture, allocationFixture.firstParticipantId, allocationFixture.secondParticipantId);
  assert(allocated.amount === 100, "offset amount was not the minimum of both gross directions");
  await confirmGroupOffset(database, allocationFixture.groupId, allocated.id, allocationFixture.secondUserId);
  const rows = await applicationRows(pool, allocated.id);
  assert(JSON.stringify(rows.map((row) => row.applied_amount)) === JSON.stringify([50, 50, 40, 60]), "offset allocation was not oldest-first with partial allocation on both directions");

  const paymentFixture = await insertFixture(pool);
  fixtures.push(paymentFixture);
  await insertDebt(pool, paymentFixture, paymentFixture.firstParticipantId, paymentFixture.secondParticipantId, 100, new Date("2026-08-01T00:00:00Z"));
  await insertDebt(pool, paymentFixture, paymentFixture.secondParticipantId, paymentFixture.firstParticipantId, 60, new Date("2026-08-02T00:00:00Z"));
  const payment = await createPayment(database, paymentFixture, paymentFixture.firstParticipantId, paymentFixture.secondParticipantId, 40);
  await confirmPayment(database, paymentFixture, payment.id, paymentFixture.secondParticipantId);
  const reduced = await createOffset(database, paymentFixture, paymentFixture.firstParticipantId, paymentFixture.secondParticipantId);
  assert(reduced.amount === 60, "payment applications did not reduce offsettable capacity");
  await confirmGroupOffset(database, paymentFixture.groupId, reduced.id, paymentFixture.secondUserId);

  const previousFixture = await insertFixture(pool);
  fixtures.push(previousFixture);
  await insertDebt(pool, previousFixture, previousFixture.firstParticipantId, previousFixture.secondParticipantId, 100, new Date("2026-08-01T00:00:00Z"));
  await insertDebt(pool, previousFixture, previousFixture.secondParticipantId, previousFixture.firstParticipantId, 60, new Date("2026-08-02T00:00:00Z"));
  const firstOffset = await createOffset(database, previousFixture, previousFixture.firstParticipantId, previousFixture.secondParticipantId);
  await confirmGroupOffset(database, previousFixture.groupId, firstOffset.id, previousFixture.secondUserId);
  await insertDebt(pool, previousFixture, previousFixture.firstParticipantId, previousFixture.secondParticipantId, 30, new Date("2026-08-03T00:00:00Z"));
  await insertDebt(pool, previousFixture, previousFixture.secondParticipantId, previousFixture.firstParticipantId, 20, new Date("2026-08-04T00:00:00Z"));
  const secondOffset = await createOffset(database, previousFixture, previousFixture.firstParticipantId, previousFixture.secondParticipantId);
  assert(secondOffset.amount === 20, "previous offset applications did not reduce later capacity");

  const paymentAfterOffsetFixture = await insertFixture(pool);
  fixtures.push(paymentAfterOffsetFixture);
  await insertDebt(
    pool,
    paymentAfterOffsetFixture,
    paymentAfterOffsetFixture.firstParticipantId,
    paymentAfterOffsetFixture.secondParticipantId,
    50,
    new Date("2026-08-01T00:00:00Z"),
  );
  const secondPaymentAfterOffsetDebt = await insertDebt(
    pool,
    paymentAfterOffsetFixture,
    paymentAfterOffsetFixture.firstParticipantId,
    paymentAfterOffsetFixture.secondParticipantId,
    50,
    new Date("2026-08-02T00:00:00Z"),
  );
  await insertDebt(
    pool,
    paymentAfterOffsetFixture,
    paymentAfterOffsetFixture.secondParticipantId,
    paymentAfterOffsetFixture.firstParticipantId,
    60,
    new Date("2026-08-03T00:00:00Z"),
  );
  const paymentOffset = await createOffset(
    database,
    paymentAfterOffsetFixture,
    paymentAfterOffsetFixture.firstParticipantId,
    paymentAfterOffsetFixture.secondParticipantId,
  );
  assert(paymentOffset.amount === 60, "payment-after-offset regression did not create the expected offset");
  await confirmGroupOffset(database, paymentAfterOffsetFixture.groupId, paymentOffset.id, paymentAfterOffsetFixture.secondUserId);
  const paymentOffsetApplications = await applicationRows(pool, paymentOffset.id);
  assert(
    JSON.stringify(paymentOffsetApplications.map((row) => row.applied_amount)) === JSON.stringify([50, 10, 60]),
    "offset did not consume the oldest obligations as expected",
  );
  assert(
    await balance(database, paymentAfterOffsetFixture, paymentAfterOffsetFixture.firstParticipantId, paymentAfterOffsetFixture.secondParticipantId) === 40,
    "offset changed the canonical remaining debt",
  );
  const paymentAfterOffset = await createPayment(
    database,
    paymentAfterOffsetFixture,
    paymentAfterOffsetFixture.firstParticipantId,
    paymentAfterOffsetFixture.secondParticipantId,
    40,
  );
  await confirmPayment(database, paymentAfterOffsetFixture, paymentAfterOffset.id, paymentAfterOffsetFixture.secondParticipantId);
  const paymentApplications = await pool.query<{ obligation_id: string; applied_amount: number }>(
    "SELECT obligation_id, applied_amount FROM group_settlement_applications WHERE settlement_id = $1",
    [paymentAfterOffset.id],
  );
  assert(
    paymentApplications.rows.length === 1 &&
      paymentApplications.rows[0]?.obligation_id === secondPaymentAfterOffsetDebt.obligationId &&
      paymentApplications.rows[0]?.applied_amount === 40,
    "payment-after-offset did not skip the consumed obligation",
  );
  const combinedApplications = await pool.query<{ total: string; original_amount: number }>(
    `SELECT obligations.original_amount,
            (SELECT COALESCE(sum(applied_amount), 0) FROM group_settlement_applications WHERE obligation_id = obligations.id) +
            (SELECT COALESCE(sum(applied_amount), 0) FROM group_offset_applications WHERE obligation_id = obligations.id) AS total
     FROM group_obligations obligations
     WHERE obligations.group_id = $1`,
    [paymentAfterOffsetFixture.groupId],
  );
  assert(
    combinedApplications.rows.every((row) => Number(row.total) <= row.original_amount),
    "payment-after-offset exceeded combined obligation capacity",
  );
  assert(
    await balance(database, paymentAfterOffsetFixture, paymentAfterOffsetFixture.firstParticipantId, paymentAfterOffsetFixture.secondParticipantId) === 0,
    "payment-after-offset did not settle the canonical debt",
  );

  const combinedFixture = await insertFixture(pool);
  fixtures.push(combinedFixture);
  const combinedDebt = await insertDebt(pool, combinedFixture, combinedFixture.firstParticipantId, combinedFixture.secondParticipantId, 150, new Date("2026-08-01T00:00:00Z"));
  await insertDebt(pool, combinedFixture, combinedFixture.secondParticipantId, combinedFixture.firstParticipantId, 50, new Date("2026-08-02T00:00:00Z"));
  const combinedOffset = await createOffset(database, combinedFixture, combinedFixture.firstParticipantId, combinedFixture.secondParticipantId);
  await confirmGroupOffset(database, combinedFixture.groupId, combinedOffset.id, combinedFixture.secondUserId);
  const client = await pool.connect();
  let overApplied: unknown;
  try {
    await client.query("BEGIN");
    const settlementId = randomUUID();
    await client.query("INSERT INTO group_settlements (id, group_id, sender_participant_id, recipient_participant_id, amount, payment_method, state, created_at) VALUES ($1, $2, $3, $4, 101, 'Cash', 'pending', now())", [settlementId, combinedFixture.groupId, combinedFixture.firstParticipantId, combinedFixture.secondParticipantId]);
    await client.query("UPDATE group_settlements SET state = 'confirmed', confirmed_at = now() WHERE id = $1", [settlementId]);
    await client.query("INSERT INTO group_settlement_applications (group_id, settlement_id, obligation_id, applied_amount) VALUES ($1, $2, $3, 101)", [combinedFixture.groupId, settlementId, combinedDebt.obligationId]);
    await client.query("COMMIT");
  } catch (error) {
    overApplied = error;
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
  assert(errorCode(overApplied) === "P0001", "combined payment and offset applications over-consumed an obligation");
}

async function holdParticipant(pool: Pool, participantId: string) {
  const client = await pool.connect();
  await client.query("BEGIN");
  await client.query("SELECT id FROM group_participants WHERE id = $1 FOR UPDATE", [participantId]);
  let released = false;
  return {
    async release(commit = true) {
      if (released) return;
      released = true;
      try {
        await client.query(commit ? "COMMIT" : "ROLLBACK");
      } finally {
        client.release();
      }
    },
  };
}

async function waitForBlockedParticipantQueries(pool: Pool, expected: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_stat_activity
       WHERE pid <> pg_backend_pid() AND state = 'active'
         AND query LIKE '%group_participants%' AND lower(query) LIKE '%for update%'`,
    );
    if (Number(result.rows[0]?.count ?? 0) >= expected) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`expected ${expected} blocked participant queries`);
}

async function orderedRace(pool: Pool, participantId: string, first: () => Promise<unknown>, second: () => Promise<unknown>, expectedBlocked = 2) {
  const lock = await holdParticipant(pool, participantId);
  const firstResult = first();
  const secondResult = second();
  let released = false;
  try {
    await waitForBlockedParticipantQueries(pool, expectedBlocked);
    await lock.release();
    released = true;
    return Promise.allSettled([firstResult, secondResult]);
  } finally {
    if (!released) await lock.release(false);
  }
}

async function runRaceChecks(pool: Pool, database: Database, fixtures: Fixture[]) {
  const inverse = await insertFixture(pool);
  fixtures.push(inverse);
  await insertDebt(pool, inverse, inverse.firstParticipantId, inverse.secondParticipantId, 100, new Date("2026-08-01T00:00:00Z"));
  await insertDebt(pool, inverse, inverse.secondParticipantId, inverse.firstParticipantId, 100, new Date("2026-08-02T00:00:00Z"));
  const inverseResults = await orderedRace(pool, inverse.firstParticipantId,
    () => createOffset(database, inverse, inverse.firstParticipantId, inverse.secondParticipantId),
    () => createOffset(database, inverse, inverse.secondParticipantId, inverse.firstParticipantId));
  assert(inverseResults.filter((result) => result.status === "fulfilled").length === 1, "concurrent inverse offset proposals both succeeded");
  assert(inverseResults.some((result) => result.status === "rejected" && errorCode(result.reason) === "pending_exists"), "inverse proposal uniqueness was not concurrency-safe");

  const same = await insertFixture(pool);
  fixtures.push(same);
  await insertDebt(pool, same, same.firstParticipantId, same.secondParticipantId, 100, new Date("2026-08-01T00:00:00Z"));
  await insertDebt(pool, same, same.secondParticipantId, same.firstParticipantId, 100, new Date("2026-08-02T00:00:00Z"));
  const sameOffset = await createOffset(database, same, same.firstParticipantId, same.secondParticipantId);
  const sameResults = await orderedRace(pool, same.firstParticipantId,
    () => confirmGroupOffset(database, same.groupId, sameOffset.id, same.secondUserId),
    () => confirmGroupOffset(database, same.groupId, sameOffset.id, same.secondUserId),
    1);
  assert(sameResults.every((result) => result.status === "fulfilled"), "same offset confirmation was not idempotent");
  const sameApplications = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM group_offset_applications WHERE offset_settlement_id = $1", [sameOffset.id]);
  assert(sameApplications.rows[0]?.count === "2", "same offset confirmation duplicated applications");

  const competing = await insertFixture(pool);
  fixtures.push(competing);
  await insertDebt(pool, competing, competing.firstParticipantId, competing.secondParticipantId, 150, new Date("2026-08-01T00:00:00Z"));
  await insertDebt(pool, competing, competing.secondParticipantId, competing.firstParticipantId, 50, new Date("2026-08-02T00:00:00Z"));
  const competingOffset = await createOffset(database, competing, competing.firstParticipantId, competing.secondParticipantId);
  await expectCode(createOffset(database, competing, competing.secondParticipantId, competing.firstParticipantId), "pending_exists");
  await confirmGroupOffset(database, competing.groupId, competingOffset.id, competing.secondUserId);
  assert((await applicationRows(pool, competingOffset.id)).reduce((total, row) => total + row.applied_amount, 0) === 100, "competing offset capacity did not have one serialized winner");

  const paymentRace = await insertFixture(pool);
  fixtures.push(paymentRace);
  await insertDebt(pool, paymentRace, paymentRace.firstParticipantId, paymentRace.secondParticipantId, 150, new Date("2026-08-01T00:00:00Z"));
  await insertDebt(pool, paymentRace, paymentRace.secondParticipantId, paymentRace.firstParticipantId, 50, new Date("2026-08-02T00:00:00Z"));
  const raceOffset = await createOffset(database, paymentRace, paymentRace.firstParticipantId, paymentRace.secondParticipantId);
  const racePayment = await createPayment(database, paymentRace, paymentRace.firstParticipantId, paymentRace.secondParticipantId, 100);
  const paymentResults = await orderedRace(pool, paymentRace.firstParticipantId,
    () => confirmGroupOffset(database, paymentRace.groupId, raceOffset.id, paymentRace.secondUserId),
    () => confirmPayment(database, paymentRace, racePayment.id, paymentRace.secondParticipantId));
  assert(paymentResults.every((result) => result.status === "fulfilled"), "offset and payment confirmation did not serialize safely");
  const combinedTotal = await pool.query<{ total: string }>(
    `SELECT (SELECT COALESCE(sum(applied_amount), 0) FROM group_settlement_applications WHERE obligation_id = obligations.id) +
            (SELECT COALESCE(sum(applied_amount), 0) FROM group_offset_applications WHERE obligation_id = obligations.id) AS total
     FROM group_obligations obligations WHERE obligations.group_id = $1`,
    [paymentRace.groupId],
  );
  assert(combinedTotal.rows.every((row) => Number(row.total) <= 150), "offset and payment race over-consumed an obligation");

  const expenseRace = await insertFixture(pool);
  fixtures.push(expenseRace);
  await insertDebt(pool, expenseRace, expenseRace.firstParticipantId, expenseRace.secondParticipantId, 100, new Date("2026-08-01T00:00:00Z"));
  await insertDebt(pool, expenseRace, expenseRace.secondParticipantId, expenseRace.firstParticipantId, 100, new Date("2026-08-02T00:00:00Z"));
  const expenseOffset = await createOffset(database, expenseRace, expenseRace.firstParticipantId, expenseRace.secondParticipantId);
  const pendingExpense = await insertPendingDebt(pool, expenseRace, expenseRace.firstParticipantId, expenseRace.secondParticipantId, 10, new Date("2026-08-03T00:00:00Z"));
  const expenseResults = await orderedRace(pool, expenseRace.firstParticipantId,
    () => confirmGroupOffset(database, expenseRace.groupId, expenseOffset.id, expenseRace.secondUserId),
    () => confirmGroupExpenseAsPayer(database, expenseRace.groupId, pendingExpense.expenseId, expenseRace.secondUserId));
  assert(expenseResults.every((result) => result.status === "fulfilled"), "offset and expense confirmation did not serialize safely");

  for (const voidFirst of [false, true]) {
    const voidRace = await insertFixture(pool);
    fixtures.push(voidRace);
    const voidDebt = await insertDebt(pool, voidRace, voidRace.firstParticipantId, voidRace.secondParticipantId, 100, new Date("2026-08-01T00:00:00Z"));
    await insertDebt(pool, voidRace, voidRace.secondParticipantId, voidRace.firstParticipantId, 100, new Date("2026-08-02T00:00:00Z"));
    const voidOffset = await createOffset(database, voidRace, voidRace.firstParticipantId, voidRace.secondParticipantId);
    const voidResults = await orderedRace(pool, voidRace.secondParticipantId,
      voidFirst
        ? () => voidGroupExpenseAsPayer(database, voidRace.groupId, voidDebt.expenseId, voidRace.secondUserId)
        : () => confirmGroupOffset(database, voidRace.groupId, voidOffset.id, voidRace.secondUserId),
      voidFirst
        ? () => confirmGroupOffset(database, voidRace.groupId, voidOffset.id, voidRace.secondUserId)
        : () => voidGroupExpenseAsPayer(database, voidRace.groupId, voidDebt.expenseId, voidRace.secondUserId));
    assert(voidResults.some((result) => result.status === "fulfilled"), "offset and expense void race had no winner");
    const history = await pool.query<{ state: string; applications: string }>(
      `SELECT offsets.state, count(applications.id)::text AS applications
       FROM group_offset_settlements offsets
       LEFT JOIN group_offset_applications applications ON applications.offset_settlement_id = offsets.id
       WHERE offsets.id = $1 GROUP BY offsets.state`,
      [voidOffset.id],
    );
    const expenseState = await pool.query<{ state: string }>("SELECT state FROM group_expenses WHERE id = $1", [voidDebt.expenseId]);
    const offsetState = history.rows[0]?.state;
    const applicationCount = Number(history.rows[0]?.applications ?? 0);
    assert(
      (offsetState === "confirmed" && applicationCount === 2) ||
      (offsetState === "pending" && expenseState.rows[0]?.state === "voided" && applicationCount === 0),
      "offset and expense void race did not preserve one serialized outcome",
    );
  }

  for (const createFirst of [false, true]) {
    const removal = await insertFixture(pool);
    fixtures.push(removal);
    await insertDebt(pool, removal, removal.firstParticipantId, removal.secondParticipantId, 100, new Date("2026-08-01T00:00:00Z"));
    await insertDebt(pool, removal, removal.secondParticipantId, removal.firstParticipantId, 100, new Date("2026-08-02T00:00:00Z"));
    const operation = () => createFirst
      ? createOffset(database, removal, removal.firstParticipantId, removal.secondParticipantId)
      : removeGroupMember(database, removal.groupId, removal.ownerUserId, removal.secondUserId);
    const other = () => createFirst
      ? removeGroupMember(database, removal.groupId, removal.ownerUserId, removal.secondUserId)
      : createOffset(database, removal, removal.firstParticipantId, removal.secondParticipantId);
    const removalResults = await orderedRace(pool, removal.secondParticipantId, operation, other);
    assert(removalResults.some((result) => result.status === "fulfilled"), "offset and participant removal race had no winner");
    if (!createFirst) assert(removalResults.some((result) => result.status === "rejected" && ["counterparty_not_active", "forbidden"].includes(errorCode(result.reason) ?? "")), "removal-first offset creation used stale membership");
  }
}

function migrationStatements(file: string) {
  return readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8").split("--> statement-breakpoint").filter((statement) => statement.trim());
}

async function applyMigration(client: PoolClient, file: string) {
  for (const statement of migrationStatements(file)) await client.query(statement);
}

async function runMigrationSmoke(config: DatabaseConfig) {
  const temporaryDatabase = `zplit_offset_${randomUUID().replaceAll("-", "")}`;
  const adminPool = new Pool({ ...config, database: "postgres", max: 1 });
  let pool: Pool | undefined;
  try {
    await adminPool.query(`CREATE DATABASE "${temporaryDatabase}"`);
    pool = new Pool({ ...config, database: temporaryDatabase, max: 2 });
    const client = await pool.connect();
    try {
      const migrationFiles = readdirSync(new URL("../drizzle/", import.meta.url)).filter((file) => /^\d{4}_.+\.sql$/.test(file) && Number(file.slice(0, 4)) < 30).sort();
      for (const file of migrationFiles) await applyMigration(client, file);
      await client.query("CREATE SCHEMA drizzle");
      await client.query("CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)");
      const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")) as { entries: Array<{ idx: number; tag: string; when: number }> };
      for (const entry of journal.entries.filter(({ idx }) => idx < 30)) {
        const sql = readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url));
        await client.query("INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES ($1, $2, $3)", [entry.idx + 1, createHash("sha256").update(sql).digest("hex"), entry.when]);
      }
      await client.query("SELECT setval('drizzle.__drizzle_migrations_id_seq', 30, true)");
      const fixture = await insertFixture(pool);
      const before = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM group_participants WHERE group_id = $1", [fixture.groupId]);
      await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
      await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
      const after = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM group_participants WHERE group_id = $1", [fixture.groupId]);
      assert(before.rows[0]?.count === after.rows[0]?.count, "0029 populated data changed during 0030 migration");
      const journalRows = await client.query<{ id: string }>("SELECT id FROM drizzle.__drizzle_migrations ORDER BY id");
      assert(journalRows.rows.length === 31 && Number(journalRows.rows.at(-1)?.id) === 31, "0030 migration rerun did not preserve migration journal convention");
    } finally {
      client.release();
    }
  } finally {
    await pool?.end();
    await adminPool.query(`DROP DATABASE IF EXISTS "${temporaryDatabase}"`);
    await adminPool.end();
  }
}

async function cleanup(pool: Pool, fixtures: Fixture[]) {
  if (fixtures.length === 0) return;
  const groupIds = fixtures.map(({ groupId }) => groupId);
  const userIds = fixtures.flatMap(({ userIds }) => userIds);
  for (const statement of [
    "DROP TRIGGER IF EXISTS group_offset_applications_totals ON group_offset_applications",
    "DROP TRIGGER IF EXISTS group_offset_settlements_applications_complete ON group_offset_settlements",
    "DROP TRIGGER IF EXISTS group_offset_applications_integrity ON group_offset_applications",
    "DROP TRIGGER IF EXISTS group_offset_settlements_historical_facts ON group_offset_settlements",
    "DROP TRIGGER IF EXISTS group_settlement_applications_totals ON group_settlement_applications",
    "DROP TRIGGER IF EXISTS group_settlements_applications_complete ON group_settlements",
    "DROP TRIGGER IF EXISTS group_settlement_applications_integrity ON group_settlement_applications",
    "DROP TRIGGER IF EXISTS group_settlements_historical_facts ON group_settlements",
  ]) await pool.query(statement);
  try {
    await pool.query("DELETE FROM group_offset_applications WHERE group_id = ANY($1::uuid[])", [groupIds]);
    await pool.query("DELETE FROM group_offset_settlements WHERE group_id = ANY($1::uuid[])", [groupIds]);
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
    await pool.query("CREATE TRIGGER group_offset_applications_integrity BEFORE INSERT OR UPDATE OR DELETE ON group_offset_applications FOR EACH ROW EXECUTE FUNCTION zplit_validate_group_offset_application()");
    await pool.query("CREATE CONSTRAINT TRIGGER group_offset_settlements_applications_complete AFTER INSERT OR UPDATE ON group_offset_settlements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zplit_validate_group_offset_application_totals()");
    await pool.query("CREATE CONSTRAINT TRIGGER group_offset_applications_totals AFTER INSERT ON group_offset_applications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zplit_validate_group_offset_application_totals()");
    await pool.query("CREATE TRIGGER group_offset_settlements_historical_facts BEFORE INSERT OR UPDATE OR DELETE ON group_offset_settlements FOR EACH ROW EXECUTE FUNCTION zplit_validate_group_offset_settlement()");
    await pool.query("CREATE TRIGGER group_settlement_applications_integrity BEFORE INSERT OR UPDATE OR DELETE ON group_settlement_applications FOR EACH ROW EXECUTE FUNCTION zplit_validate_group_settlement_application()");
    await pool.query("CREATE CONSTRAINT TRIGGER group_settlements_applications_complete AFTER INSERT OR UPDATE ON group_settlements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zplit_validate_group_settlement_application_totals()");
    await pool.query("CREATE CONSTRAINT TRIGGER group_settlement_applications_totals AFTER INSERT ON group_settlement_applications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zplit_validate_group_settlement_application_totals()");
    await pool.query("CREATE TRIGGER group_settlements_historical_facts BEFORE INSERT OR UPDATE OR DELETE ON group_settlements FOR EACH ROW EXECUTE FUNCTION zplit_validate_group_settlement()");
  }
}

export async function runGroupOffsetSmoke() {
  if (process.env.DB_NAME !== "zplit_test") throw new Error("Group offset smoke requires DB_NAME=zplit_test");
  const config = readDatabaseConfig("zplit_test");
  const pool = new Pool({ ...config, max: 12, connectionTimeoutMillis: 5_000 });
  const database = drizzle(pool, { schema }) as Database;
  const fixtures: Fixture[] = [];
  try {
    await runCoreChecks(pool, database, fixtures);
    await runRaceChecks(pool, database, fixtures);
    await runMigrationSmoke(config);
    console.log("group offset smoke passed");
  } catch (error) {
    console.error(`group offset smoke failed: ${formatSafeError(error, config.password)}`);
    process.exitCode = 1;
  } finally {
    await cleanup(pool, fixtures).catch((error) => {
      console.error(`group offset smoke cleanup failed: ${formatSafeError(error, config.password)}`);
      process.exitCode = 1;
    });
    await pool.end();
    await closeDatabase();
  }
}

if (process.argv[1]?.endsWith("group-offset-smoke.ts")) await runGroupOffsetSmoke();
