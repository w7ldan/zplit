import "server-only";

import { databaseCode } from "@/server/database-error-code";

import { asc, and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { groupExpenseReceipts, groupExpenses, groupMemberships, groupParticipants } from "@/db/schema";
import { MAX_RECEIPT_BYTES_PER_EXPENSE, MAX_RECEIPTS_PER_EXPENSE, type ValidatedReceiptFile } from "@/domain/receipt-file";
import { normalizeUuid } from "@/domain/record-retrieval";
import { GroupError, assertGroupActiveForOperationalMutation, requireGroupAccess } from "@/server/groups";

export const GROUP_RECEIPT_COUNT_LIMIT_MESSAGE = "An expense can have up to 5 receipts.";
export const GROUP_RECEIPT_TOTAL_LIMIT_MESSAGE = "Receipts for one expense cannot exceed 15 MiB.";
export const GROUP_RECEIPT_DUPLICATE_MESSAGE = "This receipt is already attached to the expense.";
export const GROUP_RECEIPT_UNAVAILABLE_MESSAGE = "This expense or receipt is no longer available.";

export type GroupExpenseReceiptMetadata = {
  id: string;
  originalFilename: string;
  mediaType: string;
  byteSize: number;
  createdAt: Date;
};

export type GroupExpenseReceiptContent = Pick<GroupExpenseReceiptMetadata, "id" | "mediaType" | "byteSize"> & { content: Buffer };

export class GroupExpenseReceiptUnavailableError extends Error {
  constructor() { super(GROUP_RECEIPT_UNAVAILABLE_MESSAGE); this.name = "GroupExpenseReceiptUnavailableError"; }
}

export class GroupExpenseReceiptPermissionError extends Error {
  constructor() { super("Only the creator may change receipts while an expense is pending."); this.name = "GroupExpenseReceiptPermissionError"; }
}

export class GroupExpenseReceiptCountError extends Error {
  constructor() { super(GROUP_RECEIPT_COUNT_LIMIT_MESSAGE); this.name = "GroupExpenseReceiptCountError"; }
}

export class GroupExpenseReceiptTotalSizeError extends Error {
  constructor() { super(GROUP_RECEIPT_TOTAL_LIMIT_MESSAGE); this.name = "GroupExpenseReceiptTotalSizeError"; }
}

export class GroupExpenseReceiptDuplicateError extends Error {
  constructor() { super(GROUP_RECEIPT_DUPLICATE_MESSAGE); this.name = "GroupExpenseReceiptDuplicateError"; }
}

const metadataSelection = () => ({ id: groupExpenseReceipts.id, originalFilename: groupExpenseReceipts.originalFilename, mediaType: groupExpenseReceipts.mediaType, byteSize: groupExpenseReceipts.byteSize, createdAt: groupExpenseReceipts.createdAt });

function assertIds(groupId: string, expenseId: string) {
  if (!normalizeUuid(groupId) || !normalizeUuid(expenseId)) throw new GroupExpenseReceiptUnavailableError();
}

async function requireExpense(database: Database, groupId: string, expenseId: string, viewerUserId: string, lockForMutation = false) {
  await requireGroupAccess(database, groupId, viewerUserId);
  const query = database
    .select({ id: groupExpenses.id, state: groupExpenses.state, creatorParticipantId: groupExpenses.creatorParticipantId })
    .from(groupExpenses)
    .where(and(eq(groupExpenses.groupId, groupId), eq(groupExpenses.id, expenseId)))
    .limit(1);
  const [expense] = lockForMutation ? await query.for("update") : await query;
  if (!expense) throw new GroupExpenseReceiptUnavailableError();
  if (!lockForMutation) return expense;

  const [creator] = await database
    .select({ userId: groupParticipants.userId })
    .from(groupParticipants)
    .where(and(eq(groupParticipants.groupId, groupId), eq(groupParticipants.id, expense.creatorParticipantId)))
    .limit(1)
    .for("update");
  const [membership] = await database
    .select({ userId: groupMemberships.userId, participantId: groupMemberships.participantId })
    .from(groupMemberships)
    .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, viewerUserId), eq(groupMemberships.participantId, expense.creatorParticipantId)))
    .limit(1)
    .for("update");
  if (expense.state !== "pending" || creator?.userId !== viewerUserId || membership?.userId !== viewerUserId || membership?.participantId !== expense.creatorParticipantId) throw new GroupExpenseReceiptPermissionError();
  return expense;
}

