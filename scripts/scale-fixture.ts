import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { createDatabasePool, readRuntimeDatabaseConfig } from "../src/db/client";
import * as schema from "../src/db/schema";
import { calculateSafeDaily } from "../src/domain/budgeting/dates";
import { getPersonalLedgerScopeId } from "../src/server/ledger-scopes";
import { readSecretFile } from "../src/server/secret-file";
import {
  generateScaleFixture,
  organizationLedgerSizes,
  SCALE_FIXTURE_CONFIRMATION,
  SCALE_FIXTURE_COUNTS,
  SCALE_FIXTURE_DATABASE,
  SCALE_FIXTURE_SCENARIO_IDS,
  type ScaleFixtureData,
} from "./scale-fixture-data";

const scaleFixtureLockKey = 20603020;
const batchSize = 250;

export type ScaleCommand = "seed" | "verify" | "clear";

export type ScaleEnvironment = {
  DB_NAME?: string;
  ZPLIT_SCALE_TEST_CONFIRM?: string;
  SCALE_TEST_OWNER_EMAIL?: string;
  SCALE_OWNER_PASSWORD_FILE?: string;
  [name: string]: string | undefined;
};

export type ScaleFixtureDependencies = {
  readDatabaseConfig?: typeof readRuntimeDatabaseConfig;
  createPool?: typeof createDatabasePool;
};

function requiredEnvironment(environment: ScaleEnvironment, name: "SCALE_TEST_OWNER_EMAIL") {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value.toLowerCase();
}

export function parseScaleCommand(value = process.argv[2]): ScaleCommand {
  if (value === "seed" || value === "verify" || value === "clear") return value;
  throw new Error("usage: tsx scripts/scale-fixture.ts <seed|verify|clear>");
}

export function validateScaleCommandEnvironment(command: ScaleCommand, environment: ScaleEnvironment = process.env) {
  if (environment.DB_NAME?.trim() !== SCALE_FIXTURE_DATABASE) {
    throw new Error(`DB_NAME must be ${SCALE_FIXTURE_DATABASE}`);
  }
  if (command !== "verify" && environment.ZPLIT_SCALE_TEST_CONFIRM?.trim() !== SCALE_FIXTURE_CONFIRMATION) {
    throw new Error(`ZPLIT_SCALE_TEST_CONFIRM must be ${SCALE_FIXTURE_CONFIRMATION}`);
  }
  return { ownerEmail: requiredEnvironment(environment, "SCALE_TEST_OWNER_EMAIL") };
}

function count(value: string | number) {
  const result = Number(value);
  assert(Number.isSafeInteger(result), "database returned an invalid count");
  return result;
}

type CountRow = { count: string };

