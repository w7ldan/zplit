import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import { createDatabasePool, readRuntimeDatabaseConfig, type Database } from "../src/db/client";
import * as schema from "../src/db/schema";
import { createLedgerRepository } from "../src/domain/ledger-repository";
import { resolveOrganizationCapabilities } from "../src/domain/organization-permissions";
import {
  ensureShowcaseAccounts,
  redactShowcaseError,
  resolveShowcaseAccounts,
  SHOWCASE_FIXTURE_LOCK_KEY,
  validateShowcaseCommandEnvironment,
  type ShowcaseEnvironment,
  type ShowcaseRuntime,
} from "./showcase-fixture";
import {
  REPOSITORY_SHOWCASE_ACCOUNTS,
  REPOSITORY_SHOWCASE_EXPECTATIONS,
  REPOSITORY_SHOWCASE_IDS,
  generateRepositoryShowcaseFixture,
  type RepositoryShowcaseFixture,
  type RepositoryShowcaseUserIds,
} from "./repository-showcase-fixture-data";
import { SHOWCASE_FIXED_TIMESTAMP } from "./showcase-fixture-data";
import { readSecretFile } from "../src/server/secret-file";

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
if (!require.cache[serverOnlyPath]) require.cache[serverOnlyPath] = { exports: {} } as never;
const {
  generateDebtorShareToken,
  getSharedDebtorReceipt,
  hashDebtorShareToken,
  resolveDebtorShareLink,
} = await import("../src/server/debtor-share-links");
const { getGroupChat, getOrganizationChat } = await import("../src/server/chat");
const { readGroupBalances } = await import("../src/server/group-accounting");
const { getOrganizationForMember, requireOrganizationAccess } = await import("../src/server/organizations");

export type RepositoryShowcaseCommand = "setup" | "verify" | "clear";
export const REPOSITORY_SHOWCASE_DATABASE = "zplit_repository_showcase";

export function parseRepositoryShowcaseCommand(value = process.argv[2]): RepositoryShowcaseCommand {
  if (value === "setup" || value === "verify" || value === "clear") return value;
  throw new Error("usage: tsx scripts/repository-showcase-fixture.ts <setup|verify|clear> [--print-share-link] [--token <token>]");
}

export function validateRepositoryShowcaseEnvironment(
  command: RepositoryShowcaseCommand,
  environment: ShowcaseEnvironment = process.env,
): ShowcaseRuntime {
  return validateShowcaseCommandEnvironment(command === "verify" ? "verify" : "setup", command === "verify" ? 6 : undefined, environment, REPOSITORY_SHOWCASE_DATABASE);
}

function repositoryDefinitions() {
  return Object.values(REPOSITORY_SHOWCASE_ACCOUNTS);
}

function userIds(accounts: Awaited<ReturnType<typeof resolveShowcaseAccounts>>): RepositoryShowcaseUserIds {
  const byEmail = new Map(accounts.map((account) => [account.email, account.id]));
  const ids = Object.fromEntries(Object.entries(REPOSITORY_SHOWCASE_ACCOUNTS).map(([key, definition]) => [key, byEmail.get(definition.email)]));
  assert(Object.values(ids).every((id) => typeof id === "string"), "repository showcase accounts are incomplete");
  return ids as RepositoryShowcaseUserIds;
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function migrateRepositoryDatabase(config: ReturnType<typeof readRuntimeDatabaseConfig>) {
  const pool = new Pool({ ...config, max: 1 });
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [20603018]);
    locked = true;
    await migrate(drizzle(client, { schema }), { migrationsFolder: "./drizzle" });
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1::bigint)", [20603018]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

async function prepareRepositoryDatabase(reset: boolean) {
  const config = readRuntimeDatabaseConfig();
  const maintenance = new Pool({ ...config, database: "postgres", max: 1 });
  try {
    if (reset) {
      await maintenance.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        [REPOSITORY_SHOWCASE_DATABASE],
      );
      await maintenance.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(REPOSITORY_SHOWCASE_DATABASE)}`);
    }
    const existing = await maintenance.query<{ exists: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists", [REPOSITORY_SHOWCASE_DATABASE]);
    if (!existing.rows[0]?.exists) {
      await maintenance.query(`CREATE DATABASE ${quoteIdentifier(REPOSITORY_SHOWCASE_DATABASE)} OWNER ${quoteIdentifier(config.user)}`);
    }
  } finally {
    await maintenance.end();
  }
  await migrateRepositoryDatabase(config);
}

async function assertRepositoryDatabaseOwned(pool: ReturnType<typeof createDatabasePool>) {
  const client = await pool.connect();
  try {
    const users = await client.query<{ id: string; email: string; name: string }>("SELECT id, email, name FROM users ORDER BY id");
    if (users.rows.length === 0) return;
    await resolveShowcaseAccounts(client, repositoryDefinitions());
  } finally {
    client.release();
  }
}

async function assertExistingRepositoryDatabaseOwned() {
  const config = readRuntimeDatabaseConfig();
  const maintenance = new Pool({ ...config, database: "postgres", max: 1 });
  let exists = false;
  try {
    const result = await maintenance.query<{ exists: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists", [REPOSITORY_SHOWCASE_DATABASE]);
    exists = Boolean(result.rows[0]?.exists);
  } finally {
    await maintenance.end();
  }
  if (!exists) return;
  const pool = createDatabasePool(config);
  try {
    await assertRepositoryDatabaseOwned(pool);
  } finally {
    await pool.end();
  }
}

async function insertRows(client: PoolClient, table: string, columns: string[], rows: readonly (readonly unknown[])[]) {
  for (const row of rows) {
    await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((_column, index) => `$${index + 1}`).join(", ")})`,
      [...row],
    );
  }
}