export async function listGroupExpenseReceipts(database: Database, groupId: string, expenseId: string, viewerUserId: string): Promise<GroupExpenseReceiptMetadata[]> {
  assertIds(groupId, expenseId);
  await requireExpense(database, groupId, expenseId, viewerUserId);
  return database.select(metadataSelection()).from(groupExpenseReceipts).where(and(eq(groupExpenseReceipts.groupId, groupId), eq(groupExpenseReceipts.expenseId, expenseId))).orderBy(asc(groupExpenseReceipts.createdAt), asc(groupExpenseReceipts.id));
}

export async function createGroupExpenseReceipt(database: Database, groupId: string, expenseId: string, creatorUserId: string, validatedFile: ValidatedReceiptFile): Promise<GroupExpenseReceiptMetadata> {
  assertIds(groupId, expenseId);
  try {
    return await database.transaction(async (transaction) => {
      await assertGroupActiveForOperationalMutation(transaction as Database, groupId);
      await requireExpense(transaction as Database, groupId, expenseId, creatorUserId, true);
      const existing = await transaction.select({ id: groupExpenseReceipts.id, byteSize: groupExpenseReceipts.byteSize, sha256: groupExpenseReceipts.sha256 }).from(groupExpenseReceipts).where(and(eq(groupExpenseReceipts.groupId, groupId), eq(groupExpenseReceipts.expenseId, expenseId))).orderBy(asc(groupExpenseReceipts.id)).for("update");
      if (existing.length >= MAX_RECEIPTS_PER_EXPENSE) throw new GroupExpenseReceiptCountError();
      if (existing.some((receipt) => receipt.sha256 === validatedFile.sha256)) throw new GroupExpenseReceiptDuplicateError();
      if (existing.reduce((total, receipt) => total + receipt.byteSize, 0) + validatedFile.byteSize > MAX_RECEIPT_BYTES_PER_EXPENSE) throw new GroupExpenseReceiptTotalSizeError();
      const [created] = await transaction.insert(groupExpenseReceipts).values({ groupId, expenseId, originalFilename: validatedFile.originalFilename, mediaType: validatedFile.mediaType, byteSize: validatedFile.byteSize, sha256: validatedFile.sha256, content: Buffer.from(validatedFile.content) }).returning(metadataSelection());
      if (!created) throw new Error("Group receipt was not created");
      return created;
    });
  } catch (error) {
    if (error instanceof GroupError) throw new GroupExpenseReceiptUnavailableError();
    if (error instanceof GroupExpenseReceiptUnavailableError || error instanceof GroupExpenseReceiptPermissionError || error instanceof GroupExpenseReceiptCountError || error instanceof GroupExpenseReceiptTotalSizeError || error instanceof GroupExpenseReceiptDuplicateError) throw error;
    if (databaseCode(error, true) === "23505") throw new GroupExpenseReceiptDuplicateError();
    throw error;
  }
}

export async function getGroupExpenseReceipt(database: Database, groupId: string, expenseId: string, receiptId: string, viewerUserId: string): Promise<GroupExpenseReceiptContent | null> {
  assertIds(groupId, expenseId);
  if (!normalizeUuid(receiptId)) return null;
  await requireExpense(database, groupId, expenseId, viewerUserId);
  const [receipt] = await database.select({ id: groupExpenseReceipts.id, mediaType: groupExpenseReceipts.mediaType, byteSize: groupExpenseReceipts.byteSize, content: groupExpenseReceipts.content }).from(groupExpenseReceipts).where(and(eq(groupExpenseReceipts.groupId, groupId), eq(groupExpenseReceipts.expenseId, expenseId), eq(groupExpenseReceipts.id, receiptId))).limit(1);
  return receipt ?? null;
}

export async function deleteGroupExpenseReceipt(database: Database, groupId: string, expenseId: string, receiptId: string, creatorUserId: string) {
  assertIds(groupId, expenseId);
  if (!normalizeUuid(receiptId)) return false;
  const deleted = await database.transaction(async (transaction) => {
    await requireExpense(transaction as Database, groupId, expenseId, creatorUserId, true);
    return transaction.delete(groupExpenseReceipts).where(and(eq(groupExpenseReceipts.groupId, groupId), eq(groupExpenseReceipts.expenseId, expenseId), eq(groupExpenseReceipts.id, receiptId))).returning({ id: groupExpenseReceipts.id });
  });
  return deleted.length > 0;
}
