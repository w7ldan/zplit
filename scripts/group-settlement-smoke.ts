import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { closeDatabase, type Database } from "../src/db/client";
import { validateReceiptFile } from "../src/domain/receipt-file";
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
  createGroupSettlementProof,
  deleteGroupSettlementProof,
  replaceGroupSettlementProof,
} = await import("../src/server/group-settlement-proofs");
const {
  confirmGroupExpenseAsPayer,
  voidGroupExpenseAsPayer,
} = await import("../src/server/group-accounting");
const { removeGroupMember } = await import("../src/server/groups");

type Fixture = {
  groupId: string;
  ownerUserId: string;
  senderUserId: string;
  recipientUserId: string;
  ownerParticipantId: string;
  senderParticipantId: string;
  recipientParticipantId: string;
  userIds: string[];
};

type Debt = { expenseId: string; shareId: string; obligationId: string };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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
    ownerUserId: randomUUID(),
    senderUserId: randomUUID(),
    recipientUserId: randomUUID(),
    ownerParticipantId: randomUUID(),
    senderParticipantId: randomUUID(),
    recipientParticipantId: randomUUID(),
  } satisfies Omit<Fixture, "userIds">;
  const users = [
    [fixture.ownerUserId, "Settlement Owner"],
    [fixture.senderUserId, "Settlement Sender"],
    [fixture.recipientUserId, "Settlement Recipient"],
  ];
  for (const [userId, name] of users) {
    await pool.query(
      "INSERT INTO users (id, name, email, email_verified) VALUES ($1, $2, $3, true)",
      [userId, name, `${userId}@group-settlement.test`],
    );
  }
  await pool.query(
    "INSERT INTO groups (id, name, created_by_user_id) VALUES ($1, $2, $3)",
    [fixture.groupId, "Settlement smoke group", fixture.ownerUserId],
  );
  await pool.query(
    `INSERT INTO group_participants (id, group_id, user_id) VALUES
      ($1, $4, $5), ($2, $4, $6), ($3, $4, $7)`,
    [fixture.ownerParticipantId, fixture.senderParticipantId, fixture.recipientParticipantId, fixture.groupId, fixture.ownerUserId, fixture.senderUserId, fixture.recipientUserId],
  );
  await pool.query(
    `INSERT INTO group_memberships (group_id, user_id, participant_id, role) VALUES
      ($1, $2, $3, 'owner'), ($1, $4, $5, 'member'), ($1, $6, $7, 'member')`,
    [fixture.groupId, fixture.ownerUserId, fixture.ownerParticipantId, fixture.senderUserId, fixture.senderParticipantId, fixture.recipientUserId, fixture.recipientParticipantId],
  );
  return { ...fixture, userIds: users.map(([userId]) => userId) };
}