function idsOf(rows: readonly { id: string }[]) {
  return rows.map((row) => row.id);
}

async function insertRepositoryShowcase(client: PoolClient, fixture: RepositoryShowcaseFixture, personalScopeId: string, token: string) {
  const personal = fixture.personal;
  const group = fixture.group;
  const organization = fixture.organization;
  const replaceScope = <T extends { ledgerScopeId: string }>(rows: readonly T[]) => rows.map((row) => ({ ...row, ledgerScopeId: personalScopeId }));

  await insertRows(client, "friends", ["id", "ledger_scope_id", "linked_user_id", "name", "phone_number", "notes", "archived_at", "created_at", "updated_at"], replaceScope(personal.friends).map((row) => [row.id, row.ledgerScopeId, row.linkedUserId, row.name, row.phoneNumber, row.notes, row.archivedAt, row.createdAt, row.updatedAt]));
  await insertRows(client, "outings", ["id", "ledger_scope_id", "trip_id", "title", "occurred_at", "notes", "created_at", "updated_at"], [{ ...personal.outing, ledgerScopeId: personalScopeId }].map((row) => [row.id, row.ledgerScopeId, null, row.title, row.occurredAt, row.notes, row.createdAt, row.updatedAt]));
  await insertRows(client, "expenses", ["id", "ledger_scope_id", "outing_id", "description", "amount", "created_at", "updated_at"], replaceScope(personal.expenses).map((row) => [row.id, row.ledgerScopeId, row.outingId, row.description, row.amount, row.createdAt, row.updatedAt]));
  await insertRows(client, "expense_shares", ["id", "ledger_scope_id", "expense_id", "friend_id", "base_amount", "amount_owed", "created_at"], replaceScope(personal.expenseShares).map((row) => [row.id, row.ledgerScopeId, row.expenseId, row.friendId, row.baseAmount, row.amountOwed, row.createdAt]));
  await insertRows(client, "repayments", ["id", "ledger_scope_id", "friend_id", "amount", "paid_at", "payment_method", "notes", "created_at"], replaceScope(personal.repayments).map((row) => [row.id, row.ledgerScopeId, row.friendId, row.amount, row.paidAt, row.paymentMethod, row.notes, row.createdAt]));
  await insertRows(client, "repayment_allocations", ["ledger_scope_id", "repayment_id", "expense_share_id", "amount", "created_at"], replaceScope(personal.repaymentAllocations).map((row) => [row.ledgerScopeId, row.repaymentId, row.expenseShareId, row.amount, row.createdAt]));
  await insertRows(client, "expense_receipts", ["id", "ledger_scope_id", "expense_id", "original_filename", "media_type", "byte_size", "sha256", "content", "created_at"], [[personal.receipt.id, personalScopeId, personal.receipt.expenseId, personal.receipt.originalFilename, personal.receipt.mediaType, personal.receipt.byteSize, personal.receipt.sha256, personal.receipt.content, personal.receipt.createdAt]]);
  await insertRows(client, "debtor_share_links", ["id", "token_hash", "ledger_scope_id", "friend_id", "created_at", "expires_at"], [[personal.shareLink.id, hashDebtorShareToken(token), personalScopeId, personal.shareLink.friendId, personal.shareLink.createdAt, personal.shareLink.expiresAt]]);
  await insertRows(client, "debtor_share_receipts", ["id", "ledger_scope_id", "debtor_share_link_id", "expense_id", "expense_receipt_id", "created_at"], [[personal.shareLink.receiptId, personalScopeId, personal.shareLink.id, personal.shareLink.expenseId, personal.receipt.id, personal.shareLink.createdAt]]);

  await insertRows(client, "groups", ["id", "name", "description", "archived_at", "created_by_user_id", "created_at", "updated_at"], [[group.group.id, group.group.name, group.group.description, group.group.archivedAt, group.group.createdByUserId, group.group.createdAt, group.group.updatedAt]]);
  await insertRows(client, "group_participants", ["id", "group_id", "user_id", "source_personal_friend_id", "display_name", "label", "created_at", "updated_at"], group.participants.map((row) => [row.id, row.groupId, row.userId, row.sourcePersonalFriendId, row.displayName, row.label, row.createdAt, row.updatedAt]));
  await insertRows(client, "group_memberships", ["group_id", "user_id", "participant_id", "role", "joined_at"], group.memberships.map((row) => [row.groupId, row.userId, row.participantId, row.role, row.joinedAt]));
  await insertRows(client, "group_expenses", ["id", "group_id", "creator_participant_id", "payer_participant_id", "description", "occurred_at", "total_amount", "state", "confirmed_at", "created_at", "updated_at"], group.expenses.map((row) => [row.id, row.groupId, row.creatorParticipantId, row.payerParticipantId, row.description, row.occurredAt, row.totalAmount, "pending", null, row.createdAt, row.createdAt]));
  await insertRows(client, "group_expense_shares", ["id", "group_id", "expense_id", "participant_id", "amount", "created_at", "updated_at"], group.shares.map((row) => [row.id, row.groupId, row.expenseId, row.participantId, row.amount, row.createdAt, row.updatedAt]));
  for (const expense of group.expenses) {
    await client.query("UPDATE group_expenses SET state = 'confirmed', confirmed_at = $1, updated_at = $1 WHERE id = $2 AND group_id = $3", [expense.confirmedAt, expense.id, expense.groupId]);
  }
  await insertRows(client, "group_obligations", ["id", "group_id", "source_expense_id", "source_share_id", "debtor_participant_id", "creditor_participant_id", "original_amount", "voided_at", "created_at"], group.obligations.map((row) => [row.id, row.groupId, row.sourceExpenseId, row.sourceShareId, row.debtorParticipantId, row.creditorParticipantId, row.originalAmount, row.voidedAt, row.createdAt]));
  await insertRows(client, "group_expense_lifecycle_events", ["id", "group_id", "expense_id", "event_type", "actor_user_id", "from_state", "to_state", "created_at"], group.expenses.map((row, index) => [index === 0 ? "5ca5e20a-0000-4000-8000-000000000001" : "5ca5e20a-0000-4000-8000-000000000002", row.groupId, row.id, "created", group.group.createdByUserId, null, "confirmed", row.confirmedAt]));
  await insertRows(client, "group_settlements", ["id", "group_id", "sender_participant_id", "recipient_participant_id", "amount", "payment_method", "state", "created_at", "confirmed_at"], [[group.settlement.id, group.settlement.groupId, group.settlement.senderParticipantId, group.settlement.recipientParticipantId, group.settlement.amount, group.settlement.paymentMethod, "pending", group.settlement.createdAt, null]]);
  await client.query("UPDATE group_settlements SET state = 'confirmed', confirmed_at = $1 WHERE id = $2 AND group_id = $3", [group.settlement.confirmedAt, group.settlement.id, group.settlement.groupId]);
  await insertRows(client, "group_settlement_applications", ["id", "group_id", "settlement_id", "obligation_id", "applied_amount", "created_at"], [[group.settlementApplication.id, group.settlementApplication.groupId, group.settlementApplication.settlementId, group.settlementApplication.obligationId, group.settlementApplication.appliedAmount, group.settlementApplication.createdAt]]);

  await insertRows(client, "organizations", ["id", "name", "description", "archived_at", "created_at", "updated_at"], [[organization.organization.id, organization.organization.name, organization.organization.description, organization.organization.archivedAt, organization.organization.createdAt, organization.organization.updatedAt]]);
  await insertRows(client, "ledger_scopes", ["id", "kind", "user_id", "organization_id", "created_at"], [[organization.ledgerScope.id, organization.ledgerScope.kind, null, organization.ledgerScope.organizationId, organization.ledgerScope.createdAt]]);
  await insertRows(client, "organization_participants", ["id", "organization_id", "user_id", "source_personal_friend_id", "display_name", "label", "created_by_user_id", "created_at", "updated_at"], organization.participants.map((row) => [row.id, row.organizationId, row.userId, row.sourcePersonalFriendId, row.displayName, row.label, row.createdByUserId, row.createdAt, row.createdAt]));
  await insertRows(client, "organization_memberships", ["organization_id", "user_id", "participant_id", "role", "custom_capabilities", "joined_at"], organization.memberships.map((row) => [row.organizationId, row.userId, row.participantId, row.role, JSON.stringify(row.customCapabilities), row.joinedAt]));
  await insertRows(client, "friends", ["id", "ledger_scope_id", "linked_user_id", "source_personal_friend_id", "name", "phone_number", "notes", "archived_at", "created_at", "updated_at"], organization.friends.map((row) => [row.id, row.ledgerScopeId, row.linkedUserId, row.sourcePersonalFriendId, row.name, row.phoneNumber, row.notes, row.archivedAt, row.createdAt, row.updatedAt]));
  await insertRows(client, "outings", ["id", "ledger_scope_id", "trip_id", "title", "occurred_at", "notes", "created_at", "updated_at"], [[organization.outing.id, organization.outing.ledgerScopeId, organization.outing.tripId, organization.outing.title, organization.outing.occurredAt, organization.outing.notes, organization.outing.createdAt, organization.outing.updatedAt]]);
  await insertRows(client, "expenses", ["id", "ledger_scope_id", "outing_id", "description", "amount", "created_at", "updated_at"], organization.expenses.map((row) => [row.id, row.ledgerScopeId, row.outingId, row.description, row.amount, row.createdAt, row.updatedAt]));
  await insertRows(client, "expense_shares", ["id", "ledger_scope_id", "expense_id", "friend_id", "base_amount", "amount_owed", "created_at"], organization.expenseShares.map((row) => [row.id, row.ledgerScopeId, row.expenseId, row.friendId, row.baseAmount, row.amountOwed, row.createdAt]));
  await insertRows(client, "repayments", ["id", "ledger_scope_id", "friend_id", "amount", "paid_at", "payment_method", "notes", "created_at"], [[organization.repayment.id, organization.repayment.ledgerScopeId, organization.repayment.friendId, organization.repayment.amount, organization.repayment.paidAt, organization.repayment.paymentMethod, organization.repayment.notes, organization.repayment.createdAt]]);
  await insertRows(client, "repayment_allocations", ["ledger_scope_id", "repayment_id", "expense_share_id", "amount", "created_at"], [[organization.repaymentAllocation.ledgerScopeId, organization.repaymentAllocation.repaymentId, organization.repaymentAllocation.expenseShareId, organization.repaymentAllocation.amount, organization.repaymentAllocation.createdAt]]);

  await insertRows(client, "chat_threads", ["id", "organization_id", "group_id", "created_at", "updated_at"], [[group.chat.thread.id, null, group.chat.thread.groupId, group.chat.thread.createdAt, group.chat.thread.updatedAt], [organization.chat.thread.id, organization.chat.thread.organizationId, null, organization.chat.thread.createdAt, organization.chat.thread.updatedAt]]);
  await insertRows(client, "chat_messages", ["id", "thread_id", "organization_id", "group_id", "sender_user_id", "sender_participant_id", "body", "created_at", "edited_at", "deleted_at", "deleted_by_user_id"], group.chat.messages.map((row) => [row.id, group.chat.thread.id, null, group.chat.thread.groupId, row.senderUserId, row.senderParticipantId, row.body, row.createdAt, null, null, null]).concat(organization.chat.messages.map((row) => [row.id, organization.chat.thread.id, organization.chat.thread.organizationId, null, row.senderUserId, null, row.body, row.createdAt, null, null, null])));
  const chatReads: Array<{ threadId: string; userId: string; lastReadMessageId: string; createdAt: Date; updatedAt: Date }> = [...group.chat.reads, ...organization.chat.reads];
  await insertRows(client, "chat_thread_reads", ["thread_id", "user_id", "last_read_message_id", "created_at", "updated_at"], chatReads.map((row) => [row.threadId, row.userId, row.lastReadMessageId, row.createdAt, row.updatedAt]));
}

