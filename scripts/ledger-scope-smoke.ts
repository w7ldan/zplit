import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { readDatabaseConfig } from "./migrate.js";
import * as schema from "../src/db/schema";
import { createLedgerRepository } from "../src/domain/ledger-repository";
import { ensurePersonalLedgerScope, getOrganizationLedgerScopeId } from "../src/server/ledger-scopes";

const databaseName = process.env.DB_NAME?.trim();
if (databaseName !== "zplit_restore_test") throw new Error("ledger scope smoke requires DB_NAME=zplit_restore_test");

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const userId = `ledger-scope-${suffix}`;
const userEmail = `${userId}@invalid.test`;

async function mustReject(action: () => Promise<unknown>, label: string) {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

async function main() {
  const config = readDatabaseConfig("zplit_restore_test");
  const pool = new Pool({ ...config, max: 1 });
  const database = drizzle(pool, { schema });
  let personalScopeId = "";
  let organizationScopeId = "";
  let otherOrganizationScopeId = "";
  let organizationId = "";
  let otherOrganizationId = "";
  let emptyOrganizationId = "";
  let emptyOrganizationScopeId = "";
  try {
    await database.insert(schema.users).values({ id: userId, name: "Ledger scope smoke", email: userEmail });
    personalScopeId = await ensurePersonalLedgerScope(database, userId);
    const createOrganizationFixture = async (name: string) => database.transaction(async (transaction) => {
      const [organization] = await transaction.insert(schema.organizations).values({ name, description: null }).returning();
      if (!organization) throw new Error("organization fixture was not created");
      const [scope] = await transaction.insert(schema.ledgerScopes).values({ kind: "organization", organizationId: organization.id }).returning({ id: schema.ledgerScopes.id });
      if (!scope) throw new Error("organization scope fixture was not created");
      const [participant] = await transaction.insert(schema.organizationParticipants).values({ organizationId: organization.id, userId, createdByUserId: userId }).returning({ id: schema.organizationParticipants.id });
      if (!participant) throw new Error("organization participant fixture was not created");
      await transaction.insert(schema.organizationMemberships).values({ organizationId: organization.id, userId, participantId: participant.id, role: "owner" });
      return { organization, scopeId: scope.id };
    });
    const { organization, scopeId } = await createOrganizationFixture(`Scope A ${suffix}`);
    const { organization: otherOrganization, scopeId: otherScopeId } = await createOrganizationFixture(`Scope B ${suffix}`);
    const { organization: emptyOrganization, scopeId: emptyScopeId } = await createOrganizationFixture(`Scope empty ${suffix}`);
    organizationId = organization.id;
    otherOrganizationId = otherOrganization.id;
    emptyOrganizationId = emptyOrganization.id;
    organizationScopeId = await getOrganizationLedgerScopeId(database, organization.id);
    otherOrganizationScopeId = await getOrganizationLedgerScopeId(database, otherOrganization.id);
    assert.equal(organizationScopeId, scopeId);
    assert.equal(otherOrganizationScopeId, otherScopeId);
    emptyOrganizationScopeId = await getOrganizationLedgerScopeId(database, emptyOrganization.id);
    assert.equal(emptyOrganizationScopeId, emptyScopeId);

    const personal = createLedgerRepository(database, personalScopeId);
    const organizationLedger = createLedgerRepository(database, organizationScopeId);
    const otherOrganizationLedger = createLedgerRepository(database, otherOrganizationScopeId);
    const personalFriend = await personal.createFriend({ name: "Personal friend", phoneNumber: null, notes: null });
    const organizationFriend = await organizationLedger.createFriend({ name: "Organization friend", phoneNumber: null, notes: null });
    const otherOrganizationFriend = await otherOrganizationLedger.createFriend({ name: "Other organization friend", phoneNumber: null, notes: null });
    const organizationOuting = await organizationLedger.createOuting({ title: "Organization outing", occurredAt: new Date("2026-08-26T00:00:00Z"), notes: null });
    const otherOrganizationOuting = await otherOrganizationLedger.createOuting({ title: "Other organization outing", occurredAt: new Date("2026-08-26T00:00:00Z"), notes: null });
    const organizationExpense = await organizationLedger.createExpense({ description: "Organization expense", amount: 100, outingId: organizationOuting.id });
    const otherOrganizationExpense = await otherOrganizationLedger.createExpense({ description: "Other organization expense", amount: 100, outingId: otherOrganizationOuting.id });
    await organizationLedger.replaceExpenseShares(organizationExpense.id, [{ friendId: organizationFriend.id, amountOwed: 100 }]);
    await otherOrganizationLedger.replaceExpenseShares(otherOrganizationExpense.id, [{ friendId: otherOrganizationFriend.id, amountOwed: 100 }]);
    const otherOrganizationShare = (await otherOrganizationLedger.listExpenseShares(otherOrganizationExpense.id))[0]!;
    const organizationRepayment = await organizationLedger.createRepayment({ friendId: organizationFriend.id, amount: 1, paidAt: new Date("2026-08-26T00:00:00Z"), paymentMethod: null, notes: null });
    const otherOrganizationRepayment = await otherOrganizationLedger.createRepayment({ friendId: otherOrganizationFriend.id, amount: 1, paidAt: new Date("2026-08-26T00:00:00Z"), paymentMethod: null, notes: null });

    assert.deepEqual((await organizationLedger.listFriends()).map((friend) => friend.id), [organizationFriend.id]);
    assert.deepEqual((await otherOrganizationLedger.listFriends()).map((friend) => friend.id), [otherOrganizationFriend.id]);
    assert.deepEqual((await personal.listFriends()).map((friend) => friend.id), [personalFriend.id]);

    await mustReject(() => database.insert(schema.ledgerScopes).values({ kind: "personal", userId }).execute(), "duplicate Personal scope");
    await mustReject(() => database.insert(schema.ledgerScopes).values({ kind: "organization", organizationId: organization.id }).execute(), "duplicate Organization scope");
    await mustReject(() => database.insert(schema.ledgerScopes).values({ kind: "personal", organizationId: organization.id }).execute(), "invalid scope subject XOR");
    await mustReject(() => database.insert(schema.expenses).values({ ledgerScopeId: organizationScopeId, outingId: otherOrganizationOuting.id, description: "cross outing", amount: 1 }).execute(), "cross-scope expense outing");
    await mustReject(() => database.insert(schema.expenseShares).values({ ledgerScopeId: organizationScopeId, expenseId: organizationExpense.id, friendId: otherOrganizationFriend.id, baseAmount: 1, amountOwed: 1 }).execute(), "cross-scope expense friend");
    await mustReject(() => database.insert(schema.expenseReceipts).values({ ledgerScopeId: organizationScopeId, expenseId: otherOrganizationExpense.id, originalFilename: "cross.png", mediaType: "image/png", byteSize: 1, sha256: createHash("sha256").update(Buffer.from([1])).digest("hex"), content: Buffer.from([1]) }).execute(), "cross-scope receipt");
    await mustReject(() => database.insert(schema.repayments).values({ ledgerScopeId: organizationScopeId, friendId: otherOrganizationFriend.id, amount: 1, paidAt: new Date(), paymentMethod: null, notes: null }).execute(), "cross-scope repayment friend");
    await mustReject(() => database.insert(schema.repaymentAllocations).values({ ledgerScopeId: organizationScopeId, repaymentId: organizationRepayment.id, expenseShareId: otherOrganizationShare.id, amount: 1 }).execute(), "cross-scope repayment allocation");
    await mustReject(() => database.insert(schema.repaymentProofs).values({ ledgerScopeId: organizationScopeId, repaymentId: otherOrganizationRepayment.id, originalFilename: "cross.png", mediaType: "image/png", byteSize: 1, sha256: createHash("sha256").update(Buffer.from([1])).digest("hex"), content: Buffer.from([1]) }).execute(), "cross-scope repayment proof");

    await mustReject(() => database.delete(schema.ledgerScopes).where(sql`${schema.ledgerScopes.id} = ${organizationScopeId}`).execute(), "populated Organization deletion");
    await database.transaction(async (transaction) => {
      await transaction.delete(schema.ledgerScopes).where(sql`${schema.ledgerScopes.id} = ${emptyOrganizationScopeId}`);
      await transaction.delete(schema.organizations).where(sql`${schema.organizations.id} = ${emptyOrganization.id}`);
    });
    const [stillThere] = await database.select({ id: schema.organizations.id }).from(schema.organizations).where(sql`${schema.organizations.id} = ${organization.id}`).limit(1);
    assert.equal(stillThere?.id, organization.id);
    console.log("ledger scope isolation passed");
  } finally {
    if (organizationScopeId) {
      await database.execute(sql`DELETE FROM repayment_allocations WHERE ledger_scope_id IN (${sql.raw(`'${organizationScopeId}'`)})`);
      await database.execute(sql`DELETE FROM repayment_proofs WHERE ledger_scope_id IN (${sql.raw(`'${organizationScopeId}'`)})`);
      await database.execute(sql`DELETE FROM repayments WHERE ledger_scope_id IN (${sql.raw(`'${organizationScopeId}'`)})`);
      await database.execute(sql`DELETE FROM expenses WHERE ledger_scope_id IN (${sql.raw(`'${organizationScopeId}'`)})`);
      await database.execute(sql`DELETE FROM outings WHERE ledger_scope_id IN (${sql.raw(`'${organizationScopeId}'`)})`);
      await database.execute(sql`DELETE FROM friends WHERE ledger_scope_id IN (${sql.raw(`'${organizationScopeId}'`)})`);
      await database.execute(sql`DELETE FROM ledger_scopes WHERE id IN (${sql.raw(`'${organizationScopeId}'`)})`);
      await database.execute(sql`DELETE FROM organizations WHERE id IN (${sql.raw(`'${organizationId}'`)})`);
    }
    if (otherOrganizationScopeId) {
      await database.execute(sql`DELETE FROM repayments WHERE ledger_scope_id IN (${sql.raw(`'${otherOrganizationScopeId}'`)})`);
      await database.execute(sql`DELETE FROM expenses WHERE ledger_scope_id IN (${sql.raw(`'${otherOrganizationScopeId}'`)})`);
      await database.execute(sql`DELETE FROM outings WHERE ledger_scope_id IN (${sql.raw(`'${otherOrganizationScopeId}'`)})`);
      await database.execute(sql`DELETE FROM friends WHERE ledger_scope_id IN (${sql.raw(`'${otherOrganizationScopeId}'`)})`);
      await database.execute(sql`DELETE FROM ledger_scopes WHERE id IN (${sql.raw(`'${otherOrganizationScopeId}'`)})`);
      await database.execute(sql`DELETE FROM organizations WHERE id IN (${sql.raw(`'${otherOrganizationId}'`)})`);
    }
    if (emptyOrganizationScopeId) {
      await database.execute(sql`DELETE FROM ledger_scopes WHERE id IN (${sql.raw(`'${emptyOrganizationScopeId}'`)})`);
      await database.execute(sql`DELETE FROM organizations WHERE id IN (${sql.raw(`'${emptyOrganizationId}'`)})`);
    }
    if (personalScopeId) {
      await database.execute(sql`DELETE FROM friends WHERE ledger_scope_id IN (${sql.raw(`'${personalScopeId}'`)})`);
      await database.execute(sql`DELETE FROM ledger_scopes WHERE id IN (${sql.raw(`'${personalScopeId}'`)})`);
    }
    await database.execute(sql`DELETE FROM friend_link_requests WHERE owner_user_id = ${userId} OR target_user_id = ${userId}`);
    await database.execute(sql`DELETE FROM friend_connections WHERE user_a_id = ${userId} OR user_b_id = ${userId}`);
    await database.execute(sql`DELETE FROM organization_memberships WHERE user_id = ${userId}`);
    await database.execute(sql`DELETE FROM notifications WHERE recipient_user_id = ${userId}`);
    await database.execute(sql`DELETE FROM accounts WHERE user_id = ${userId}`);
    await database.execute(sql`DELETE FROM sessions WHERE user_id = ${userId}`);
    await database.execute(sql`DELETE FROM verifications WHERE identifier = ${userEmail}`);
    await database.execute(sql`DELETE FROM users WHERE id = ${userId}`);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "ledger scope smoke failed");
  process.exitCode = 1;
});
