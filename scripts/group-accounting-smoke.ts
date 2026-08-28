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
const { createGroupExpense, confirmGroupExpenseAsPayer, createGroupAccountingRepository } = await import("../src/server/group-accounting");
const { createExternalParticipant, createGroup, removeGroupMember } = await import("../src/server/groups");
const { acceptGroupJoinRequest, createGroupParticipantLinkRequest } = await import("../src/server/group-join-requests");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function errorCode(error: unknown) {
  return error instanceof Error && "code" in error ? (error as { code?: unknown }).code : error instanceof Error && error.cause && typeof error.cause === "object" && "code" in error.cause ? (error.cause as { code?: unknown }).code : undefined;
}

async function expectCode(action: () => Promise<unknown>, code: string) {
  try {
    await action();
  } catch (error) {
    const actualCode = errorCode(error);
    assert(actualCode === code, `expected ${code}, got ${error instanceof Error ? `${error.message} ${String(actualCode ?? "")}` : "unknown"}`);
    return;
  }
  throw new Error(`expected ${code}`);
}

async function count(pool: Pool, table: string, groupId: string, expenseId?: string) {
  const result = expenseId
    ? await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table} WHERE group_id = $1 AND source_expense_id = $2`, [groupId, expenseId])
    : await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table} WHERE group_id = $1`, [groupId]);
  return Number(result.rows[0]?.count ?? 0);
}

async function installObligationFailure(pool: Pool, expenseId: string) {
  await pool.query(`CREATE FUNCTION zplit_smoke_fail_group_obligation() RETURNS trigger LANGUAGE plpgsql AS $function$ BEGIN IF NEW.source_expense_id = '${expenseId}'::uuid THEN RAISE EXCEPTION 'forced Group obligation failure'; END IF; RETURN NEW; END; $function$`);
  await pool.query("CREATE TRIGGER zplit_smoke_fail_group_obligation_trigger BEFORE INSERT ON group_obligations FOR EACH ROW EXECUTE FUNCTION zplit_smoke_fail_group_obligation()");
}

async function removeObligationFailure(pool: Pool) {
  await pool.query("DROP TRIGGER IF EXISTS zplit_smoke_fail_group_obligation_trigger ON group_obligations");
  await pool.query("DROP FUNCTION IF EXISTS zplit_smoke_fail_group_obligation()");
}

async function addMember(pool: Pool, groupId: string, userId: string) {
  const participantId = randomUUID();
  await pool.query("INSERT INTO group_participants (id, group_id, user_id) VALUES ($1, $2, $3)", [participantId, groupId, userId]);
  await pool.query("INSERT INTO group_memberships (group_id, user_id, participant_id, role) VALUES ($1, $2, $3, 'member')", [groupId, userId, participantId]);
  return participantId;
}

async function holdMembership(pool: Pool, groupId: string, userId: string) {
  const client = await pool.connect();
  try {
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
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    throw error;
  }
}