async function insertDebt(pool: Pool, fixture: Fixture, amount: number): Promise<Debt> {
  const debt = { expenseId: randomUUID(), shareId: randomUUID(), obligationId: randomUUID() };
  const now = new Date();
  await pool.query(
    `INSERT INTO group_expenses (id, group_id, creator_participant_id, payer_participant_id, description, occurred_at, total_amount, state, confirmed_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NULL, $6, $6)`,
    [debt.expenseId, fixture.groupId, fixture.ownerParticipantId, fixture.recipientParticipantId, `Debt ${debt.expenseId}`, now, amount],
  );
  await pool.query(
    `INSERT INTO group_expense_shares (id, group_id, expense_id, participant_id, amount, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [debt.shareId, fixture.groupId, debt.expenseId, fixture.senderParticipantId, amount, now],
  );
  await pool.query(
    "UPDATE group_expenses SET state = 'confirmed', confirmed_at = $2, updated_at = $2 WHERE id = $1",
    [debt.expenseId, now],
  );
  await pool.query(
    `INSERT INTO group_obligations (id, group_id, source_expense_id, source_share_id, debtor_participant_id, creditor_participant_id, original_amount, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [debt.obligationId, fixture.groupId, debt.expenseId, debt.shareId, fixture.senderParticipantId, fixture.recipientParticipantId, amount, now],
  );
  return debt;
}

async function insertPendingDebt(pool: Pool, fixture: Fixture, amount: number): Promise<Debt> {
  const debt = { expenseId: randomUUID(), shareId: randomUUID(), obligationId: randomUUID() };
  const now = new Date();
  await pool.query(
    `INSERT INTO group_expenses (id, group_id, creator_participant_id, payer_participant_id, description, occurred_at, total_amount, state, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $6, $6)`,
    [debt.expenseId, fixture.groupId, fixture.ownerParticipantId, fixture.recipientParticipantId, `Pending debt ${debt.expenseId}`, now, amount],
  );
  await pool.query(
    `INSERT INTO group_expense_shares (id, group_id, expense_id, participant_id, amount, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [debt.shareId, fixture.groupId, debt.expenseId, fixture.senderParticipantId, amount, now],
  );
  return debt;
}

async function holdParticipant(pool: Pool, participantId: string) {
  const client = await pool.connect();
  await client.query("BEGIN");
  const result = await client.query("SELECT id FROM group_participants WHERE id = $1 FOR UPDATE", [participantId]);
  assert(result.rowCount === 1, `participant ${participantId} was not found for lock coordination`);
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

async function blockedParticipantQueries(pool: Pool) {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM pg_stat_activity
     WHERE pid <> pg_backend_pid()
       AND state = 'active'
       AND query LIKE '%group_participants%'
       AND lower(query) LIKE '%for update%'`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function waitForBlockedParticipantQueries(pool: Pool, expected: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await blockedParticipantQueries(pool) >= expected) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`expected ${expected} blocked participant queries`);
}

function firstParticipant(fixture: Fixture) {
  return [fixture.senderParticipantId, fixture.recipientParticipantId].sort()[0]!;
}

async function orderedRace(pool: Pool, participantId: string, first: () => Promise<unknown>, second: () => Promise<unknown>) {
  const lock = await holdParticipant(pool, participantId);
  let released = false;
  const pending: Promise<unknown>[] = [];
  try {
    const firstResult = first();
    pending.push(firstResult);
    await waitForBlockedParticipantQueries(pool, 1);
    const secondResult = second();
    pending.push(secondResult);
    await waitForBlockedParticipantQueries(pool, 2);
    await lock.release();
    released = true;
    return Promise.allSettled([firstResult, secondResult]);
  } catch (error) {
    if (!released) {
      await lock.release(false);
      released = true;
    }
    const settled = await Promise.allSettled(pending);
    const rejected = settled.find((result) => result.status === "rejected");
    if (rejected?.status === "rejected" && error instanceof Error) {
      error.message += `; operation failed: ${errorCode(rejected.reason) ?? (rejected.reason instanceof Error ? rejected.reason.message : "unknown")}`;
    }
    throw error;
  } finally {
    if (!released) await lock.release(false);
  }
}

async function settlement(database: Database, fixture: Fixture, amount: number) {
  return createGroupSettlement(database, fixture.groupId, fixture.senderUserId, {
    senderParticipantId: fixture.senderParticipantId,
    recipientParticipantId: fixture.recipientParticipantId,
    amount,
    paymentMethod: "Bank transfer",
  });
}

async function balance(database: Database, fixture: Fixture) {
  const balances = await getGroupSettlementBalances(database, fixture.groupId, fixture.ownerUserId);
  return balances.find((row) => row.debtorParticipantId === fixture.senderParticipantId && row.creditorParticipantId === fixture.recipientParticipantId)?.amount ?? 0;
}

async function runLifecycleAndMigrationChecks(pool: Pool, database: Database, fixtures: Fixture[]) {
  const tables = ["group_settlements", "group_settlement_proofs"];
  const result = await pool.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
    [tables],
  );
  assert(new Set(result.rows.map(({ table_name }) => table_name)).size === tables.length, "settlement migration did not create both tables");

  const fixture = await insertFixture(pool);
  fixtures.push(fixture);
  await insertDebt(pool, fixture, 100);
  const externalParticipantId = randomUUID();
  await pool.query(
    "INSERT INTO group_participants (id, group_id, display_name) VALUES ($1, $2, $3)",
    [externalParticipantId, fixture.groupId, "Cash taxi"],
  );
  await expectCode(createGroupSettlement(database, fixture.groupId, fixture.senderUserId, {
    senderParticipantId: fixture.senderParticipantId,
    recipientParticipantId: externalParticipantId,
    amount: 1,
    paymentMethod: "Cash",
  }), "recipient_external");
  const pending = await settlement(database, fixture, 70);
  assert(pending.state === "pending", "settlement did not start pending");
  assert(await balance(database, fixture) === 100, "pending settlement changed the balance");
  await expectCode(settlement(database, fixture, 101), "debt_exceeded");
  await expectCode(createGroupSettlement(database, fixture.groupId, fixture.ownerUserId, {
    senderParticipantId: fixture.senderParticipantId,
    recipientParticipantId: fixture.recipientParticipantId,
    amount: 1,
    paymentMethod: "Cash",
  }), "forbidden");
  await expectCode(confirmGroupSettlement(database, fixture.groupId, pending.id, fixture.ownerUserId), "forbidden");
  const notificationCount = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM notifications WHERE recipient_user_id = $1 AND type = $2 AND dedupe_key = $3",
    [fixture.recipientUserId, "group.settlement.confirmation", `group-settlement-confirmation:${pending.id}`],
  );
  assert(notificationCount.rows[0]?.count === "1", "settlement creation did not create one deduplicated notification");
  const confirmed = await confirmGroupSettlement(database, fixture.groupId, pending.id, fixture.recipientUserId);
  assert(confirmed.state === "confirmed" && confirmed.confirmedAt !== null, "recipient confirmation did not persist");
  assert(await balance(database, fixture) === 30, "confirmed settlement did not reduce the balance once");
  const repeated = await confirmGroupSettlement(database, fixture.groupId, pending.id, fixture.recipientUserId);
  assert(repeated.state === "confirmed" && await balance(database, fixture) === 30, "repeated confirmation changed the balance");

  const directUpdate = await pool.query("UPDATE group_settlements SET amount = 1 WHERE id = $1", [pending.id]).then(() => null).catch((error) => error);
  assert(errorCode(directUpdate) === "P0001", "confirmed settlement financial fields were mutable");
  const directDelete = await pool.query("DELETE FROM group_settlements WHERE id = $1", [pending.id]).then(() => null).catch((error) => error);
  assert(errorCode(directDelete) === "P0001", "confirmed settlement was deletable");

  const removedSender = await insertFixture(pool);
  fixtures.push(removedSender);
  await insertDebt(pool, removedSender, 20);
  const senderPayment = await settlement(database, removedSender, 20);
  await removeGroupMember(database, removedSender.groupId, removedSender.ownerUserId, removedSender.senderUserId);
  const confirmedAfterSenderRemoval = await confirmGroupSettlement(database, removedSender.groupId, senderPayment.id, removedSender.recipientUserId);
  assert(confirmedAfterSenderRemoval.state === "confirmed", "sender removal incorrectly blocked recipient confirmation");

  const proofPayment = await settlement(database, fixture, 20);
  const proof = validateReceiptFile({
    bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    filename: "confirmed-proof.png",
    mediaType: "image/png",
  }, "Payment proof");
  const createdProof = await createGroupSettlementProof(database, fixture.groupId, proofPayment.id, fixture.senderUserId, proof);
  await confirmGroupSettlement(database, fixture.groupId, proofPayment.id, fixture.recipientUserId);
  const replacedAfterConfirmation = await replaceGroupSettlementProof(database, fixture.groupId, proofPayment.id, fixture.senderUserId, proof).catch((error) => error);
  const deletedAfterConfirmation = await deleteGroupSettlementProof(database, fixture.groupId, proofPayment.id, createdProof.id, fixture.senderUserId).catch((error) => error);
  assert(replacedAfterConfirmation instanceof Error && replacedAfterConfirmation.message.includes("pending"), "confirmed settlement proof was replaceable");
  assert(deletedAfterConfirmation instanceof Error && deletedAfterConfirmation.message.includes("pending"), "confirmed settlement proof was deletable");
}

