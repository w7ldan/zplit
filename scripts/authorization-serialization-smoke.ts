import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { OrganizationCapability } from "../src/domain/organization-permissions";
import { closeDatabase, type Database } from "../src/db/client";
import * as schema from "../src/db/schema";
import { readDatabaseConfig } from "./migrate.js";

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
if (!require.cache[serverOnlyPath]) require.cache[serverOnlyPath] = { exports: {} } as never;

const [groups, groupRequests, organizations, receipts, proofs, receiptFiles] = await Promise.all([
  import("../src/server/groups"),
  import("../src/server/group-join-requests"),
  import("../src/server/organizations"),
  import("../src/server/expense-receipts"),
  import("../src/server/repayment-payment-proofs"),
  import("../src/domain/receipt-file"),
]);

type Deferred<T> = { promise: Promise<T>; resolve(value?: T): void; reject(error: unknown): void };

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve: (value?: T) => resolve(value as T), reject };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

async function waitForDatabaseLock(pool: Pool, applicationName: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ wait_event_type: string | null }>(
      "SELECT wait_event_type FROM pg_stat_activity WHERE application_name = $1 AND state = 'active'",
      [applicationName],
    );
    if (result.rows.some((row) => row.wait_event_type === "Lock")) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${applicationName} did not wait on a PostgreSQL lock`);
}

function withTransactionSettings(database: Database, applicationName?: string, started?: Deferred<void>): Database {
  return new Proxy(database as object, {
    get(target, property) {
      if (property !== "transaction") return Reflect.get(target, property, target);
      const transaction = Reflect.get(target, property, target) as (callback: (transaction: Database) => Promise<unknown>, config?: unknown) => Promise<unknown>;
      return (callback: (transaction: Database) => Promise<unknown>, config?: unknown) => transaction.call(target, async (tx) => {
        await tx.execute(sql.raw("SET LOCAL lock_timeout = '8s'"));
        await tx.execute(sql.raw("SET LOCAL statement_timeout = '12s'"));
        if (applicationName) await tx.execute(sql`SELECT set_config('application_name', ${applicationName}, true)`);
        started?.resolve();
        return callback(tx);
      }, config);
    },
  }) as Database;
}

function pauseInsertReturning(database: Database, pausedTable: unknown, entered: Deferred<void>, release: Promise<void>): Database {
  return new Proxy(database as object, {
    get(target, property) {
      if (property !== "transaction") return Reflect.get(target, property, target);
      const transaction = Reflect.get(target, property, target) as (callback: (transaction: Database) => Promise<unknown>, config?: unknown) => Promise<unknown>;
      return (callback: (transaction: Database) => Promise<unknown>, config?: unknown) => transaction.call(target, async (tx) => {
        await tx.execute(sql.raw("SET LOCAL lock_timeout = '8s'"));
        await tx.execute(sql.raw("SET LOCAL statement_timeout = '12s'"));
        const intercepted = new Proxy(tx as object, {
          get(transactionTarget, transactionProperty) {
            if (transactionProperty !== "insert") {
              const value = Reflect.get(transactionTarget, transactionProperty, transactionTarget);
              return typeof value === "function" ? value.bind(transactionTarget) : value;
            }
            const insert = Reflect.get(transactionTarget, transactionProperty, transactionTarget) as (table: unknown) => Record<string, unknown>;
            return (table: unknown) => {
              const builder = insert.call(transactionTarget, table) as Record<string, unknown>;
              if (table !== pausedTable) return builder;
              return {
                values(value: unknown) {
                  const valued = (builder.values as (value: unknown) => Record<string, unknown>).call(builder, value);
                  return {
                    returning(...args: unknown[]) {
                      entered.resolve();
                      return release.then(() => (valued.returning as (...args: unknown[]) => Promise<unknown>).apply(valued, args));
                    },
                  };
                },
              };
            };
          },
        }) as Database;
        return callback(intercepted);
      }, config);
    },
  }) as Database;
}

async function expectCode(action: Promise<unknown>, code: string) {
  await assert.rejects(action, (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === code);
}

async function count(pool: Pool, table: string, where: string, values: unknown[]) {
  const result = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table} WHERE ${where}`, values);
  return Number(result.rows[0]?.count ?? 0);
}