async function waitForParticipantLock(pool: Pool, participantId: string) {
  const client = await pool.connect();
  const deadline = Date.now() + 5_000;
  try {
    while (Date.now() < deadline) {
      await client.query("BEGIN");
      try {
        await client.query("SELECT id FROM group_participants WHERE id = $1 FOR UPDATE NOWAIT", [participantId]);
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
  throw new Error(`participant lock was not observed for ${participantId}`);
}

async function raceFixture(pool: Pool, database: Database, ownerId: string, memberId: string, groupIds: string[]) {
  const group = await createGroup(database, ownerId, { name: "Membership race" });
  groupIds.push(group.id);
  const ownerParticipant = (await pool.query<{ participant_id: string }>("SELECT participant_id FROM group_memberships WHERE group_id = $1 AND user_id = $2", [group.id, ownerId])).rows[0]!.participant_id;
  const memberParticipant = await addMember(pool, group.id, memberId);
  await createGroupExpense(database, group.id, ownerId, {
    description: "History seed",
    occurredAt: new Date("2026-08-27T22:00:00.000Z"),
    totalAmount: 1,
    payerParticipantId: ownerParticipant,
    shares: [{ participantId: memberParticipant, amount: 1 }],
  });
  return { groupId: group.id, ownerParticipant, memberParticipant };
}

async function countRaceRows(pool: Pool, groupId: string, memberId: string, participantId: string, description: string) {
  const membership = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM group_memberships WHERE group_id = $1 AND user_id = $2", [groupId, memberId]);
  const expenses = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM group_expenses WHERE group_id = $1 AND description = $2", [groupId, description]);
  const shares = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM group_expense_shares WHERE group_id = $1 AND participant_id = $2 AND expense_id IN (SELECT id FROM group_expenses WHERE group_id = $1 AND description = $3)", [groupId, participantId, description]);
  const expenseShares = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM group_expense_shares WHERE group_id = $1 AND expense_id IN (SELECT id FROM group_expenses WHERE group_id = $1 AND description = $2)", [groupId, description]);
  const obligations = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM group_obligations WHERE group_id = $1 AND source_expense_id IN (SELECT id FROM group_expenses WHERE group_id = $1 AND description = $2)", [groupId, description]);
  return { membership: Number(membership.rows[0]?.count ?? 0), expenses: Number(expenses.rows[0]?.count ?? 0), shares: Number(shares.rows[0]?.count ?? 0), expenseShares: Number(expenseShares.rows[0]?.count ?? 0), obligations: Number(obligations.rows[0]?.count ?? 0) };
}

export async function runGroupAccountingSmoke() {
  if (process.env.DB_NAME !== "zplit_test") throw new Error("Group accounting smoke requires DB_NAME=zplit_test");
  const config = readDatabaseConfig("zplit_test");
  const pool = new Pool({ ...config, max: 8, connectionTimeoutMillis: 5_000 });
  const database = drizzle(pool, { schema });
  const users = ["owner", "payer", "member", "other"].map((label) => ({ id: randomUUID(), label, username: `s12a_${label}_${randomUUID().replaceAll("-", "").slice(0, 6)}` }));
  const groupIds: string[] = [];
  const participantIds: string[] = [];
  let failureTriggerInstalled = false;

  try {
    for (const user of users) await pool.query("INSERT INTO users (id, name, email, username, email_verified) VALUES ($1, $2, $3, $4, true)", [user.id, user.label, `${user.id}@example.com`, user.username]);
    const group = await createGroup(database, users[0]!.id, { name: "Accounting smoke" });
    groupIds.push(group.id);
    const ownerParticipant = (await pool.query<{ participant_id: string }>("SELECT participant_id FROM group_memberships WHERE group_id = $1 AND user_id = $2", [group.id, users[0]!.id])).rows[0]!.participant_id;
    const payerParticipant = await addMember(pool, group.id, users[1]!.id);
    const memberParticipant = await addMember(pool, group.id, users[2]!.id);
    participantIds.push(ownerParticipant, payerParticipant, memberParticipant);
    const external = await createExternalParticipant(database, group.id, users[0]!.id, { displayName: "Taxi", label: "Driver" });
    participantIds.push(external.id);

    const selfExpense = await createGroupExpense(database, group.id, users[0]!.id, {
      description: "Self payer",
      occurredAt: new Date("2026-08-27T12:00:00.000Z"),
      totalAmount: 100_000,
      payerParticipantId: ownerParticipant,
      shares: [
        { participantId: ownerParticipant, amount: 30_000 },
        { participantId: payerParticipant, amount: 20_000 },
        { participantId: memberParticipant, amount: 50_000 },
      ],
    });
    assert(selfExpense.state === "confirmed", "self-payer expense was not confirmed");
    assert(selfExpense.shares.length === 3 && selfExpense.obligations.length === 2, "self-payer rows are incomplete");
    assert(selfExpense.obligations.every((obligation) => obligation.creditorParticipantId === ownerParticipant), "self-payer creditor is wrong");

    const pendingExpense = await createGroupExpense(database, group.id, users[0]!.id, {
      description: "Third-party payer",
      occurredAt: new Date("2026-08-27T13:00:00.000Z"),
      totalAmount: 100_000,
      payerParticipantId: payerParticipant,
      shares: [
        { participantId: ownerParticipant, amount: 30_000 },
        { participantId: payerParticipant, amount: 20_000 },
        { participantId: external.id, amount: 50_000 },
      ],
    });
    assert(pendingExpense.state === "pending" && pendingExpense.obligations.length === 0, "third-party payer claim was authoritative too early");
    const confirmedExpense = await confirmGroupExpenseAsPayer(database, group.id, pendingExpense.id, users[1]!.id);
    assert(confirmedExpense.state === "confirmed" && confirmedExpense.obligations.length === 2, "payer confirmation did not materialize exact obligations");
    assert(confirmedExpense.obligations.some((obligation) => obligation.debtorParticipantId === external.id && obligation.creditorParticipantId === payerParticipant), "external debtor obligation is missing");
    await confirmGroupExpenseAsPayer(database, group.id, pendingExpense.id, users[1]!.id);
    assert(await count(pool, "group_obligations", group.id, pendingExpense.id) === 2, "repeated confirmation duplicated obligations");

    const beforeExternalPayer = await count(pool, "group_expenses", group.id);
    await expectCode(() => createGroupExpense(database, group.id, users[0]!.id, {
      description: "External payer",
      occurredAt: new Date("2026-08-27T14:00:00.000Z"),
      totalAmount: 1,
      payerParticipantId: external.id,
      shares: [{ participantId: external.id, amount: 1 }],
    }), "payer_external");
    assert(await count(pool, "group_expenses", group.id) === beforeExternalPayer, "external payer failure persisted an expense");
    const registeredShare = selfExpense.shares.find((share) => share.participantId === payerParticipant);
    assert(registeredShare, "registered source share is missing");
    await expectCode(() => pool.query("INSERT INTO group_obligations (group_id, source_expense_id, source_share_id, debtor_participant_id, creditor_participant_id, original_amount) VALUES ($1, $2, $3, $4, $5, $6)", [group.id, selfExpense.id, registeredShare.id, payerParticipant, external.id, registeredShare.amount]).then(() => undefined), "P0001");

    for (const totalAmount of [99_999, 100_001]) {
      await expectCode(() => createGroupExpense(database, group.id, users[0]!.id, {
        description: "Invalid allocation",
        occurredAt: new Date("2026-08-27T15:00:00.000Z"),
        totalAmount,
        payerParticipantId: ownerParticipant,
        shares: [{ participantId: ownerParticipant, amount: 100_000 }],
      }), "share_total_mismatch");
    }
    await expectCode(() => createGroupExpense(database, group.id, users[0]!.id, {
      description: "Invalid amount",
      occurredAt: new Date("2026-08-27T15:00:00.000Z"),
      totalAmount: 1,
      payerParticipantId: ownerParticipant,
      shares: [{ participantId: ownerParticipant, amount: -1 }],
    }), "invalid_amount");

    const creatorWithoutShare = await createGroupExpense(database, group.id, users[0]!.id, {
      description: "Creator does not share",
      occurredAt: new Date("2026-08-27T16:00:00.000Z"),
      totalAmount: 100,
      payerParticipantId: ownerParticipant,
      shares: [{ participantId: memberParticipant, amount: 100 }],
    });
    assert(creatorWithoutShare.state === "confirmed" && creatorWithoutShare.obligations.length === 1, "creator-without-share was rejected");
    const singleParticipant = await createGroupExpense(database, group.id, users[0]!.id, {
      description: "Single participant",
      occurredAt: new Date("2026-08-27T17:00:00.000Z"),
      totalAmount: 1,
      payerParticipantId: ownerParticipant,
      shares: [{ participantId: ownerParticipant, amount: 1 }],
    });
    assert(singleParticipant.obligations.length === 0, "single payer share created self-debt");

    const reciprocal = await createGroupExpense(database, group.id, users[1]!.id, {
      description: "Reciprocal direction",
      occurredAt: new Date("2026-08-27T18:00:00.000Z"),
      totalAmount: 20,
      payerParticipantId: payerParticipant,
      shares: [{ participantId: ownerParticipant, amount: 20 }],
    });
    assert(reciprocal.obligations.length === 1 && reciprocal.obligations[0]!.debtorParticipantId === ownerParticipant, "reciprocal obligation missing");
    assert(await count(pool, "group_obligations", group.id) >= 6, "original obligations were netted");

    const rollbackExpense = await createGroupExpense(database, group.id, users[0]!.id, {
      description: "Rollback claim",
      occurredAt: new Date("2026-08-27T19:00:00.000Z"),
      totalAmount: 2,
      payerParticipantId: payerParticipant,
      shares: [{ participantId: ownerParticipant, amount: 1 }, { participantId: external.id, amount: 1 }],
    });
    await installObligationFailure(pool, rollbackExpense.id);
    failureTriggerInstalled = true;
    await expectCode(() => confirmGroupExpenseAsPayer(database, group.id, rollbackExpense.id, users[1]!.id), "P0001");
    await removeObligationFailure(pool);
    failureTriggerInstalled = false;
    const rollbackState = await pool.query<{ state: string; count: string }>("SELECT expenses.state, count(obligations.id)::text AS count FROM group_expenses expenses LEFT JOIN group_obligations obligations ON obligations.group_id = expenses.group_id AND obligations.source_expense_id = expenses.id WHERE expenses.id = $1 GROUP BY expenses.state", [rollbackExpense.id]);
    assert(rollbackState.rows[0]?.state === "pending" && rollbackState.rows[0]?.count === "0", "failed materialization partially confirmed the expense");
    await confirmGroupExpenseAsPayer(database, group.id, rollbackExpense.id, users[1]!.id);

    const foreignGroup = await createGroup(database, users[3]!.id, { name: "Other accounting smoke" });
    groupIds.push(foreignGroup.id);
    const foreignParticipant = (await pool.query<{ participant_id: string }>("SELECT participant_id FROM group_memberships WHERE group_id = $1 AND user_id = $2", [foreignGroup.id, users[3]!.id])).rows[0]!.participant_id;
    await expectCode(() => createGroupExpense(database, group.id, users[0]!.id, {
      description: "Cross Group",
      occurredAt: new Date("2026-08-27T20:00:00.000Z"),
      totalAmount: 1,
      payerParticipantId: foreignParticipant,
      shares: [{ participantId: foreignParticipant, amount: 1 }],
    }), "payer_not_found");
    await expectCode(() => pool.query("INSERT INTO group_expense_shares (group_id, expense_id, participant_id, amount) VALUES ($1, $2, $3, 1)", [group.id, selfExpense.id, foreignParticipant]).then(() => undefined), "23503");

    const repository = createGroupAccountingRepository(database, group.id);
    const page = await repository.listExpenses(users[0]!.id, 1);
    assert(page.items.length > 0 && page.items.length <= 20, "Group expense pagination is not bounded");
    const eligibility = await repository.getParticipantEligibility(users[0]!.id);
    assert(eligibility.find((participant) => participant.id === external.id)?.status === "external", "external eligibility state is wrong");
    const concurrentExpense = await createGroupExpense(database, group.id, users[0]!.id, {
      description: "Concurrent confirmation",
      occurredAt: new Date("2026-08-27T21:00:00.000Z"),
      totalAmount: 2,
      payerParticipantId: payerParticipant,
      shares: [{ participantId: ownerParticipant, amount: 1 }, { participantId: external.id, amount: 1 }],
    });
    const confirmations = await Promise.allSettled([
      confirmGroupExpenseAsPayer(database, group.id, concurrentExpense.id, users[1]!.id),
      confirmGroupExpenseAsPayer(database, group.id, concurrentExpense.id, users[1]!.id),
    ]);
    assert(confirmations.every((result) => result.status === "fulfilled"), "concurrent confirmation did not be idempotent");
    assert(await count(pool, "group_obligations", group.id, concurrentExpense.id) === 2, "concurrent confirmation duplicated obligations");

    const expenseFirst = await raceFixture(pool, database, users[0]!.id, users[2]!.id, groupIds);
    const expenseFirstMembershipLock = await holdMembership(pool, expenseFirst.groupId, users[2]!.id);
    let expenseFirstLockReleased = false;
    try {
      let expenseSettled = false;
      const expensePromise = createGroupExpense(database, expenseFirst.groupId, users[0]!.id, {
        description: "Race expense first",
        occurredAt: new Date("2026-08-27T23:00:00.000Z"),
        totalAmount: 2,
        payerParticipantId: expenseFirst.ownerParticipant,
        shares: [{ participantId: expenseFirst.memberParticipant, amount: 2 }],
      }).finally(() => { expenseSettled = true; });
      await waitForParticipantLock(pool, expenseFirst.memberParticipant);
      assert(!expenseSettled, "expense creation continued without locking the member membership");
      const removalPromise = removeGroupMember(database, expenseFirst.groupId, users[0]!.id, users[2]!.id);
      await expenseFirstMembershipLock.release();
      expenseFirstLockReleased = true;
      const [expenseResult, removalResult] = await Promise.allSettled([expensePromise, removalPromise]);
      assert(expenseResult.status === "fulfilled" && removalResult.status === "fulfilled", "expense-first membership race did not serialize");
      const expenseFirstState = await countRaceRows(pool, expenseFirst.groupId, users[2]!.id, expenseFirst.memberParticipant, "Race expense first");
      assert(expenseFirstState.membership === 0 && expenseFirstState.expenses === 1 && expenseFirstState.shares === 1, "expense-first race did not produce the valid serial outcome");
    } finally {
      if (!expenseFirstLockReleased) await expenseFirstMembershipLock.release(false);
    }

    const removalFirst = await raceFixture(pool, database, users[0]!.id, users[2]!.id, groupIds);
    const removalFirstMembershipLock = await holdMembership(pool, removalFirst.groupId, users[2]!.id);
    let removalFirstLockReleased = false;
    try {
      const removalPromise = removeGroupMember(database, removalFirst.groupId, users[0]!.id, users[2]!.id);
      await waitForParticipantLock(pool, removalFirst.memberParticipant);
      const expensePromise = createGroupExpense(database, removalFirst.groupId, users[0]!.id, {
        description: "Race removal first",
        occurredAt: new Date("2026-08-28T00:00:00.000Z"),
        totalAmount: 2,
        payerParticipantId: removalFirst.ownerParticipant,
        shares: [{ participantId: removalFirst.memberParticipant, amount: 2 }],
      });
      await removalFirstMembershipLock.release();
      removalFirstLockReleased = true;
      const [removalResult, expenseResult] = await Promise.allSettled([removalPromise, expensePromise]);
      assert(removalResult.status === "fulfilled", "removal-first membership race did not remove the member");
      assert(expenseResult.status === "rejected" && errorCode(expenseResult.reason) === "participant_not_eligible", "removal-first race accepted a former participant");
      const removalFirstState = await countRaceRows(pool, removalFirst.groupId, users[2]!.id, removalFirst.memberParticipant, "Race removal first");
      assert(removalFirstState.membership === 0 && removalFirstState.expenses === 0 && removalFirstState.shares === 0, "removal-first race did not produce the valid serial outcome");
    } finally {
      if (!removalFirstLockReleased) await removalFirstMembershipLock.release(false);
    }

    const creatorExpenseFirst = await raceFixture(pool, database, users[0]!.id, users[2]!.id, groupIds);
    const creatorExpenseFirstMembershipLock = await holdMembership(pool, creatorExpenseFirst.groupId, users[2]!.id);
    let creatorExpenseFirstLockReleased = false;
    try {
      let expenseSettled = false;
      const expensePromise = createGroupExpense(database, creatorExpenseFirst.groupId, users[2]!.id, {
        description: "Creator race expense first",
        occurredAt: new Date("2026-08-28T01:00:00.000Z"),
        totalAmount: 2,
        payerParticipantId: creatorExpenseFirst.ownerParticipant,
        shares: [{ participantId: creatorExpenseFirst.ownerParticipant, amount: 2 }],
      }).finally(() => { expenseSettled = true; });
      await waitForParticipantLock(pool, creatorExpenseFirst.memberParticipant);
      assert(!expenseSettled, "creator expense creation continued without locking its participant");
      const removalPromise = removeGroupMember(database, creatorExpenseFirst.groupId, users[0]!.id, users[2]!.id);
      await creatorExpenseFirstMembershipLock.release();
      creatorExpenseFirstLockReleased = true;
      const [expenseResult, removalResult] = await Promise.allSettled([expensePromise, removalPromise]);
      assert(expenseResult.status === "fulfilled" && removalResult.status === "fulfilled", "creator expense-first membership race did not serialize");
      const state = await countRaceRows(pool, creatorExpenseFirst.groupId, users[2]!.id, creatorExpenseFirst.memberParticipant, "Creator race expense first");
      assert(state.membership === 0 && state.expenses === 1 && state.shares === 0 && state.expenseShares === 1 && state.obligations === 0, "creator expense-first race did not preserve the valid serial outcome");
    } finally {
      if (!creatorExpenseFirstLockReleased) await creatorExpenseFirstMembershipLock.release(false);
    }

    const creatorRemovalFirst = await raceFixture(pool, database, users[0]!.id, users[2]!.id, groupIds);
    const creatorRemovalFirstMembershipLock = await holdMembership(pool, creatorRemovalFirst.groupId, users[2]!.id);
    let creatorRemovalFirstLockReleased = false;
    try {
      const removalPromise = removeGroupMember(database, creatorRemovalFirst.groupId, users[0]!.id, users[2]!.id);
      await waitForParticipantLock(pool, creatorRemovalFirst.memberParticipant);
      const expensePromise = createGroupExpense(database, creatorRemovalFirst.groupId, users[2]!.id, {
        description: "Creator race removal first",
        occurredAt: new Date("2026-08-28T02:00:00.000Z"),
        totalAmount: 2,
        payerParticipantId: creatorRemovalFirst.ownerParticipant,
        shares: [{ participantId: creatorRemovalFirst.ownerParticipant, amount: 2 }],
      });
      await creatorRemovalFirstMembershipLock.release();
      creatorRemovalFirstLockReleased = true;
      await removalPromise;
      await expectCode(() => expensePromise, "not_member");
      const state = await countRaceRows(pool, creatorRemovalFirst.groupId, users[2]!.id, creatorRemovalFirst.memberParticipant, "Creator race removal first");
      assert(state.membership === 0 && state.expenses === 0 && state.shares === 0 && state.expenseShares === 0 && state.obligations === 0, "creator removal-first race committed stale creator financial rows");
    } finally {
      if (!creatorRemovalFirstLockReleased) await creatorRemovalFirstMembershipLock.release(false);
    }

    const linkRequest = await createGroupParticipantLinkRequest(database, group.id, external.id, users[0]!.id, users[3]!.username);
    await acceptGroupJoinRequest(database, users[3]!.id, linkRequest.id);
    const linkedParticipant = await pool.query<{ id: string; user_id: string | null }>("SELECT id, user_id FROM group_participants WHERE group_id = $1 AND id = $2", [group.id, external.id]);
    assert(linkedParticipant.rows[0]?.id === external.id && linkedParticipant.rows[0]?.user_id === users[3]!.id, "linking an external participant changed its financial identity");
    console.log("group accounting smoke passed");
  } catch (error) {
    console.error(`group accounting smoke failed: ${formatSafeError(error)}`);
    process.exitCode = 1;
  } finally {
    if (failureTriggerInstalled) await removeObligationFailure(pool);
    if (groupIds.length > 0) {
      await pool.query("DELETE FROM group_expense_receipts WHERE group_id = ANY($1::uuid[])", [groupIds]);
      await pool.query("DELETE FROM group_obligations WHERE group_id = ANY($1::uuid[])", [groupIds]);
      await pool.query("DELETE FROM group_expense_shares WHERE group_id = ANY($1::uuid[])", [groupIds]);
      await pool.query("DELETE FROM group_expenses WHERE group_id = ANY($1::uuid[])", [groupIds]);
      await pool.query("DELETE FROM group_join_requests WHERE group_id = ANY($1::uuid[])", [groupIds]);
      await pool.query("DELETE FROM group_memberships WHERE group_id = ANY($1::uuid[])", [groupIds]);
      await pool.query("DELETE FROM group_participants WHERE group_id = ANY($1::uuid[])", [groupIds]);
      await pool.query("DELETE FROM groups WHERE id = ANY($1::uuid[])", [groupIds]);
    }
    if (users.length > 0) await pool.query("DELETE FROM users WHERE id = ANY($1::text[])", [users.map(({ id }) => id)]);
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith("group-accounting-smoke.ts")) await runGroupAccountingSmoke();