async function runSameSettlementRace(pool: Pool, database: Database, fixtures: Fixture[]) {
  const fixture = await insertFixture(pool);
  fixtures.push(fixture);
  await insertDebt(pool, fixture, 100);
  const pending = await settlement(database, fixture, 70);
  const results = await orderedRace(pool, firstParticipant(fixture),
    () => confirmGroupSettlement(database, fixture.groupId, pending.id, fixture.recipientUserId),
    () => confirmGroupSettlement(database, fixture.groupId, pending.id, fixture.recipientUserId));
  assert(results.every((result) => result.status === "fulfilled"), "same-settlement confirmation was not idempotent");
  assert(await balance(database, fixture) === 30, "same settlement had more than one financial effect");
}

async function runTwoPendingRace(pool: Pool, database: Database, fixtures: Fixture[], reverse = false) {
  const fixture = await insertFixture(pool);
  fixtures.push(fixture);
  await insertDebt(pool, fixture, 100);
  const first = await settlement(database, fixture, 70);
  const second = await settlement(database, fixture, 70);
  const calls = [
    () => confirmGroupSettlement(database, fixture.groupId, first.id, fixture.recipientUserId),
    () => confirmGroupSettlement(database, fixture.groupId, second.id, fixture.recipientUserId),
  ];
  const results = await orderedRace(pool, firstParticipant(fixture), reverse ? calls[1]! : calls[0]!, reverse ? calls[0]! : calls[1]!);
  assert(results.filter((result) => result.status === "fulfilled").length === 1, "two pending settlements both confirmed");
  assert(results.filter((result) => result.status === "rejected" && errorCode(result.reason) === "debt_exceeded").length === 1, "losing settlement did not fail on current debt");
  assert(await balance(database, fixture) === 30, "two pending settlements overpaid the debt");
}