async function replaceRepositoryShowcase(pool: ReturnType<typeof createDatabasePool>, accounts: Awaited<ReturnType<typeof resolveShowcaseAccounts>>, token: string | undefined) {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [SHOWCASE_FIXTURE_LOCK_KEY]);
    const users = userIds(accounts);
    const fixture = generateRepositoryShowcaseFixture(users);
    const [ari] = accounts.filter((account) => account.email === REPOSITORY_SHOWCASE_ACCOUNTS.ari.email);
    assert(ari !== undefined, "Ari showcase account is missing");
    const personalScope = await client.query<{ id: string }>("SELECT id FROM ledger_scopes WHERE kind = 'personal' AND user_id = $1", [ari.id]);
    assert(personalScope.rows.length === 1, "Ari personal ledger scope is missing");
    if (token) await insertRepositoryShowcase(client, fixture, personalScope.rows[0]!.id, token);
    await client.query("COMMIT");
    transactionStarted = false;
    return { fixture, users, token };
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function sortBalances(rows: readonly { debtorParticipantId: string; creditorParticipantId: string; amount: number }[]) {
  return rows.map((row) => `${row.debtorParticipantId}:${row.creditorParticipantId}:${row.amount}`).sort();
}

type RepositoryVerifyContext = {
  client: PoolClient;
  db: Database;
  fixture: RepositoryShowcaseFixture;
  users: RepositoryShowcaseUserIds;
  personalScopeId: string;
};

