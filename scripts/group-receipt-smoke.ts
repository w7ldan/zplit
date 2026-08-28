import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/client";
import { formatSafeError, readDatabaseConfig } from "./migrate.js";

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
if (!require.cache[serverOnlyPath]) require.cache[serverOnlyPath] = { exports: {} } as never;

const { createGroupExpense } = await import("../src/server/group-accounting");
const { createGroup, removeGroupMember } = await import("../src/server/groups");
const { createGroupExpenseReceipt, deleteGroupExpenseReceipt, getGroupExpenseReceipt, GroupExpenseReceiptPermissionError } = await import("../src/server/group-expense-receipts");

type Fixture = {
  groupId: string;
  ownerId: string;
  creatorId: string;
  creatorParticipantId: string;
  expenseId: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function file(seed: string) {
  return { originalFilename: `${seed}.png`, mediaType: "image/png" as const, byteSize: 4, sha256: seed.repeat(64), content: Uint8Array.from([1, 2, 3, 4]) };
}

async function expectRejected(action: () => Promise<unknown>, message: string, errorType?: new (...args: never[]) => Error) {
  try {
    await action();
  } catch (error) {
    if (errorType && !(error instanceof errorType)) throw new Error(`${message}: unexpected error ${formatSafeError(error)}`);
    return error;
  }
  throw new Error(`${message}: operation succeeded`);
}

async function participantId(pool: Pool, groupId: string, userId: string) {
  const result = await pool.query<{ participant_id: string }>("SELECT participant_id FROM group_memberships WHERE group_id = $1 AND user_id = $2", [groupId, userId]);
  assert(result.rows[0]?.participant_id, `missing participant for ${userId}`);
  return result.rows[0].participant_id;
}

async function addMember(pool: Pool, groupId: string, userId: string) {
  const participant = randomUUID();
  await pool.query("INSERT INTO group_participants (id, group_id, user_id) VALUES ($1, $2, $3)", [participant, groupId, userId]);
  await pool.query("INSERT INTO group_memberships (group_id, user_id, participant_id, role) VALUES ($1, $2, $3, 'member')", [groupId, userId, participant]);
  return participant;
}

async function pendingExpense(database: Database, groupId: string, creatorId: string, payerParticipantId: string, description: string) {
  const expense = await createGroupExpense(database, groupId, creatorId, {
    description,
    occurredAt: new Date("2026-08-28T12:00:00.000Z"),
    totalAmount: 4,
    payerParticipantId,
    shares: [{ participantId: payerParticipantId, amount: 4 }],
  });
  assert(expense.state === "pending", `${description} was not pending`);
  return expense.id;
}

async function holdMembership(pool: Pool, groupId: string, userId: string) {
  const client = await pool.connect();
  await client.query("BEGIN");
  await client.query("SELECT participant_id FROM group_memberships WHERE group_id = $1 AND user_id = $2 FOR UPDATE", [groupId, userId]);
  let released = false;
  return {
    async release(commit = true) {
      if (released) return;
      released = true;
      try { await client.query(commit ? "COMMIT" : "ROLLBACK"); } finally { client.release(); }
    },
  };
}

async function waitForParticipantLock(pool: Pool, id: string) {
  const client = await pool.connect();
  const deadline = Date.now() + 5_000;
  try {
    while (Date.now() < deadline) {
      await client.query("BEGIN");
      try {
        await client.query("SELECT id FROM group_participants WHERE id = $1 FOR UPDATE NOWAIT", [id]);
      } catch (error) {
        await client.query("ROLLBACK");
        if (error instanceof Error && "code" in error && error.code === "55P03") return;
        throw error;
      }
      await client.query("ROLLBACK");
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  } finally {
    client.release();
  }
  throw new Error(`participant lock was not observed for ${id}`);
}

async function waitForExpenseLock(pool: Pool, id: string) {
  const client = await pool.connect();
  const deadline = Date.now() + 5_000;
  try {
    while (Date.now() < deadline) {
      await client.query("BEGIN");
      try {
        await client.query("SELECT id FROM group_expenses WHERE id = $1 FOR UPDATE NOWAIT", [id]);
      } catch (error) {
        await client.query("ROLLBACK");
        if (error instanceof Error && "code" in error && error.code === "55P03") return;
        throw error;
      }
      await client.query("ROLLBACK");
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  } finally {
    client.release();
  }
  throw new Error(`expense lock was not observed for ${id}`);
}

async function countReceipts(pool: Pool, groupId: string, expenseId: string) {
  const result = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM group_expense_receipts WHERE group_id = $1 AND expense_id = $2", [groupId, expenseId]);
  return Number(result.rows[0]?.count ?? 0);
}

async function hasMembership(pool: Pool, groupId: string, userId: string) {
  const result = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM group_memberships WHERE group_id = $1 AND user_id = $2", [groupId, userId]);
  return Number(result.rows[0]?.count ?? 0) === 1;
}

async function raceFixture(pool: Pool, database: Database, ownerId: string, creatorId: string, groupIds: string[], label: string): Promise<Fixture> {
  const group = await createGroup(database, ownerId, { name: `Receipt race ${label} ${randomUUID()}` });
  groupIds.push(group.id);
  const ownerParticipantId = await participantId(pool, group.id, ownerId);
  const creatorParticipantId = await addMember(pool, group.id, creatorId);
  const expenseId = await pendingExpense(database, group.id, creatorId, ownerParticipantId, `Race seed ${label}`);
  return { groupId: group.id, ownerId, creatorId, creatorParticipantId, expenseId };
}

async function runUploadRaces(pool: Pool, database: Database, ownerId: string, creatorId: string, groupIds: string[]) {
  const uploadFirst = await raceFixture(pool, database, ownerId, creatorId, groupIds, "upload first");
  const uploadHold = await holdMembership(pool, uploadFirst.groupId, creatorId);
  let uploadReleased = false;
  try {
    let settled = false;
    const upload = createGroupExpenseReceipt(database, uploadFirst.groupId, uploadFirst.expenseId, creatorId, file("a")).finally(() => { settled = true; });
    await waitForParticipantLock(pool, uploadFirst.creatorParticipantId);
    assert(!settled, "upload did not wait on the held membership");
    const removal = removeGroupMember(database, uploadFirst.groupId, ownerId, creatorId);
    await uploadHold.release();
    uploadReleased = true;
    const [uploadResult, removalResult] = await Promise.allSettled([upload, removal]);
    assert(uploadResult.status === "fulfilled" && removalResult.status === "fulfilled", "upload-first race did not serialize");
    assert(await countReceipts(pool, uploadFirst.groupId, uploadFirst.expenseId) === 1, "upload-first receipt did not survive");
    assert(!await hasMembership(pool, uploadFirst.groupId, creatorId), "upload-first removal did not complete");
  } finally {
    if (!uploadReleased) await uploadHold.release(false);
  }

  const removalFirst = await raceFixture(pool, database, ownerId, creatorId, groupIds, "upload removal first");
  const removalHold = await holdMembership(pool, removalFirst.groupId, creatorId);
  let removalReleased = false;
  try {
    const removal = removeGroupMember(database, removalFirst.groupId, ownerId, creatorId);
    await waitForParticipantLock(pool, removalFirst.creatorParticipantId);
    const upload = createGroupExpenseReceipt(database, removalFirst.groupId, removalFirst.expenseId, creatorId, file("b"));
    await waitForExpenseLock(pool, removalFirst.expenseId);
    await removalHold.release();
    removalReleased = true;
    const [removalResult, uploadResult] = await Promise.allSettled([removal, upload]);
    assert(removalResult.status === "fulfilled", "upload removal-first removal failed");
    assert(uploadResult.status === "rejected" && uploadResult.reason instanceof GroupExpenseReceiptPermissionError, "upload removal-first accepted stale membership");
    assert(await countReceipts(pool, removalFirst.groupId, removalFirst.expenseId) === 0, "rejected upload left receipt metadata");
    assert(!await hasMembership(pool, removalFirst.groupId, creatorId), "upload removal-first membership survived");
  } finally {
    if (!removalReleased) await removalHold.release(false);
  }
}

async function runDeleteRaces(pool: Pool, database: Database, ownerId: string, creatorId: string, groupIds: string[]) {
  const deleteFirst = await raceFixture(pool, database, ownerId, creatorId, groupIds, "delete first");
  const deleteReceipt = await createGroupExpenseReceipt(database, deleteFirst.groupId, deleteFirst.expenseId, creatorId, file("c"));
  const deleteHold = await holdMembership(pool, deleteFirst.groupId, creatorId);
  let deleteReleased = false;
  try {
    let settled = false;
    const deletion = deleteGroupExpenseReceipt(database, deleteFirst.groupId, deleteFirst.expenseId, deleteReceipt.id, creatorId).finally(() => { settled = true; });
    await waitForParticipantLock(pool, deleteFirst.creatorParticipantId);
    assert(!settled, "delete did not wait on the held membership");
    const removal = removeGroupMember(database, deleteFirst.groupId, ownerId, creatorId);
    await deleteHold.release();
    deleteReleased = true;
    const [deleteResult, removalResult] = await Promise.allSettled([deletion, removal]);
    assert(deleteResult.status === "fulfilled" && deleteResult.value && removalResult.status === "fulfilled", "delete-first race did not serialize");
    assert(await countReceipts(pool, deleteFirst.groupId, deleteFirst.expenseId) === 0, "delete-first receipt survived");
    assert(!await hasMembership(pool, deleteFirst.groupId, creatorId), "delete-first removal did not complete");
  } finally {
    if (!deleteReleased) await deleteHold.release(false);
  }

  const removalFirst = await raceFixture(pool, database, ownerId, creatorId, groupIds, "delete removal first");
  const removalReceipt = await createGroupExpenseReceipt(database, removalFirst.groupId, removalFirst.expenseId, creatorId, file("d"));
  const removalHold = await holdMembership(pool, removalFirst.groupId, creatorId);
  let removalReleased = false;
  try {
    const removal = removeGroupMember(database, removalFirst.groupId, ownerId, creatorId);
    await waitForParticipantLock(pool, removalFirst.creatorParticipantId);
    const deletion = deleteGroupExpenseReceipt(database, removalFirst.groupId, removalFirst.expenseId, removalReceipt.id, creatorId);
    await waitForExpenseLock(pool, removalFirst.expenseId);
    await removalHold.release();
    removalReleased = true;
    const [removalResult, deleteResult] = await Promise.allSettled([removal, deletion]);
    assert(removalResult.status === "fulfilled", "delete removal-first removal failed");
    assert(deleteResult.status === "rejected" && deleteResult.reason instanceof GroupExpenseReceiptPermissionError, "delete removal-first accepted stale membership");
    assert(await countReceipts(pool, removalFirst.groupId, removalFirst.expenseId) === 1, "rejected delete removed the receipt");
    const remaining = await getGroupExpenseReceipt(database, removalFirst.groupId, removalFirst.expenseId, removalReceipt.id, ownerId);
    assert(remaining?.content.equals(Buffer.from([1, 2, 3, 4])), "rejected delete changed receipt storage");
    assert(!await hasMembership(pool, removalFirst.groupId, creatorId), "delete removal-first membership survived");
  } finally {
    if (!removalReleased) await removalHold.release(false);
  }
}

export async function runGroupReceiptSmoke() {
  if (process.env.DB_NAME !== "zplit_test") throw new Error("Group receipt smoke requires DB_NAME=zplit_test");
  const config = readDatabaseConfig("zplit_test");
  const pool = new Pool({ ...config, max: 8, connectionTimeoutMillis: 5_000 });
  const database = drizzle(pool, { schema });
  const users = ["owner", "creator", "member", "former", "outsider"].map((label) => ({ id: randomUUID(), label, username: `s12br_${randomUUID().replaceAll("-", "").slice(0, 13)}` }));
  const groupIds: string[] = [];
  try {
    for (const user of users) await pool.query("INSERT INTO users (id, name, email, username, email_verified) VALUES ($1, $2, $3, $4, true)", [user.id, user.label, `${user.id}@example.com`, user.username]);

    const group = await createGroup(database, users[0]!.id, { name: `Group receipts ${randomUUID()}` });
    groupIds.push(group.id);
    const ownerParticipantId = await participantId(pool, group.id, users[0]!.id);
    await addMember(pool, group.id, users[1]!.id);
    await addMember(pool, group.id, users[2]!.id);
    const formerParticipantId = await addMember(pool, group.id, users[3]!.id);
    const creatorExpenseId = await pendingExpense(database, group.id, users[1]!.id, ownerParticipantId, "Creator pending expense");
    const creatorReceipt = await createGroupExpenseReceipt(database, group.id, creatorExpenseId, users[1]!.id, file("e"));
    const otherExpenseId = await pendingExpense(database, group.id, users[1]!.id, ownerParticipantId, "Other pending expense");
    const formerExpenseId = await pendingExpense(database, group.id, users[3]!.id, ownerParticipantId, "Former pending expense");
    const formerReceipt = await createGroupExpenseReceipt(database, group.id, formerExpenseId, users[3]!.id, file("f"));
    await removeGroupMember(database, group.id, users[0]!.id, users[3]!.id);
    const former = await pool.query<{ id: string; user_id: string | null }>("SELECT id, user_id FROM group_participants WHERE group_id = $1 AND id = $2", [group.id, formerParticipantId]);
    assert(former.rows[0]?.id === formerParticipantId && former.rows[0]?.user_id === users[3]!.id, "former participant changed identity");

    const uploaded = await createGroupExpenseReceipt(database, group.id, creatorExpenseId, users[1]!.id, file("a"));
    assert(uploaded.id !== creatorReceipt.id && await countReceipts(pool, group.id, creatorExpenseId) === 2, "creator upload was not accepted");
    await expectRejected(() => createGroupExpenseReceipt(database, group.id, creatorExpenseId, users[2]!.id, file("h")), "non-creator upload");
    await expectRejected(() => deleteGroupExpenseReceipt(database, group.id, creatorExpenseId, creatorReceipt.id, users[2]!.id), "non-creator delete");
    await expectRejected(() => createGroupExpenseReceipt(database, group.id, creatorExpenseId, users[4]!.id, file("i")), "non-member upload");
    await expectRejected(() => deleteGroupExpenseReceipt(database, group.id, creatorExpenseId, creatorReceipt.id, users[4]!.id), "non-member delete");
    await expectRejected(() => createGroupExpenseReceipt(database, group.id, formerExpenseId, users[3]!.id, file("j")), "former-member upload");
    await expectRejected(() => deleteGroupExpenseReceipt(database, group.id, formerExpenseId, formerReceipt.id, users[3]!.id), "former-member delete");
    assert(await getGroupExpenseReceipt(database, group.id, creatorExpenseId, creatorReceipt.id, users[1]!.id), "authorized receipt read failed");
    assert(await deleteGroupExpenseReceipt(database, group.id, creatorExpenseId, creatorReceipt.id, users[1]!.id), "authorized receipt delete failed");
    assert(await countReceipts(pool, group.id, creatorExpenseId) === 1, "authorized delete removed the wrong receipt");

    const confirmed = await createGroupExpense(database, group.id, users[0]!.id, { description: "Confirmed expense", occurredAt: new Date("2026-08-28T13:00:00.000Z"), totalAmount: 4, payerParticipantId: ownerParticipantId, shares: [{ participantId: ownerParticipantId, amount: 4 }] });
    await expectRejected(() => createGroupExpenseReceipt(database, group.id, confirmed.id, users[0]!.id, file("k")), "confirmed-expense upload");
    assert(await countReceipts(pool, group.id, confirmed.id) === 0, "confirmed expense gained a receipt");

    const foreignGroup = await createGroup(database, users[4]!.id, { name: `Foreign receipts ${randomUUID()}` });
    groupIds.push(foreignGroup.id);
    await expectRejected(() => getGroupExpenseReceipt(database, foreignGroup.id, creatorExpenseId, uploaded.id, users[4]!.id), "cross-Group read");
    await expectRejected(() => createGroupExpenseReceipt(database, foreignGroup.id, creatorExpenseId, users[4]!.id, file("l")), "cross-Group upload");
    await expectRejected(() => deleteGroupExpenseReceipt(database, foreignGroup.id, creatorExpenseId, uploaded.id, users[4]!.id), "cross-Group delete");
    assert(await getGroupExpenseReceipt(database, group.id, otherExpenseId, uploaded.id, users[1]!.id) === null, "wrong expense/receipt pairing bypassed scoping");
    assert(await deleteGroupExpenseReceipt(database, group.id, otherExpenseId, uploaded.id, users[1]!.id) === false, "wrong expense/receipt delete bypassed scoping");
    assert(await getGroupExpenseReceipt(database, group.id, creatorExpenseId, randomUUID(), users[1]!.id) === null, "guessed receipt ID bypassed scoping");
    assert(await deleteGroupExpenseReceipt(database, group.id, creatorExpenseId, randomUUID(), users[1]!.id) === false, "guessed receipt delete bypassed scoping");

    await runUploadRaces(pool, database, users[0]!.id, users[1]!.id, groupIds);
    await runDeleteRaces(pool, database, users[0]!.id, users[1]!.id, groupIds);
    console.log("group receipt smoke passed");
  } catch (error) {
    console.error(`group receipt smoke failed: ${formatSafeError(error)}`);
    process.exitCode = 1;
  } finally {
    if (groupIds.length > 0) {
      await pool.query("DELETE FROM group_expense_receipts WHERE group_id = ANY($1::uuid[])", [groupIds]);
      await pool.query("DELETE FROM group_expense_lifecycle_events WHERE group_id = ANY($1::uuid[])", [groupIds]);
      await pool.query("DELETE FROM group_obligations WHERE group_id = ANY($1::uuid[])", [groupIds]);
      await pool.query("DELETE FROM group_expense_shares WHERE group_id = ANY($1::uuid[])", [groupIds]);
      await pool.query("DELETE FROM group_expenses WHERE group_id = ANY($1::uuid[])", [groupIds]);
      await pool.query("DELETE FROM group_memberships WHERE group_id = ANY($1::uuid[])", [groupIds]);
      await pool.query("DELETE FROM group_participants WHERE group_id = ANY($1::uuid[])", [groupIds]);
      await pool.query("DELETE FROM groups WHERE id = ANY($1::uuid[])", [groupIds]);
    }
    await pool.query("DELETE FROM users WHERE id = ANY($1::text[])", [users.map(({ id }) => id)]);
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("group-receipt-smoke.ts")) await runGroupReceiptSmoke();