async function addGroupAdmin(database: Database, groupId: string, userId: string) {
  const [participant] = await database.insert(schema.groupParticipants).values({ groupId, userId }).returning({ id: schema.groupParticipants.id });
  assert(participant, "Group admin participant was not created");
  await database.insert(schema.groupMemberships).values({ groupId, userId, participantId: participant.id, role: "admin" });
}

async function addOrganizationMember(database: Database, organizationId: string, userId: string, createdByUserId: string, customCapabilities: OrganizationCapability[]) {
  const [participant] = await database.insert(schema.organizationParticipants).values({ organizationId, userId, createdByUserId }).returning({ id: schema.organizationParticipants.id });
  assert(participant, "Organization member participant was not created");
  await database.insert(schema.organizationMemberships).values({ organizationId, userId, participantId: participant.id, role: "custom", customCapabilities });
}

async function waitForGroupRequestLockWins(pool: Pool, database: Database, groupId: string, ownerUserId: string, actorUserId: string, targetUserId: string) {
  const entered = deferred<void>();
  const release = deferred<void>();
  const demotionStarted = deferred<void>();
  const applicationName = `zplit-authz-group-${randomUUID().slice(0, 8)}`;
  let invitationPromise: Promise<typeof schema.groupJoinRequests.$inferSelect> | undefined;
  let demotionPromise: Promise<unknown> | undefined;
  try {
    const delayed = pauseInsertReturning(database, schema.groupJoinRequests, entered, release.promise);
    invitationPromise = groupRequests.createGroupInvitation(delayed, groupId, actorUserId, { targetUserId });
    await withTimeout(entered.promise, 5_000, "Group invitation authorization lock");
    const tracked = withTransactionSettings(database, applicationName, demotionStarted);
    demotionPromise = groups.updateGroupMemberRole(tracked, groupId, ownerUserId, actorUserId, "member");
    await withTimeout(demotionStarted.promise, 5_000, "Group demotion transaction start");
    await waitForDatabaseLock(pool, applicationName);
    release.resolve();
    const invitation = await withTimeout(invitationPromise, 10_000, "Group invitation transaction");
    await withTimeout(demotionPromise, 10_000, "Group demotion transaction");
    assert.equal(invitation.status, "pending");
    return invitation.id;
  } finally {
    release.resolve();
    if (invitationPromise) await Promise.allSettled([invitationPromise]);
    if (demotionPromise) await Promise.allSettled([demotionPromise]);
  }
}

async function waitForOrganizationLedgerLockWins(pool: Pool, database: Database, organizationId: string, actorUserId: string, ledgerScopeId: string) {
  const entered = deferred<void>();
  const release = deferred<void>();
  const revokeStarted = deferred<void>();
  const applicationName = `zplit-authz-org-${randomUUID().slice(0, 8)}`;
  let tripPromise: Promise<unknown> | undefined;
  let revokePromise: Promise<unknown> | undefined;
  try {
    const delayed = pauseInsertReturning(database, schema.trips, entered, release.promise);
    const access = await organizations.requireOrganizationLedgerAccess(delayed, organizationId, actorUserId, "trips.manage");
    assert.equal(access.ledgerScopeId, ledgerScopeId);
    tripPromise = access.ledger.createTrip({ name: "Authorized before revocation", startsOn: null, endsOn: null, notes: null });
    await withTimeout(entered.promise, 5_000, "Organization ledger authorization lock");
    const tracked = withTransactionSettings(database, applicationName, revokeStarted);
    revokePromise = tracked.transaction(async (transaction) => {
      await transaction.update(schema.organizationMemberships)
        .set({ customCapabilities: [] })
        .where(and(
          eq(schema.organizationMemberships.organizationId, organizationId),
          eq(schema.organizationMemberships.userId, actorUserId),
        ));
    });
    await withTimeout(revokeStarted.promise, 5_000, "Organization capability revocation transaction start");
    await waitForDatabaseLock(pool, applicationName);
    release.resolve();
    const trip = await withTimeout(tripPromise, 10_000, "Organization ledger mutation");
    await withTimeout(revokePromise, 10_000, "Organization capability revocation");
    return trip as { id: string };
  } finally {
    release.resolve();
    if (tripPromise) await Promise.allSettled([tripPromise]);
    if (revokePromise) await Promise.allSettled([revokePromise]);
  }
}