async function verifyPersonal(context: RepositoryVerifyContext) {
  const { client, fixture, personalScopeId } = context;
  const personal = fixture.personal;
  const personalCounts = await client.query<{ friends: string; expenses: string; shares: string; repayments: string }>("SELECT (SELECT count(*) FROM friends WHERE ledger_scope_id = $1 AND id = ANY($2::uuid[]))::text AS friends, (SELECT count(*) FROM expenses WHERE ledger_scope_id = $1 AND id = ANY($3::uuid[]))::text AS expenses, (SELECT count(*) FROM expense_shares WHERE ledger_scope_id = $1 AND id = ANY($4::uuid[]))::text AS shares, (SELECT count(*) FROM repayments WHERE ledger_scope_id = $1 AND id = ANY($5::uuid[]))::text AS repayments", [personalScopeId, idsOf(personal.friends), idsOf(personal.expenses), idsOf(personal.expenseShares), idsOf(personal.repayments)]);
  assert(Number(personalCounts.rows[0]?.friends) === personal.friends.length && Number(personalCounts.rows[0]?.expenses) === personal.expenses.length && Number(personalCounts.rows[0]?.shares) === personal.expenseShares.length && Number(personalCounts.rows[0]?.repayments) === personal.repayments.length, "repository Personal rows are incomplete");
  const personalTotals = await client.query<{ spending: string; assigned: string; repaid: string }>("SELECT (SELECT coalesce(sum(amount), 0) FROM expenses WHERE ledger_scope_id = $1 AND id = ANY($2::uuid[]))::text AS spending, (SELECT coalesce(sum(amount_owed), 0) FROM expense_shares WHERE ledger_scope_id = $1 AND id = ANY($3::uuid[]))::text AS assigned, (SELECT coalesce(sum(amount), 0) FROM repayments WHERE ledger_scope_id = $1 AND id = ANY($4::uuid[]))::text AS repaid", [personalScopeId, idsOf(personal.expenses), idsOf(personal.expenseShares), idsOf(personal.repayments)]);
  assert(Number(personalTotals.rows[0]?.spending) === REPOSITORY_SHOWCASE_EXPECTATIONS.personal.spending && Number(personalTotals.rows[0]?.assigned) === REPOSITORY_SHOWCASE_EXPECTATIONS.personal.assigned && Number(personalTotals.rows[0]?.repaid) === REPOSITORY_SHOWCASE_EXPECTATIONS.personal.repaid, "repository Personal totals are incorrect");
  const personalBalances = await client.query<{ friend_id: string; outstanding: string }>("SELECT f.id AS friend_id, coalesce(sum(s.amount_owed), 0) - coalesce((SELECT sum(a.amount) FROM repayment_allocations a JOIN expense_shares paid ON paid.ledger_scope_id = a.ledger_scope_id AND paid.id = a.expense_share_id WHERE a.ledger_scope_id = f.ledger_scope_id AND paid.friend_id = f.id), 0) AS outstanding FROM friends f LEFT JOIN expense_shares s ON s.ledger_scope_id = f.ledger_scope_id AND s.friend_id = f.id WHERE f.ledger_scope_id = $1 AND f.id = ANY($2::uuid[]) GROUP BY f.id ORDER BY f.id", [personalScopeId, idsOf(personal.friends)]);
  const expectedPersonalBalances = new Map<string, number>([[personal.friends[0]!.id, REPOSITORY_SHOWCASE_EXPECTATIONS.personal.outstanding.nadia], [personal.friends[1]!.id, REPOSITORY_SHOWCASE_EXPECTATIONS.personal.outstanding.reno], [personal.friends[2]!.id, REPOSITORY_SHOWCASE_EXPECTATIONS.personal.outstanding.mika]]);
  assert(personalBalances.rows.every((row) => Number(row.outstanding) === expectedPersonalBalances.get(row.friend_id)), "repository Personal balances are incorrect");
  const receipt = await client.query<{ expense_id: string; media_type: string; sha256: string; byte_size: number }>("SELECT expense_id, media_type, sha256, byte_size FROM expense_receipts WHERE ledger_scope_id = $1 AND id = $2", [personalScopeId, personal.receipt.id]);
  assert(receipt.rows.length === 1 && receipt.rows[0]!.expense_id === personal.receipt.expenseId && receipt.rows[0]!.media_type === "image/png" && receipt.rows[0]!.sha256 === personal.receipt.sha256 && Number(receipt.rows[0]!.byte_size) === personal.receipt.byteSize, "repository receipt integrity is incorrect");
  const mapping = await client.query<{ friend_id: string; expense_id: string; expense_receipt_id: string }>("SELECT l.friend_id, r.expense_id, r.expense_receipt_id FROM debtor_share_links l JOIN debtor_share_receipts r ON r.ledger_scope_id = l.ledger_scope_id AND r.debtor_share_link_id = l.id WHERE l.ledger_scope_id = $1 AND l.id = $2", [personalScopeId, personal.shareLink.id]);
  assert(mapping.rows.length === 1 && mapping.rows[0]!.friend_id === personal.shareLink.friendId && mapping.rows[0]!.expense_id === personal.shareLink.expenseId && mapping.rows[0]!.expense_receipt_id === personal.receipt.id, "repository debtor share mapping is incorrect");
}

