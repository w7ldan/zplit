import { createHash } from "node:crypto";
import { LedgerIntegrityError } from "../ledger-summary";
import type { DeletionImpact, LedgerDeletionConfirmationReason } from "./types";

export type LedgerErrorCode =
  | "INVALID_INPUT"
  | "INVALID_OWNER"
  | "NOT_FOUND"
  | "SHARE_TOTAL_EXCEEDED"
  | "SHARE_ALLOCATION_EXCEEDED"
  | "REPAYMENT_AMOUNT_TOO_LOW"
  | "REPAYMENT_FRIEND_LOCKED"
  | "REPAYMENT_ALLOCATION_AMOUNT_EXCEEDED"
  | "REPAYMENT_ALLOCATION_SHARE_EXCEEDED"
  | "DELETION_CONFIRMATION_REQUIRED"
  | "PERSISTENCE_ERROR";

export class LedgerRepositoryError extends Error {
  constructor(
    readonly code: LedgerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LedgerRepositoryError";
  }
}

export class LedgerNotFoundError extends LedgerRepositoryError {
  constructor() {
    super("NOT_FOUND", "Ledger record not found");
    this.name = "LedgerNotFoundError";
  }
}

export class ExpenseShareInvariantError extends LedgerRepositoryError {
  constructor() {
    super("SHARE_TOTAL_EXCEEDED", "Assigned shares cannot exceed the expense amount.");
    this.name = "ExpenseShareInvariantError";
  }
}

export class ExpenseShareAllocationInvariantError extends LedgerRepositoryError {
  constructor() {
    super("SHARE_ALLOCATION_EXCEEDED", "A share cannot be reduced below its existing repayments.");
    this.name = "ExpenseShareAllocationInvariantError";
  }
}

export class RepaymentAmountInvariantError extends LedgerRepositoryError {
  constructor() {
    super("REPAYMENT_AMOUNT_TOO_LOW", "Repayment amount cannot be lower than its allocated amount.");
    this.name = "RepaymentAmountInvariantError";
  }
}

export class RepaymentFriendInvariantError extends LedgerRepositoryError {
  constructor() {
    super("REPAYMENT_FRIEND_LOCKED", "The friend cannot be changed after this repayment has allocations.");
    this.name = "RepaymentFriendInvariantError";
  }
}

export class RepaymentAllocationAmountInvariantError extends LedgerRepositoryError {
  constructor() {
    super("REPAYMENT_ALLOCATION_AMOUNT_EXCEEDED", "Allocated amount cannot exceed the repayment amount.");
    this.name = "RepaymentAllocationAmountInvariantError";
  }
}

export class RepaymentAllocationShareInvariantError extends LedgerRepositoryError {
  constructor() {
    super("REPAYMENT_ALLOCATION_SHARE_EXCEEDED", "An allocation cannot exceed the share's remaining balance.");
    this.name = "RepaymentAllocationShareInvariantError";
  }
}

function normalizedImpactId(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new LedgerIntegrityError(`${label} is invalid.`);
  return value.trim().toLowerCase();
}

function normalizedImpactIds(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new LedgerIntegrityError(`${label} is invalid.`);
  const ids = value.map((id) => normalizedImpactId(id, label)).sort();
  if (new Set(ids).size !== ids.length) throw new LedgerIntegrityError(`${label} contains duplicates.`);
  return ids;
}

function deletionImpactInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new LedgerIntegrityError(`${label} is invalid.`);
  return value as number;
}

function deletionImpactCanonical(impact: DeletionImpact) {
  if (!impact || typeof impact !== "object" || Array.isArray(impact)) throw new LedgerIntegrityError("Deletion impact is invalid.");
  const value = impact as unknown as Record<string, unknown>;
  if (value.recordType === "outing") {
    const affectedRepaymentIds = normalizedImpactIds(value.affectedRepaymentIds, "Affected repayment ID");
    const affectedRepaymentCount = deletionImpactInteger(value.affectedRepaymentCount, "Affected repayment count");
    if (affectedRepaymentCount !== affectedRepaymentIds.length) throw new LedgerIntegrityError("Affected repayment count is invalid.");
    return {
      recordType: value.recordType,
      expenseCount: deletionImpactInteger(value.expenseCount, "Outing expense count"),
      expenseTotal: deletionImpactInteger(value.expenseTotal, "Outing expense total"),
      receiptCount: deletionImpactInteger(value.receiptCount, "Outing receipt count"),
      shareCount: deletionImpactInteger(value.shareCount, "Outing share count"),
      allocationCount: deletionImpactInteger(value.allocationCount, "Outing allocation count"),
      affectedRepaymentCount,
      affectedRepaymentIds,
      affectedFriendIds: normalizedImpactIds(value.affectedFriendIds, "Affected friend ID"),
    };
  }
  if (value.recordType === "expense") {
    const affectedRepaymentIds = normalizedImpactIds(value.affectedRepaymentIds, "Affected repayment ID");
    const affectedRepaymentCount = deletionImpactInteger(value.affectedRepaymentCount, "Affected repayment count");
    if (affectedRepaymentCount !== affectedRepaymentIds.length) throw new LedgerIntegrityError("Affected repayment count is invalid.");
    return {
      recordType: value.recordType,
      receiptCount: deletionImpactInteger(value.receiptCount, "Expense receipt count"),
      shareCount: deletionImpactInteger(value.shareCount, "Expense share count"),
      allocationCount: deletionImpactInteger(value.allocationCount, "Expense allocation count"),
      affectedRepaymentCount,
      affectedRepaymentIds,
      affectedFriendIds: normalizedImpactIds(value.affectedFriendIds, "Affected friend ID"),
    };
  }
  if (value.recordType === "repayment") {
    return {
      recordType: value.recordType,
      allocationCount: deletionImpactInteger(value.allocationCount, "Repayment allocation count"),
      friendId: normalizedImpactId(value.friendId, "Affected friend ID"),
    };
  }
  throw new LedgerIntegrityError("Deletion impact record type is invalid.");
}

export function deletionImpactRevision(impact: DeletionImpact): string {
  return createHash("sha256").update(JSON.stringify(deletionImpactCanonical(impact))).digest("hex");
}

export class LedgerDeletionConfirmationRequiredError extends LedgerRepositoryError {
  constructor(
    readonly impact: DeletionImpact,
    readonly reason: LedgerDeletionConfirmationReason = "cascade_confirmation_required",
  ) {
    super("DELETION_CONFIRMATION_REQUIRED", "Additional destructive confirmation is required.");
    this.name = "LedgerDeletionConfirmationRequiredError";
  }
}

/** @deprecated Use LedgerDeletionConfirmationRequiredError. */
export class OutingDeletionInvariantError extends LedgerDeletionConfirmationRequiredError {}
/** @deprecated Use LedgerDeletionConfirmationRequiredError. */
export class ExpenseDeletionInvariantError extends LedgerDeletionConfirmationRequiredError {}
/** @deprecated Use LedgerDeletionConfirmationRequiredError. */
export class RepaymentDeletionInvariantError extends LedgerDeletionConfirmationRequiredError {}