async function cleanup(pool: Pool, groupIds: string[], organizationId: string | undefined, userIds: string[]) {
  if (userIds.length > 0) await pool.query("DELETE FROM notifications WHERE recipient_user_id = ANY($1::text[])", [userIds]);
  if (organizationId) {
    const scopes = await pool.query<{ id: string }>("SELECT id FROM ledger_scopes WHERE kind = 'organization' AND organization_id = $1", [organizationId]);
    const scopeIds = scopes.rows.map(({ id }) => id);
    if (scopeIds.length > 0) {
      await pool.query("DELETE FROM repayment_allocations WHERE ledger_scope_id = ANY($1::uuid[])", [scopeIds]);
      await pool.query("DELETE FROM repayment_proofs WHERE ledger_scope_id = ANY($1::uuid[])", [scopeIds]);
      await pool.query("DELETE FROM expense_receipts WHERE ledger_scope_id = ANY($1::uuid[])", [scopeIds]);
      await pool.query("DELETE FROM expense_charge_targets WHERE ledger_scope_id = ANY($1::uuid[])", [scopeIds]);
      await pool.query("DELETE FROM expense_charges WHERE ledger_scope_id = ANY($1::uuid[])", [scopeIds]);
      await pool.query("DELETE FROM expense_shares WHERE ledger_scope_id = ANY($1::uuid[])", [scopeIds]);
      await pool.query("DELETE FROM repayments WHERE ledger_scope_id = ANY($1::uuid[])", [scopeIds]);
      await pool.query("DELETE FROM expenses WHERE ledger_scope_id = ANY($1::uuid[])", [scopeIds]);
      await pool.query("DELETE FROM outings WHERE ledger_scope_id = ANY($1::uuid[])", [scopeIds]);
      await pool.query("DELETE FROM trips WHERE ledger_scope_id = ANY($1::uuid[])", [scopeIds]);
      await pool.query("DELETE FROM friends WHERE ledger_scope_id = ANY($1::uuid[])", [scopeIds]);
      await pool.query("DELETE FROM repayment_destinations WHERE ledger_scope_id = ANY($1::uuid[])", [scopeIds]);
      await pool.query("DELETE FROM ledger_scopes WHERE id = ANY($1::uuid[])", [scopeIds]);
    }
    await pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
  }
  if (groupIds.length > 0) await pool.query("DELETE FROM groups WHERE id = ANY($1::uuid[])", [groupIds]);
  if (userIds.length > 0) await pool.query("DELETE FROM users WHERE id = ANY($1::text[])", [userIds]);
}