async function verifyGroup(context: RepositoryVerifyContext) {
  const { client, db, fixture, users } = context;
  const group = fixture.group;
  const groupRows = await client.query<{ participant_count: string; member_count: string; expense_count: string; obligation_count: string }>("SELECT (SELECT count(*) FROM group_participants WHERE group_id = $1)::text AS participant_count, (SELECT count(*) FROM group_memberships WHERE group_id = $1)::text AS member_count, (SELECT count(*) FROM group_expenses WHERE group_id = $1)::text AS expense_count, (SELECT count(*) FROM group_obligations WHERE group_id = $1)::text AS obligation_count", [group.group.id]);
  assert(Number(groupRows.rows[0]?.participant_count) === 4 && Number(groupRows.rows[0]?.member_count) === 4 && Number(groupRows.rows[0]?.expense_count) === 2 && Number(groupRows.rows[0]?.obligation_count) === 6, "repository Group rows are incomplete");
  const groupBalances = await readGroupBalances(db, group.group.id);
  const expectedGroupBalances = [
    { debtorParticipantId: REPOSITORY_SHOWCASE_IDS.group.participants.nadia, creditorParticipantId: REPOSITORY_SHOWCASE_IDS.group.participants.ari, amount: 120_000 },
    { debtorParticipantId: REPOSITORY_SHOWCASE_IDS.group.participants.reno, creditorParticipantId: REPOSITORY_SHOWCASE_IDS.group.participants.ari, amount: 190_000 },
    { debtorParticipantId: REPOSITORY_SHOWCASE_IDS.group.participants.mika, creditorParticipantId: REPOSITORY_SHOWCASE_IDS.group.participants.ari, amount: 150_000 },
  ];
  assert(JSON.stringify(sortBalances(groupBalances)) === JSON.stringify(sortBalances(expectedGroupBalances)), "repository Group canonical balances are incorrect");
  const settlement = await client.query<{ state: string; amount: number; sender_participant_id: string; recipient_participant_id: string; applied: number }>("SELECT s.state, s.amount, s.sender_participant_id, s.recipient_participant_id, coalesce(sum(a.applied_amount), 0)::int AS applied FROM group_settlements s LEFT JOIN group_settlement_applications a ON a.group_id = s.group_id AND a.settlement_id = s.id WHERE s.group_id = $1 AND s.id = $2 GROUP BY s.id", [group.group.id, group.settlement.id]);
  assert(settlement.rows.length === 1 && settlement.rows[0]!.state === "confirmed" && Number(settlement.rows[0]!.amount) === REPOSITORY_SHOWCASE_EXPECTATIONS.group.settled && settlement.rows[0]!.sender_participant_id === REPOSITORY_SHOWCASE_IDS.group.participants.nadia && settlement.rows[0]!.recipient_participant_id === REPOSITORY_SHOWCASE_IDS.group.participants.ari && Number(settlement.rows[0]!.applied) === REPOSITORY_SHOWCASE_EXPECTATIONS.group.settled, "repository Group settlement is incorrect");
  const groupChat = await getGroupChat(db, group.group.id, users.ari);
  assert(groupChat.threadId === group.chat.thread.id && groupChat.messages.length === 3 && groupChat.messages.some((message) => message.body === "I’ll send my share tonight."), "repository Group chat is inconsistent");
}