async function insertBatches(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: readonly (readonly unknown[])[],
) {
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values: unknown[] = [];
    const placeholders = batch.map((row, rowIndex) => {
      assert(row.length === columns.length, `${table} row has the wrong number of columns`);
      return `(${row.map((_value, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(", ")})`;
    });
    for (const row of batch) values.push(...row);
    await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders.join(", ")}`,
      values,
    );
  }
}

function fixtureIds(fixture: ScaleFixtureData) {
  return {
    friendIds: fixture.friends.map((row) => row.id),
    tripIds: fixture.trips.map((row) => row.id),
    outingIds: fixture.outings.map((row) => row.id),
    expenseIds: fixture.expenses.map((row) => row.id),
    shareIds: fixture.expenseShares.map((row) => row.id),
    repaymentIds: fixture.repayments.map((row) => row.id),
    receiptIds: fixture.receipts.map((row) => row.id),
    secondaryUserIds: fixture.secondaryUsers.map((row) => row.id),
    friendConnectionIds: fixture.friendConnections.map((row) => row.id),
    groupIds: fixture.groups.map((row) => row.id),
    groupParticipantIds: fixture.groupParticipants.map((row) => row.id),
    groupExpenseIds: fixture.groupExpenses.map((row) => row.id),
    groupShareIds: fixture.groupExpenseShares.map((row) => row.id),
    obligationIds: fixture.groupObligations.map((row) => row.id),
    settlementIds: fixture.groupSettlements.map((row) => row.id),
    groupReceiptIds: fixture.groupExpenseReceipts.map((row) => row.id),
    groupProofIds: fixture.groupSettlementProofs.map((row) => row.id),
    orgIds: fixture.organizations.map((row) => row.id),
    orgScopeIds: fixture.organizationScopes.map((row) => row.id),
    orgParticipantIds: fixture.organizationParticipants.map((row) => row.id),
    orgInvitationIds: fixture.organizationInvitations.map((row) => row.id),
    orgFriendIds: fixture.organizationFriends.map((row) => row.id),
    orgOutingIds: fixture.organizationOutings.map((row) => row.id),
    orgExpenseIds: fixture.organizationExpenses.map((row) => row.id),
    orgShareIds: fixture.organizationExpenseShares.map((row) => row.id),
    orgRepaymentIds: fixture.organizationRepayments.map((row) => row.id),
    orgReceiptIds: fixture.organizationReceipts.map((row) => row.id),
    budgetPeriodIds: fixture.budgetPeriods.map((row) => row.id),
    budgetCategoryIds: fixture.budgetCategories.map((row) => row.id),
    budgetTransactionIds: fixture.budgetTransactions.map((row) => row.id),
    budgetImpactIds: fixture.budgetImpacts.map((row) => row.id),
    recurringTemplateIds: fixture.recurringTemplates.map((row) => row.id),
    occurrenceIds: fixture.recurringOccurrences.map((row) => row.id),
    notificationIds: fixture.notifications.map((row) => row.id),
    chatThreadIds: fixture.chatThreads.map((row) => row.id),
    chatMessageIds: fixture.chatMessages.map((row) => row.id),
  };
}

export function credentialAccountId(ownerId: string) {
  return `scale-credential-${ownerId}`;
}

async function deleteFixture(client: PoolClient, fixture: ScaleFixtureData, ownerId: string, ledgerScopeId: string) {
  const ids = fixtureIds(fixture);
  await client.query("DELETE FROM notifications WHERE id = ANY($1::uuid[])", [ids.notificationIds]);
  await client.query("DELETE FROM chat_thread_reads WHERE thread_id = ANY($1::uuid[])", [ids.chatThreadIds]);
  await client.query("DELETE FROM chat_messages WHERE thread_id = ANY($1::uuid[])", [ids.chatThreadIds]);
  await client.query("DELETE FROM chat_threads WHERE id = ANY($1::uuid[])", [ids.chatThreadIds]);
  // Budget rows link Personal, Group, and recurring sources, so they clear
  // before the workspaces they reference. Clear by owner (not by fixture IDs)
  // so a shrunk fixture still removes orphaned rows from a larger previous
  // seed in the disposable database; the scale owner holds only fixture data.
  await client.query("DELETE FROM budget_recurring_occurrences WHERE owner_user_id = $1", [ownerId]);
  await client.query("DELETE FROM budget_recurring_templates WHERE owner_user_id = $1", [ownerId]);
  await client.query("DELETE FROM budget_group_obligation_classifications WHERE owner_user_id = $1", [ownerId]);
  await client.query("DELETE FROM budget_group_settlement_sources WHERE owner_user_id = $1", [ownerId]);
  await client.query("DELETE FROM budget_group_expense_sources WHERE owner_user_id = $1", [ownerId]);
  await client.query("DELETE FROM budget_personal_repayment_sources WHERE owner_user_id = $1", [ownerId]);
  await client.query("DELETE FROM budget_personal_expense_sources WHERE owner_user_id = $1", [ownerId]);
  await client.query("DELETE FROM budget_impacts WHERE owner_user_id = $1", [ownerId]);
  await client.query("DELETE FROM budget_transactions WHERE owner_user_id = $1", [ownerId]);
  await client.query("DELETE FROM budget_period_categories WHERE owner_user_id = $1", [ownerId]);
  await client.query("DELETE FROM budget_categories WHERE owner_user_id = $1", [ownerId]);
  await client.query("DELETE FROM budget_periods WHERE owner_user_id = $1", [ownerId]);
  await client.query("DELETE FROM organization_invitations WHERE id = ANY($1::uuid[])", [ids.orgInvitationIds]);
  await client.query("DELETE FROM group_join_requests WHERE group_id = ANY($1::uuid[])", [ids.groupIds]);
  // Group money movements are immutable financial history by production
  // triggers (settlements, offsets, applications, and proofs of confirmed
  // settlements reject row deletes). Fixture teardown in the disposable scale
  // database removes fixture-owned rows with triggers bypassed, in FK-safe
  // order; enforcement resumes immediately afterwards so seed inserts that
  // follow in the same transaction remain trigger-validated.
  await client.query("SET LOCAL session_replication_role = 'replica'");
  try {
    await client.query("DELETE FROM group_settlement_proofs WHERE group_id = ANY($1::uuid[])", [ids.groupIds]);
    await client.query("DELETE FROM group_settlement_applications WHERE group_id = ANY($1::uuid[])", [ids.groupIds]);
    await client.query("DELETE FROM group_settlements WHERE group_id = ANY($1::uuid[])", [ids.groupIds]);
    await client.query("DELETE FROM group_offset_applications WHERE group_id = ANY($1::uuid[])", [ids.groupIds]);
    await client.query("DELETE FROM group_offset_settlements WHERE group_id = ANY($1::uuid[])", [ids.groupIds]);
  } finally {
    await client.query("SET LOCAL session_replication_role = 'origin'");
  }
  await client.query("DELETE FROM group_expense_receipts WHERE group_id = ANY($1::uuid[])", [ids.groupIds]);
  await client.query("DELETE FROM group_expense_lifecycle_events WHERE group_id = ANY($1::uuid[])", [ids.groupIds]);
  await client.query("DELETE FROM group_obligations WHERE group_id = ANY($1::uuid[])", [ids.groupIds]);
  await client.query("DELETE FROM group_expense_shares WHERE group_id = ANY($1::uuid[])", [ids.groupIds]);
  await client.query("DELETE FROM group_expenses WHERE group_id = ANY($1::uuid[])", [ids.groupIds]);
  await client.query("DELETE FROM group_memberships WHERE group_id = ANY($1::uuid[])", [ids.groupIds]);
  await client.query("DELETE FROM group_participants WHERE group_id = ANY($1::uuid[])", [ids.groupIds]);
  await client.query("DELETE FROM groups WHERE id = ANY($1::uuid[])", [ids.groupIds]);
  await client.query("DELETE FROM friend_connections WHERE id = ANY($1::uuid[])", [ids.friendConnectionIds]);
  // Organization participants project Personal friends, so they clear before
  // the ledger rows they reference.
  await client.query("DELETE FROM organization_memberships WHERE organization_id = ANY($1::uuid[])", [ids.orgIds]);
  await client.query("DELETE FROM organization_participants WHERE organization_id = ANY($1::uuid[])", [ids.orgIds]);
  await client.query(
    "DELETE FROM repayment_allocations WHERE ledger_scope_id = ANY($1::uuid[]) AND repayment_id = ANY($2::uuid[]) AND expense_share_id = ANY($3::uuid[])",
    [[ledgerScopeId, ...ids.orgScopeIds], [...ids.repaymentIds, ...ids.orgRepaymentIds], [...ids.shareIds, ...ids.orgShareIds]],
  );
  await client.query("DELETE FROM expense_receipts WHERE ledger_scope_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])", [[ledgerScopeId, ...ids.orgScopeIds], [...ids.receiptIds, ...ids.orgReceiptIds]]);
  await client.query("DELETE FROM expense_shares WHERE ledger_scope_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])", [[ledgerScopeId, ...ids.orgScopeIds], [...ids.shareIds, ...ids.orgShareIds]]);
  await client.query("DELETE FROM repayments WHERE ledger_scope_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])", [[ledgerScopeId, ...ids.orgScopeIds], [...ids.repaymentIds, ...ids.orgRepaymentIds]]);
  await client.query("DELETE FROM expenses WHERE ledger_scope_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])", [[ledgerScopeId, ...ids.orgScopeIds], [...ids.expenseIds, ...ids.orgExpenseIds]]);
  await client.query("DELETE FROM outings WHERE ledger_scope_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])", [[ledgerScopeId, ...ids.orgScopeIds], [...ids.outingIds, ...ids.orgOutingIds]]);
  await client.query("DELETE FROM friends WHERE ledger_scope_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])", [[ledgerScopeId, ...ids.orgScopeIds], [...ids.friendIds, ...ids.orgFriendIds]]);
  await client.query("DELETE FROM trips WHERE ledger_scope_id = $1 AND id = ANY($2::uuid[])", [ledgerScopeId, ids.tripIds]);
  await client.query("DELETE FROM ledger_scopes WHERE id = ANY($1::uuid[])", [ids.orgScopeIds]);
  await client.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [ids.orgIds]);
  const remainingPeriods: { rows: CountRow[] } = await client.query("SELECT count(*)::text AS count FROM budget_periods WHERE owner_user_id = $1", [ownerId]);
  if (count(remainingPeriods.rows[0]!.count) === 0) {
    await client.query("DELETE FROM budget_profiles WHERE owner_user_id = $1", [ownerId]);
  }
  await client.query("DELETE FROM accounts WHERE id = $1 AND user_id = $2 AND provider_id = 'credential'", [credentialAccountId(ownerId), ownerId]);
  await client.query("DELETE FROM users WHERE id = ANY($1)", [ids.secondaryUserIds]);
}

async function seedFixture(client: PoolClient, fixture: ScaleFixtureData, ownerId: string, ledgerScopeId: string) {
  await deleteFixture(client, fixture, ownerId, ledgerScopeId);
  await insertBatches(client, "users", ["id", "name", "email", "email_verified", "image", "username", "created_at", "updated_at"], fixture.secondaryUsers.map((row) => [row.id, row.name, row.email, false, null, row.username, row.createdAt, row.updatedAt]));
  await insertBatches(client, "organizations", ["id", "name", "description", "archived_at", "created_at", "updated_at"], fixture.organizations.map((row) => [row.id, row.name, row.description, row.archivedAt, row.createdAt, row.updatedAt]));
  await insertBatches(client, "ledger_scopes", ["id", "kind", "user_id", "organization_id", "created_at"], fixture.organizationScopes.map((row) => [row.id, "organization", null, row.organizationId, new Date("2026-01-01T00:00:00.000Z")]));
  await insertBatches(client, '"trips"', ["id", "ledger_scope_id", "name", "starts_on", "ends_on", "notes", "created_at", "updated_at"], fixture.trips.map((row) => [row.id, ledgerScopeId, row.name, row.startsOn, row.endsOn, row.notes, row.createdAt, row.updatedAt]));
  await insertBatches(client, '"friends"', ["id", "ledger_scope_id", "linked_user_id", "name", "phone_number", "notes", "archived_at", "created_at", "updated_at"], fixture.friends.map((row) => [row.id, ledgerScopeId, row.linkedUserId, row.name, row.phoneNumber, row.notes, row.archivedAt, row.createdAt, row.updatedAt]));
  await insertBatches(client, '"outings"', ["id", "ledger_scope_id", "trip_id", "title", "occurred_at", "occurred_on", "notes", "created_at", "updated_at"], fixture.outings.map((row) => [row.id, ledgerScopeId, row.tripId, row.title, row.occurredAt, row.occurredOn, row.notes, row.createdAt, row.updatedAt]));
  await insertBatches(client, '"expenses"', ["id", "ledger_scope_id", "outing_id", "description", "amount", "created_at", "updated_at"], fixture.expenses.map((row) => [row.id, ledgerScopeId, row.outingId, row.description, row.amount, row.createdAt, row.updatedAt]));
  await insertBatches(client, '"expense_shares"', ["id", "ledger_scope_id", "expense_id", "friend_id", "base_amount", "amount_owed", "created_at"], fixture.expenseShares.map((row) => [row.id, ledgerScopeId, row.expenseId, row.friendId, row.amountOwed, row.amountOwed, row.createdAt]));
  await insertBatches(client, '"repayments"', ["id", "ledger_scope_id", "friend_id", "amount", "paid_at", "paid_on", "payment_method", "notes", "created_at"], fixture.repayments.map((row) => [row.id, ledgerScopeId, row.friendId, row.amount, row.paidAt, row.paidOn, row.paymentMethod, row.notes, row.createdAt]));
  await insertBatches(client, '"repayment_allocations"', ["ledger_scope_id", "repayment_id", "expense_share_id", "amount", "created_at"], fixture.repaymentAllocations.map((row) => [ledgerScopeId, row.repaymentId, row.expenseShareId, row.amount, row.createdAt]));
  await insertBatches(client, '"expense_receipts"', ["id", "ledger_scope_id", "expense_id", "original_filename", "media_type", "byte_size", "sha256", "content", "created_at"], fixture.receipts.map((row) => [row.id, ledgerScopeId, row.expenseId, row.originalFilename, row.mediaType, row.byteSize, row.sha256, row.content, row.createdAt]));
  await insertBatches(client, "organization_participants", ["id", "organization_id", "user_id", "source_personal_friend_id", "display_name", "label", "created_by_user_id", "created_at", "updated_at"], fixture.organizationParticipants.map((row) => [row.id, row.organizationId, row.userId, row.sourcePersonalFriendId, row.displayName, row.label, row.createdByUserId, row.createdAt, row.updatedAt]));
  await insertBatches(client, "organization_memberships", ["organization_id", "user_id", "participant_id", "role", "custom_capabilities", "joined_at"], fixture.organizationMemberships.map((row) => [row.organizationId, row.userId, row.participantId, row.role, JSON.stringify(row.customCapabilities), row.joinedAt]));
  await seedOrganizationLedgers(client, fixture);
  await insertBatches(client, "friend_connections", ["id", "user_a_id", "user_b_id", "status", "created_at", "connected_at", "disconnected_at", "updated_at"], fixture.friendConnections.map((row) => [row.id, row.userAId, row.userBId, "connected", row.createdAt, row.connectedAt, null, row.updatedAt]));
  await insertBatches(client, '"groups"', ["id", "name", "description", "archived_at", "created_by_user_id", "created_at", "updated_at"], fixture.groups.map((row) => [row.id, row.name, row.description, row.archivedAt, row.createdByUserId, row.createdAt, row.updatedAt]));
  await insertBatches(client, "group_participants", ["id", "group_id", "user_id", "source_personal_friend_id", "display_name", "label", "created_at", "updated_at"], fixture.groupParticipants.map((row) => [row.id, row.groupId, row.userId, row.sourcePersonalFriendId, row.displayName, row.label, row.createdAt, row.updatedAt]));
  await insertBatches(client, "group_memberships", ["group_id", "user_id", "participant_id", "role", "joined_at"], fixture.groupMemberships.map((row) => [row.groupId, row.userId, row.participantId, row.role, row.joinedAt]));
  await seedGroupFinancials(client, fixture);
  await client.query("INSERT INTO budget_profiles (owner_user_id, created_at, updated_at) VALUES ($1, $2, $3) ON CONFLICT (owner_user_id) DO NOTHING", [ownerId, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z")]);
  await insertBatches(client, "budget_periods", ["id", "owner_user_id", "ordinal", "name", "starts_on", "ends_on", "total_budget", "status", "created_at", "updated_at"], fixture.budgetPeriods.map((row) => [row.id, ownerId, row.ordinal, row.name, row.startsOn, row.endsOn, row.totalBudget, row.status, row.createdAt, row.updatedAt]));
  await insertBatches(client, "budget_categories", ["id", "owner_user_id", "name", "normalized_name", "system_key", "archived_at", "created_at", "updated_at"], fixture.budgetCategories.map((row) => [row.id, ownerId, row.name, row.normalizedName, row.systemKey, row.archivedAt, row.createdAt, row.updatedAt]));
  await insertBatches(client, "budget_period_categories", ["owner_user_id", "budget_period_id", "budget_category_id", "allocated_amount", "display_order", "created_at", "updated_at"], fixture.budgetPeriodCategories.map((row) => [ownerId, row.budgetPeriodId, row.budgetCategoryId, row.allocatedAmount, row.displayOrder, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z")]));
  await insertBatches(client, "budget_transactions", ["id", "owner_user_id", "direction", "amount", "description", "occurred_on", "status", "origin", "created_at", "updated_at", "voided_at"], fixture.budgetTransactions.map((row) => [row.id, ownerId, row.direction, row.amount, row.description, row.occurredOn, row.status, row.origin, row.createdAt, row.updatedAt, row.voidedAt]));
  await insertBatches(client, "budget_impacts", ["id", "owner_user_id", "budget_transaction_id", "budget_category_id", "budget_period_id", "amount", "status", "target_period_ordinal", "created_at", "updated_at"], fixture.budgetImpacts.map((row) => [row.id, ownerId, row.budgetTransactionId, row.budgetCategoryId, row.budgetPeriodId, row.amount, row.status, row.targetPeriodOrdinal, row.createdAt, row.updatedAt]));
  await insertBatches(client, "budget_personal_expense_sources", ["owner_user_id", "budget_transaction_id", "expense_id", "created_at"], fixture.budgetPersonalExpenseSources.map((row) => [ownerId, row.budgetTransactionId, row.expenseId, new Date("2026-01-01T00:00:00.000Z")]));
  await insertBatches(client, "budget_personal_repayment_sources", ["owner_user_id", "budget_transaction_id", "repayment_id", "created_at"], fixture.budgetPersonalRepaymentSources.map((row) => [ownerId, row.budgetTransactionId, row.repaymentId, new Date("2026-01-01T00:00:00.000Z")]));
  await insertBatches(client, "budget_group_expense_sources", ["owner_user_id", "budget_transaction_id", "group_expense_id", "created_at"], fixture.budgetGroupExpenseSources.map((row) => [ownerId, row.budgetTransactionId, row.groupExpenseId, new Date("2026-01-01T00:00:00.000Z")]));
  await insertBatches(client, "budget_group_settlement_sources", ["owner_user_id", "budget_transaction_id", "group_settlement_id", "created_at"], fixture.budgetGroupSettlementSources.map((row) => [ownerId, row.budgetTransactionId, row.groupSettlementId, new Date("2026-01-01T00:00:00.000Z")]));
  await insertBatches(client, "budget_group_obligation_classifications", ["owner_user_id", "group_obligation_id", "budget_category_id", "created_at", "updated_at"], fixture.budgetGroupObligationClassifications.map((row) => [ownerId, row.groupObligationId, row.budgetCategoryId, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z")]));
  await insertBatches(client, "budget_recurring_templates", ["id", "owner_user_id", "name", "amount", "category_id", "frequency", "starts_on", "spread_count", "archived_at", "created_at", "updated_at"], fixture.recurringTemplates.map((row) => [row.id, ownerId, row.name, row.amount, row.categoryId, row.frequency, row.startsOn, row.spreadCount, row.archivedAt, row.createdAt, row.updatedAt]));
  await insertBatches(client, "budget_recurring_occurrences", ["id", "owner_user_id", "recurring_template_id", "scheduled_period_id", "scheduled_on", "amount", "category_id", "spread_count", "status", "budget_transaction_id", "created_at", "updated_at"], fixture.recurringOccurrences.map((row) => [row.id, ownerId, row.recurringTemplateId, row.scheduledPeriodId, row.scheduledOn, row.amount, row.categoryId, row.spreadCount, row.status, row.budgetTransactionId, row.createdAt, row.updatedAt]));
  await insertBatches(client, "organization_invitations", ["id", "organization_id", "target_user_id", "participant_id", "invited_by_user_id", "role", "status", "created_at", "expires_at", "updated_at", "accepted_at", "declined_at", "revoked_at", "expired_at"], fixture.organizationInvitations.map((row) => [row.id, row.organizationId, row.targetUserId, row.participantId, row.invitedByUserId, row.role, row.status, row.createdAt, row.expiresAt, row.updatedAt, row.acceptedAt, row.declinedAt, row.revokedAt, row.expiredAt]));
  await insertBatches(client, "chat_threads", ["id", "organization_id", "group_id", "created_at", "updated_at"], fixture.chatThreads.map((row) => [row.id, row.organizationId, row.groupId, row.createdAt, row.updatedAt]));
  await insertBatches(client, "chat_messages", ["id", "thread_id", "organization_id", "group_id", "sender_user_id", "sender_participant_id", "body", "created_at", "edited_at", "deleted_at", "deleted_by_user_id"], fixture.chatMessages.map((row) => [row.id, row.threadId, row.organizationId, row.groupId, row.senderUserId, row.senderParticipantId, row.body, row.createdAt, row.editedAt, row.deletedAt, row.deletedByUserId]));
  await insertBatches(client, "chat_thread_reads", ["thread_id", "user_id", "last_read_message_id", "created_at", "updated_at"], fixture.chatThreadReads.map((row) => [row.threadId, row.userId, row.lastReadMessageId, row.createdAt, row.updatedAt]));
  await insertBatches(client, "notifications", ["id", "recipient_user_id", "type", "metadata", "created_at", "read_at", "dedupe_key"], fixture.notifications.map((row) => [row.id, row.recipientUserId, row.type, JSON.stringify(row.metadata), row.createdAt, row.readAt, row.dedupeKey]));
}

async function seedGroupFinancials(client: PoolClient, fixture: ScaleFixtureData) {
  // Production triggers require lifecycle choreography: expenses and money
  // movements are created pending, shares must equal the total before an
  // expense confirms, obligations exist only for confirmed expenses, and
  // applications reference only confirmed money. The generator describes final
  // states; the seed replays the valid transitions in bulk.
  await insertBatches(client, "group_expenses", ["id", "group_id", "creator_participant_id", "payer_participant_id", "description", "occurred_at", "occurred_on", "total_amount", "state", "confirmed_at", "created_at", "updated_at"], fixture.groupExpenses.map((row) => [row.id, row.groupId, row.creatorParticipantId, row.payerParticipantId, row.description, row.occurredAt, row.occurredOn, row.totalAmount, "pending", null, row.createdAt, row.updatedAt]));
  await insertBatches(client, "group_expense_shares", ["id", "group_id", "expense_id", "participant_id", "amount", "created_at", "updated_at"], fixture.groupExpenseShares.map((row) => [row.id, row.groupId, row.expenseId, row.participantId, row.amount, row.createdAt, row.updatedAt]));
  const confirmTargets = fixture.groupExpenses.filter((row) => row.state === "confirmed" || row.state === "voided");
  await client.query(
    "UPDATE group_expenses AS expense SET state = 'confirmed', confirmed_at = input.confirmed_at, updated_at = input.confirmed_at FROM unnest($1::uuid[], $2::timestamptz[]) AS input(id, confirmed_at) WHERE expense.id = input.id",
    [confirmTargets.map((row) => row.id), confirmTargets.map((row) => row.confirmedAt)],
  );
  const obligationByExpense = new Map<string, typeof fixture.groupObligations>();
  for (const obligation of fixture.groupObligations) {
    obligationByExpense.set(obligation.sourceExpenseId, [...(obligationByExpense.get(obligation.sourceExpenseId) ?? []), obligation]);
  }
  const expenseState = new Map(fixture.groupExpenses.map((row) => [row.id, row.state]));
  const confirmedObligations = fixture.groupObligations.filter((row) => expenseState.get(row.sourceExpenseId) === "confirmed");
  const voidedObligations = fixture.groupObligations.filter((row) => expenseState.get(row.sourceExpenseId) === "voided");
  await insertBatches(client, "group_obligations", ["id", "group_id", "source_expense_id", "source_share_id", "debtor_participant_id", "creditor_participant_id", "original_amount", "voided_at", "created_at"], confirmedObligations.map((row) => [row.id, row.groupId, row.sourceExpenseId, row.sourceShareId, row.debtorParticipantId, row.creditorParticipantId, row.originalAmount, null, row.createdAt]));
  const rejectedTargets = fixture.groupExpenses.filter((row) => row.state === "rejected");
  await client.query("UPDATE group_expenses AS expense SET state = 'rejected' WHERE expense.id = ANY($1::uuid[])", [rejectedTargets.map((row) => row.id)]);
  await insertBatches(client, "group_obligations", ["id", "group_id", "source_expense_id", "source_share_id", "debtor_participant_id", "creditor_participant_id", "original_amount", "voided_at", "created_at"], voidedObligations.map((row) => [row.id, row.groupId, row.sourceExpenseId, row.sourceShareId, row.debtorParticipantId, row.creditorParticipantId, row.originalAmount, null, row.createdAt]));
  const voidedTargets = fixture.groupExpenses.filter((row) => row.state === "voided");
  await client.query("UPDATE group_expenses AS expense SET state = 'voided', updated_at = now() WHERE expense.id = ANY($1::uuid[])", [voidedTargets.map((row) => row.id)]);
  await client.query(
    "UPDATE group_obligations AS obligation SET voided_at = input.voided_at FROM unnest($1::uuid[], $2::timestamptz[]) AS input(id, voided_at) WHERE obligation.id = input.id",
    [voidedObligations.map((row) => row.id), voidedObligations.map((row) => row.voidedAt)],
  );
  await insertBatches(client, "group_settlements", ["id", "group_id", "sender_participant_id", "recipient_participant_id", "amount", "payment_method", "state", "paid_on", "created_at", "confirmed_at"], fixture.groupSettlements.map((row) => [row.id, row.groupId, row.senderParticipantId, row.recipientParticipantId, row.amount, row.paymentMethod, "pending", null, row.createdAt, null]));
  await insertBatches(client, "group_settlement_proofs", ["id", "group_id", "settlement_id", "original_filename", "media_type", "byte_size", "sha256", "content", "created_at"], fixture.groupSettlementProofs.map((row) => [row.id, row.groupId, row.settlementId, row.originalFilename, row.mediaType, row.byteSize, row.sha256, row.content, row.createdAt]));
  const confirmedSettlements = fixture.groupSettlements.filter((row) => row.state === "confirmed");
  await client.query(
    "UPDATE group_settlements AS settlement SET state = 'confirmed', confirmed_at = input.confirmed_at, paid_on = input.paid_on FROM unnest($1::uuid[], $2::timestamptz[], $3::date[]) AS input(id, confirmed_at, paid_on) WHERE settlement.id = input.id",
    [confirmedSettlements.map((row) => row.id), confirmedSettlements.map((row) => row.confirmedAt), confirmedSettlements.map((row) => row.paidOn)],
  );
  await insertBatches(client, "group_settlement_applications", ["id", "group_id", "settlement_id", "obligation_id", "applied_amount", "created_at"], fixture.groupSettlementApplications.map((row) => [row.id, row.groupId, row.settlementId, row.obligationId, row.appliedAmount, row.createdAt]));
  await insertBatches(client, "group_offset_settlements", ["id", "group_id", "initiator_participant_id", "counterparty_participant_id", "amount", "state", "created_at", "confirmed_at"], fixture.groupOffsets.map((row) => [row.id, row.groupId, row.initiatorParticipantId, row.counterpartyParticipantId, row.amount, "pending", row.createdAt, null]));
  const confirmedOffsets = fixture.groupOffsets.filter((row) => row.state === "confirmed");
  await client.query(
    "UPDATE group_offset_settlements AS offset_settlement SET state = 'confirmed', confirmed_at = input.confirmed_at FROM unnest($1::uuid[], $2::timestamptz[]) AS input(id, confirmed_at) WHERE offset_settlement.id = input.id",
    [confirmedOffsets.map((row) => row.id), confirmedOffsets.map((row) => row.confirmedAt)],
  );
  await insertBatches(client, "group_offset_applications", ["id", "group_id", "offset_settlement_id", "obligation_id", "applied_amount", "created_at"], fixture.groupOffsetApplications.map((row) => [row.id, row.groupId, row.offsetSettlementId, row.obligationId, row.appliedAmount, row.createdAt]));
  await insertBatches(client, "group_expense_lifecycle_events", ["id", "group_id", "expense_id", "event_type", "actor_user_id", "from_state", "to_state", "created_at"], fixture.groupExpenseLifecycleEvents.map((row) => [row.id, row.groupId, row.expenseId, row.eventType, row.actorUserId, row.fromState, row.toState, row.createdAt]));
  await insertBatches(client, "group_expense_receipts", ["id", "group_id", "expense_id", "original_filename", "media_type", "byte_size", "sha256", "content", "created_at"], fixture.groupExpenseReceipts.map((row) => [row.id, row.groupId, row.expenseId, row.originalFilename, row.mediaType, row.byteSize, row.sha256, row.content, row.createdAt]));
  await insertBatches(client, "group_join_requests", ["id", "group_id", "kind", "participant_id", "participant_display_name_snapshot", "participant_label_snapshot", "target_user_id", "requester_user_id", "status", "expires_at", "created_at", "updated_at", "accepted_at", "declined_at", "revoked_at", "expired_at"], fixture.groupJoinRequests.map((row) => [row.id, row.groupId, row.kind, row.participantId, row.participantDisplayNameSnapshot, row.participantLabelSnapshot, row.targetUserId, row.requesterUserId, row.status, row.expiresAt, row.createdAt, row.updatedAt, row.acceptedAt, row.declinedAt, row.revokedAt, row.expiredAt]));
}

async function seedOrganizationLedgers(client: PoolClient, fixture: ScaleFixtureData) {
  let friendOffset = 0;
  let outingOffset = 0;
  let expenseOffset = 0;
  let shareOffset = 0;
  let repaymentOffset = 0;
  let allocationOffset = 0;
  let receiptOffset = 0;
  for (const [orgIndex, scope] of fixture.organizationScopes.entries()) {
    const sizes = organizationLedgerSizes()[orgIndex]!;
    const friends = fixture.organizationFriends.slice(friendOffset, friendOffset + sizes.friends);
    const outings = fixture.organizationOutings.slice(outingOffset, outingOffset + sizes.outings);
    const expenses = fixture.organizationExpenses.slice(expenseOffset, expenseOffset + sizes.expenses);
    const repayments = fixture.organizationRepayments.slice(repaymentOffset, repaymentOffset + sizes.repayments);
    const expenseIds = new Set(expenses.map((row) => row.id));
    const repaymentIds = new Set(repayments.map((row) => row.id));
    const shares = fixture.organizationExpenseShares.slice(shareOffset).filter((row) => expenseIds.has(row.expenseId));
    const allocations = fixture.organizationRepaymentAllocations.slice(allocationOffset).filter((row) => repaymentIds.has(row.repaymentId));
    const receipts = fixture.organizationReceipts.slice(receiptOffset).filter((row) => expenseIds.has(row.expenseId));
    await insertBatches(client, '"friends"', ["id", "ledger_scope_id", "linked_user_id", "name", "phone_number", "notes", "archived_at", "created_at", "updated_at"], friends.map((row) => [row.id, scope.id, row.linkedUserId, row.name, row.phoneNumber, row.notes, row.archivedAt, row.createdAt, row.updatedAt]));
    await insertBatches(client, '"outings"', ["id", "ledger_scope_id", "trip_id", "title", "occurred_at", "occurred_on", "notes", "created_at", "updated_at"], outings.map((row) => [row.id, scope.id, row.tripId, row.title, row.occurredAt, row.occurredOn, row.notes, row.createdAt, row.updatedAt]));
    await insertBatches(client, '"expenses"', ["id", "ledger_scope_id", "outing_id", "description", "amount", "created_at", "updated_at"], expenses.map((row) => [row.id, scope.id, row.outingId, row.description, row.amount, row.createdAt, row.updatedAt]));
    await insertBatches(client, '"expense_shares"', ["id", "ledger_scope_id", "expense_id", "friend_id", "base_amount", "amount_owed", "created_at"], shares.map((row) => [row.id, scope.id, row.expenseId, row.friendId, row.amountOwed, row.amountOwed, row.createdAt]));
    await insertBatches(client, '"repayments"', ["id", "ledger_scope_id", "friend_id", "amount", "paid_at", "paid_on", "payment_method", "notes", "created_at"], repayments.map((row) => [row.id, scope.id, row.friendId, row.amount, row.paidAt, row.paidOn, row.paymentMethod, row.notes, row.createdAt]));
    await insertBatches(client, '"repayment_allocations"', ["ledger_scope_id", "repayment_id", "expense_share_id", "amount", "created_at"], allocations.map((row) => [scope.id, row.repaymentId, row.expenseShareId, row.amount, row.createdAt]));
    await insertBatches(client, '"expense_receipts"', ["id", "ledger_scope_id", "expense_id", "original_filename", "media_type", "byte_size", "sha256", "content", "created_at"], receipts.map((row) => [row.id, scope.id, row.expenseId, row.originalFilename, row.mediaType, row.byteSize, row.sha256, row.content, row.createdAt]));
    friendOffset += friends.length;
    outingOffset += outings.length;
    expenseOffset += expenses.length;
    repaymentOffset += repayments.length;
    shareOffset += shares.length;
    allocationOffset += allocations.length;
    receiptOffset += receipts.length;
  }
}

async function resolveOwner(client: PoolClient, email: string) {
  const result = await client.query<{ id: string; email: string }>("SELECT id, email FROM users WHERE lower(email) = lower($1)", [email]);
  assert(result.rows.length === 1, "SCALE_TEST_OWNER_EMAIL must resolve exactly one existing test user");
  return result.rows[0]!;
}

async function verifyCounts(client: PoolClient, fixture: ScaleFixtureData, ownerId: string, ledgerScopeId: string) {
  const ids = fixtureIds(fixture);
  const tables = [
    ["friends", "id", ids.friendIds, fixture.friends.length],
    ["outings", "id", ids.outingIds, fixture.outings.length],
    ["expenses", "id", ids.expenseIds, fixture.expenses.length],
    ["expense_shares", "id", ids.shareIds, fixture.expenseShares.length],
    ["repayments", "id", ids.repaymentIds, fixture.repayments.length],
    ["expense_receipts", "id", ids.receiptIds, fixture.receipts.length],
  ] as const;
  for (const [table, column, tableIds, expected] of tables) {
    const result = await client.query<{ total: string; owned: string }>(
      `SELECT count(*)::text AS total, count(*) FILTER (WHERE ledger_scope_id = $1)::text AS owned FROM "${table}" WHERE "${column}" = ANY($2::uuid[])`,
      [ledgerScopeId, tableIds],
    );
    const row = result.rows[0]!;
    assert(count(row.total) === expected && count(row.owned) === expected, `${table} fixture count or ownership mismatch`);
  }
  const allocationResult = await client.query<{ total: string; owned: string }>(
    "SELECT count(*)::text AS total, count(*) FILTER (WHERE ledger_scope_id = $1)::text AS owned FROM repayment_allocations WHERE repayment_id = ANY($2::uuid[]) AND expense_share_id = ANY($3::uuid[])",
    [ledgerScopeId, ids.repaymentIds, ids.shareIds],
  );
  assert(count(allocationResult.rows[0]!.total) === fixture.repaymentAllocations.length && count(allocationResult.rows[0]!.owned) === fixture.repaymentAllocations.length, "repayment allocation fixture count or ownership mismatch");

  const ownedCount = async (label: string, query: string, params: unknown[], expected: number) => {
    const result = await client.query<{ total: string }>(query, params as Array<string | string[] | Date | null | boolean | number>);
    assert(count(result.rows[0]!.total) === expected, `${label} fixture count mismatch`);
  };
  await ownedCount("secondary users", "SELECT count(*)::text AS total FROM users WHERE id = ANY($1)", [ids.secondaryUserIds], fixture.secondaryUsers.length);
  await ownedCount("trips", "SELECT count(*)::text AS total FROM trips WHERE ledger_scope_id = $1 AND id = ANY($2::uuid[])", [ledgerScopeId, ids.tripIds], fixture.trips.length);
  await ownedCount("linked friends", "SELECT count(*)::text AS total FROM friends WHERE ledger_scope_id = $1 AND linked_user_id IS NOT NULL AND id = ANY($2::uuid[])", [ledgerScopeId, ids.friendIds], SCALE_FIXTURE_COUNTS.linkedFriends);
  await ownedCount("dated outings", "SELECT count(*)::text AS total FROM outings WHERE ledger_scope_id = $1 AND occurred_on IS NOT NULL AND id = ANY($2::uuid[])", [ledgerScopeId, ids.outingIds], fixture.outings.length);
  await ownedCount("dated repayments", "SELECT count(*)::text AS total FROM repayments WHERE ledger_scope_id = $1 AND paid_on IS NOT NULL AND id = ANY($2::uuid[])", [ledgerScopeId, ids.repaymentIds], fixture.repayments.length);
  await ownedCount("friend connections", "SELECT count(*)::text AS total FROM friend_connections WHERE id = ANY($1::uuid[])", [ids.friendConnectionIds], fixture.friendConnections.length);
  await ownedCount("groups", "SELECT count(*)::text AS total FROM groups WHERE id = ANY($1::uuid[])", [ids.groupIds], fixture.groups.length);
  await ownedCount("group participants", "SELECT count(*)::text AS total FROM group_participants WHERE group_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])", [ids.groupIds, ids.groupParticipantIds], fixture.groupParticipants.length);
  await ownedCount("group memberships", "SELECT count(*)::text AS total FROM group_memberships WHERE group_id = ANY($1::uuid[])", [ids.groupIds], fixture.groupMemberships.length);
  await ownedCount("group expenses", "SELECT count(*)::text AS total FROM group_expenses WHERE group_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])", [ids.groupIds, ids.groupExpenseIds], fixture.groupExpenses.length);
  await ownedCount("group expense shares", "SELECT count(*)::text AS total FROM group_expense_shares WHERE group_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])", [ids.groupIds, ids.groupShareIds], fixture.groupExpenseShares.length);
  await ownedCount("group obligations", "SELECT count(*)::text AS total FROM group_obligations WHERE group_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])", [ids.groupIds, ids.obligationIds], fixture.groupObligations.length);
  await ownedCount("group settlements", "SELECT count(*)::text AS total FROM group_settlements WHERE group_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])", [ids.groupIds, ids.settlementIds], fixture.groupSettlements.length);
  await ownedCount("group settlement applications", "SELECT count(*)::text AS total FROM group_settlement_applications WHERE group_id = ANY($1::uuid[])", [ids.groupIds], fixture.groupSettlementApplications.length);
  await ownedCount("group offsets", "SELECT count(*)::text AS total FROM group_offset_settlements WHERE group_id = ANY($1::uuid[])", [ids.groupIds], fixture.groupOffsets.length);
  await ownedCount("group offset applications", "SELECT count(*)::text AS total FROM group_offset_applications WHERE group_id = ANY($1::uuid[])", [ids.groupIds], fixture.groupOffsetApplications.length);
  await ownedCount("group expense receipts", "SELECT count(*)::text AS total FROM group_expense_receipts WHERE group_id = ANY($1::uuid[])", [ids.groupIds], fixture.groupExpenseReceipts.length);
  await ownedCount("group settlement proofs", "SELECT count(*)::text AS total FROM group_settlement_proofs WHERE group_id = ANY($1::uuid[])", [ids.groupIds], fixture.groupSettlementProofs.length);
  await ownedCount("group lifecycle events", "SELECT count(*)::text AS total FROM group_expense_lifecycle_events WHERE group_id = ANY($1::uuid[])", [ids.groupIds], fixture.groupExpenseLifecycleEvents.length);
  await ownedCount("group join requests", "SELECT count(*)::text AS total FROM group_join_requests WHERE group_id = ANY($1::uuid[])", [ids.groupIds], fixture.groupJoinRequests.length);
  await ownedCount("organizations", "SELECT count(*)::text AS total FROM organizations WHERE id = ANY($1::uuid[])", [ids.orgIds], fixture.organizations.length);
  await ownedCount("organization scopes", "SELECT count(*)::text AS total FROM ledger_scopes WHERE kind = 'organization' AND id = ANY($1::uuid[])", [ids.orgScopeIds], fixture.organizationScopes.length);
  await ownedCount("organization participants", "SELECT count(*)::text AS total FROM organization_participants WHERE organization_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])", [ids.orgIds, ids.orgParticipantIds], fixture.organizationParticipants.length);
  await ownedCount("organization memberships", "SELECT count(*)::text AS total FROM organization_memberships WHERE organization_id = ANY($1::uuid[])", [ids.orgIds], fixture.organizationMemberships.length);
  await ownedCount("organization invitations", "SELECT count(*)::text AS total FROM organization_invitations WHERE organization_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])", [ids.orgIds, ids.orgInvitationIds], fixture.organizationInvitations.length);
  await ownedCount("organization friends", "SELECT count(*)::text AS total FROM friends WHERE ledger_scope_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])", [ids.orgScopeIds, ids.orgFriendIds], fixture.organizationFriends.length);
  await ownedCount("organization outings", "SELECT count(*)::text AS total FROM outings WHERE ledger_scope_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])", [ids.orgScopeIds, ids.orgOutingIds], fixture.organizationOutings.length);
  await ownedCount("organization expenses", "SELECT count(*)::text AS total FROM expenses WHERE ledger_scope_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])", [ids.orgScopeIds, ids.orgExpenseIds], fixture.organizationExpenses.length);
  await ownedCount("organization shares", "SELECT count(*)::text AS total FROM expense_shares WHERE ledger_scope_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])", [ids.orgScopeIds, ids.orgShareIds], fixture.organizationExpenseShares.length);
  await ownedCount("organization repayments", "SELECT count(*)::text AS total FROM repayments WHERE ledger_scope_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])", [ids.orgScopeIds, ids.orgRepaymentIds], fixture.organizationRepayments.length);
  await ownedCount("organization receipts", "SELECT count(*)::text AS total FROM expense_receipts WHERE ledger_scope_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])", [ids.orgScopeIds, ids.orgReceiptIds], fixture.organizationReceipts.length);
  await ownedCount("budget profile", "SELECT count(*)::text AS total FROM budget_profiles WHERE owner_user_id = $1", [ownerId], 1);
  await ownedCount("budget periods", "SELECT count(*)::text AS total FROM budget_periods WHERE owner_user_id = $1 AND id = ANY($2::uuid[])", [ownerId, ids.budgetPeriodIds], fixture.budgetPeriods.length);
  await ownedCount("budget categories", "SELECT count(*)::text AS total FROM budget_categories WHERE owner_user_id = $1 AND id = ANY($2::uuid[])", [ownerId, ids.budgetCategoryIds], fixture.budgetCategories.length);
  await ownedCount("budget period categories", "SELECT count(*)::text AS total FROM budget_period_categories WHERE owner_user_id = $1 AND budget_period_id = ANY($2::uuid[])", [ownerId, ids.budgetPeriodIds], fixture.budgetPeriodCategories.length);
  await ownedCount("budget transactions", "SELECT count(*)::text AS total FROM budget_transactions WHERE owner_user_id = $1 AND id = ANY($2::uuid[])", [ownerId, ids.budgetTransactionIds], fixture.budgetTransactions.length);
  await ownedCount("budget impacts", "SELECT count(*)::text AS total FROM budget_impacts WHERE owner_user_id = $1 AND id = ANY($2::uuid[])", [ownerId, ids.budgetImpactIds], fixture.budgetImpacts.length);
  await ownedCount("personal expense sources", "SELECT count(*)::text AS total FROM budget_personal_expense_sources WHERE owner_user_id = $1", [ownerId], fixture.budgetPersonalExpenseSources.length);
  await ownedCount("personal repayment sources", "SELECT count(*)::text AS total FROM budget_personal_repayment_sources WHERE owner_user_id = $1", [ownerId], fixture.budgetPersonalRepaymentSources.length);
  await ownedCount("group expense sources", "SELECT count(*)::text AS total FROM budget_group_expense_sources WHERE owner_user_id = $1", [ownerId], fixture.budgetGroupExpenseSources.length);
  await ownedCount("group settlement sources", "SELECT count(*)::text AS total FROM budget_group_settlement_sources WHERE owner_user_id = $1", [ownerId], fixture.budgetGroupSettlementSources.length);
  await ownedCount("obligation classifications", "SELECT count(*)::text AS total FROM budget_group_obligation_classifications WHERE owner_user_id = $1", [ownerId], fixture.budgetGroupObligationClassifications.length);
  await ownedCount("recurring templates", "SELECT count(*)::text AS total FROM budget_recurring_templates WHERE owner_user_id = $1 AND id = ANY($2::uuid[])", [ownerId, ids.recurringTemplateIds], fixture.recurringTemplates.length);
  await ownedCount("recurring occurrences", "SELECT count(*)::text AS total FROM budget_recurring_occurrences WHERE owner_user_id = $1 AND id = ANY($2::uuid[])", [ownerId, ids.occurrenceIds], fixture.recurringOccurrences.length);
  await ownedCount("chat threads", "SELECT count(*)::text AS total FROM chat_threads WHERE id = ANY($1::uuid[])", [ids.chatThreadIds], fixture.chatThreads.length);
  await ownedCount("chat messages", "SELECT count(*)::text AS total FROM chat_messages WHERE thread_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])", [ids.chatThreadIds, ids.chatMessageIds], fixture.chatMessages.length);
  await ownedCount("notifications", "SELECT count(*)::text AS total FROM notifications WHERE recipient_user_id = $1 AND id = ANY($2::uuid[])", [ownerId, ids.notificationIds], fixture.notifications.length);
}

async function verifyRelationships(client: PoolClient, fixture: ScaleFixtureData, ledgerScopeId: string) {
  const ids = fixtureIds(fixture);
  const result = await client.query<Record<string, string>>(
    `SELECT
      (SELECT count(*) FROM expenses e WHERE e.ledger_scope_id = $1 AND e.id = ANY($2::uuid[]) AND NOT EXISTS (SELECT 1 FROM outings o WHERE o.ledger_scope_id = e.ledger_scope_id AND o.id = e.outing_id AND o.id = ANY($6::uuid[]))) AS expense_outing,
      (SELECT count(*) FROM expense_shares s WHERE s.ledger_scope_id = $1 AND s.id = ANY($3::uuid[]) AND (NOT EXISTS (SELECT 1 FROM expenses e WHERE e.ledger_scope_id = s.ledger_scope_id AND e.id = s.expense_id AND e.id = ANY($2::uuid[])) OR NOT EXISTS (SELECT 1 FROM friends f WHERE f.ledger_scope_id = s.ledger_scope_id AND f.id = s.friend_id AND f.id = ANY($7::uuid[])))) AS share_parent,
      (SELECT count(*) FROM repayments r WHERE r.ledger_scope_id = $1 AND r.id = ANY($4::uuid[]) AND NOT EXISTS (SELECT 1 FROM friends f WHERE f.ledger_scope_id = r.ledger_scope_id AND f.id = r.friend_id AND f.id = ANY($7::uuid[]))) AS repayment_friend,
      (SELECT count(*) FROM expense_receipts r WHERE r.ledger_scope_id = $1 AND r.id = ANY($5::uuid[]) AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.ledger_scope_id = r.ledger_scope_id AND e.id = r.expense_id AND e.id = ANY($2::uuid[]))) AS receipt_expense,
      (SELECT count(*) FROM repayment_allocations a WHERE a.ledger_scope_id = $1 AND a.repayment_id = ANY($4::uuid[]) AND a.expense_share_id = ANY($3::uuid[]) AND (NOT EXISTS (SELECT 1 FROM repayments r WHERE r.ledger_scope_id = a.ledger_scope_id AND r.id = a.repayment_id AND r.id = ANY($4::uuid[])) OR NOT EXISTS (SELECT 1 FROM expense_shares s WHERE s.ledger_scope_id = a.ledger_scope_id AND s.id = a.expense_share_id AND s.id = ANY($3::uuid[])))) AS allocation_parent,
      (SELECT count(*) FROM repayment_allocations a JOIN repayments r ON r.ledger_scope_id = a.ledger_scope_id AND r.id = a.repayment_id JOIN expense_shares s ON s.ledger_scope_id = a.ledger_scope_id AND s.id = a.expense_share_id WHERE a.ledger_scope_id = $1 AND a.repayment_id = ANY($4::uuid[]) AND a.expense_share_id = ANY($3::uuid[]) AND r.friend_id <> s.friend_id) AS cross_friend,
      (SELECT count(*) FROM outings o WHERE o.ledger_scope_id = $1 AND o.id = ANY($6::uuid[]) AND o.trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.ledger_scope_id = o.ledger_scope_id AND t.id = o.trip_id)) AS outing_trip,
      (SELECT count(*) FROM friends f WHERE f.ledger_scope_id = $1 AND f.id = ANY($7::uuid[]) AND f.linked_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = f.linked_user_id)) AS friend_link`,
    [ledgerScopeId, ids.expenseIds, ids.shareIds, ids.repaymentIds, ids.receiptIds, ids.outingIds, ids.friendIds],
  );
  for (const [name, value] of Object.entries(result.rows[0]!)) assert(count(value) === 0, `${name} relationship violations found`);
}

async function verifyFinancialInvariants(client: PoolClient, fixture: ScaleFixtureData, ledgerScopeId: string) {
  const ids = fixtureIds(fixture);
  const result = await client.query<Record<string, string>>(
    `SELECT
      (SELECT count(*) FROM (SELECT s.expense_id FROM expense_shares s JOIN expenses e ON e.ledger_scope_id = s.ledger_scope_id AND e.id = s.expense_id WHERE s.ledger_scope_id = $1 AND s.id = ANY($2::uuid[]) GROUP BY s.expense_id, e.amount HAVING sum(s.amount_owed) > e.amount) invalid) AS shares_over_expense,
      (SELECT count(*) FROM (SELECT a.repayment_id FROM repayment_allocations a JOIN repayments r ON r.ledger_scope_id = a.ledger_scope_id AND r.id = a.repayment_id WHERE a.ledger_scope_id = $1 AND a.repayment_id = ANY($3::uuid[]) AND a.expense_share_id = ANY($2::uuid[]) GROUP BY a.repayment_id, r.amount HAVING sum(a.amount) > r.amount) invalid) AS allocations_over_repayment,
      (SELECT count(*) FROM (SELECT a.expense_share_id FROM repayment_allocations a JOIN expense_shares s ON s.ledger_scope_id = a.ledger_scope_id AND s.id = a.expense_share_id WHERE a.ledger_scope_id = $1 AND a.repayment_id = ANY($3::uuid[]) AND a.expense_share_id = ANY($2::uuid[]) GROUP BY a.expense_share_id, s.amount_owed HAVING sum(a.amount) > s.amount_owed) invalid) AS allocations_over_share`,
    [ledgerScopeId, ids.shareIds, ids.repaymentIds],
  );
  for (const [name, value] of Object.entries(result.rows[0]!)) assert(count(value) === 0, `${name} financial invariant violations found`);
}

async function verifyScenarios(client: PoolClient, fixture: ScaleFixtureData, ledgerScopeId: string) {
  const ids = fixtureIds(fixture);
  const scenario = SCALE_FIXTURE_SCENARIO_IDS;
  const result = await client.query<Record<string, string>>(
    `WITH share_totals AS (
      SELECT s.expense_id, sum(s.amount_owed)::bigint AS amount, count(DISTINCT s.friend_id)::int AS friends
      FROM expense_shares s WHERE s.ledger_scope_id = $1 AND s.expense_id = ANY($2::uuid[]) GROUP BY s.expense_id
    ), allocation_totals AS (
      SELECT s.expense_id, sum(a.amount)::bigint AS amount
      FROM expense_shares s JOIN repayment_allocations a ON a.ledger_scope_id = s.ledger_scope_id AND a.expense_share_id = s.id
      WHERE s.ledger_scope_id = $1 AND s.expense_id = ANY($2::uuid[]) GROUP BY s.expense_id
    ), repayment_totals AS (
      SELECT r.id, r.amount, coalesce(sum(a.amount), 0)::bigint AS allocated
      FROM repayments r LEFT JOIN repayment_allocations a ON a.ledger_scope_id = r.ledger_scope_id AND a.repayment_id = r.id
      WHERE r.ledger_scope_id = $1 AND r.id = ANY($3::uuid[]) GROUP BY r.id, r.amount
    )
    SELECT
      (SELECT count(*) FROM expenses e WHERE e.ledger_scope_id = $1 AND e.id = $4::uuid AND NOT EXISTS (SELECT 1 FROM expense_shares s WHERE s.ledger_scope_id = e.ledger_scope_id AND s.expense_id = e.id)) AS no_shares,
      (SELECT count(*) FROM share_totals s JOIN allocation_totals a USING (expense_id) WHERE s.expense_id = $5::uuid AND s.amount = a.amount AND s.amount > 0) AS fully_paid,
      (SELECT count(*) FROM share_totals s JOIN allocation_totals a USING (expense_id) WHERE s.expense_id = $6::uuid AND a.amount > 0 AND a.amount < s.amount) AS partially_paid,
      (SELECT count(*) FROM share_totals s WHERE s.expense_id = $7::uuid AND NOT EXISTS (SELECT 1 FROM allocation_totals a WHERE a.expense_id = s.expense_id)) AS unpaid,
      (SELECT count(*) FROM repayment_totals WHERE id = $8::uuid AND allocated > 0 AND amount > allocated) AS overpaid,
      (SELECT count(*) FROM repayment_totals WHERE id = $9::uuid AND allocated = 0) AS unallocated,
      (SELECT count(*) FROM share_totals WHERE expense_id = $10::uuid AND friends >= 2) AS several_friends,
      (SELECT count(*) FROM friends f WHERE f.ledger_scope_id = $1 AND f.id = $11::uuid AND char_length(f.name) >= 120) AS long_friend,
      (SELECT count(*) FROM outings o WHERE o.ledger_scope_id = $1 AND o.id = $12::uuid AND char_length(o.title) >= 160 AND o.occurred_at = $13::timestamptz) AS long_outing_boundary,
      (SELECT count(*) FROM expenses e WHERE e.ledger_scope_id = $1 AND e.id = $14::uuid AND char_length(e.description) >= 200) AS long_expense`,
    [
      ledgerScopeId,
      ids.expenseIds,
      ids.repaymentIds,
      scenario.noSharesExpenseId,
      scenario.fullyPaidExpenseId,
      scenario.partiallyPaidExpenseId,
      scenario.unpaidExpenseId,
      scenario.overpaidRepaymentId,
      scenario.unallocatedRepaymentId,
      scenario.severalFriendsExpenseId,
      fixture.friends[0]!.id,
      fixture.outings[0]!.id,
      fixture.outings[0]!.occurredAt,
      fixture.expenses[0]!.id,
    ],
  );
  for (const [name, value] of Object.entries(result.rows[0]!)) assert(count(value) === 1, `${name} scenario is missing`);
}

async function verifyFixture(client: PoolClient, fixture: ScaleFixtureData, ownerId: string, ledgerScopeId: string) {
  await verifyCounts(client, fixture, ownerId, ledgerScopeId);
  await verifyRelationships(client, fixture, ledgerScopeId);
  await verifyFinancialInvariants(client, fixture, ledgerScopeId);
  await verifyScenarios(client, fixture, ledgerScopeId);
  await verifyGroupInvariants(client, fixture);
  await verifyOrganizationInvariants(client, fixture, ownerId);
  await verifyBudgetAuthority(client, fixture, ownerId);
  await verifyActiveBudgetRealism(client, ownerId);
  await verifyCollaborationAnchors(client, fixture, ownerId);
}

async function verifyActiveBudgetRealism(client: PoolClient, ownerId: string) {
  const periodResult = await client.query<{ id: string; total_budget: string; starts_on: string; ends_on: string }>(
    "SELECT id, total_budget::text AS total_budget, starts_on::text AS starts_on, ends_on::text AS ends_on FROM budget_periods WHERE owner_user_id = $1 AND status = 'active'",
    [ownerId],
  );
  assert(periodResult.rows.length === 1, "budget must have exactly one active period");
  const period = periodResult.rows[0]!;
  const totalBudget = count(period.total_budget);
  assert(totalBudget === 20_000_000, "active budget total is not the fixture anchor");
  // Reuse the dashboard authority: posted transactions plus applied impacts.
  const sums = await client.query<{ outflow: string; inflow: string; allocated: string }>(
    `SELECT
      (SELECT coalesce(sum(i.amount) FILTER (WHERE t.direction = 'outflow'), 0)::text FROM budget_impacts i JOIN budget_transactions t ON t.owner_user_id = i.owner_user_id AND t.id = i.budget_transaction_id WHERE i.owner_user_id = $1 AND i.budget_period_id = $2 AND i.status = 'applied' AND t.status = 'posted') AS outflow,
      (SELECT coalesce(sum(i.amount) FILTER (WHERE t.direction = 'inflow'), 0)::text FROM budget_impacts i JOIN budget_transactions t ON t.owner_user_id = i.owner_user_id AND t.id = i.budget_transaction_id WHERE i.owner_user_id = $1 AND i.budget_period_id = $2 AND i.status = 'applied' AND t.status = 'posted') AS inflow,
      (SELECT coalesce(sum(allocated_amount), 0)::text FROM budget_period_categories WHERE owner_user_id = $1 AND budget_period_id = $2) AS allocated`,
    [ownerId, period.id],
  );
  const outflow = count(sums.rows[0]!.outflow);
  const inflow = count(sums.rows[0]!.inflow);
  const netSpent = outflow - inflow;
  const remaining = totalBudget - netSpent;
  const allocated = count(sums.rows[0]!.allocated);
  const unallocated = totalBudget - allocated;
  assert(netSpent < totalBudget, "active budget is overspent and not useful for UI inspection");
  assert(netSpent >= 10_000_000 && netSpent <= 15_000_000, "active budget net is outside the realistic 10-15m band");
  assert(remaining > 0, "active budget has no remaining amount");
  assert(unallocated > 0, "active budget has no unallocated amount");
  const safeDaily = calculateSafeDaily(period.starts_on, period.ends_on, "2026-09-15", remaining);
  assert(safeDaily !== null && safeDaily > 0, "active budget Safe Daily is not positive on the fixture reference date");
  const categories = await client.query<{ allocated: string; net: string }>(
    `SELECT pc.allocated_amount::text AS allocated,
      (coalesce(sum(i.amount) FILTER (WHERE t.direction = 'outflow'), 0) - coalesce(sum(i.amount) FILTER (WHERE t.direction = 'inflow'), 0))::text AS net
      FROM budget_period_categories pc LEFT JOIN budget_impacts i ON i.owner_user_id = pc.owner_user_id AND i.budget_period_id = pc.budget_period_id AND i.budget_category_id = pc.budget_category_id AND i.status = 'applied'
      LEFT JOIN budget_transactions t ON t.owner_user_id = i.owner_user_id AND t.id = i.budget_transaction_id AND t.status = 'posted'
      WHERE pc.owner_user_id = $1 AND pc.budget_period_id = $2 GROUP BY pc.allocated_amount`,
    [ownerId, period.id],
  );
  const nets = categories.rows.map((row) => ({ allocated: count(row.allocated), net: count(row.net) }));
  assert(nets.some((row) => row.net > row.allocated || row.net >= Math.floor(row.allocated * 0.9)), "no active category is near or over allocation");
  assert(nets.some((row) => row.net < row.allocated), "no active category has remaining budget");
  const links = await client.query<Record<string, string>>(
    `SELECT
      (SELECT count(*) FROM budget_personal_expense_sources s JOIN budget_transactions t ON t.owner_user_id = s.owner_user_id AND t.id = s.budget_transaction_id WHERE s.owner_user_id = $1 AND t.occurred_on >= '2026-09-01' AND t.occurred_on <= '2026-09-30') AS personal,
      (SELECT count(*) FROM budget_group_expense_sources s JOIN budget_transactions t ON t.owner_user_id = s.owner_user_id AND t.id = s.budget_transaction_id WHERE s.owner_user_id = $1 AND t.occurred_on >= '2026-09-01' AND t.occurred_on <= '2026-09-30') AS group_expenses,
      (SELECT count(*) FROM budget_transactions WHERE owner_user_id = $1 AND origin = 'recurring' AND occurred_on >= '2026-09-01' AND occurred_on <= '2026-09-30') AS recurring,
      (SELECT count(*) FROM budget_transactions WHERE owner_user_id = $1 AND occurred_on >= '2026-09-24' AND occurred_on <= '2026-09-30') AS recent`,
    [ownerId],
  );
  const linkRow = links.rows[0]!;
  assert(count(linkRow.personal!) > 0, "no active-period linked Personal activity");
  assert(count(linkRow.group_expenses!) > 0, "no active-period linked Group activity");
  assert(count(linkRow.recurring!) > 0, "no active-period recurring activity");
  assert(count(linkRow.recent!) > 0, "no recent active-period transactions");
}

async function verifyGroupInvariants(client: PoolClient, fixture: ScaleFixtureData) {
  const ids = fixtureIds(fixture);
  const result = await client.query<Record<string, string>>(
    `SELECT
      (SELECT count(*) FROM group_obligations o WHERE o.group_id = ANY($1::uuid[]) AND o.id = ANY($2::uuid[]) AND EXISTS (SELECT 1 FROM group_expenses e WHERE e.group_id = o.group_id AND e.id = o.source_expense_id AND e.state IN ('pending', 'rejected'))) AS non_authoritative_obligation,
      (SELECT count(*) FROM group_obligations o WHERE o.group_id = ANY($1::uuid[]) AND o.id = ANY($2::uuid[]) AND ((SELECT e.state FROM group_expenses e WHERE e.group_id = o.group_id AND e.id = o.source_expense_id) = 'voided') <> (o.voided_at IS NOT NULL)) AS void_shape,
      (SELECT count(*) FROM group_settlement_applications a JOIN group_settlements s ON s.group_id = a.group_id AND s.id = a.settlement_id WHERE a.group_id = ANY($1::uuid[]) AND s.state = 'pending') AS pending_settlement_application,
      (SELECT count(*) FROM (SELECT a.settlement_id FROM group_settlement_applications a JOIN group_settlements s ON s.group_id = a.group_id AND s.id = a.settlement_id WHERE a.group_id = ANY($1::uuid[]) GROUP BY a.settlement_id, s.amount HAVING sum(a.applied_amount) > s.amount) invalid) AS settlement_over_applied,
      (SELECT count(*) FROM (SELECT a.offset_settlement_id, ob.debtor_participant_id, ob.creditor_participant_id FROM group_offset_applications a JOIN group_obligations ob ON ob.group_id = a.group_id AND ob.id = a.obligation_id JOIN group_offset_settlements o ON o.group_id = a.group_id AND o.id = a.offset_settlement_id WHERE a.group_id = ANY($1::uuid[]) AND o.state = 'confirmed' GROUP BY a.offset_settlement_id, ob.debtor_participant_id, ob.creditor_participant_id, o.amount HAVING sum(a.applied_amount) <> o.amount) invalid) AS offset_amount_mismatch,
      (SELECT count(*) FROM group_offset_applications a JOIN group_offset_settlements o ON o.group_id = a.group_id AND o.id = a.offset_settlement_id WHERE a.group_id = ANY($1::uuid[]) AND o.state = 'pending') AS pending_offset_application,
      (SELECT count(*) FROM (SELECT a.obligation_id FROM (SELECT obligation_id, applied_amount FROM group_settlement_applications WHERE group_id = ANY($1::uuid[]) UNION ALL SELECT obligation_id, applied_amount FROM group_offset_applications WHERE group_id = ANY($1::uuid[])) a JOIN group_obligations o ON o.group_id = ANY($1::uuid[]) AND o.id = a.obligation_id GROUP BY a.obligation_id, o.original_amount HAVING sum(a.applied_amount) > o.original_amount) invalid) AS obligation_over_applied,
      (SELECT count(*) FROM group_expenses e JOIN group_participants p ON p.group_id = e.group_id AND p.id = e.payer_participant_id WHERE e.group_id = ANY($1::uuid[]) AND e.id = ANY($3::uuid[]) AND p.user_id IS NULL) AS external_payer,
      (SELECT count(*) FROM group_participants p WHERE p.group_id = ANY($1::uuid[]) AND p.id = ANY($4::uuid[]) AND NOT ((p.user_id IS NOT NULL AND p.display_name IS NULL) OR (p.user_id IS NULL AND p.display_name IS NOT NULL))) AS participant_identity,
      (SELECT count(*) FROM (SELECT group_id FROM group_memberships WHERE group_id = ANY($1::uuid[]) AND role = 'owner' GROUP BY group_id HAVING count(*) <> 1) invalid) AS owner_count`,
    [ids.groupIds, ids.obligationIds, ids.groupExpenseIds, ids.groupParticipantIds],
  );
  for (const [name, value] of Object.entries(result.rows[0]!)) assert(count(value) === 0, `${name} group invariant violations found`);
}

async function verifyOrganizationInvariants(client: PoolClient, fixture: ScaleFixtureData, ownerId: string) {
  const ids = fixtureIds(fixture);
  const result = await client.query<Record<string, string>>(
    `SELECT
      (SELECT count(*) FROM organization_memberships m WHERE m.organization_id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM organization_participants p WHERE p.organization_id = m.organization_id AND p.id = m.participant_id)) AS membership_participant,
      (SELECT count(*) FROM organization_memberships m JOIN organization_participants p ON p.organization_id = m.organization_id AND p.id = m.participant_id WHERE m.organization_id = ANY($1::uuid[]) AND p.user_id IS NOT NULL AND p.user_id <> m.user_id) AS membership_user,
      (SELECT count(*) FROM organization_participants p WHERE p.organization_id = ANY($1::uuid[]) AND p.id = ANY($2::uuid[]) AND NOT ((p.user_id IS NOT NULL AND p.display_name IS NULL) OR (p.user_id IS NULL AND p.display_name IS NOT NULL))) AS participant_identity,
      (SELECT count(*) FROM ledger_scopes s WHERE s.kind = 'organization' AND s.id = ANY($3::uuid[]) AND s.user_id IS NOT NULL) AS scope_shape,
      (SELECT count(*) FROM organization_invitations i WHERE i.organization_id = ANY($1::uuid[]) AND i.id = ANY($4::uuid[]) AND i.status = 'pending' AND (i.accepted_at IS NOT NULL OR i.declined_at IS NOT NULL OR i.revoked_at IS NOT NULL OR i.expired_at IS NOT NULL)) AS invitation_shape,
      (SELECT count(*) FROM (SELECT f.expense_id FROM expense_shares f JOIN expenses e ON e.ledger_scope_id = f.ledger_scope_id AND e.id = f.expense_id WHERE f.ledger_scope_id = ANY($3::uuid[]) GROUP BY f.expense_id, e.amount HAVING sum(f.amount_owed) > e.amount) invalid) AS org_shares_over_expense`,
    [ids.orgIds, ids.orgParticipantIds, ids.orgScopeIds, ids.orgInvitationIds],
  );
  for (const [name, value] of Object.entries(result.rows[0]!)) assert(count(value) === 0, `${name} organization invariant violations found`);
  const roles = await client.query<{ role: string; total: string }>(
    "SELECT m.role, count(*)::text AS total FROM organization_memberships m WHERE m.organization_id = ANY($1::uuid[]) AND m.user_id = $2 GROUP BY m.role",
    [ids.orgIds, ownerId],
  );
  const byRole = new Map(roles.rows.map((row) => [row.role, count(row.total)]));
  assert((byRole.get("owner") ?? 0) >= 1, "scale owner has no owner organization");
  assert((byRole.get("admin") ?? 0) >= 1 || (byRole.get("treasurer") ?? 0) >= 1 || (byRole.get("member") ?? 0) >= 1, "scale owner has no non-owner organization role");
}

async function verifyBudgetAuthority(client: PoolClient, fixture: ScaleFixtureData, ownerId: string) {
  const ids = fixtureIds(fixture);
  const shape = await client.query<Record<string, string>>(
    `SELECT
      (SELECT count(*) FROM budget_periods WHERE owner_user_id = $1 AND id = ANY($2::uuid[]) AND status = 'active') AS active_periods,
      (SELECT count(DISTINCT ordinal)::text FROM budget_periods WHERE owner_user_id = $1 AND id = ANY($2::uuid[])) AS distinct_ordinals,
      (SELECT count(*) FROM budget_categories WHERE owner_user_id = $1 AND system_key = 'uncategorized' AND id = ANY($3::uuid[])) AS uncategorized,
      (SELECT count(*) FROM budget_recurring_templates WHERE owner_user_id = $1 AND archived_at IS NULL AND id = ANY($4::uuid[])) AS active_templates,
      (SELECT count(*) FROM (SELECT budget_transaction_id FROM budget_impacts WHERE owner_user_id = $1 AND status = 'applied' AND budget_period_id IS NULL) invalid) AS applied_without_period,
      (SELECT count(*) FROM budget_impacts WHERE owner_user_id = $1 AND status = 'pending' AND (budget_period_id IS NOT NULL OR target_period_ordinal <= 20)) AS pending_shape,
      (SELECT count(*) FROM budget_impacts i JOIN budget_periods p ON p.owner_user_id = i.owner_user_id AND p.id = i.budget_period_id WHERE i.owner_user_id = $1 AND i.status = 'applied' AND i.target_period_ordinal <> p.ordinal) AS applied_ordinal,
      (SELECT count(*) FROM (SELECT recurring_template_id, scheduled_on FROM budget_recurring_occurrences WHERE owner_user_id = $1 GROUP BY recurring_template_id, scheduled_on HAVING count(*) > 1) invalid) AS occurrence_identity,
      (SELECT count(*) FROM budget_recurring_occurrences o WHERE o.owner_user_id = $1 AND ((o.status = 'recorded') <> (o.budget_transaction_id IS NOT NULL))) AS occurrence_lifecycle,
      (SELECT count(*) FROM budget_recurring_templates t WHERE t.owner_user_id = $1 AND (t.spread_count < 1 OR t.spread_count > 24 OR t.spread_count > t.amount)) AS template_spread`,
    [ownerId, ids.budgetPeriodIds, ids.budgetCategoryIds, ids.recurringTemplateIds],
  );
  const shapeRow = shape.rows[0]!;
  assert(count(shapeRow.active_periods!) === 1, "budget must have exactly one active period");
  assert(count(shapeRow.distinct_ordinals!) === fixture.budgetPeriods.length, "budget ordinals are not distinct");
  assert(count(shapeRow.uncategorized!) === 1, "budget Uncategorized system category is missing");
  assert(count(shapeRow.active_templates!) === SCALE_FIXTURE_COUNTS.activeRecurringTemplates, "active recurring template count mismatch");
  assert(count(shapeRow.active_templates!) <= 200, "budget exceeds MAX_ACTIVE_RECURRING_TEMPLATES");
  for (const [name, value] of Object.entries(shapeRow)) {
    if (["active_periods", "distinct_ordinals", "uncategorized", "active_templates"].includes(name)) continue;
    assert(count(value) === 0, `${name} budget invariant violations found`);
  }

  const impactSums = await client.query<{ transaction_id: string; total: string }>(
    "SELECT budget_transaction_id AS transaction_id, sum(amount)::text AS total FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = ANY($2::uuid[]) GROUP BY budget_transaction_id",
    [ownerId, ids.budgetTransactionIds],
  );
  const expectedByTransaction = new Map(fixture.budgetTransactions.map((row) => [row.id, row]));
  const actualByTransaction = new Map(impactSums.rows.map((row) => [row.transaction_id, count(row.total)]));
  for (const transaction of fixture.budgetTransactions) {
    const actual = actualByTransaction.get(transaction.id) ?? 0;
    if (actual === 0) {
      assert(transaction.origin === "linked", `transaction ${transaction.id} has no impacts but is not linked`);
      continue;
    }
    assert(actual === transaction.amount, `transaction ${transaction.id} impact total does not reconcile`);
  }
  assert(expectedByTransaction.size === actualByTransaction.size || [...expectedByTransaction.keys()].every((id) => actualByTransaction.has(id) || expectedByTransaction.get(id)!.origin === "linked"), "budget impact coverage mismatch");

  const appliedRows = await client.query<{ period_id: string; category_id: string; direction: string; total: string }>(
    `SELECT i.budget_period_id AS period_id, i.budget_category_id AS category_id, t.direction, sum(i.amount)::text AS total
     FROM budget_impacts i JOIN budget_transactions t ON t.owner_user_id = i.owner_user_id AND t.id = i.budget_transaction_id
     WHERE i.owner_user_id = $1 AND i.status = 'applied' AND t.status = 'posted'
     GROUP BY i.budget_period_id, i.budget_category_id, t.direction`,
    [ownerId],
  );
  const expectedTotals = new Map<string, number>();
  const transactionById = new Map(fixture.budgetTransactions.map((row) => [row.id, row]));
  for (const impact of fixture.budgetImpacts) {
    if (impact.status !== "applied" || !impact.budgetPeriodId) continue;
    const transaction = transactionById.get(impact.budgetTransactionId)!;
    if (transaction.status !== "posted") continue;
    const key = `${impact.budgetPeriodId}|${impact.budgetCategoryId}|${transaction.direction}`;
    expectedTotals.set(key, (expectedTotals.get(key) ?? 0) + impact.amount);
  }
  assert(appliedRows.rows.length === expectedTotals.size, "budget category totals row count does not reconcile");
  for (const row of appliedRows.rows) {
    const key = `${row.period_id}|${row.category_id}|${row.direction}`;
    assert(count(row.total) === (expectedTotals.get(key) ?? -1), `budget category total does not reconcile for ${key}`);
  }
}

async function verifyCollaborationAnchors(client: PoolClient, fixture: ScaleFixtureData, ownerId: string) {
  const ids = fixtureIds(fixture);
  const anchors = await client.query<Record<string, string>>(
    `SELECT
      (SELECT count(*) FROM groups WHERE id = ANY($1::uuid[]) AND archived_at IS NULL) AS active_groups,
      (SELECT count(*) FROM groups WHERE id = ANY($1::uuid[]) AND name IN ('Jakarta Weekend', 'Japan Trip 2026', 'Fasilkom Study Group', 'Apartment Split', 'Design Committee', 'Engineering Committee', 'Archived Club', 'Quiet Reading Club')) AS named_groups,
      (SELECT count(*) FROM group_memberships WHERE group_id = ANY($1::uuid[]) AND user_id = $2) AS owner_groups,
      (SELECT count(*) FROM organizations WHERE id = ANY($3::uuid[]) AND name IN ('Atelier Nusantara', 'Engineering Guild', 'Fasilkom Alumni', 'Treasury Collective', 'River Community', 'Archived Syndicate', 'Quiet Collective')) AS named_orgs,
      (SELECT count(*) FROM organization_memberships WHERE organization_id = ANY($3::uuid[]) AND user_id = $2) AS owner_orgs,
      (SELECT count(*) FROM budget_periods WHERE owner_user_id = $2 AND name = 'September Budget' AND status = 'active') AS active_budget,
      (SELECT count(*) FROM budget_recurring_templates WHERE owner_user_id = $2 AND name = 'Heavy Recurring' AND archived_at IS NULL) AS heavy_recurring,
      (SELECT count(*) FROM budget_recurring_occurrences WHERE owner_user_id = $2 AND status = 'due') AS due_occurrences,
      (SELECT count(*) FROM notifications WHERE recipient_user_id = $2 AND read_at IS NULL AND id = ANY($4::uuid[])) AS unread_notifications,
      (SELECT count(*) FROM (SELECT DISTINCT type FROM notifications WHERE recipient_user_id = $2 AND id = ANY($4::uuid[])) families) AS notification_families,
      (SELECT max(message_count)::text FROM (SELECT count(*) AS message_count FROM chat_messages WHERE thread_id = ANY($5::uuid[]) GROUP BY thread_id) threads) AS longest_thread,
      (SELECT count(*) FROM budget_group_expense_sources s JOIN budget_transactions t ON t.owner_user_id = s.owner_user_id AND t.id = s.budget_transaction_id WHERE s.owner_user_id = $2 AND t.occurred_on >= '2026-09-01' AND t.occurred_on <= '2026-09-30') AS active_group_links`,
    [ids.groupIds, ownerId, ids.orgIds, ids.notificationIds, ids.chatThreadIds],
  );
  const row = anchors.rows[0]!;
  assert(count(row.active_groups!) >= 20, "expected at least 20 active fixture groups");
  assert(count(row.named_groups!) === 8, "group scenario anchors are missing");
  assert(count(row.owner_groups!) >= 20, "scale owner is missing group memberships");
  assert(count(row.named_orgs!) === 7, "organization scenario anchors are missing");
  assert(count(row.owner_orgs!) >= 8, "scale owner is missing organization memberships");
  assert(count(row.active_budget!) === 1, "active September Budget is missing");
  assert(count(row.heavy_recurring!) === 1, "Heavy Recurring template is missing");
  assert(count(row.due_occurrences!) > 0, "no due recurring occurrences");
  assert(count(row.unread_notifications!) > 0, "no unread notifications");
  assert(count(row.notification_families!) >= 8, "notification families are missing");
  assert(count(row.longest_thread!) >= 1000, "no long chat thread for scroll testing");
  assert(count(row.active_group_links!) > 0, "no active-period linked Group activity");
}

export function readOwnerPassword(environment: ScaleEnvironment) {
  const filePath = environment.SCALE_OWNER_PASSWORD_FILE?.trim();
  if (!filePath) return undefined;
  const password = readSecretFile(filePath, "SCALE_OWNER_PASSWORD_FILE");
  if (password.length < 16 || password.length > 128) {
    throw new Error("SCALE_OWNER_PASSWORD_FILE must contain a 16-128 character password");
  }
  return password;
}

export async function ensureScaleCredential(client: PoolClient, ownerId: string, password: string | undefined) {
  if (!password) {
    const existing = await client.query<{ id: string }>(
      "SELECT id FROM accounts WHERE user_id = $1 AND provider_id = 'credential'",
      [ownerId],
    );
    if (existing.rows.length > 0) return "present" as const;
    return "skipped" as const;
  }
  // TEST-ONLY credential for the disposable scale database, hashed with the
  // same Better Auth password helper production uses. Never a plaintext store,
  // never outside zplit_scale_test (guarded by validateScaleCommandEnvironment).
  // When an explicit disposable password is supplied, the fixture owns its
  // deterministic credential: any other credential rows for this owner are
  // removed first so the supplied password cannot be silently ignored via the
  // unique (provider_id, account_id) constraint. Repeated seeds re-hash (new
  // salt) but remain login-equivalent, hence idempotent for manual UI use.
  const deterministicId = credentialAccountId(ownerId);
  const hashed = await hashPassword(password);
  await client.query(
    "DELETE FROM accounts WHERE user_id = $1 AND provider_id = 'credential' AND id <> $2",
    [ownerId, deterministicId],
  );
  await client.query(
    "INSERT INTO accounts (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES ($1, $2, 'credential', $2, $3, now(), now()) ON CONFLICT (id) DO UPDATE SET password = EXCLUDED.password, account_id = EXCLUDED.account_id, updated_at = now()",
    [deterministicId, ownerId, hashed],
  );
  return "created" as const;
}

export async function verifyScaleCredential(client: PoolClient, ownerId: string, password: string | undefined, passwordFileSet: boolean) {
  if (!passwordFileSet) return;
  const result = await client.query<{ id: string; user_id: string; provider_id: string; password: string | null }>(
    "SELECT id, user_id, provider_id, password FROM accounts WHERE id = $1 AND user_id = $2 AND provider_id = 'credential'",
    [credentialAccountId(ownerId), ownerId],
  );
  assert(result.rows.length === 1, "scale owner credential account is missing");
  const row = result.rows[0]!;
  assert(row.provider_id === "credential", "scale owner credential provider is wrong");
  assert(typeof row.password === "string" && row.password.trim() !== "", "scale owner credential has no password material");
  assert(row.password !== password, "scale owner credential stores a plaintext password");
  if (password) {
    const matches = await verifyPassword({ hash: row.password, password });
    assert(matches, "scale owner credential does not match SCALE_OWNER_PASSWORD_FILE");
  }
}

export async function runScaleCommand(
  command: ScaleCommand,
  environment: ScaleEnvironment = process.env,
  dependencies: ScaleFixtureDependencies = {},
) {
  const { ownerEmail } = validateScaleCommandEnvironment(command, environment);
  const ownerPassword = command === "clear" ? undefined : readOwnerPassword(environment);
  const config = (dependencies.readDatabaseConfig ?? readRuntimeDatabaseConfig)();
  const pool = (dependencies.createPool ?? createDatabasePool)(config);
  let client: PoolClient | undefined;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    if (command === "verify") await client.query("SET TRANSACTION READ ONLY");
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [scaleFixtureLockKey]);
    const user = await resolveOwner(client, ownerEmail);
    const ledgerScopeId = await getPersonalLedgerScopeId(drizzle(client, { schema }), user.id);
    const fixture = generateScaleFixture(user.id);
    let credential: "created" | "present" | "skipped" = "skipped";
    if (command === "seed") {
      await seedFixture(client, fixture, user.id, ledgerScopeId);
      credential = await ensureScaleCredential(client, user.id, ownerPassword);
    }
    if (command === "clear") await deleteFixture(client, fixture, user.id, ledgerScopeId);
    if (command === "verify") {
      await verifyFixture(client, fixture, user.id, ledgerScopeId);
      await verifyScaleCredential(client, user.id, ownerPassword, Boolean(environment.SCALE_OWNER_PASSWORD_FILE?.trim()));
    }
    await client.query("COMMIT");
    transactionStarted = false;
    return { command, ownerEmail: user.email, counts: SCALE_FIXTURE_COUNTS, credential };
  } catch (error) {
    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original failure.
      }
    }
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

export function redactScaleError(error: unknown, secrets: string[]) {
  let message = error instanceof Error ? error.message : "unknown error";
  for (const secret of secrets) if (secret) message = message.replaceAll(secret, "[redacted]");
  return message.replace(/\s+/g, " ").slice(0, 240);
}

async function main() {
  const command = parseScaleCommand();
  const result = await runScaleCommand(command);
  const summary = `groups=${result.counts.groups} orgs=${result.counts.organizations} budgetTxns=${result.counts.budgetTransactions} notifs=${result.counts.notifications} chat=${result.counts.chatMessages}`;
  const login = "credential" in result && result.credential === "skipped" && command === "seed"
    ? " (no SCALE_OWNER_PASSWORD_FILE: manual UI login unavailable)"
    : "";
  console.log(`scale fixture ${result.command} succeeded for ${result.ownerEmail} (${summary})${login}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    const secretFiles = [process.env.DB_PASSWORD_FILE, process.env.SCALE_OWNER_PASSWORD_FILE].filter(Boolean) as string[];
    const secrets = secretFiles.flatMap((filePath) => {
      try {
        return [readSecretFile(filePath, "secret file")];
      } catch {
        return [];
      }
    });
    console.error(`scale fixture failed: ${redactScaleError(error, secrets)}`);
    process.exitCode = 1;
  });
}