export async function runAuthorizationSerializationSmoke() {
  if (process.env.DB_NAME?.trim() !== "zplit_test") throw new Error("authorization serialization smoke requires DB_NAME=zplit_test");
  const pool = new Pool({ ...readDatabaseConfig("zplit_test"), max: 10, connectionTimeoutMillis: 5_000 });
  const database = drizzle(pool, { schema });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const users = await database.insert(schema.users).values([
    { id: randomUUID(), name: "Authorization Owner", email: `authz-owner-${suffix}@example.com`, username: `o_${suffix}` },
    { id: randomUUID(), name: "Authorization Actor", email: `authz-actor-${suffix}@example.com`, username: `a_${suffix}` },
    { id: randomUUID(), name: "Authorization Target", email: `authz-target-${suffix}@example.com`, username: `t_${suffix}` },
  ]).returning({ id: schema.users.id });
  const [owner, actor, target] = users;
  assert(owner && actor && target, "authorization smoke users were not created");
  const groupIds: string[] = [];
  let organizationId: string | undefined;
  try {
    const demotionGroup = await groups.createGroup(database, owner.id, { name: "Demotion wins" });
    groupIds.push(demotionGroup.id);
    await addGroupAdmin(database, demotionGroup.id, actor.id);
    await groups.updateGroupMemberRole(database, demotionGroup.id, owner.id, actor.id, "member");
    await expectCode(groupRequests.createGroupInvitation(database, demotionGroup.id, actor.id, { targetUserId: target.id }), "forbidden");
    assert.equal(await count(pool, "group_join_requests", "group_id = $1", [demotionGroup.id]), 0);
    assert.equal(await count(pool, "notifications", "recipient_user_id = $1 AND type = 'group.invitation'", [target.id]), 0);

    const removalGroup = await groups.createGroup(database, owner.id, { name: "Removal wins" });
    groupIds.push(removalGroup.id);
    await addGroupAdmin(database, removalGroup.id, actor.id);
    await groups.removeGroupMember(database, removalGroup.id, owner.id, actor.id);
    await expectCode(groupRequests.createGroupInvitation(database, removalGroup.id, actor.id, { targetUserId: target.id }), "not_member");
    assert.equal(await count(pool, "group_join_requests", "group_id = $1", [removalGroup.id]), 0);
    assert.equal(await count(pool, "notifications", "recipient_user_id = $1 AND type = 'group.invitation'", [target.id]), 0);

    const mutationGroup = await groups.createGroup(database, owner.id, { name: "Mutation lock wins" });
    groupIds.push(mutationGroup.id);
    await addGroupAdmin(database, mutationGroup.id, actor.id);
    const createdRequestId = await waitForGroupRequestLockWins(pool, database, mutationGroup.id, owner.id, actor.id, target.id);
    assert.equal(await count(pool, "group_join_requests", "id = $1 AND status = 'pending'", [createdRequestId]), 1);
    assert.equal(await count(pool, "notifications", "recipient_user_id = $1 AND type = 'group.invitation'", [target.id]), 1);
    const demoted = await pool.query<{ role: string }>("SELECT role FROM group_memberships WHERE group_id = $1 AND user_id = $2", [mutationGroup.id, actor.id]);
    assert.equal(demoted.rows[0]?.role, "member");

    const organization = await organizations.createOrganization(database, owner.id, { name: "Authorization Organization" });
    organizationId = organization.id;
    const caps: OrganizationCapability[] = ["organization.update", "outings.manage", "expenses.create", "expenses.edit", "friends.manage", "repayments.create", "repayments.edit", "trips.manage"];
    await addOrganizationMember(database, organization.id, actor.id, owner.id, caps);
    await database.update(schema.organizationMemberships)
      .set({ customCapabilities: [] })
      .where(and(
        eq(schema.organizationMemberships.organizationId, organization.id),
        eq(schema.organizationMemberships.userId, actor.id),
      ));
    await expectCode(organizations.updateOrganization(database, organization.id, actor.id, { name: "Unauthorized update" }), "forbidden");
    const unchanged = await database.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, organization.id)).limit(1);
    assert.equal(unchanged[0]?.name, "Authorization Organization");

    await database.update(schema.organizationMemberships)
      .set({ customCapabilities: ["trips.manage"] })
      .where(and(eq(schema.organizationMemberships.organizationId, organization.id), eq(schema.organizationMemberships.userId, actor.id)));
    const staleAccess = await organizations.requireOrganizationLedgerAccess(database, organization.id, actor.id, "trips.manage");
    await database.update(schema.organizationMemberships)
      .set({ customCapabilities: [] })
      .where(and(eq(schema.organizationMemberships.organizationId, organization.id), eq(schema.organizationMemberships.userId, actor.id)));
    await expectCode(staleAccess.ledger.createTrip({ name: "Stale repository", startsOn: null, endsOn: null, notes: null }), "FORBIDDEN");
    assert.equal(await count(pool, "trips", "ledger_scope_id = $1", [staleAccess.ledgerScopeId]), 0);

    await database.update(schema.organizationMemberships)
      .set({ customCapabilities: ["trips.manage"] })
      .where(and(eq(schema.organizationMemberships.organizationId, organization.id), eq(schema.organizationMemberships.userId, actor.id)));
    const tripsAccess = await organizations.requireOrganizationLedgerAccess(database, organization.id, actor.id, "trips.manage");
    await expectCode(tripsAccess.ledger.createFriend({ name: "Wrong operation", phoneNumber: null, notes: null }), "FORBIDDEN");
    assert.equal(await count(pool, "friends", "ledger_scope_id = $1", [tripsAccess.ledgerScopeId]), 0);

    const ledgerTrip = await waitForOrganizationLedgerLockWins(pool, database, organization.id, actor.id, tripsAccess.ledgerScopeId);
    assert.equal(await count(pool, "trips", "id = $1 AND ledger_scope_id = $2", [ledgerTrip.id, tripsAccess.ledgerScopeId]), 1);
    const revokedCaps = await database.select({ customCapabilities: schema.organizationMemberships.customCapabilities })
      .from(schema.organizationMemberships)
      .where(and(eq(schema.organizationMemberships.organizationId, organization.id), eq(schema.organizationMemberships.userId, actor.id)))
      .limit(1);
    assert.deepEqual(revokedCaps[0]?.customCapabilities, []);

    await database.update(schema.organizationMemberships)
      .set({ customCapabilities: caps })
      .where(and(eq(schema.organizationMemberships.organizationId, organization.id), eq(schema.organizationMemberships.userId, actor.id)));
    const outingAccess = await organizations.requireOrganizationLedgerAccess(database, organization.id, actor.id, "outings.manage");
    const outing = await outingAccess.ledger.createOuting({ title: "Expense attachment", occurredAt: new Date(), occurredOn: "2026-09-28", notes: null });
    const expenseAccess = await organizations.requireOrganizationLedgerAccess(database, organization.id, actor.id, "expenses.create");
    const expense = await expenseAccess.ledger.createExpense({ outingId: outing.id, description: "Receipt authorization", amount: 100 });
    const friendAccess = await organizations.requireOrganizationLedgerAccess(database, organization.id, actor.id, "friends.manage");
    const friend = await friendAccess.ledger.createFriend({ name: "Proof payer", phoneNumber: null, notes: null });
    const repaymentAccess = await organizations.requireOrganizationLedgerAccess(database, organization.id, actor.id, "repayments.create");
    const repayment = await repaymentAccess.ledger.createRepayment({ friendId: friend.id, amount: 100, paidAt: new Date(), paidOn: "2026-09-28", paymentMethod: null, notes: null });
    const routeReceiptAccess = await organizations.requireOrganizationLedgerAccess(database, organization.id, actor.id, "expenses.edit");
    const routeProofAccess = await organizations.requireOrganizationLedgerAccess(database, organization.id, actor.id, "repayments.edit");
    const file = receiptFiles.validateReceiptFile({ bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0x01]), filename: "proof.jpg", mediaType: "image/jpeg" });
    const receiptOwner = { ledgerScopeId: routeReceiptAccess.ledgerScopeId, organizationId: organization.id, userId: actor.id, requiredCapability: "expenses.edit" as const };
    const proofOwner = { ledgerScopeId: routeProofAccess.ledgerScopeId, organizationId: organization.id, userId: actor.id, requiredCapability: "repayments.edit" as const };
    const receipt = await receipts.createExpenseReceipt(database, receiptOwner, expense.id, file);
    const proof = await proofs.createRepaymentPaymentProof(database, proofOwner, repayment.id, file);
    await database.update(schema.organizationMemberships)
      .set({ customCapabilities: caps.filter((capability) => capability !== "expenses.edit") })
      .where(and(eq(schema.organizationMemberships.organizationId, organization.id), eq(schema.organizationMemberships.userId, actor.id)));
    await expectCode(receipts.createExpenseReceipt(database, receiptOwner, expense.id, file), "forbidden");
    await expectCode(receipts.deleteExpenseReceipt(database, receiptOwner, expense.id, receipt.id), "forbidden");
    assert.equal(await count(pool, "expense_receipts", "ledger_scope_id = $1 AND expense_id = $2", [routeReceiptAccess.ledgerScopeId, expense.id]), 1);
    await database.update(schema.organizationMemberships)
      .set({ customCapabilities: caps.filter((capability) => capability !== "repayments.edit") })
      .where(and(eq(schema.organizationMemberships.organizationId, organization.id), eq(schema.organizationMemberships.userId, actor.id)));
    await expectCode(proofs.createRepaymentPaymentProof(database, proofOwner, repayment.id, file), "forbidden");
    await expectCode(proofs.deleteRepaymentPaymentProof(database, proofOwner, repayment.id, proof.id), "forbidden");
    assert.equal(await count(pool, "repayment_proofs", "ledger_scope_id = $1 AND repayment_id = $2", [routeProofAccess.ledgerScopeId, repayment.id]), 1);

    console.log("authorization serialization smoke passed: demotion wins, mutation lock wins, stale ledger capability denied, operation capability scoped, receipt/proof writes revalidated");
  } finally {
    await cleanup(pool, groupIds, organizationId, users.map(({ id }) => id));
    await closeDatabase();
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void runAuthorizationSerializationSmoke();