async function verifyOrganization(context: RepositoryVerifyContext) {
  const { client, db, fixture, users } = context;
  const organization = fixture.organization;
  const organizationScope = await client.query<{ id: string; kind: string; organization_id: string }>("SELECT id, kind, organization_id FROM ledger_scopes WHERE id = $1", [organization.ledgerScope.id]);
  assert(organizationScope.rows.length === 1 && organizationScope.rows[0]!.kind === "organization" && organizationScope.rows[0]!.organization_id === organization.organization.id, "Organization ledger scope ownership is incorrect");
  const organizationMembers = await client.query<{ user_id: string; role: string; participant_id: string }>("SELECT user_id, role, participant_id FROM organization_memberships WHERE organization_id = $1 ORDER BY user_id", [organization.organization.id]);
  assert(organizationMembers.rows.length === 4 && new Set(organizationMembers.rows.map((row) => row.role)).size >= 3, "Organization roles are not represented");
  const treasurer = organizationMembers.rows.find((row) => row.user_id === users.nadia);
  assert(treasurer?.role === "treasurer" && resolveOrganizationCapabilities(treasurer.role).has("repayments.create"), "Organization treasurer capability is incorrect");
  const organizationDetail = await getOrganizationForMember(db, organization.organization.id, users.ari);
  const treasurerAccess = await requireOrganizationAccess(db, organization.organization.id, users.nadia);
  assert(organizationDetail.role === "owner" && organizationDetail.canViewLedger && treasurerAccess.role === "treasurer" && treasurerAccess.can("ledger.view"), "Organization authorization relationship is incorrect");
  const organizationSummary = await createLedgerRepository(db, organization.ledgerScope.id).getLedgerOverviewSummary();
  assert(organizationSummary.totalExpenseAmount === REPOSITORY_SHOWCASE_EXPECTATIONS.organization.spending && organizationSummary.totalAssignedAmount === REPOSITORY_SHOWCASE_EXPECTATIONS.organization.assigned && organizationSummary.totalRepaidAmount === REPOSITORY_SHOWCASE_EXPECTATIONS.organization.repaid && organizationSummary.totalOutstandingAmount === REPOSITORY_SHOWCASE_EXPECTATIONS.organization.outstanding, "Organization ledger totals are incorrect");
  const organizationChat = await getOrganizationChat(db, organization.organization.id, users.ari);
  assert(organizationChat.threadId === organization.chat.thread.id && organizationChat.messages.length === 3 && organizationChat.messages.some((message) => message.body === "Workshop lunch is in the latest records."), "Organization General Chat is inconsistent");
}