async function runExpenseConfirmRace(pool: Pool, database: Database, fixtures: Fixture[], settlementFirst: boolean) {
  const fixture = await insertFixture(pool);
  fixtures.push(fixture);
  await insertDebt(pool, fixture, 100);
  const payment = await settlement(database, fixture, 100);
  const expense = await insertPendingDebt(pool, fixture, 50);
  const confirmPayment = () => confirmGroupSettlement(database, fixture.groupId, payment.id, fixture.recipientUserId);
  const confirmExpense = () => confirmGroupExpenseAsPayer(database, fixture.groupId, expense.expenseId, fixture.recipientUserId);
  const results = await orderedRace(pool, fixture.recipientParticipantId, settlementFirst ? confirmPayment : confirmExpense, settlementFirst ? confirmExpense : confirmPayment);
  assert(results.every((result) => result.status === "fulfilled"), `settlement and expense confirmation did not serialize: ${results.map((result) => result.status === "rejected" ? errorCode(result.reason) ?? (result.reason instanceof Error ? result.reason.message : "unknown") : "fulfilled").join(",")}`);
  assert(await balance(database, fixture) === 50, "settlement and expense confirmation used a stale balance");
}

async function runExpenseVoidRace(pool: Pool, database: Database, fixtures: Fixture[], settlementFirst: boolean) {
  const fixture = await insertFixture(pool);
  fixtures.push(fixture);
  const debt = await insertDebt(pool, fixture, 100);
  const payment = await settlement(database, fixture, 100);
  const confirmPayment = () => confirmGroupSettlement(database, fixture.groupId, payment.id, fixture.recipientUserId);
  const voidExpense = () => voidGroupExpenseAsPayer(database, fixture.groupId, debt.expenseId, fixture.recipientUserId);
  const results = await orderedRace(pool, fixture.recipientParticipantId, settlementFirst ? confirmPayment : voidExpense, settlementFirst ? voidExpense : confirmPayment);
  if (settlementFirst) {
    assert(results.every((result) => result.status === "fulfilled"), `settlement-first void race did not serialize: ${results.map((result) => result.status === "rejected" ? errorCode(result.reason) ?? (result.reason instanceof Error ? result.reason.message : "unknown") : "fulfilled").join(",")}`);
    const row = await pool.query<{ state: string; confirmed_at: Date | null }>("SELECT state, confirmed_at FROM group_settlements WHERE id = $1", [payment.id]);
    assert(row.rows[0]?.state === "confirmed" && row.rows[0]?.confirmed_at !== null, "payment history was rewritten by a later void");
  } else {
    assert(results.filter((result) => result.status === "fulfilled").length === 1, "void-first race allowed an overpayment");
    assert(results.some((result) => result.status === "rejected" && errorCode(result.reason) === "debt_exceeded"), "void-first settlement did not recompute debt");
  }
}

async function runMembershipRace(pool: Pool, database: Database, fixtures: Fixture[], participant: "sender" | "recipient", operation: "create" | "confirm", createFirst: boolean) {
  const fixture = await insertFixture(pool);
  fixtures.push(fixture);
  await insertDebt(pool, fixture, 100);
  const payment = await settlement(database, fixture, 50);
  const participantId = participant === "sender" ? fixture.senderParticipantId : fixture.recipientParticipantId;
  const userId = participant === "sender" ? fixture.senderUserId : fixture.recipientUserId;
  const financialOperation = () => operation === "create"
    ? settlement(database, fixture, 25)
    : confirmGroupSettlement(database, fixture.groupId, payment.id, fixture.recipientUserId);
  const createOrConfirm = createFirst
    ? financialOperation
    : () => removeGroupMember(database, fixture.groupId, fixture.ownerUserId, userId);
  const removeOrCreate = createFirst
    ? () => removeGroupMember(database, fixture.groupId, fixture.ownerUserId, userId)
    : financialOperation;
  const results = await orderedRace(pool, participantId, createOrConfirm, removeOrCreate);
  if (participant === "recipient") {
    if (createFirst) assert(results.every((result) => result.status === "fulfilled"), "confirmation-first recipient removal race failed");
    else assert(results.some((result) => result.status === "rejected" && errorCode(result.reason) === "recipient_not_active"), "removal-first confirmation used stale membership");
  } else if (createFirst) {
    assert(results.every((result) => result.status === "fulfilled"), "creation-first sender removal race failed");
  } else {
    assert(results.some((result) => result.status === "rejected" && errorCode(result.reason) === "sender_not_active"), "removal-first sender creation used stale membership");
  }
}

