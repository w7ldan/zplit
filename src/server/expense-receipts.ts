import { asc, and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { expenseReceipts, expenses } from "../db/schema";
import {
  MAX_RECEIPT_BYTES_PER_EXPENSE,
  MAX_RECEIPTS_PER_EXPENSE,
  type ValidatedReceiptFile,
} from "../domain/receipt-file";
import { getPersonalLedgerScopeId } from "./ledger-scopes";

export const RECEIPT_COUNT_LIMIT_MESSAGE = "An expense can have up to 5 receipts.";
export const RECEIPT_TOTAL_LIMIT_MESSAGE = "Receipts for one expense cannot exceed 15 MiB.";
export const RECEIPT_DUPLICATE_MESSAGE = "This receipt is already attached to the expense.";
export const RECEIPT_UNAVAILABLE_MESSAGE = "This expense or receipt is no longer available.";
export const RECEIPT_READ_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
} as const;

export type ExpenseReceiptMetadata = {
  id: string;
  originalFilename: string;
  mediaType: string;
  byteSize: number;
  createdAt: Date;
};

export type ExpenseReceiptContent = Pick<ExpenseReceiptMetadata, "id" | "mediaType" | "byteSize"> & {
  content: Buffer;
};

export class ExpenseReceiptUnavailableError extends Error {
  constructor() {
    super(RECEIPT_UNAVAILABLE_MESSAGE);
    this.name = "ExpenseReceiptUnavailableError";
  }
}

export class ExpenseReceiptCountError extends Error {
  constructor() {
    super(RECEIPT_COUNT_LIMIT_MESSAGE);
    this.name = "ExpenseReceiptCountError";
  }
}

export class ExpenseReceiptTotalSizeError extends Error {
  constructor() {
    super(RECEIPT_TOTAL_LIMIT_MESSAGE);
    this.name = "ExpenseReceiptTotalSizeError";
  }
}

export class ExpenseReceiptDuplicateError extends Error {
  constructor() {
    super(RECEIPT_DUPLICATE_MESSAGE);
    this.name = "ExpenseReceiptDuplicateError";
  }
}

function metadataSelection() {
  return {
    id: expenseReceipts.id,
    originalFilename: expenseReceipts.originalFilename,
    mediaType: expenseReceipts.mediaType,
    byteSize: expenseReceipts.byteSize,
    createdAt: expenseReceipts.createdAt,
  };
}

function databaseCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function assertOwner(ownerUserId: string) {
  if (typeof ownerUserId !== "string" || !ownerUserId.trim()) throw new Error("A receipt owner is required");
}

export async function listExpenseReceipts(database: Database, ownerUserId: string, expenseId: string): Promise<ExpenseReceiptMetadata[]> {
  assertOwner(ownerUserId);
  const ledgerScopeId = await getPersonalLedgerScopeId(database, ownerUserId);
  return database
    .select(metadataSelection())
    .from(expenseReceipts)
    .where(and(eq(expenseReceipts.ledgerScopeId, ledgerScopeId), eq(expenseReceipts.expenseId, expenseId)))
    .orderBy(asc(expenseReceipts.createdAt), asc(expenseReceipts.id));
}

export async function createExpenseReceipt(
  database: Database,
  ownerUserId: string,
  expenseId: string,
  validatedFile: ValidatedReceiptFile,
): Promise<ExpenseReceiptMetadata> {
  assertOwner(ownerUserId);
  const ledgerScopeId = await getPersonalLedgerScopeId(database, ownerUserId);
  try {
    return await database.transaction(async (transaction) => {
      const [expense] = await transaction
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.ledgerScopeId, ledgerScopeId), eq(expenses.id, expenseId)))
        .limit(1)
        .for("update");
      if (!expense) throw new ExpenseReceiptUnavailableError();

      const existing = await transaction
        .select({ id: expenseReceipts.id, byteSize: expenseReceipts.byteSize, sha256: expenseReceipts.sha256 })
        .from(expenseReceipts)
        .where(and(eq(expenseReceipts.ledgerScopeId, ledgerScopeId), eq(expenseReceipts.expenseId, expenseId)))
        .orderBy(asc(expenseReceipts.id))
        .for("update");
      if (existing.length >= MAX_RECEIPTS_PER_EXPENSE) throw new ExpenseReceiptCountError();
      if (existing.some((receipt) => receipt.sha256 === validatedFile.sha256)) throw new ExpenseReceiptDuplicateError();
      if (existing.reduce((total, receipt) => total + receipt.byteSize, 0) + validatedFile.byteSize > MAX_RECEIPT_BYTES_PER_EXPENSE) {
        throw new ExpenseReceiptTotalSizeError();
      }

      const [created] = await transaction
        .insert(expenseReceipts)
        .values({
          ledgerScopeId,
          expenseId,
          originalFilename: validatedFile.originalFilename,
          mediaType: validatedFile.mediaType,
          byteSize: validatedFile.byteSize,
          sha256: validatedFile.sha256,
          content: Buffer.from(validatedFile.content),
        })
        .returning(metadataSelection());
      if (!created) throw new Error("Receipt was not created");
      return created;
    });
  } catch (error) {
    if (error instanceof ExpenseReceiptUnavailableError || error instanceof ExpenseReceiptCountError || error instanceof ExpenseReceiptTotalSizeError || error instanceof ExpenseReceiptDuplicateError) throw error;
    if (databaseCode(error) === "23505") throw new ExpenseReceiptDuplicateError();
    throw error;
  }
}

export async function getExpenseReceipt(database: Database, ownerUserId: string, expenseId: string, receiptId: string): Promise<ExpenseReceiptContent | null> {
  assertOwner(ownerUserId);
  const ledgerScopeId = await getPersonalLedgerScopeId(database, ownerUserId);
  const [receipt] = await database
    .select({ id: expenseReceipts.id, mediaType: expenseReceipts.mediaType, byteSize: expenseReceipts.byteSize, content: expenseReceipts.content })
    .from(expenseReceipts)
    .where(
      and(
        eq(expenseReceipts.ledgerScopeId, ledgerScopeId),
        eq(expenseReceipts.expenseId, expenseId),
        eq(expenseReceipts.id, receiptId),
      ),
    )
    .limit(1);
  return receipt ?? null;
}

export async function deleteExpenseReceipt(database: Database, ownerUserId: string, expenseId: string, receiptId: string) {
  assertOwner(ownerUserId);
  const ledgerScopeId = await getPersonalLedgerScopeId(database, ownerUserId);
  const deleted = await database
    .delete(expenseReceipts)
    .where(
      and(
        eq(expenseReceipts.ledgerScopeId, ledgerScopeId),
        eq(expenseReceipts.expenseId, expenseId),
        eq(expenseReceipts.id, receiptId),
      ),
    )
    .returning({ id: expenseReceipts.id });
  return deleted.length > 0;
}