async function verifyPrivateShare(context: RepositoryVerifyContext, token?: string) {
  const { client, db, fixture, personalScopeId } = context;
  const personal = fixture.personal;
  const links = await client.query<{ token_hash: string; revoked_at: Date | null; expires_at: Date; friend_id: string }>("SELECT token_hash, revoked_at, expires_at, friend_id FROM debtor_share_links WHERE ledger_scope_id = $1 AND id = $2", [personalScopeId, personal.shareLink.id]);
  assert(links.rows.length === 1 && links.rows[0]!.token_hash.length === 64 && links.rows[0]!.revoked_at === null && links.rows[0]!.friend_id === personal.shareLink.friendId && links.rows[0]!.expires_at > new Date(SHOWCASE_FIXED_TIMESTAMP), "repository private share link is not active");
  const paymentProofs = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM repayment_proofs WHERE ledger_scope_id = $1", [personalScopeId]);
  assert(Number(paymentProofs.rows[0]?.count) === 0, "repository private share exposes payment proof data");
  if (!token) return;
  const resolved = await resolveDebtorShareLink(db, token, new Date(SHOWCASE_FIXED_TIMESTAMP));
  assert(resolved?.statement.friendName === "Nadia Putri" && resolved.statement.assignedAmount === 270_000 && resolved.statement.repaidAmount === 120_000 && resolved.statement.outstandingAmount === 150_000, "repository private share does not resolve through the public contract");
  const sharedReceipts = resolved.statement.items.flatMap((item) => item.sharedReceipts ?? []);
  assert(sharedReceipts.length === 1 && sharedReceipts[0]!.publicId, "repository private share receipt selection is incorrect");
  const publicReceipt = await getSharedDebtorReceipt(db, token, sharedReceipts[0]!.publicId, new Date(SHOWCASE_FIXED_TIMESTAMP));
  assert(publicReceipt?.mediaType === "image/png" && publicReceipt.byteSize === personal.receipt.byteSize, "repository public receipt contract is incorrect");
}

async function verifyRepositoryShowcase(pool: ReturnType<typeof createDatabasePool>, accounts: Awaited<ReturnType<typeof resolveShowcaseAccounts>>, token?: string) {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SET TRANSACTION READ ONLY");
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [SHOWCASE_FIXTURE_LOCK_KEY]);
    const users = userIds(accounts);
    const fixture = generateRepositoryShowcaseFixture(users);
    const db = drizzle(client, { schema });
    const personalScopeResult = await client.query<{ id: string }>("SELECT id FROM ledger_scopes WHERE kind = 'personal' AND user_id = $1", [users.ari]);
    assert(personalScopeResult.rows.length === 1, "Ari personal ledger scope is missing");
    const personalScopeId = personalScopeResult.rows[0]!.id;

    const userRows = await client.query<{ email: string; name: string }>("SELECT email, name FROM users ORDER BY email");
    assert(userRows.rows.every((row) => row.email.endsWith("@zplit.local")), "repository showcase contains a non-local email");
    await resolveShowcaseAccounts(client, repositoryDefinitions());

    await verifyPersonal({ client, db, fixture, users, personalScopeId });
    await verifyGroup({ client, db, fixture, users, personalScopeId });
    await verifyOrganization({ client, db, fixture, users, personalScopeId });
    await verifyPrivateShare({ client, db, fixture, users, personalScopeId }, token);
    await client.query("COMMIT");
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function url(baseURL: string, path: string) {
  return new URL(path, baseURL.endsWith("/") ? baseURL : `${baseURL}/`).toString();
}

