import { sql } from "drizzle-orm";
import { LedgerIntegrityError } from "../ledger-summary";
import { DebtorStatementIntegrityError } from "../debtor-statement";
import { LedgerExportIntegrityError } from "../ledger-export";
import { LedgerHistoryError } from "../ledger-history";
import { escapeLikePattern } from "../record-retrieval";
import {
  LedgerDeletionConfirmationRequiredError,
  LedgerNotFoundError,
  LedgerRepositoryError,
} from "./errors";
import { deletionImpactRevision } from "./errors";
import type { DeleteRecordOptions, DeletionImpact, LedgerDeletionConfirmationReason } from "./types";

export function notFound(): never {
  throw new LedgerNotFoundError();
}

export function persistenceError(error: unknown): never {
  if (error instanceof LedgerRepositoryError || error instanceof LedgerIntegrityError || error instanceof DebtorStatementIntegrityError || error instanceof LedgerExportIntegrityError || error instanceof LedgerHistoryError) throw error;
  throw new LedgerRepositoryError("PERSISTENCE_ERROR", "Ledger operation failed");
}

export function literalContains(column: unknown, value: string) {
  return sql`${column} ILIKE ${`%${escapeLikePattern(value)}%`} ESCAPE ${"\\"}`;
}

export function safeRetrievalInteger(value: unknown, label: string) {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 0) throw new LedgerIntegrityError(`${label} is invalid.`);
  return number;
}

export function safeDeletionIds(values: unknown[], label: string) {
  const ids = values.map((value) => {
    if (typeof value !== "string" || !value.trim()) throw new LedgerIntegrityError(`${label} is invalid.`);
    return value;
  });
  return [...new Set(ids)].sort();
}

export function addDeletionAmount(total: number, amount: unknown, label: string) {
  const value = safeRetrievalInteger(amount, label);
  const next = total + value;
  if (!Number.isSafeInteger(next)) throw new LedgerIntegrityError(`${label} is unsafe.`);
  return next;
}

export function assertDeleteOptions(options: DeleteRecordOptions): asserts options is DeleteRecordOptions {
  if (
    !options ||
    typeof options.cascadeDependents !== "boolean" ||
    (options.expectedImpactRevision !== undefined && (typeof options.expectedImpactRevision !== "string" || !/^[0-9a-f]{64}$/.test(options.expectedImpactRevision)))
  ) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Deletion options are invalid.");
  }
}

function deletionImpactHasDependents(impact: DeletionImpact) {
  return impact.recordType === "outing"
    ? impact.expenseCount > 0 || impact.receiptCount > 0 || impact.shareCount > 0 || impact.allocationCount > 0
    : impact.recordType === "expense"
      ? impact.receiptCount > 0 || impact.shareCount > 0 || impact.allocationCount > 0
      : impact.allocationCount > 0;
}

export function assertDeletionConfirmation(
  impact: DeletionImpact,
  options: DeleteRecordOptions,
  ErrorType: new (impact: DeletionImpact, reason?: LedgerDeletionConfirmationReason) => LedgerDeletionConfirmationRequiredError,
) {
  if (options.expectedImpactRevision !== undefined && deletionImpactRevision(impact) !== options.expectedImpactRevision) {
    throw new ErrorType(impact, "impact_changed");
  }
  if (options.expectedImpactRevision !== undefined && options.cascadeDependents && !deletionImpactHasDependents(impact)) {
    throw new ErrorType(impact, "cascade_confirmation_obsolete");
  }
  if (deletionImpactHasDependents(impact) && !options.cascadeDependents) {
    throw new ErrorType(impact);
  }
}

export function ledgerInteger(value: unknown, label: string) {
  const result = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(result) || result < 0) throw new LedgerIntegrityError(`${label} is not a safe whole-rupiah amount.`);
  return result;
}

export function ledgerDifference(left: number, right: number, label: string) {
  const result = left - right;
  if (!Number.isSafeInteger(result) || result < 0) throw new LedgerIntegrityError(`${label} is negative or not a safe integer.`);
  return result;
}

export function recentActivityDate(value: unknown, label: string) {
  const date = value instanceof Date ? new Date(value.getTime()) : typeof value === "string" ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) throw new LedgerIntegrityError(`${label} is invalid.`);
  return date;
}