async function runProofRace(pool: Pool, database: Database, fixtures: Fixture[], proofFirst: boolean) {
  const fixture = await insertFixture(pool);
  fixtures.push(fixture);
  await insertDebt(pool, fixture, 100);
  const payment = await settlement(database, fixture, 50);
  const proof = validateReceiptFile({
    bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    filename: "proof.png",
    mediaType: "image/png",
  }, "Payment proof");
  const attach = () => createGroupSettlementProof(database, fixture.groupId, payment.id, fixture.senderUserId, proof);
  const confirm = () => confirmGroupSettlement(database, fixture.groupId, payment.id, fixture.recipientUserId);
  const results = await orderedRace(pool, fixture.senderParticipantId, proofFirst ? attach : confirm, proofFirst ? confirm : attach);
  if (proofFirst) {
    assert(results.every((result) => result.status === "fulfilled"), "proof-first race did not preserve pending proof");
    const row = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM group_settlement_proofs WHERE settlement_id = $1", [payment.id]);
    assert(row.rows[0]?.count === "1", "proof-first race lost the proof");
  } else {
    assert(results.some((result) => result.status === "rejected" && errorCode(result.reason) === undefined), "confirmation-first proof mutation unexpectedly succeeded");
  }
}

async function cleanup(pool: Pool, fixtures: Fixture[]) {
  if (fixtures.length === 0) return;
  const groupIds = fixtures.map(({ groupId }) => groupId);
  const userIds = fixtures.flatMap(({ userIds }) => userIds);
  await pool.query("DROP TRIGGER IF EXISTS group_settlement_proofs_pending_only ON group_settlement_proofs");
  await pool.query("DROP TRIGGER IF EXISTS group_settlements_historical_facts ON group_settlements");
  try {
    await pool.query("DELETE FROM group_settlement_proofs WHERE group_id = ANY($1::uuid[])", [groupIds]);
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
    await pool.query("CREATE TRIGGER group_settlements_historical_facts BEFORE INSERT OR UPDATE OR DELETE ON group_settlements FOR EACH ROW EXECUTE FUNCTION zplit_validate_group_settlement()");
    await pool.query("CREATE TRIGGER group_settlement_proofs_pending_only BEFORE INSERT OR UPDATE OR DELETE ON group_settlement_proofs FOR EACH ROW EXECUTE FUNCTION zplit_validate_group_settlement_proof()");
  }
}

export async function runGroupSettlementSmoke() {
  if (process.env.DB_NAME !== "zplit_test") throw new Error("Group settlement smoke requires DB_NAME=zplit_test");
  const config = readDatabaseConfig("zplit_test");
  const pool = new Pool({ ...config, max: 8, connectionTimeoutMillis: 5_000 });
  const database = drizzle(pool, { schema }) as Database;
  const fixtures: Fixture[] = [];
  try {
    await runLifecycleAndMigrationChecks(pool, database, fixtures);
    await runSameSettlementRace(pool, database, fixtures);
    await runTwoPendingRace(pool, database, fixtures);
    await runTwoPendingRace(pool, database, fixtures, true);
    await runExpenseConfirmRace(pool, database, fixtures, false);
    await runExpenseConfirmRace(pool, database, fixtures, true);
    await runExpenseVoidRace(pool, database, fixtures, false);
    await runExpenseVoidRace(pool, database, fixtures, true);
    await runMembershipRace(pool, database, fixtures, "recipient", "confirm", false);
    await runMembershipRace(pool, database, fixtures, "recipient", "confirm", true);
    await runMembershipRace(pool, database, fixtures, "recipient", "create", false);
    await runMembershipRace(pool, database, fixtures, "recipient", "create", true);
    await runMembershipRace(pool, database, fixtures, "sender", "create", false);
    await runMembershipRace(pool, database, fixtures, "sender", "create", true);
    await runProofRace(pool, database, fixtures, true);
    await runProofRace(pool, database, fixtures, false);
    console.log("group settlement smoke passed");
  } catch (error) {
    console.error(`group settlement smoke failed: ${formatSafeError(error, config.password)}`);
    process.exitCode = 1;
  } finally {
    await cleanup(pool, fixtures).catch((error) => {
      console.error(`group settlement smoke cleanup failed: ${formatSafeError(error, config.password)}`);
      process.exitCode = 1;
    });
    await pool.end();
    await closeDatabase();
  }
}

if (process.argv[1]?.endsWith("group-settlement-smoke.ts")) await runGroupSettlementSmoke();