export type RepositoryShowcaseRunResult = {
  command: RepositoryShowcaseCommand;
  baseURL: string;
  users?: RepositoryShowcaseUserIds;
  token?: string;
};

export async function runRepositoryShowcaseCommand(command: RepositoryShowcaseCommand, environment: ShowcaseEnvironment = process.env, token?: string): Promise<RepositoryShowcaseRunResult> {
  const runtime = validateRepositoryShowcaseEnvironment(command, environment);
  if (command === "setup") {
    await assertExistingRepositoryDatabaseOwned();
    await prepareRepositoryDatabase(true);
  }
  if (command === "clear") {
    await assertExistingRepositoryDatabaseOwned();
    await prepareRepositoryDatabase(true);
    return { command, baseURL: runtime.authBaseURL };
  }
  const pool = createDatabasePool(readRuntimeDatabaseConfig());
  try {
    if (command === "setup") {
      await ensureShowcaseAccounts(pool, runtime, repositoryDefinitions());
      const client = await pool.connect();
      let accounts;
      try {
        accounts = await resolveShowcaseAccounts(client, repositoryDefinitions());
      } finally {
        client.release();
      }
      const shareToken = generateDebtorShareToken();
      const result = await replaceRepositoryShowcase(pool, accounts, shareToken);
      await verifyRepositoryShowcase(pool, accounts, shareToken);
      return { command, baseURL: runtime.authBaseURL, users: result.users, token: shareToken };
    }
    const client = await pool.connect();
    let accounts;
    try {
      accounts = await resolveShowcaseAccounts(client, repositoryDefinitions());
    } finally {
      client.release();
    }
    if (command === "verify") await verifyRepositoryShowcase(pool, accounts, token);
    else await replaceRepositoryShowcase(pool, accounts, undefined);
    return { command, baseURL: runtime.authBaseURL, users: userIds(accounts) };
  } finally {
    await pool.end();
  }
}

function optionalSecret(filePath: string | undefined) {
  if (!filePath) return [];
  try {
    return [readSecretFile(filePath)];
  } catch {
    return [];
  }
}

function printCapture(result: RepositoryShowcaseRunResult, printShareLink: boolean) {
  console.log(`Repository showcase: ${result.command}`);
  console.log(`Primary login: ${REPOSITORY_SHOWCASE_ACCOUNTS.ari.email}`);
  console.log(`Group login: ${REPOSITORY_SHOWCASE_ACCOUNTS.nadia.email}`);
  console.log(`Organization login: ${REPOSITORY_SHOWCASE_ACCOUNTS.reno.email}`);
  console.log(`Hero URL: ${url(result.baseURL, "/app")}`);
  console.log(`Personal URL: ${url(result.baseURL, "/app/personal")}`);
  console.log(`Group payments URL: ${url(result.baseURL, `/app/personal/groups/${REPOSITORY_SHOWCASE_IDS.group.group}/settlements`)}`);
  console.log(`Group chat URL: ${url(result.baseURL, `/app/personal/groups/${REPOSITORY_SHOWCASE_IDS.group.group}/chat`)}`);
  console.log(`Organization URL: ${url(result.baseURL, `/app/organizations/${REPOSITORY_SHOWCASE_IDS.organization.organization}`)}`);
  console.log(`Organization people URL: ${url(result.baseURL, `/app/organizations/${REPOSITORY_SHOWCASE_IDS.organization.organization}/people`)}`);
  console.log(`Organization General URL: ${url(result.baseURL, `/app/organizations/${REPOSITORY_SHOWCASE_IDS.organization.organization}/general`)}`);
  if (printShareLink && result.token) console.log(`Private share URL (ephemeral): ${url(result.baseURL, `/share/${result.token}`)}`);
}

async function main() {
  const command = parseRepositoryShowcaseCommand();
  const tokenArg = process.argv.find((value) => value.startsWith("--token="))?.slice("--token=".length) ?? (process.argv[3] === "--token" ? process.argv[4] : undefined);
  const result = await runRepositoryShowcaseCommand(command, process.env, tokenArg);
  printCapture(result, process.argv.includes("--print-share-link"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    const secrets = [
      ...optionalSecret(process.env.DB_PASSWORD_FILE),
      ...optionalSecret(process.env.BETTER_AUTH_SECRET_FILE),
      ...optionalSecret(process.env.OWNER_PASSWORD_FILE),
    ];
    const message = redactShowcaseError(error, secrets);
    console.error(`repository showcase fixture failed: ${message}`);
    process.exitCode = 1;
  });
}
