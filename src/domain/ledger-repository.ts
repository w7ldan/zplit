import { and, asc, desc, eq, gte, gt, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type { Database } from "../db/client";
import {
  debtorShareLinks,
  debtorShareReceipts,
  expenseChargeTargets,
  expenseCharges,
  expenseReceipts,
  expenseShares,
  expenses,
  friends,
  outings,
  repaymentAllocations,
  repayments,
  trips,
} from "../db/schema";
import { LedgerIntegrityError, type FriendBalance, type LedgerSummary } from "./ledger-summary";
import {
  buildDebtorStatement,
  buildPagedDebtorStatement,
  DEBTOR_STATEMENT_PAGE_SIZE,
  DebtorStatementIntegrityError,
} from "./debtor-statement";
import { validateLedgerExportSnapshot, LedgerExportIntegrityError, type LedgerExportSnapshot } from "./ledger-export";
import type { RepaymentAllocationInput } from "./repayment-allocation-input";
import { MAX_RUPIAH } from "./rupiah";
import {
  calculateShareBreakdown,
  MAX_PERCENTAGE_BASIS_POINTS,
  type ExpenseShareChargeInput,
  type ExpenseShareInput as ExpenseShareBaseInput,
} from "./expense-share-input";
import {
  buildLedgerHistory,
  LedgerHistoryError,
  LedgerHistoryIntegrityError,
  parseLedgerHistoryCursor,
  type LedgerHistoryExpenseRecord,
  type LedgerHistoryRepaymentRecord,
  type LedgerHistoryResult,
  type LedgerHistoryType,
} from "./ledger-history";
import {
  clampPage,
  escapeLikePattern,
  monthStart,
  nextMonthStart,
  normalizeExpenseFilters,
  normalizeFriendFilters,
  normalizeOutingFilters,
  normalizePage,
  normalizeRepaymentFilters,
  normalizeText,
  normalizeTimezoneOffset,
  normalizeUuid,
  pageResult,
  RECORD_PAGE_SIZE,
  type RecordPage,
} from "./record-retrieval";

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

export type FriendMutationInput = {
  name: string;
  phoneNumber: string | null;
  notes: string | null;
};

export type CreateFriendInput = FriendMutationInput;
export type UpdateFriendInput = FriendMutationInput;
export type OutingMutationInput = {
  title: string;
  occurredAt: Date;
  notes: string | null;
  tripId?: string | null;
};
export type CreateOutingInput = OutingMutationInput;
export type UpdateOutingInput = OutingMutationInput;
export type OutingSelectorOption = { id: string; title: string };
export type TripMutationInput = {
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  notes: string | null;
};
export type CreateTripInput = TripMutationInput;
export type UpdateTripInput = TripMutationInput;
export type TripSelectorOption = { id: string; name: string };
export type TripSummary = { outingCount: number; expenseCount: number; expenseTotal: number };
export type TripListRecord = typeof trips.$inferSelect & TripSummary;
export type ExpenseMutationInput = {
  description: string;
  amount: number;
  outingId: string;
};
export type CreateExpenseInput = ExpenseMutationInput;
export type UpdateExpenseInput = ExpenseMutationInput;
export type ExpenseShareInput = ExpenseShareBaseInput;
export type ExpenseChargeInput = ExpenseShareChargeInput;
export type ExpenseChargeRecord = ExpenseChargeInput & { id: string };
export type ExpenseShareRecord = {
  id: string;
  friendId: string;
  friendName: string;
  friendArchivedAt: Date | null;
  baseAmount: number;
  amountOwed: number;
  appliedAmount: number;
  remainingAmount: number;
  settled: boolean;
};
export type ExpenseSplitFriendDefinition = Pick<ExpenseShareRecord, "friendId" | "friendName" | "friendArchivedAt" | "baseAmount">;
export type ExpenseSplitDefinition = { friends: ExpenseSplitFriendDefinition[]; charges: ExpenseChargeInput[] };
export type RepaymentMutationInput = {
  friendId: string;
  amount: number;
  paidAt: Date;
  paymentMethod: string | null;
  notes: string | null;
};
export type CreateRepaymentInput = RepaymentMutationInput;
export type UpdateRepaymentInput = RepaymentMutationInput;
export type FriendSelectorOption = { id: string; name: string; archived: boolean };
export type FriendArchiveReversalReceipt = {
  version: 1;
  friendId: string;
  archivedAt: string;
  updatedAt: string;
};
export type RepaymentAllocationReversalReceipt = {
  version: 1;
  reversalId: string;
  allocationId: string;
  repaymentId: string;
  expenseShareId: string;
  friendId: string;
  amount: number;
};
export type RepaymentRecord = {
  id: string;
  ownerUserId: string;
  friendId: string;
  amount: number;
  paidAt: Date;
  paymentMethod: string | null;
  notes: string | null;
  createdAt: Date;
  friendName: string;
  friendArchivedAt: Date | null;
};

export type RepaymentListRecord = RepaymentRecord & {
  allocatedAmount: number;
  unallocatedAmount: number;
};

export type FriendExpenseShareRecord = {
  id: string;
  expenseId: string;
  expenseDescription: string;
  outingTitle: string;
  outingOccurredAt: Date;
  amountOwed: number;
  appliedAmount: number;
  remainingAmount: number;
  settled: boolean;
};

export type LedgerOverviewSummary = Omit<LedgerSummary, "friendBalances"> & {
  totalAssignedFriendCount: number;
  friendBalances: FriendBalance[];
};

export type RecentActivityRecord = {
  kind: "Expense" | "Repayment";
  id: string;
  title: string;
  detail: string;
  amount: number;
  date: Date;
};

export type RepaymentAllocationShare = {
  id: string;
  expenseShareId: string;
  expenseDescription: string;
  outingTitle: string;
  outingOccurredAt: Date;
  amountOwed: number;
  allocatedByOtherRepayments: number;
  currentAllocation: number;
  capacityAvailable: number;
};

export type RepaymentAllocationPlan = RepaymentRecord & {
  allocatedAmount: number;
  unallocatedAmount: number;
  shares: RepaymentAllocationShare[];
};

export type DeleteRecordOptions = { cascadeDependents: boolean; expectedImpactRevision?: string };

export type OutingDeletionImpact = {
  recordType: "outing";
  expenseCount: number;
  expenseTotal: number;
  receiptCount: number;
  shareCount: number;
  allocationCount: number;
  affectedRepaymentCount: number;
  affectedRepaymentIds: string[];
  affectedFriendIds: string[];
};

export type ExpenseDeletionImpact = {
  recordType: "expense";
  receiptCount: number;
  shareCount: number;
  allocationCount: number;
  affectedRepaymentCount: number;
  affectedRepaymentIds: string[];
  affectedFriendIds: string[];
};

export type RepaymentDeletionImpact = {
  recordType: "repayment";
  allocationCount: number;
  friendId: string;
};

export type DeletionImpact = OutingDeletionImpact | ExpenseDeletionImpact | RepaymentDeletionImpact;

export type LedgerDeletionConfirmationReason =
  | "cascade_confirmation_required"
  | "impact_changed"
  | "cascade_confirmation_obsolete";

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

export type OpenExpenseShare = {
  id: string;
  friendId: string;
  friendName: string;
  expenseDescription: string;
  outingTitle: string;
  outingOccurredAt: Date;
  amountOwed: number;
  repaidAmount: number;
  remainingAmount: number;
};

export type OpenExpenseSharesByFriend = Record<string, OpenExpenseShare[]>;

export type RepaymentFriendContext = {
  option: FriendSelectorOption;
  outstandingAmount: number;
  openExpenseShares: OpenExpenseShare[];
};

export type EligibleDebtorShareReceipt = {
  id: string;
  originalFilename: string;
  mediaType: string;
  createdAt: Date;
};

export type EligibleDebtorShareReceiptGroup = {
  expenseId: string;
  expenseDescription: string;
  outingTitle: string;
  receipts: EligibleDebtorShareReceipt[];
};

export type DebtorStatementPageOptions = {
  expensePage?: unknown;
  repaymentPage?: unknown;
};

function assertInput(input: unknown): asserts input is Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Ledger input is invalid");
  }
  if (Object.prototype.hasOwnProperty.call(input, "ownerUserId") || Object.prototype.hasOwnProperty.call(input, "owner_user_id")) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Ledger ownership is server managed");
  }
}

function assertFriendInput(input: unknown): asserts input is FriendMutationInput {
  assertInput(input);
  const keys = Object.keys(input);
  if (keys.some((key) => !["name", "phoneNumber", "notes"].includes(key))) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Friend fields are invalid");
  }
}

function assertFriendId(friendId: string) {
  if (typeof friendId !== "string" || !friendId.trim()) {
    throw new LedgerRepositoryError("INVALID_INPUT", "A friend ID is required");
  }
}

function assertFriendArchiveReversalReceipt(value: unknown): asserts value is FriendArchiveReversalReceipt {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !["version", "friendId", "archivedAt", "updatedAt"].includes(key)) ||
    (value as FriendArchiveReversalReceipt).version !== 1 ||
    typeof (value as FriendArchiveReversalReceipt).friendId !== "string" ||
    typeof (value as FriendArchiveReversalReceipt).archivedAt !== "string" ||
    typeof (value as FriendArchiveReversalReceipt).updatedAt !== "string"
  ) {
    throw new LedgerRepositoryError("INVALID_INPUT", "The archive reversal receipt is invalid");
  }
  assertFriendId((value as FriendArchiveReversalReceipt).friendId);
  for (const date of [(value as FriendArchiveReversalReceipt).archivedAt, (value as FriendArchiveReversalReceipt).updatedAt]) {
    if (Number.isNaN(new Date(date).getTime())) throw new LedgerRepositoryError("INVALID_INPUT", "The archive reversal receipt is invalid");
  }
}

function repaymentAllocationId(repaymentId: string, expenseShareId: string) {
  return `${repaymentId}:${expenseShareId}`;
}

function assertRepaymentAllocationReversalReceipt(value: unknown): asserts value is RepaymentAllocationReversalReceipt {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !["version", "reversalId", "allocationId", "repaymentId", "expenseShareId", "friendId", "amount"].includes(key)) ||
    (value as RepaymentAllocationReversalReceipt).version !== 1 ||
    typeof (value as RepaymentAllocationReversalReceipt).reversalId !== "string" ||
    normalizeUuid((value as RepaymentAllocationReversalReceipt).reversalId) !== (value as RepaymentAllocationReversalReceipt).reversalId ||
    typeof (value as RepaymentAllocationReversalReceipt).allocationId !== "string" ||
    typeof (value as RepaymentAllocationReversalReceipt).repaymentId !== "string" ||
    typeof (value as RepaymentAllocationReversalReceipt).expenseShareId !== "string" ||
    typeof (value as RepaymentAllocationReversalReceipt).friendId !== "string" ||
    typeof (value as RepaymentAllocationReversalReceipt).amount !== "number" ||
    !Number.isSafeInteger((value as RepaymentAllocationReversalReceipt).amount) ||
    (value as RepaymentAllocationReversalReceipt).amount <= 0
  ) {
    throw new LedgerRepositoryError("INVALID_INPUT", "The repayment allocation reversal receipt is invalid");
  }
  for (const id of [(value as RepaymentAllocationReversalReceipt).repaymentId, (value as RepaymentAllocationReversalReceipt).expenseShareId, (value as RepaymentAllocationReversalReceipt).friendId]) {
    if (!id.trim()) throw new LedgerRepositoryError("INVALID_INPUT", "The repayment allocation reversal receipt is invalid");
  }
  const receipt = value as RepaymentAllocationReversalReceipt;
  if (receipt.allocationId !== repaymentAllocationId(receipt.repaymentId, receipt.expenseShareId)) {
    throw new LedgerRepositoryError("INVALID_INPUT", "The repayment allocation reversal receipt is invalid");
  }
}

function assertOutingInput(input: unknown): asserts input is OutingMutationInput {
  assertInput(input);
  const keys = Object.keys(input);
  if (keys.some((key) => !["title", "occurredAt", "notes", "tripId"].includes(key))) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Outing fields are invalid");
  }
  if (
    typeof input.title !== "string" ||
    !(input.occurredAt instanceof Date) ||
    Number.isNaN(input.occurredAt.getTime()) ||
    (input.notes !== null && typeof input.notes !== "string") ||
    (input.tripId !== undefined && input.tripId !== null && (typeof input.tripId !== "string" || !normalizeUuid(input.tripId)))
  ) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Outing fields are invalid");
  }
}

function assertTripInput(input: unknown): asserts input is TripMutationInput {
  assertInput(input);
  if (
    Object.keys(input).some((key) => !["name", "startsOn", "endsOn", "notes"].includes(key)) ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 160 ||
    (input.startsOn !== null && (typeof input.startsOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn))) ||
    (input.endsOn !== null && (typeof input.endsOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.endsOn))) ||
    (input.startsOn !== null && input.endsOn !== null && input.endsOn < input.startsOn) ||
    (input.notes !== null && (typeof input.notes !== "string" || input.notes.length > 4000))
  ) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Trip fields are invalid");
  }
}

function assertOutingId(outingId: string) {
  if (typeof outingId !== "string" || !outingId.trim()) {
    throw new LedgerRepositoryError("INVALID_INPUT", "An outing ID is required");
  }
}

function assertTripId(tripId: string) {
  if (typeof tripId !== "string" || !normalizeUuid(tripId)) {
    throw new LedgerRepositoryError("INVALID_INPUT", "A trip ID is required");
  }
}

function assertExpenseInput(input: unknown): asserts input is ExpenseMutationInput {
  assertInput(input);
  const keys = Object.keys(input);
  if (keys.length !== 3 || keys.some((key) => !["description", "amount", "outingId"].includes(key))) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Expense fields are invalid");
  }
  if (
    typeof input.description !== "string" ||
    !input.description.trim() ||
    input.description.length > 200 ||
    typeof input.amount !== "number" ||
    !Number.isInteger(input.amount) ||
    input.amount <= 0 ||
    input.amount > 2_147_483_647 ||
    typeof input.outingId !== "string" ||
    !input.outingId.trim()
  ) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Expense fields are invalid");
  }
}

function assertExpenseId(expenseId: string) {
  if (typeof expenseId !== "string" || !expenseId.trim()) {
    throw new LedgerRepositoryError("INVALID_INPUT", "An expense ID is required");
  }
}

function assertRepaymentId(repaymentId: string) {
  if (typeof repaymentId !== "string" || !repaymentId.trim()) {
    throw new LedgerRepositoryError("INVALID_INPUT", "A repayment ID is required");
  }
}

function assertRepaymentInput(input: unknown): asserts input is RepaymentMutationInput {
  assertInput(input);
  const keys = Object.keys(input);
  if (keys.length !== 5 || keys.some((key) => !["friendId", "amount", "paidAt", "paymentMethod", "notes"].includes(key))) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Repayment fields are invalid");
  }
  if (
    typeof input.friendId !== "string" ||
    !input.friendId.trim() ||
    typeof input.amount !== "number" ||
    !Number.isSafeInteger(input.amount) ||
    input.amount <= 0 ||
    !(input.paidAt instanceof Date) ||
    Number.isNaN(input.paidAt.getTime()) ||
    (input.paymentMethod !== null && typeof input.paymentMethod !== "string") ||
    (input.notes !== null && typeof input.notes !== "string")
  ) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Repayment fields are invalid");
  }
}

function assertRepaymentAllocationsInput(input: unknown): asserts input is RepaymentAllocationInput[] {
  if (!Array.isArray(input)) throw new LedgerRepositoryError("INVALID_INPUT", "Repayment allocations are invalid");
  const seen = new Set<string>();
  for (const allocation of input) {
    if (
      allocation === null ||
      typeof allocation !== "object" ||
      Array.isArray(allocation) ||
      Object.keys(allocation).some((key) => !["expenseShareId", "amount"].includes(key)) ||
      typeof (allocation as RepaymentAllocationInput).expenseShareId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((allocation as RepaymentAllocationInput).expenseShareId) ||
      typeof (allocation as RepaymentAllocationInput).amount !== "number" ||
      !Number.isSafeInteger((allocation as RepaymentAllocationInput).amount) ||
      (allocation as RepaymentAllocationInput).amount <= 0 ||
      (allocation as RepaymentAllocationInput).amount > MAX_RUPIAH
    ) {
      throw new LedgerRepositoryError("INVALID_INPUT", "Repayment allocations are invalid");
    }
    const expenseShareId = (allocation as RepaymentAllocationInput).expenseShareId.toLowerCase();
    if (seen.has(expenseShareId)) throw new LedgerRepositoryError("INVALID_INPUT", "Each expense share can appear only once.");
    seen.add(expenseShareId);
  }
}

function assertExpenseSharesInput(shares: unknown): asserts shares is ExpenseShareInput[] {
  if (!Array.isArray(shares)) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Expense shares are invalid");
  }
  const seen = new Set<string>();
  for (const share of shares) {
    const value = share !== null && typeof share === "object" && !Array.isArray(share) ? share as Record<string, unknown> : {};
    const baseAmount = typeof value.baseAmount === "number" ? value.baseAmount : value.amountOwed;
    if (
      share === null ||
      typeof share !== "object" ||
      Array.isArray(share) ||
      Object.keys(share).some((key) => !["friendId", "amountOwed", "baseAmount"].includes(key)) ||
      !("baseAmount" in share || "amountOwed" in share) ||
      typeof (share as ExpenseShareInput).friendId !== "string" ||
      !(share as ExpenseShareInput).friendId.trim() ||
      typeof baseAmount !== "number" ||
      !Number.isInteger(baseAmount) ||
      baseAmount <= 0 ||
      baseAmount > MAX_RUPIAH
    ) {
      throw new LedgerRepositoryError("INVALID_INPUT", "Expense shares are invalid");
    }
    const friendId = (share as ExpenseShareInput).friendId.trim().toLowerCase();
    if (seen.has(friendId)) throw new LedgerRepositoryError("INVALID_INPUT", "Each friend can have only one share per expense.");
    seen.add(friendId);
  }
}

function assertExpenseChargesInput(charges: unknown): asserts charges is ExpenseChargeInput[] {
  if (!Array.isArray(charges)) throw new LedgerRepositoryError("INVALID_INPUT", "Expense charges are invalid");
  for (const charge of charges) {
    if (
      charge === null ||
      typeof charge !== "object" ||
      Array.isArray(charge) ||
      Object.keys(charge).some((key) => !["name", "percentageBasisPoints", "scope", "friendIds"].includes(key)) ||
      typeof (charge as ExpenseChargeInput).name !== "string" ||
      !(charge as ExpenseChargeInput).name.trim() ||
      (charge as ExpenseChargeInput).name.trim().length > 120 ||
      typeof (charge as ExpenseChargeInput).percentageBasisPoints !== "number" ||
      !Number.isSafeInteger((charge as ExpenseChargeInput).percentageBasisPoints) ||
      (charge as ExpenseChargeInput).percentageBasisPoints < 0 ||
      (charge as ExpenseChargeInput).percentageBasisPoints > MAX_PERCENTAGE_BASIS_POINTS ||
      ((charge as ExpenseChargeInput).scope !== "all" && (charge as ExpenseChargeInput).scope !== "selected") ||
      !Array.isArray((charge as ExpenseChargeInput).friendIds) ||
      (charge as ExpenseChargeInput).friendIds.some((friendId) => typeof friendId !== "string" || !normalizeUuid(friendId)) ||
      new Set((charge as ExpenseChargeInput).friendIds.map((friendId) => friendId.toLowerCase())).size !== (charge as ExpenseChargeInput).friendIds.length ||
      ((charge as ExpenseChargeInput).scope === "selected" && (charge as ExpenseChargeInput).friendIds.length === 0)
    ) {
      throw new LedgerRepositoryError("INVALID_INPUT", "Expense charges are invalid");
    }
  }
}

function shareBaseAmount(share: ExpenseShareInput) {
  return "baseAmount" in share ? share.baseAmount : share.amountOwed;
}

function notFound(): never {
  throw new LedgerNotFoundError();
}

function persistenceError(error: unknown): never {
  if (error instanceof LedgerRepositoryError || error instanceof LedgerIntegrityError || error instanceof DebtorStatementIntegrityError || error instanceof LedgerExportIntegrityError || error instanceof LedgerHistoryError) throw error;
  throw new LedgerRepositoryError("PERSISTENCE_ERROR", "Ledger operation failed");
}

function literalContains(column: unknown, value: string) {
  return sql`${column} ILIKE ${`%${escapeLikePattern(value)}%`} ESCAPE ${"\\"}`;
}

function safeRetrievalInteger(value: unknown, label: string) {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 0) throw new LedgerIntegrityError(`${label} is invalid.`);
  return number;
}

function safeDeletionIds(values: unknown[], label: string) {
  const ids = values.map((value) => {
    if (typeof value !== "string" || !value.trim()) throw new LedgerIntegrityError(`${label} is invalid.`);
    return value;
  });
  return [...new Set(ids)].sort();
}

function addDeletionAmount(total: number, amount: unknown, label: string) {
  const value = safeRetrievalInteger(amount, label);
  const next = total + value;
  if (!Number.isSafeInteger(next)) throw new LedgerIntegrityError(`${label} is unsafe.`);
  return next;
}

function assertDeleteOptions(options: DeleteRecordOptions): asserts options is DeleteRecordOptions {
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

function assertDeletionConfirmation(
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

type RecentActivityRow = {
  event_kind: unknown;
  record_id: unknown;
  title_source: unknown;
  detail_source: unknown;
  amount: unknown;
  effective_at: unknown;
  created_at: unknown;
  allocated_amount: unknown;
};

function recentActivityText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new LedgerIntegrityError(`${label} is invalid.`);
  return value;
}

function recentActivityAmount(value: unknown, label: string) {
  const amount = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(amount) || amount < 0) throw new LedgerIntegrityError(`${label} is not a safe whole-rupiah amount.`);
  return amount;
}

function recentActivityDate(value: unknown, label: string) {
  const date = value instanceof Date ? new Date(value.getTime()) : typeof value === "string" ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) throw new LedgerIntegrityError(`${label} is invalid.`);
  return date;
}

type LedgerAggregateRow = {
  total_expense_amount: unknown;
  total_assigned_amount: unknown;
  total_repaid_amount: unknown;
  total_received_amount: unknown;
  owner_portion_amount: unknown;
  total_assigned_friend_count: unknown;
  invalid_cross_friend_allocations: unknown;
  invalid_repayment_allocations: unknown;
  invalid_share_allocations: unknown;
  invalid_owner_portions: unknown;
  friend_balances: unknown;
};

function ledgerInteger(value: unknown, label: string) {
  const result = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(result) || result < 0) throw new LedgerIntegrityError(`${label} is not a safe whole-rupiah amount.`);
  return result;
}

function ledgerText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new LedgerIntegrityError(`${label} is invalid.`);
  return value;
}

function ledgerDifference(left: number, right: number, label: string) {
  const result = left - right;
  if (!Number.isSafeInteger(result) || result < 0) throw new LedgerIntegrityError(`${label} is negative or not a safe integer.`);
  return result;
}

function ledgerJson(value: unknown, label: string) {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { throw new LedgerIntegrityError(`${label} is invalid.`); }
  }
  if (!Array.isArray(value)) throw new LedgerIntegrityError(`${label} is invalid.`);
  return value;
}

function parseFriendBalances(value: unknown): FriendBalance[] {
  const seen = new Set<string>();
  return ledgerJson(value, "Friend balances").map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new LedgerIntegrityError(`Friend balance ${index} is invalid.`);
    const record = row as Record<string, unknown>;
    const friendId = ledgerText(record.friendId, `Friend balance ${index} ID`);
    if (seen.has(friendId)) throw new LedgerIntegrityError(`Friend balance ${friendId} is duplicated.`);
    seen.add(friendId);
    const name = ledgerText(record.name, `Friend balance ${friendId} name`);
    if (typeof record.archived !== "boolean") throw new LedgerIntegrityError(`Friend balance ${friendId} archive state is invalid.`);
    const assignedAmount = ledgerInteger(record.assignedAmount, `Assigned amount for friend ${friendId}`);
    const repaidAmount = ledgerInteger(record.repaidAmount, `Repaid amount for friend ${friendId}`);
    return {
      friendId,
      name,
      archived: record.archived,
      assignedAmount,
      repaidAmount,
      outstandingAmount: ledgerDifference(assignedAmount, repaidAmount, `Outstanding amount for friend ${friendId}`),
    };
  });
}

function emptyLedgerAggregate(): LedgerAggregateRow {
  return {
    total_expense_amount: "0",
    total_assigned_amount: "0",
    total_repaid_amount: "0",
    total_received_amount: "0",
    owner_portion_amount: "0",
    total_assigned_friend_count: "0",
    invalid_cross_friend_allocations: "0",
    invalid_repayment_allocations: "0",
    invalid_share_allocations: "0",
    invalid_owner_portions: "0",
    friend_balances: [],
  };
}

function parseLedgerAggregate(row: LedgerAggregateRow): LedgerOverviewSummary {
  for (const [value, label] of [
    [row.invalid_cross_friend_allocations, "Cross-friend allocations"],
    [row.invalid_repayment_allocations, "Repayment allocations"],
    [row.invalid_share_allocations, "Expense share allocations"],
    [row.invalid_owner_portions, "Owner portions"],
  ] as const) {
    if (ledgerInteger(value, label) > 0) throw new LedgerIntegrityError(`${label} violate ledger integrity.`);
  }

  const totalExpenseAmount = ledgerInteger(row.total_expense_amount, "Total expense amount");
  const totalAssignedAmount = ledgerInteger(row.total_assigned_amount, "Total assigned amount");
  const totalRepaidAmount = ledgerInteger(row.total_repaid_amount, "Total repaid amount");
  const totalReceivedAmount = ledgerInteger(row.total_received_amount, "Total received amount");
  const ownerPortionAmount = ledgerInteger(row.owner_portion_amount, "Owner portion amount");
  const totalAssignedFriendCount = ledgerInteger(row.total_assigned_friend_count, "Assigned friend count");
  const friendBalances = parseFriendBalances(row.friend_balances);

  return {
    totalExpenseAmount,
    totalAssignedAmount,
    totalRepaidAmount,
    totalReceivedAmount,
    totalUnallocatedRepaymentAmount: ledgerDifference(totalReceivedAmount, totalRepaidAmount, "Total unallocated repayment amount"),
    totalOutstandingAmount: ledgerDifference(totalAssignedAmount, totalRepaidAmount, "Total outstanding amount"),
    ownerPortionAmount,
    totalAssignedFriendCount,
    friendBalances,
  };
}

function ledgerAggregateQuery(owner: string, friendLimit?: number) {
  const limit = friendLimit === undefined ? sql`` : sql`LIMIT ${friendLimit}`;
  return sql<LedgerAggregateRow>`
    WITH expense_totals AS (
      SELECT e.id, e.amount::numeric AS amount, COALESCE(SUM(s.amount_owed::numeric), 0) AS assigned_amount
      FROM expenses e
      LEFT JOIN expense_shares s
        ON s.owner_user_id = e.owner_user_id
        AND s.expense_id = e.id
      WHERE e.owner_user_id = ${owner}
      GROUP BY e.id, e.amount
    ),
    share_allocation_totals AS (
      SELECT s.id, s.friend_id, s.amount_owed::numeric AS amount_owed, COALESCE(SUM(a.amount::numeric), 0) AS allocated_amount
      FROM expense_shares s
      LEFT JOIN repayment_allocations a
        ON a.owner_user_id = s.owner_user_id
        AND a.expense_share_id = s.id
      WHERE s.owner_user_id = ${owner}
      GROUP BY s.id, s.friend_id, s.amount_owed
    ),
    repayment_allocation_totals AS (
      SELECT r.id, r.amount::numeric AS amount, COALESCE(SUM(a.amount::numeric), 0) AS allocated_amount
      FROM repayments r
      LEFT JOIN repayment_allocations a
        ON a.owner_user_id = r.owner_user_id
        AND a.repayment_id = r.id
      WHERE r.owner_user_id = ${owner}
      GROUP BY r.id, r.amount
    ),
    allocation_links AS (
      SELECT a.repayment_id, a.expense_share_id, r.friend_id AS repayment_friend_id, s.friend_id AS share_friend_id
      FROM repayment_allocations a
      LEFT JOIN repayments r
        ON r.owner_user_id = a.owner_user_id
        AND r.id = a.repayment_id
      LEFT JOIN expense_shares s
        ON s.owner_user_id = a.owner_user_id
        AND s.id = a.expense_share_id
      WHERE a.owner_user_id = ${owner}
    ),
    friend_totals AS (
      SELECT f.id, f.name, f.archived_at,
        COALESCE((SELECT SUM(s.amount_owed::numeric) FROM expense_shares s WHERE s.owner_user_id = f.owner_user_id AND s.friend_id = f.id), 0) AS assigned_amount,
        COALESCE((SELECT SUM(a.amount::numeric) FROM repayment_allocations a INNER JOIN expense_shares s ON s.owner_user_id = a.owner_user_id AND s.id = a.expense_share_id WHERE a.owner_user_id = f.owner_user_id AND s.friend_id = f.id), 0) AS repaid_amount
      FROM friends f
      WHERE f.owner_user_id = ${owner}
    ),
    friend_balances AS (
      SELECT id, name, archived_at, assigned_amount, repaid_amount, assigned_amount - repaid_amount AS outstanding_amount
      FROM friend_totals
      WHERE assigned_amount > 0
    ),
    integrity AS (
      SELECT
        (SELECT COUNT(*) FROM allocation_links WHERE repayment_friend_id IS NULL OR share_friend_id IS NULL OR repayment_friend_id <> share_friend_id)::text AS invalid_cross_friend_allocations,
        (SELECT COUNT(*) FROM repayment_allocation_totals WHERE allocated_amount > amount)::text AS invalid_repayment_allocations,
        (SELECT COUNT(*) FROM share_allocation_totals WHERE allocated_amount > amount_owed)::text AS invalid_share_allocations,
        (SELECT COUNT(*) FROM expense_totals WHERE assigned_amount > amount)::text AS invalid_owner_portions
    ),
    totals AS (
      SELECT
        COALESCE((SELECT SUM(amount) FROM expense_totals), 0)::text AS total_expense_amount,
        COALESCE((SELECT SUM(amount_owed) FROM share_allocation_totals), 0)::text AS total_assigned_amount,
        COALESCE((SELECT SUM(allocated_amount) FROM repayment_allocation_totals), 0)::text AS total_repaid_amount,
        COALESCE((SELECT SUM(amount::numeric) FROM repayments WHERE owner_user_id = ${owner}), 0)::text AS total_received_amount,
        COALESCE((SELECT SUM(amount - assigned_amount) FROM expense_totals), 0)::text AS owner_portion_amount
    )
    SELECT totals.*, (SELECT COUNT(*) FROM friend_balances)::text AS total_assigned_friend_count,
      integrity.invalid_cross_friend_allocations,
      integrity.invalid_repayment_allocations,
      integrity.invalid_share_allocations,
      integrity.invalid_owner_portions,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'friendId', id,
          'name', name,
          'archived', archived_at IS NOT NULL,
          'assignedAmount', assigned_amount::text,
          'repaidAmount', repaid_amount::text
        ) ORDER BY outstanding_amount DESC, name ASC, id ASC)
        FROM (SELECT * FROM friend_balances ORDER BY outstanding_amount DESC, name ASC, id ASC ${limit}) selected_friend_balances
      ), '[]'::jsonb) AS friend_balances
    FROM totals CROSS JOIN integrity
  `;
}

function friendBalancesQuery(owner: string, friendIds: string[]) {
  const friendFilter = sql.join(friendIds.map((friendId) => sql`${friendId}`), sql`, `);
  return sql<LedgerAggregateRow>`
    WITH selected_friends AS (
      SELECT f.id, f.name, f.archived_at
      FROM friends f
      WHERE f.owner_user_id = ${owner} AND f.id IN (${friendFilter})
    ),
    share_allocation_totals AS (
      SELECT s.id, s.friend_id, s.amount_owed::numeric AS amount_owed, COALESCE(SUM(a.amount::numeric), 0) AS allocated_amount
      FROM expense_shares s
      INNER JOIN selected_friends f ON f.id = s.friend_id
      LEFT JOIN repayment_allocations a
        ON a.owner_user_id = s.owner_user_id
        AND a.expense_share_id = s.id
      WHERE s.owner_user_id = ${owner}
      GROUP BY s.id, s.friend_id, s.amount_owed
    ),
    repayment_ids AS (
      SELECT DISTINCT a.repayment_id
      FROM repayment_allocations a
      INNER JOIN share_allocation_totals s ON s.id = a.expense_share_id
      WHERE a.owner_user_id = ${owner}
    ),
    repayment_allocation_totals AS (
      SELECT r.id, r.amount::numeric AS amount, COALESCE(SUM(a.amount::numeric), 0) AS allocated_amount
      FROM repayments r
      INNER JOIN repayment_ids ids ON ids.repayment_id = r.id
      LEFT JOIN repayment_allocations a
        ON a.owner_user_id = r.owner_user_id
        AND a.repayment_id = r.id
      WHERE r.owner_user_id = ${owner}
      GROUP BY r.id, r.amount
    ),
    allocation_links AS (
      SELECT a.repayment_id, a.expense_share_id, r.friend_id AS repayment_friend_id, s.friend_id AS share_friend_id
      FROM repayment_allocations a
      INNER JOIN repayment_ids ids ON ids.repayment_id = a.repayment_id
      LEFT JOIN repayments r ON r.owner_user_id = a.owner_user_id AND r.id = a.repayment_id
      LEFT JOIN expense_shares s ON s.owner_user_id = a.owner_user_id AND s.id = a.expense_share_id
      WHERE a.owner_user_id = ${owner}
    ),
    friend_balances AS (
      SELECT f.id, f.name, f.archived_at,
        COALESCE(SUM(s.amount_owed), 0) AS assigned_amount,
        COALESCE(SUM(s.allocated_amount), 0) AS repaid_amount
      FROM selected_friends f
      LEFT JOIN share_allocation_totals s ON s.friend_id = f.id
      GROUP BY f.id, f.name, f.archived_at
      HAVING COALESCE(SUM(s.amount_owed), 0) > 0
    ),
    integrity AS (
      SELECT
        (SELECT COUNT(*) FROM allocation_links WHERE repayment_friend_id IS NULL OR share_friend_id IS NULL OR repayment_friend_id <> share_friend_id)::text AS invalid_cross_friend_allocations,
        (SELECT COUNT(*) FROM repayment_allocation_totals WHERE allocated_amount > amount)::text AS invalid_repayment_allocations,
        (SELECT COUNT(*) FROM share_allocation_totals WHERE allocated_amount > amount_owed)::text AS invalid_share_allocations,
        (SELECT COUNT(*) FROM friend_balances WHERE assigned_amount - repaid_amount < 0)::text AS invalid_owner_portions
    )
    SELECT
      '0' AS total_expense_amount,
      '0' AS total_assigned_amount,
      '0' AS total_repaid_amount,
      '0' AS total_received_amount,
      '0' AS owner_portion_amount,
      '0' AS total_assigned_friend_count,
      integrity.invalid_cross_friend_allocations,
      integrity.invalid_repayment_allocations,
      integrity.invalid_share_allocations,
      integrity.invalid_owner_portions,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'friendId', id,
          'name', name,
          'archived', archived_at IS NOT NULL,
          'assignedAmount', assigned_amount::text,
          'repaidAmount', repaid_amount::text
        ) ORDER BY assigned_amount - repaid_amount DESC, name ASC, id ASC)
        FROM friend_balances
      ), '[]'::jsonb) AS friend_balances
    FROM integrity
  `;
}

export function createLedgerRepository(database: Database, ownerUserId: string) {
  const owner = ownerUserId.trim();
  if (!owner) throw new LedgerRepositoryError("INVALID_OWNER", "A ledger owner is required");

  async function createFriend(input: CreateFriendInput) {
    assertFriendInput(input);
    try {
      const [friend] = await database.insert(friends).values({ ...input, ownerUserId: owner }).returning();
      if (!friend) return persistenceError(new Error("friend insert returned no row"));
      return friend;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getFriend(friendId: string) {
    assertFriendId(friendId);
    try {
      const [friend] = await database
        .select()
        .from(friends)
        .where(and(eq(friends.ownerUserId, owner), eq(friends.id, friendId)))
        .limit(1);
      if (!friend) return notFound();
      return friend;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listFriends({ archived = false }: { archived?: boolean } = {}) {
    try {
      return await database
        .select()
        .from(friends)
        .where(and(eq(friends.ownerUserId, owner), archived ? isNotNull(friends.archivedAt) : isNull(friends.archivedAt)))
        .orderBy(asc(friends.name), asc(friends.id));
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function searchFriends(options: { q?: unknown; selectedId?: unknown; activeOnly?: boolean } = {}): Promise<FriendSelectorOption[]> {
    const query = normalizeText(options.q);
    const selectedId = normalizeUuid(options.selectedId);
    const conditions = [
      eq(friends.ownerUserId, owner),
      ...(options.activeOnly ? [isNull(friends.archivedAt)] : []),
      ...(query ? [selectedId ? or(literalContains(friends.name, query), literalContains(friends.phoneNumber, query), eq(friends.id, selectedId)) : or(literalContains(friends.name, query), literalContains(friends.phoneNumber, query))] : []),
    ];
    try {
      const rows = await database
        .select({ id: friends.id, name: friends.name, archived: sql<boolean>`${friends.archivedAt} is not null` })
        .from(friends)
        .where(and(...conditions))
        .orderBy(
          ...(selectedId ? [sql`case when ${friends.id} = ${selectedId} then 0 else 1 end`] : []),
          sql`case when ${friends.archivedAt} is null then 0 else 1 end`,
          asc(friends.name),
          asc(friends.id),
        )
        .limit(20);
      return rows;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listFriendRecords(options: { archived?: unknown; q?: unknown; page?: unknown } = {}): Promise<RecordPage<typeof friends.$inferSelect>> {
    const filters = normalizeFriendFilters(options);
    const conditions = [
      eq(friends.ownerUserId, owner),
      filters.archived ? isNotNull(friends.archivedAt) : isNull(friends.archivedAt),
      ...(filters.q ? [sql`(${literalContains(friends.name, filters.q)} OR ${literalContains(friends.phoneNumber, filters.q)})`] : []),
    ];
    try {
      const [{ count = 0 } = {}] = await database
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(friends)
        .where(and(...conditions));
      const totalItems = safeRetrievalInteger(count, "Friend count");
      const page = clampPage(filters.page, totalItems);
      const items = await database
        .select()
        .from(friends)
        .where(and(...conditions))
        .orderBy(asc(friends.name), asc(friends.id))
        .limit(RECORD_PAGE_SIZE)
        .offset((page - 1) * RECORD_PAGE_SIZE);
      return pageResult(items, totalItems, page);
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function updateFriend(friendId: string, input: UpdateFriendInput) {
    assertFriendId(friendId);
    assertFriendInput(input);
    try {
      const [friend] = await database
        .update(friends)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(friends.ownerUserId, owner), eq(friends.id, friendId)))
        .returning();
      if (!friend) return notFound();
      return friend;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function setFriendArchived(friendId: string, archived: boolean) {
    assertFriendId(friendId);
    try {
      const [friend] = await database
        .update(friends)
        .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
        .where(and(eq(friends.ownerUserId, owner), eq(friends.id, friendId)))
        .returning();
      if (!friend) return notFound();
      return friend;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function archiveFriend(friendId: string) {
    assertFriendId(friendId);
    const archivedAt = new Date();
    const updatedAt = new Date();
    try {
      const [friend] = await database
        .update(friends)
        .set({ archivedAt, updatedAt })
        .where(and(eq(friends.ownerUserId, owner), eq(friends.id, friendId), isNull(friends.archivedAt)))
        .returning();
      if (!friend) return notFound();
      return {
        friend,
        reversalReceipt: {
          version: 1 as const,
          friendId: friend.id,
          archivedAt: friend.archivedAt?.toISOString() ?? archivedAt.toISOString(),
          updatedAt: friend.updatedAt.toISOString(),
        },
      };
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function undoFriendArchive(receipt: FriendArchiveReversalReceipt) {
    assertFriendArchiveReversalReceipt(receipt);
    try {
      const [friend] = await database
        .update(friends)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(and(
          eq(friends.ownerUserId, owner),
          eq(friends.id, receipt.friendId),
          eq(friends.archivedAt, new Date(receipt.archivedAt)),
          eq(friends.updatedAt, new Date(receipt.updatedAt)),
        ))
        .returning();
      if (!friend) return notFound();
      return friend;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function createTrip(input: CreateTripInput) {
    assertTripInput(input);
    try {
      const [trip] = await database.insert(trips).values({ ...input, ownerUserId: owner }).returning();
      if (!trip) return persistenceError(new Error("trip insert returned no row"));
      return trip;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getTrip(tripId: string) {
    assertTripId(tripId);
    try {
      const [trip] = await database
        .select()
        .from(trips)
        .where(and(eq(trips.ownerUserId, owner), eq(trips.id, tripId)))
        .limit(1);
      if (!trip) return notFound();
      return trip;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function searchTrips(options: { q?: unknown; selectedId?: unknown } = {}): Promise<TripSelectorOption[]> {
    const query = normalizeText(options.q);
    const selectedId = normalizeUuid(options.selectedId);
    const conditions = [
      eq(trips.ownerUserId, owner),
      ...(query ? [selectedId ? or(literalContains(trips.name, query), eq(trips.id, selectedId)) : literalContains(trips.name, query)] : []),
    ];
    try {
      return await database
        .select({ id: trips.id, name: trips.name })
        .from(trips)
        .where(and(...conditions))
        .orderBy(
          ...(selectedId ? [sql`case when ${trips.id} = ${selectedId} then 0 else 1 end`] : []),
          sql`${trips.startsOn} DESC NULLS LAST`,
          desc(trips.createdAt),
          asc(trips.name),
          asc(trips.id),
        )
        .limit(20);
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listTripRecords(options: { q?: unknown; page?: unknown } = {}): Promise<RecordPage<TripListRecord>> {
    const query = normalizeText(options.q);
    const conditions = [eq(trips.ownerUserId, owner), ...(query ? [literalContains(trips.name, query)] : [])];
    try {
      const [{ count = 0 } = {}] = await database
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(trips)
        .where(and(...conditions));
      const totalItems = safeRetrievalInteger(count, "Trip count");
      const page = clampPage(options.page === undefined ? 1 : Number(options.page), totalItems);
      const pageTrips = database
        .select({ id: trips.id, ownerUserId: trips.ownerUserId })
        .from(trips)
        .where(and(...conditions))
        .orderBy(sql`${trips.startsOn} DESC NULLS LAST`, desc(trips.createdAt), asc(trips.name), asc(trips.id))
        .limit(RECORD_PAGE_SIZE)
        .offset((page - 1) * RECORD_PAGE_SIZE)
        .as("trip_page");
      const totals = database
        .select({
          tripId: outings.tripId,
          outingCount: sql<number>`count(distinct ${outings.id})`.mapWith(Number).as("outing_count"),
          expenseCount: sql<number>`count(${expenses.id})`.mapWith(Number).as("expense_count"),
          expenseTotal: sql<number>`coalesce(sum(${expenses.amount}), 0)`.mapWith(Number).as("expense_total"),
        })
        .from(outings)
        .innerJoin(pageTrips, and(eq(pageTrips.id, outings.tripId), eq(pageTrips.ownerUserId, outings.ownerUserId)))
        .leftJoin(expenses, and(eq(expenses.ownerUserId, outings.ownerUserId), eq(expenses.outingId, outings.id)))
        .where(eq(outings.ownerUserId, owner))
        .groupBy(outings.ownerUserId, outings.tripId)
        .as("trip_totals");
      const rows = await database
        .select({ trip: trips, outingCount: totals.outingCount, expenseCount: totals.expenseCount, expenseTotal: totals.expenseTotal })
        .from(trips)
        .innerJoin(pageTrips, and(eq(pageTrips.id, trips.id), eq(pageTrips.ownerUserId, trips.ownerUserId)))
        .leftJoin(totals, and(eq(totals.tripId, trips.id)))
        .where(eq(trips.ownerUserId, owner))
        .orderBy(sql`${trips.startsOn} DESC NULLS LAST`, desc(trips.createdAt), asc(trips.name), asc(trips.id));
      const items = rows.map((row) => {
        const raw = row as unknown as Record<string, unknown>;
        return {
          ...row.trip,
          outingCount: safeRetrievalInteger(raw.outing_count ?? row.outingCount ?? 0, "Trip outing count"),
          expenseCount: safeRetrievalInteger(raw.expense_count ?? row.expenseCount ?? 0, "Trip expense count"),
          expenseTotal: safeRetrievalInteger(raw.expense_total ?? row.expenseTotal ?? 0, "Trip expense total"),
        };
      });
      return pageResult(items, totalItems, page);
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getTripSummary(tripId: string): Promise<TripSummary> {
    assertTripId(tripId);
    try {
      const [row] = await database
        .select({
          id: trips.id,
          outingCount: sql<number>`count(distinct ${outings.id})`.mapWith(Number).as("outing_count"),
          expenseCount: sql<number>`count(${expenses.id})`.mapWith(Number).as("expense_count"),
          expenseTotal: sql<number>`coalesce(sum(${expenses.amount}), 0)`.mapWith(Number).as("expense_total"),
        })
        .from(trips)
        .leftJoin(outings, and(eq(outings.ownerUserId, trips.ownerUserId), eq(outings.tripId, trips.id)))
        .leftJoin(expenses, and(eq(expenses.ownerUserId, outings.ownerUserId), eq(expenses.outingId, outings.id)))
        .where(and(eq(trips.ownerUserId, owner), eq(trips.id, tripId)))
        .groupBy(trips.id)
        .limit(1);
      if (!row) return notFound();
      const raw = row as unknown as Record<string, unknown>;
      return {
        outingCount: safeRetrievalInteger(raw.outing_count ?? row.outingCount, "Trip outing count"),
        expenseCount: safeRetrievalInteger(raw.expense_count ?? row.expenseCount, "Trip expense count"),
        expenseTotal: safeRetrievalInteger(raw.expense_total ?? row.expenseTotal, "Trip expense total"),
      };
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function updateTrip(tripId: string, input: UpdateTripInput) {
    assertTripId(tripId);
    assertTripInput(input);
    try {
      const [trip] = await database
        .update(trips)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(trips.ownerUserId, owner), eq(trips.id, tripId)))
        .returning();
      if (!trip) return notFound();
      return trip;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function deleteTrip(tripId: string) {
    assertTripId(tripId);
    try {
      return await database.transaction(async (transaction) => {
        const [trip] = await transaction
          .select({ id: trips.id })
          .from(trips)
          .where(and(eq(trips.ownerUserId, owner), eq(trips.id, tripId)))
          .limit(1)
          .for("update");
        if (!trip) return notFound();
        const detached = await transaction
          .update(outings)
          .set({ tripId: null, updatedAt: new Date() })
          .where(and(eq(outings.ownerUserId, owner), eq(outings.tripId, tripId)))
          .returning({ id: outings.id });
        const deleted = await transaction
          .delete(trips)
          .where(and(eq(trips.ownerUserId, owner), eq(trips.id, tripId)))
          .returning({ id: trips.id });
        if (deleted.length === 0) return notFound();
        return { detachedOutingCount: detached.length };
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function assertOwnedTrip(databaseLike: Pick<Database, "select">, tripId: string) {
    const [trip] = await databaseLike
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.ownerUserId, owner), eq(trips.id, tripId)))
      .limit(1);
    if (!trip) return notFound();
  }

  async function createOuting(input: CreateOutingInput) {
    assertOutingInput(input);
    const requested = { ...input, tripId: input.tripId ?? null };
    try {
      if (requested.tripId) await assertOwnedTrip(database, requested.tripId);
      const [outing] = await database.insert(outings).values({ ...requested, ownerUserId: owner }).returning();
      if (!outing) return persistenceError(new Error("outing insert returned no row"));
      return outing;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getOuting(outingId: string) {
    assertOutingId(outingId);
    try {
      const [outing] = await database
        .select()
        .from(outings)
        .where(and(eq(outings.ownerUserId, owner), eq(outings.id, outingId)))
        .limit(1);
      if (!outing) return notFound();
      return outing;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listOutings() {
    try {
      return await database.select().from(outings).where(eq(outings.ownerUserId, owner)).orderBy(desc(outings.occurredAt), asc(outings.id));
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function searchOutings(options: { q?: unknown; selectedId?: unknown } = {}): Promise<OutingSelectorOption[]> {
    const query = normalizeText(options.q);
    const selectedId = normalizeUuid(options.selectedId);
    const conditions = [
      eq(outings.ownerUserId, owner),
      ...(query && selectedId ? [or(literalContains(outings.title, query), eq(outings.id, selectedId))] : query ? [literalContains(outings.title, query)] : []),
    ];
    try {
      return await database
        .select({ id: outings.id, title: outings.title })
        .from(outings)
        .where(and(...conditions))
        .orderBy(
          ...(selectedId ? [sql`case when ${outings.id} = ${selectedId} then 0 else 1 end`] : []),
          desc(outings.occurredAt),
          desc(outings.createdAt),
          asc(outings.id),
        )
        .limit(20);
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listOutingRecords(options: { q?: unknown; month?: unknown; trip?: unknown; page?: unknown; timezoneOffsetMinutes?: unknown } = {}) {
    const filters = normalizeOutingFilters(options);
    const timezoneOffsetMinutes = normalizeTimezoneOffset(options.timezoneOffsetMinutes) ?? 0;
    const conditions = [
      eq(outings.ownerUserId, owner),
      ...(filters.q ? [literalContains(outings.title, filters.q)] : []),
      ...(filters.month ? [gte(outings.occurredAt, monthStart(filters.month, timezoneOffsetMinutes)), lt(outings.occurredAt, nextMonthStart(filters.month, timezoneOffsetMinutes))] : []),
      ...(filters.trip === "unassigned" ? [isNull(outings.tripId)] : filters.trip ? [eq(outings.tripId, filters.trip)] : []),
    ];
    try {
      const [{ count = 0 } = {}] = await database
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(outings)
        .where(and(...conditions));
      const totalItems = safeRetrievalInteger(count, "Outing count");
      const page = clampPage(filters.page, totalItems);
      const pageOutings = database
        .select({ id: outings.id, ownerUserId: outings.ownerUserId, tripId: outings.tripId })
        .from(outings)
        .where(and(...conditions))
        .orderBy(desc(outings.occurredAt), desc(outings.createdAt), asc(outings.id))
        .limit(RECORD_PAGE_SIZE)
        .offset((page - 1) * RECORD_PAGE_SIZE)
        .as("outing_page");
      const expenseTotals = database
        .select({
          outingId: expenses.outingId,
          expenseCount: sql<number>`count(${expenses.id})`.mapWith(Number).as("expense_count"),
          expenseTotal: sql<number>`coalesce(sum(${expenses.amount}), 0)`.mapWith(Number).as("expense_total"),
        })
        .from(expenses)
        .innerJoin(pageOutings, and(eq(pageOutings.id, expenses.outingId), eq(pageOutings.ownerUserId, expenses.ownerUserId)))
        .where(eq(expenses.ownerUserId, owner))
        .groupBy(expenses.ownerUserId, expenses.outingId)
        .as("outing_expense_totals");
      const rows = await database
        .select({ outing: outings, tripName: trips.name, expenseCount: expenseTotals.expenseCount, expenseTotal: expenseTotals.expenseTotal })
        .from(outings)
        .innerJoin(pageOutings, and(eq(pageOutings.id, outings.id), eq(pageOutings.ownerUserId, outings.ownerUserId)))
        .leftJoin(expenseTotals, eq(expenseTotals.outingId, outings.id))
        .leftJoin(trips, and(eq(trips.ownerUserId, outings.ownerUserId), eq(trips.id, outings.tripId)))
        .where(eq(outings.ownerUserId, owner))
        .orderBy(desc(outings.occurredAt), desc(outings.createdAt), asc(outings.id));
      const items = rows.map(({ outing, tripName, expenseCount, expenseTotal }) => ({
        ...outing,
        tripName: tripName ?? null,
        expenseCount: safeRetrievalInteger(expenseCount ?? 0, "Outing expense count"),
        expenseTotal: safeRetrievalInteger(expenseTotal ?? 0, "Outing expense total"),
      }));
      return pageResult(items, totalItems, page);
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function updateOuting(outingId: string, input: UpdateOutingInput) {
    assertOutingId(outingId);
    assertOutingInput(input);
    const requested = { ...input, tripId: input.tripId ?? null };
    try {
      if (requested.tripId) await assertOwnedTrip(database, requested.tripId);
      const [outing] = await database
        .update(outings)
        .set({ ...requested, updatedAt: new Date() })
        .where(and(eq(outings.ownerUserId, owner), eq(outings.id, outingId)))
        .returning();
      if (!outing) return notFound();
      return outing;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getOutingDeletionImpact(outingId: string): Promise<OutingDeletionImpact> {
    assertOutingId(outingId);
    try {
      const [outing] = await database
        .select({ id: outings.id })
        .from(outings)
        .where(and(eq(outings.ownerUserId, owner), eq(outings.id, outingId)))
        .limit(1);
      if (!outing) return notFound();
      const expenseRows = await database
        .select({ id: expenses.id, amount: expenses.amount })
        .from(expenses)
        .where(and(eq(expenses.ownerUserId, owner), eq(expenses.outingId, outingId)));
      const expenseIds = safeDeletionIds(expenseRows.map((expense) => expense.id), "Outing expense ID");
      let expenseTotal = 0;
      for (const expense of expenseRows) expenseTotal = addDeletionAmount(expenseTotal, expense.amount, `Expense ${expense.id} amount`);
      const shareRows = expenseIds.length
        ? await database.select({ id: expenseShares.id, friendId: expenseShares.friendId }).from(expenseShares).where(and(eq(expenseShares.ownerUserId, owner), inArray(expenseShares.expenseId, expenseIds)))
        : [];
      const shareIds = safeDeletionIds(shareRows.map((share) => share.id), "Expense share ID");
      const [receiptRows, allocationRows] = expenseIds.length
        ? await Promise.all([
            database.select({ id: expenseReceipts.id }).from(expenseReceipts).where(and(eq(expenseReceipts.ownerUserId, owner), inArray(expenseReceipts.expenseId, expenseIds))),
            shareIds.length
              ? database.select({ repaymentId: repaymentAllocations.repaymentId }).from(repaymentAllocations).where(and(eq(repaymentAllocations.ownerUserId, owner), inArray(repaymentAllocations.expenseShareId, shareIds)))
              : Promise.resolve([]),
          ])
        : [[], []];
      const affectedRepaymentIds = safeDeletionIds(allocationRows.map((allocation) => allocation.repaymentId), "Affected repayment ID");
      return {
        recordType: "outing",
        expenseCount: safeRetrievalInteger(expenseRows.length, "Outing expense count"),
        expenseTotal,
        receiptCount: safeRetrievalInteger(receiptRows.length, "Outing receipt count"),
        shareCount: safeRetrievalInteger(shareRows.length, "Outing share count"),
        allocationCount: safeRetrievalInteger(allocationRows.length, "Outing allocation count"),
        affectedRepaymentCount: safeRetrievalInteger(affectedRepaymentIds.length, "Affected repayment count"),
        affectedRepaymentIds,
        affectedFriendIds: safeDeletionIds(shareRows.map((share) => share.friendId), "Affected friend ID"),
      };
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function lockExpenseDependents(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    expenseIds: string[],
  ) {
    if (expenseIds.length === 0) return { receipts: [], publicReceipts: [], shares: [], allocations: [] };
    const receipts = await transaction
      .select({ id: expenseReceipts.id })
      .from(expenseReceipts)
      .where(and(eq(expenseReceipts.ownerUserId, owner), inArray(expenseReceipts.expenseId, expenseIds)))
      .orderBy(asc(expenseReceipts.id))
      .for("update");
    const publicReceipts = await transaction
      .select({ id: debtorShareReceipts.id })
      .from(debtorShareReceipts)
      .where(and(eq(debtorShareReceipts.ownerUserId, owner), inArray(debtorShareReceipts.expenseId, expenseIds)))
      .orderBy(asc(debtorShareReceipts.id))
      .for("update");
    const shares = await transaction
      .select({ id: expenseShares.id, friendId: expenseShares.friendId })
      .from(expenseShares)
      .where(and(eq(expenseShares.ownerUserId, owner), inArray(expenseShares.expenseId, expenseIds)))
      .orderBy(asc(expenseShares.id))
      .for("update");
    const shareIds = safeDeletionIds(shares.map((share) => share.id), "Expense share ID");
    const allocations = shareIds.length
      ? await transaction
          .select({ repaymentId: repaymentAllocations.repaymentId, expenseShareId: repaymentAllocations.expenseShareId })
          .from(repaymentAllocations)
          .where(and(eq(repaymentAllocations.ownerUserId, owner), inArray(repaymentAllocations.expenseShareId, shareIds)))
          .orderBy(asc(repaymentAllocations.expenseShareId), asc(repaymentAllocations.repaymentId))
          .for("update")
      : [];
    return { receipts, publicReceipts, shares, allocations };
  }

  async function deleteOuting(outingId: string, options: DeleteRecordOptions = { cascadeDependents: false }) {
    assertOutingId(outingId);
    assertDeleteOptions(options);
    try {
      return await database.transaction(async (transaction) => {
        const [outing] = await transaction
          .select({ id: outings.id })
          .from(outings)
          .where(and(eq(outings.ownerUserId, owner), eq(outings.id, outingId)))
          .limit(1)
          .for("update");
        if (!outing) return notFound();
        const dependentExpenses = await transaction
          .select({ id: expenses.id, amount: expenses.amount })
          .from(expenses)
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.outingId, outingId)))
          .orderBy(asc(expenses.id))
          .for("update");
        const expenseIds = safeDeletionIds(dependentExpenses.map((expense) => expense.id), "Outing expense ID");
        const dependents = await lockExpenseDependents(transaction, expenseIds);
        const affectedRepaymentIds = safeDeletionIds(dependents.allocations.map((allocation) => allocation.repaymentId), "Affected repayment ID");
        const impact: OutingDeletionImpact = {
          recordType: "outing",
          expenseCount: safeRetrievalInteger(dependentExpenses.length, "Outing expense count"),
          expenseTotal: dependentExpenses.reduce((total, expense) => addDeletionAmount(total, expense.amount, `Expense ${expense.id} amount`), 0),
          receiptCount: safeRetrievalInteger(dependents.receipts.length, "Outing receipt count"),
          shareCount: safeRetrievalInteger(dependents.shares.length, "Outing share count"),
          allocationCount: safeRetrievalInteger(dependents.allocations.length, "Outing allocation count"),
          affectedRepaymentCount: safeRetrievalInteger(affectedRepaymentIds.length, "Affected repayment count"),
          affectedRepaymentIds,
          affectedFriendIds: safeDeletionIds(dependents.shares.map((share) => share.friendId), "Affected friend ID"),
        };
        assertDeletionConfirmation(impact, options, OutingDeletionInvariantError);
        const deleted = await transaction
          .delete(outings)
          .where(and(eq(outings.ownerUserId, owner), eq(outings.id, outingId)))
          .returning({ id: outings.id });
        if (deleted.length === 0) return notFound();
        return { friendIds: impact.affectedFriendIds, repaymentIds: impact.affectedRepaymentIds };
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  function expenseSelection() {
    return {
      id: expenses.id,
      ownerUserId: expenses.ownerUserId,
      outingId: expenses.outingId,
      description: expenses.description,
      amount: expenses.amount,
      createdAt: expenses.createdAt,
      updatedAt: expenses.updatedAt,
      outingTitle: outings.title,
      outingOccurredAt: outings.occurredAt,
    };
  }

  async function assertOwnedOuting(transaction: Parameters<Parameters<Database["transaction"]>[0]>[0], outingId: string) {
    const [outing] = await transaction
      .select({ id: outings.id })
      .from(outings)
      .where(and(eq(outings.ownerUserId, owner), eq(outings.id, outingId)))
      .limit(1);
    if (!outing) return notFound();
  }

  async function createExpense(input: CreateExpenseInput) {
    assertExpenseInput(input);
    try {
      return await database.transaction(async (transaction) => {
        await assertOwnedOuting(transaction, input.outingId);
        const [expense] = await transaction.insert(expenses).values({ ...input, ownerUserId: owner }).returning();
        if (!expense) return persistenceError(new Error("expense insert returned no row"));
        const [created] = await transaction
          .select(expenseSelection())
          .from(expenses)
          .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expense.id)))
          .limit(1);
        if (!created) return persistenceError(new Error("expense insert lookup returned no row"));
        return created;
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getExpense(expenseId: string) {
    assertExpenseId(expenseId);
    try {
      const [expense] = await database
        .select(expenseSelection())
        .from(expenses)
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
        .limit(1);
      if (!expense) return notFound();
      return expense;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listExpenses() {
    try {
      return await database
        .select(expenseSelection())
        .from(expenses)
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .where(eq(expenses.ownerUserId, owner))
        .orderBy(desc(outings.occurredAt), desc(expenses.createdAt), asc(expenses.id));
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listRecentActivity({ limit = 6 }: { limit?: number } = {}): Promise<RecentActivityRecord[]> {
    if (typeof limit !== "number" || !Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new LedgerRepositoryError("INVALID_INPUT", "Recent activity limit is invalid.");
    }
    try {
      const result = await database.execute<RecentActivityRow>(sql`
        WITH expense_candidates AS MATERIALIZED (
          SELECT
            'Expense'::text AS event_kind,
            e.id AS record_id,
            e.description AS title_source,
            o.title AS detail_source,
            e.amount,
            o.occurred_at AS effective_at,
            e.created_at,
            0::bigint AS allocated_amount
          FROM expenses e
          INNER JOIN outings o
            ON o.owner_user_id = e.owner_user_id
            AND o.id = e.outing_id
          WHERE e.owner_user_id = ${owner}
            AND o.owner_user_id = ${owner}
          ORDER BY o.occurred_at DESC, e.created_at DESC, e.id ASC
          LIMIT ${limit}
        ),
        repayment_candidates AS MATERIALIZED (
          SELECT
            'Repayment'::text AS event_kind,
            r.id AS record_id,
            f.name AS title_source,
            'Money received'::text AS detail_source,
            r.amount,
            r.paid_at AS effective_at,
            r.created_at,
            0::bigint AS allocated_amount
          FROM repayments r
          INNER JOIN friends f
            ON f.owner_user_id = r.owner_user_id
            AND f.id = r.friend_id
          WHERE r.owner_user_id = ${owner}
            AND f.owner_user_id = ${owner}
          ORDER BY r.paid_at DESC, r.created_at DESC, r.id ASC
          LIMIT ${limit}
        ),
        bounded_activity AS MATERIALIZED (
          SELECT * FROM expense_candidates
          UNION ALL
          SELECT * FROM repayment_candidates
        ),
        final_activity AS MATERIALIZED (
          SELECT activity.*
          FROM bounded_activity activity
          ORDER BY
            activity.effective_at DESC,
            CASE WHEN activity.event_kind = 'Expense' THEN 0 ELSE 1 END ASC,
            activity.created_at DESC,
            activity.record_id ASC
          LIMIT ${limit}
        ),
        repayment_totals AS (
          SELECT
            ra.owner_user_id,
            ra.repayment_id,
            COALESCE(SUM(ra.amount), 0) AS allocated_amount
          FROM repayment_allocations ra
          INNER JOIN final_activity activity
            ON activity.event_kind = 'Repayment'
            AND activity.record_id = ra.repayment_id
          WHERE ra.owner_user_id = ${owner}
          GROUP BY ra.owner_user_id, ra.repayment_id
        )
        SELECT
          activity.event_kind,
          activity.record_id,
          activity.title_source,
          activity.detail_source,
          activity.amount,
          activity.effective_at,
          activity.created_at,
          COALESCE(rt.allocated_amount, 0)::bigint AS allocated_amount
        FROM final_activity activity
        LEFT JOIN repayment_totals rt
          ON rt.owner_user_id = ${owner}
          AND rt.repayment_id = activity.record_id
        ORDER BY
          activity.effective_at DESC,
          CASE WHEN activity.event_kind = 'Expense' THEN 0 ELSE 1 END ASC,
          activity.created_at DESC,
          activity.record_id ASC
      `);

      const activityRows = (Array.isArray(result) ? result : result.rows) as RecentActivityRow[];
      return activityRows.map((row) => {
        if (row.event_kind !== "Expense" && row.event_kind !== "Repayment") {
          throw new LedgerIntegrityError("Recent activity event kind is invalid.");
        }
        const id = recentActivityText(row.record_id, "Recent activity record ID");
        const title = recentActivityText(row.title_source, `Recent activity ${row.event_kind} title`);
        const detailSource = recentActivityText(row.detail_source, `Recent activity ${row.event_kind} detail`);
        const amount = recentActivityAmount(row.amount, `Recent activity ${id} amount`);
        const allocatedAmount = recentActivityAmount(row.allocated_amount, `Allocation for repayment ${id}`);
        const date = recentActivityDate(row.effective_at, `Recent activity ${id} date`);
        recentActivityDate(row.created_at, `Recent activity ${id} creation time`);
        if (row.event_kind === "Repayment" && allocatedAmount > amount) {
          throw new LedgerIntegrityError(`Allocations exceed repayment ${id}.`);
        }
        return {
          kind: row.event_kind,
          id,
          title,
          detail: row.event_kind === "Repayment" && amount - allocatedAmount > 0
            ? `${detailSource} · unallocated remains open`
            : detailSource,
          amount,
          date,
        };
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listExpenseRecords(options: { q?: unknown; outingId?: unknown; month?: unknown; assignment?: unknown; page?: unknown; timezoneOffsetMinutes?: unknown } = {}) {
    const filters = normalizeExpenseFilters(options);
    const timezoneOffsetMinutes = normalizeTimezoneOffset(options.timezoneOffsetMinutes) ?? 0;
    const assignmentCondition = filters.assignment === "all"
      ? undefined
      : filters.assignment === "assigned"
        ? sql`exists (select 1 from ${expenseShares} where ${expenseShares.ownerUserId} = ${owner} and ${expenseShares.expenseId} = ${expenses.id})`
        : sql`not exists (select 1 from ${expenseShares} where ${expenseShares.ownerUserId} = ${owner} and ${expenseShares.expenseId} = ${expenses.id})`;
    const conditions = [
      eq(expenses.ownerUserId, owner),
      eq(outings.ownerUserId, owner),
      ...(filters.q ? [sql`(${literalContains(expenses.description, filters.q)} OR ${literalContains(outings.title, filters.q)})`] : []),
      ...(filters.outingId ? [eq(expenses.outingId, filters.outingId)] : []),
      ...(filters.month ? [gte(outings.occurredAt, monthStart(filters.month, timezoneOffsetMinutes)), lt(outings.occurredAt, nextMonthStart(filters.month, timezoneOffsetMinutes))] : []),
      ...(assignmentCondition ? [assignmentCondition] : []),
    ];
    try {
      const [{ count = 0 } = {}] = await database
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(expenses)
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .where(and(...conditions));
      const totalItems = safeRetrievalInteger(count, "Expense count");
      const page = clampPage(filters.page, totalItems);
      const pageExpenses = database
        .select({ id: expenses.id, ownerUserId: expenses.ownerUserId })
        .from(expenses)
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .where(and(...conditions))
        .orderBy(desc(outings.occurredAt), desc(expenses.createdAt), asc(expenses.id))
        .limit(RECORD_PAGE_SIZE)
        .offset((page - 1) * RECORD_PAGE_SIZE)
        .as("expense_page");
      const items = await database
        .select(expenseSelection())
        .from(expenses)
        .innerJoin(pageExpenses, and(eq(pageExpenses.id, expenses.id), eq(pageExpenses.ownerUserId, expenses.ownerUserId)))
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .where(eq(expenses.ownerUserId, owner))
        .orderBy(desc(outings.occurredAt), desc(expenses.createdAt), asc(expenses.id));
      return pageResult(items, totalItems, page);
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listFriendExpenseShareRecords(friendId: string, options: { page?: unknown } = {}): Promise<RecordPage<FriendExpenseShareRecord>> {
    assertFriendId(friendId);
    const page = normalizePage(options.page);
    const allocationTotals = database
      .select({
        ownerUserId: repaymentAllocations.ownerUserId,
        expenseShareId: repaymentAllocations.expenseShareId,
        appliedAmount: sql<number>`sum(${repaymentAllocations.amount})`.mapWith(Number).as("applied_amount"),
      })
      .from(repaymentAllocations)
      .where(eq(repaymentAllocations.ownerUserId, owner))
      .groupBy(repaymentAllocations.ownerUserId, repaymentAllocations.expenseShareId)
      .as("friend_expense_share_allocations");
    const conditions = [
      eq(expenseShares.ownerUserId, owner),
      eq(expenseShares.friendId, friendId.trim().toLowerCase()),
      eq(expenses.ownerUserId, owner),
      eq(outings.ownerUserId, owner),
      eq(friends.ownerUserId, owner),
    ];
    try {
      const [{ count = 0 } = {}] = await database
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(expenseShares)
        .innerJoin(expenses, and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseShares.expenseId)))
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, expenseShares.friendId)))
        .where(and(...conditions));
      const totalItems = safeRetrievalInteger(count, "Friend expense share count");
      const requestedPage = clampPage(page, totalItems);
      const appliedAmount = sql<number>`coalesce(${allocationTotals.appliedAmount}, 0)`.mapWith(Number);
      const rows = await database
        .select({
          id: expenseShares.id,
          expenseId: expenses.id,
          expenseDescription: expenses.description,
          outingTitle: outings.title,
          outingOccurredAt: outings.occurredAt,
          amountOwed: expenseShares.amountOwed,
          appliedAmount,
        })
        .from(expenseShares)
        .innerJoin(expenses, and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseShares.expenseId)))
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, expenseShares.friendId)))
        .leftJoin(allocationTotals, and(eq(allocationTotals.ownerUserId, owner), eq(allocationTotals.expenseShareId, expenseShares.id)))
        .where(and(...conditions))
        .orderBy(
          sql`case when ${appliedAmount} < ${expenseShares.amountOwed} then 0 else 1 end`,
          desc(outings.occurredAt),
          desc(expenses.createdAt),
          asc(expenses.id),
          asc(expenseShares.id),
        )
        .limit(RECORD_PAGE_SIZE)
        .offset((requestedPage - 1) * RECORD_PAGE_SIZE);
      const items = rows.map((row) => {
        const amountOwed = safeRetrievalInteger(row.amountOwed, `Share for expense ${row.expenseId}`);
        const applied = safeRetrievalInteger(row.appliedAmount ?? 0, `Applied amount for expense ${row.expenseId}`);
        if (applied > amountOwed) throw new LedgerIntegrityError(`Allocations exceed share for expense ${row.expenseId}.`);
        return {
          ...row,
          amountOwed,
          appliedAmount: applied,
          remainingAmount: amountOwed - applied,
          settled: applied === amountOwed,
        };
      });
      return pageResult(items, totalItems, requestedPage);
    } catch (error) {
      return persistenceError(error);
    }
  }

  type HistoryRow = {
    event_type: string;
    record_id: string;
    effective_at: Date | string;
    description: string | null;
    outing_title: string | null;
    friend_id: string | null;
    friend_name: string | null;
    total_amount: number | string | null;
    shares: unknown;
    allocations: unknown;
  };

  function historyAmount(value: unknown, label: string) {
    const result = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(result) || result < 0) throw new LedgerHistoryIntegrityError(`${label} is not a safe whole-rupiah amount.`);
    return result;
  }

  function historyArray(value: unknown, label: string) {
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch { throw new LedgerHistoryIntegrityError(`${label} is invalid.`); }
    }
    if (!Array.isArray(value)) throw new LedgerHistoryIntegrityError(`${label} is invalid.`);
    return value;
  }

  async function listLedgerHistory({ cursor, type = "all", limit = 30 }: { cursor?: string; type?: LedgerHistoryType; limit?: number } = {}): Promise<LedgerHistoryResult> {
    if (type !== "all" && type !== "expense" && type !== "repayment") throw new LedgerHistoryError("Ledger history type is invalid.");
    const requestedLimit = typeof limit === "number" && Number.isFinite(limit) ? Math.trunc(limit) : 30;
    const pageLimit = Math.min(50, Math.max(1, requestedLimit));
    const parsedCursor = cursor === undefined ? undefined : parseLedgerHistoryCursor(cursor);
    const typeClause = type === "all" ? sql`true` : sql`event_type = ${type}`;
    const cursorClause = parsedCursor
      ? sql`(
          effective_at < ${parsedCursor.effectiveAt} OR
          (effective_at = ${parsedCursor.effectiveAt} AND event_type > ${parsedCursor.eventType}) OR
          (effective_at = ${parsedCursor.effectiveAt} AND event_type = ${parsedCursor.eventType} AND record_id > ${parsedCursor.recordId})
        )`
      : sql`true`;
    try {
      const result = await database.execute<HistoryRow>(sql`
        WITH share_data AS (
          SELECT
            es.owner_user_id,
            es.id,
            es.expense_id,
            es.friend_id,
            es.amount_owed,
            COALESCE(SUM(ra.amount), 0) AS allocated_amount
          FROM expense_shares es
          LEFT JOIN repayment_allocations ra
            ON ra.owner_user_id = es.owner_user_id
            AND ra.expense_share_id = es.id
          WHERE es.owner_user_id = ${owner}
          GROUP BY es.owner_user_id, es.id, es.expense_id, es.friend_id, es.amount_owed
        ), expense_events AS (
          SELECT
            'expense'::text AS event_type,
            e.id AS record_id,
            o.occurred_at AS effective_at,
            e.description,
            o.title AS outing_title,
            NULL::uuid AS friend_id,
            NULL::text AS friend_name,
            e.amount AS total_amount,
            COALESCE(jsonb_agg(jsonb_build_object(
              'id', sd.id,
              'friendId', sd.friend_id,
              'amountOwed', sd.amount_owed,
              'allocatedAmount', sd.allocated_amount
            ) ORDER BY sd.id) FILTER (WHERE sd.id IS NOT NULL), '[]'::jsonb) AS shares,
            '[]'::jsonb AS allocations
          FROM expenses e
          INNER JOIN outings o
            ON o.owner_user_id = e.owner_user_id
            AND o.id = e.outing_id
          LEFT JOIN share_data sd
            ON sd.owner_user_id = e.owner_user_id
            AND sd.expense_id = e.id
          WHERE e.owner_user_id = ${owner}
          GROUP BY e.id, o.occurred_at, e.description, o.title, e.amount
        ), repayment_events AS (
          SELECT
            'repayment'::text AS event_type,
            r.id AS record_id,
            r.paid_at AS effective_at,
            NULL::text AS description,
            NULL::text AS outing_title,
            f.id AS friend_id,
            f.name AS friend_name,
            r.amount AS total_amount,
            '[]'::jsonb AS shares,
            COALESCE(jsonb_agg(jsonb_build_object(
              'expenseShareId', ra.expense_share_id,
              'amount', ra.amount,
              'friendId', sd.friend_id,
              'shareAmountOwed', sd.amount_owed,
              'shareAllocatedAmount', sd.allocated_amount
            ) ORDER BY ra.expense_share_id) FILTER (WHERE ra.expense_share_id IS NOT NULL), '[]'::jsonb) AS allocations
          FROM repayments r
          INNER JOIN friends f
            ON f.owner_user_id = r.owner_user_id
            AND f.id = r.friend_id
          LEFT JOIN repayment_allocations ra
            ON ra.owner_user_id = r.owner_user_id
            AND ra.repayment_id = r.id
          LEFT JOIN share_data sd
            ON sd.owner_user_id = r.owner_user_id
            AND sd.id = ra.expense_share_id
          WHERE r.owner_user_id = ${owner}
          GROUP BY r.id, r.paid_at, f.id, f.name, r.amount
        ), events AS (
          SELECT * FROM expense_events
          UNION ALL
          SELECT * FROM repayment_events
        )
        SELECT event_type, record_id, effective_at, description, outing_title, friend_id, friend_name, total_amount, shares, allocations
        FROM events
        WHERE ${typeClause} AND ${cursorClause}
        ORDER BY effective_at DESC, event_type ASC, record_id ASC
        LIMIT ${pageLimit + 1}
      `);

      const expenses: LedgerHistoryExpenseRecord[] = [];
      const repayments: LedgerHistoryRepaymentRecord[] = [];
      const historyRows = (Array.isArray(result) ? result : result.rows) as HistoryRow[];
      for (const row of historyRows) {
        if (row.event_type === "expense") {
          if (row.description === null || row.outing_title === null || row.total_amount === null) throw new LedgerHistoryIntegrityError("Expense history row is incomplete.");
          expenses.push({
            id: row.record_id,
            description: row.description,
            outingTitle: row.outing_title,
            outingOccurredAt: row.effective_at,
            amount: historyAmount(row.total_amount, `Expense ${row.record_id} amount`),
            shares: historyArray(row.shares, `Expense ${row.record_id} shares`) as LedgerHistoryExpenseRecord["shares"],
          });
        } else if (row.event_type === "repayment") {
          if (row.friend_id === null || row.friend_name === null || row.total_amount === null) throw new LedgerHistoryIntegrityError("Repayment history row is incomplete.");
          repayments.push({
            id: row.record_id,
            friendId: row.friend_id,
            friendName: row.friend_name,
            paidAt: row.effective_at,
            amount: historyAmount(row.total_amount, `Repayment ${row.record_id} amount`),
            allocations: historyArray(row.allocations, `Repayment ${row.record_id} allocations`) as LedgerHistoryRepaymentRecord["allocations"],
          });
        } else {
          throw new LedgerHistoryIntegrityError("Ledger history event type is invalid.");
        }
      }
      return buildLedgerHistory({ expenses, repayments }, { type, limit: pageLimit, allocationsComplete: false });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getLedgerSummary() {
    try {
      const result = await database.execute(ledgerAggregateQuery(owner));
      const [row] = (Array.isArray(result) ? result : result.rows) as LedgerAggregateRow[];
      const aggregate = parseLedgerAggregate(row ?? emptyLedgerAggregate());
      return {
        totalExpenseAmount: aggregate.totalExpenseAmount,
        totalAssignedAmount: aggregate.totalAssignedAmount,
        totalRepaidAmount: aggregate.totalRepaidAmount,
        totalReceivedAmount: aggregate.totalReceivedAmount,
        totalUnallocatedRepaymentAmount: aggregate.totalUnallocatedRepaymentAmount,
        totalOutstandingAmount: aggregate.totalOutstandingAmount,
        ownerPortionAmount: aggregate.ownerPortionAmount,
        friendBalances: aggregate.friendBalances,
      } satisfies LedgerSummary;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getLedgerOverviewSummary(): Promise<LedgerOverviewSummary> {
    try {
      const result = await database.execute(ledgerAggregateQuery(owner, 8));
      const [row] = (Array.isArray(result) ? result : result.rows) as LedgerAggregateRow[];
      return parseLedgerAggregate(row ?? emptyLedgerAggregate());
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getFriendBalances(friendIds: string[]): Promise<FriendBalance[]> {
    const normalizedIds = [...new Set(friendIds.map((friendId) => {
      assertFriendId(friendId);
      return friendId.trim().toLowerCase();
    }))];
    if (normalizedIds.length === 0) return [];
    try {
      const result = await database.execute(friendBalancesQuery(owner, normalizedIds));
      const [row] = (Array.isArray(result) ? result : result.rows) as LedgerAggregateRow[];
      return parseLedgerAggregate(row ?? emptyLedgerAggregate()).friendBalances;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getLedgerExportSnapshot(): Promise<LedgerExportSnapshot> {
    try {
      const [friendRows, expenseRows, shareRows, repaymentRows, allocationRows] = await Promise.all([
        database
          .select({ id: friends.id, name: friends.name, archivedAt: friends.archivedAt })
          .from(friends)
          .where(eq(friends.ownerUserId, owner)),
        database
          .select({
            id: expenses.id,
            description: expenses.description,
            amount: expenses.amount,
            outingTitle: outings.title,
            outingOccurredAt: outings.occurredAt,
          })
          .from(expenses)
          .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
          .where(eq(expenses.ownerUserId, owner)),
        database
          .select({ id: expenseShares.id, expenseId: expenseShares.expenseId, friendId: expenseShares.friendId, amountOwed: expenseShares.amountOwed })
          .from(expenseShares)
          .where(eq(expenseShares.ownerUserId, owner)),
        database
          .select({ id: repayments.id, friendId: repayments.friendId, amount: repayments.amount, paidAt: repayments.paidAt, paymentMethod: repayments.paymentMethod })
          .from(repayments)
          .where(eq(repayments.ownerUserId, owner)),
        database
          .select({ repaymentId: repaymentAllocations.repaymentId, expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
          .from(repaymentAllocations)
          .where(eq(repaymentAllocations.ownerUserId, owner)),
      ]);
      const snapshot = {
        friends: friendRows,
        expenses: expenseRows,
        expenseShares: shareRows,
        repayments: repaymentRows,
        repaymentAllocations: allocationRows,
      };
      validateLedgerExportSnapshot(snapshot);
      return snapshot;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listEligibleDebtorShareReceipts(friendId: string): Promise<EligibleDebtorShareReceiptGroup[]> {
    assertFriendId(friendId);
    try {
      const rows = await database
        .select({
          expenseId: expenses.id,
          expenseDescription: expenses.description,
          outingTitle: outings.title,
          id: expenseReceipts.id,
          originalFilename: expenseReceipts.originalFilename,
          mediaType: expenseReceipts.mediaType,
          createdAt: expenseReceipts.createdAt,
        })
        .from(expenseReceipts)
        .innerJoin(expenses, and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseReceipts.expenseId)))
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .innerJoin(expenseShares, and(
          eq(expenseShares.ownerUserId, owner),
          eq(expenseShares.expenseId, expenseReceipts.expenseId),
          eq(expenseShares.friendId, friendId),
        ))
        .where(eq(expenseReceipts.ownerUserId, owner))
        .orderBy(asc(outings.occurredAt), asc(expenses.createdAt), asc(expenseReceipts.createdAt), asc(expenseReceipts.id));
      const groups = new Map<string, EligibleDebtorShareReceiptGroup>();
      for (const row of rows) {
        const group = groups.get(row.expenseId) ?? { expenseId: row.expenseId, expenseDescription: row.expenseDescription, outingTitle: row.outingTitle, receipts: [] };
        group.receipts.push({ id: row.id, originalFilename: row.originalFilename, mediaType: row.mediaType, createdAt: row.createdAt });
        groups.set(row.expenseId, group);
      }
      return [...groups.values()];
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getFriendDebtorStatement(friendId: string, asOf = new Date(), debtorShareLinkId?: string) {
    assertFriendId(friendId);
    try {
      const [friend] = await database
        .select({ id: friends.id, name: friends.name })
        .from(friends)
        .where(and(eq(friends.ownerUserId, owner), eq(friends.id, friendId)))
        .limit(1);
      if (!friend) return notFound();

      const shares = await database
        .select({
          id: expenseShares.id,
          friendId: expenseShares.friendId,
          expenseId: expenseShares.expenseId,
          expenseDescription: expenses.description,
          outingTitle: outings.title,
          outingOccurredAt: outings.occurredAt,
          amountOwed: expenseShares.amountOwed,
        })
        .from(expenseShares)
        .innerJoin(expenses, and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseShares.expenseId)))
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.friendId, friendId)));

      const repaymentRows = await database
        .select({
          repaymentId: repayments.id,
          repaymentFriendId: repayments.friendId,
          repaymentAmount: repayments.amount,
          expenseShareId: repaymentAllocations.expenseShareId,
          allocationAmount: repaymentAllocations.amount,
        })
        .from(repayments)
        .leftJoin(
          repaymentAllocations,
          and(
            eq(repaymentAllocations.ownerUserId, owner),
            eq(repaymentAllocations.repaymentId, repayments.id),
          ),
        )
        .leftJoin(
          expenseShares,
          and(
            eq(expenseShares.ownerUserId, owner),
            eq(expenseShares.id, repaymentAllocations.expenseShareId),
            eq(expenseShares.friendId, friendId),
          ),
        )
        .where(and(eq(repayments.ownerUserId, owner), eq(repayments.friendId, friendId)));

      const repaymentById = new Map<string, { id: string; friendId: string; amount: number }>();
      const allocations = [] as { repaymentId: string; expenseShareId: string; amount: number }[];
      for (const row of repaymentRows) {
        repaymentById.set(row.repaymentId, {
          id: row.repaymentId,
          friendId: row.repaymentFriendId,
          amount: row.repaymentAmount,
        });
        if (row.expenseShareId !== null && row.allocationAmount !== null) {
          allocations.push({ repaymentId: row.repaymentId, expenseShareId: row.expenseShareId, amount: row.allocationAmount });
        }
      }

      const publicReceipts = debtorShareLinkId && shares.length > 0
        ? await database
            .select({ publicId: debtorShareReceipts.id, expenseId: debtorShareReceipts.expenseId, mediaType: expenseReceipts.mediaType })
            .from(debtorShareReceipts)
            .innerJoin(debtorShareLinks, and(
              eq(debtorShareLinks.id, debtorShareReceipts.debtorShareLinkId),
              eq(debtorShareLinks.ownerUserId, owner),
              isNull(debtorShareLinks.revokedAt),
              gt(debtorShareLinks.expiresAt, asOf),
            ))
            .innerJoin(expenseReceipts, and(
              eq(expenseReceipts.ownerUserId, owner),
              eq(expenseReceipts.expenseId, debtorShareReceipts.expenseId),
              eq(expenseReceipts.id, debtorShareReceipts.expenseReceiptId),
            ))
            .innerJoin(expenseShares, and(
              eq(expenseShares.ownerUserId, owner),
              eq(expenseShares.expenseId, debtorShareReceipts.expenseId),
              eq(expenseShares.friendId, friendId),
            ))
            .where(and(
              eq(debtorShareReceipts.ownerUserId, owner),
              eq(debtorShareReceipts.debtorShareLinkId, debtorShareLinkId),
              inArray(debtorShareReceipts.expenseId, shares.map((share) => share.expenseId)),
            ))
        : [];

      return buildDebtorStatement({
        friend,
        shares,
        repayments: [...repaymentById.values()],
        allocations,
        publicReceipts,
        asOf,
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getPublicFriendDebtorStatement(
    friendId: string,
    asOf = new Date(),
    debtorShareLinkId: string,
    options: DebtorStatementPageOptions = {},
  ) {
    assertFriendId(friendId);
    try {
      const assignedAmount = sql<number>`coalesce((select sum(${expenseShares.amountOwed}) from ${expenseShares} where ${expenseShares.ownerUserId} = ${owner} and ${expenseShares.friendId} = ${friendId}), 0)`.mapWith(Number);
      const repaidAmount = sql<number>`coalesce((select sum(${repaymentAllocations.amount}) from ${repaymentAllocations} where ${repaymentAllocations.ownerUserId} = ${owner} and ${repaymentAllocations.expenseShareId} in (select ${expenseShares.id} from ${expenseShares} where ${expenseShares.ownerUserId} = ${owner} and ${expenseShares.friendId} = ${friendId})), 0)`.mapWith(Number);
      const [summary] = await database
        .select({
          id: friends.id,
          name: friends.name,
          assignedAmount,
          repaidAmount,
          expenseCount: sql<number>`(select count(*) from ${expenseShares} where ${expenseShares.ownerUserId} = ${owner} and ${expenseShares.friendId} = ${friendId})`.mapWith(Number),
          repaymentCount: sql<number>`(select count(*) from ${repayments} where ${repayments.ownerUserId} = ${owner} and ${repayments.friendId} = ${friendId})`.mapWith(Number),
          invalidShareAllocations: sql<number>`(select count(*) from "expense_shares" statement_shares where statement_shares.owner_user_id = ${owner} and statement_shares.friend_id = ${friendId} and coalesce((select sum(statement_allocations.amount) from "repayment_allocations" statement_allocations where statement_allocations.owner_user_id = ${owner} and statement_allocations.expense_share_id = statement_shares.id), 0) > statement_shares.amount_owed)`.mapWith(Number),
          invalidRepaymentAllocations: sql<number>`(select count(*) from "repayments" statement_repayments where statement_repayments.owner_user_id = ${owner} and statement_repayments.friend_id = ${friendId} and coalesce((select sum(statement_allocations.amount) from "repayment_allocations" statement_allocations inner join "expense_shares" statement_shares on statement_shares.owner_user_id = statement_allocations.owner_user_id and statement_shares.id = statement_allocations.expense_share_id and statement_shares.friend_id = statement_repayments.friend_id where statement_allocations.owner_user_id = ${owner} and statement_allocations.repayment_id = statement_repayments.id), 0) > statement_repayments.amount)`.mapWith(Number),
        })
        .from(friends)
        .where(and(eq(friends.ownerUserId, owner), eq(friends.id, friendId)))
        .limit(1);
      if (!summary) return notFound();

      const assignedTotal = safeRetrievalInteger(summary.assignedAmount, "Assigned amount");
      const repaidTotal = safeRetrievalInteger(summary.repaidAmount, "Repaid amount");
      if (safeRetrievalInteger(summary.invalidShareAllocations, "Expense share allocation integrity") > 0) throw new LedgerIntegrityError("Allocations exceed an expense share.");
      if (safeRetrievalInteger(summary.invalidRepaymentAllocations, "Repayment allocation integrity") > 0) throw new LedgerIntegrityError("Allocations exceed a repayment.");
      if (repaidTotal > assignedTotal) throw new DebtorStatementIntegrityError("Repaid amount exceeds assigned amount.");
      const expenseTotalItems = safeRetrievalInteger(summary.expenseCount, "Expense share count");
      const repaymentTotalItems = safeRetrievalInteger(summary.repaymentCount, "Repayment count");
      const expensePage = clampPage(normalizePage(options.expensePage), expenseTotalItems, DEBTOR_STATEMENT_PAGE_SIZE);
      const repaymentPage = clampPage(normalizePage(options.repaymentPage), repaymentTotalItems, DEBTOR_STATEMENT_PAGE_SIZE);

      const expenseRepaidAmount = sql<number>`coalesce((select sum(${repaymentAllocations.amount}) from ${repaymentAllocations} where ${repaymentAllocations.ownerUserId} = ${owner} and ${repaymentAllocations.expenseShareId} = ${expenseShares.id}), 0)`.mapWith(Number);
      const expenseRows = await database
        .select({
          id: expenseShares.id,
          friendId: expenseShares.friendId,
          expenseId: expenseShares.expenseId,
          expenseDescription: expenses.description,
          outingTitle: outings.title,
          outingOccurredAt: outings.occurredAt,
          amountOwed: expenseShares.amountOwed,
          repaidAmount: expenseRepaidAmount,
        })
        .from(expenseShares)
        .innerJoin(expenses, and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseShares.expenseId)))
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.friendId, friendId)))
        .orderBy(
          sql`case when ${expenseRepaidAmount} < ${expenseShares.amountOwed} then 0 else 1 end`,
          desc(outings.occurredAt),
          asc(expenses.description),
          asc(expenseShares.id),
        )
        .limit(DEBTOR_STATEMENT_PAGE_SIZE)
        .offset((expensePage - 1) * DEBTOR_STATEMENT_PAGE_SIZE);

      const repaymentAllocatedAmount = sql<number>`coalesce((select sum(${repaymentAllocations.amount}) from ${repaymentAllocations} where ${repaymentAllocations.ownerUserId} = ${owner} and ${repaymentAllocations.repaymentId} = ${repayments.id} and ${repaymentAllocations.expenseShareId} in (select ${expenseShares.id} from ${expenseShares} where ${expenseShares.ownerUserId} = ${owner} and ${expenseShares.friendId} = ${friendId})), 0)`.mapWith(Number);
      const repaymentRows = await database
        .select({
          id: repayments.id,
          friendId: repayments.friendId,
          amount: repayments.amount,
          paidAt: repayments.paidAt,
          paymentMethod: repayments.paymentMethod,
          allocatedAmount: repaymentAllocatedAmount,
        })
        .from(repayments)
        .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, repayments.friendId)))
        .where(and(eq(repayments.ownerUserId, owner), eq(repayments.friendId, friendId)))
        .orderBy(desc(repayments.paidAt), desc(repayments.createdAt), asc(repayments.id))
        .limit(DEBTOR_STATEMENT_PAGE_SIZE)
        .offset((repaymentPage - 1) * DEBTOR_STATEMENT_PAGE_SIZE);

      const repaymentIds = repaymentRows.map((repayment) => repayment.id);
      const allocationRows = repaymentIds.length > 0
        ? await database
            .select({
              repaymentId: repaymentAllocations.repaymentId,
              expenseShareId: repaymentAllocations.expenseShareId,
              amount: repaymentAllocations.amount,
              expenseDescription: expenses.description,
              outingTitle: outings.title,
            })
            .from(repaymentAllocations)
            .innerJoin(expenseShares, and(
              eq(expenseShares.ownerUserId, owner),
              eq(expenseShares.id, repaymentAllocations.expenseShareId),
              eq(expenseShares.friendId, friendId),
            ))
            .innerJoin(expenses, and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseShares.expenseId)))
            .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
            .where(and(eq(repaymentAllocations.ownerUserId, owner), inArray(repaymentAllocations.repaymentId, repaymentIds)))
            .orderBy(asc(repaymentAllocations.repaymentId), desc(outings.occurredAt), asc(expenses.description), asc(expenseShares.id))
        : [];

      const expenseIds = expenseRows.map((share) => share.expenseId);
      const publicReceipts = debtorShareLinkId && expenseIds.length > 0
        ? await database
            .select({ publicId: debtorShareReceipts.id, expenseId: debtorShareReceipts.expenseId, mediaType: expenseReceipts.mediaType })
            .from(debtorShareReceipts)
            .innerJoin(debtorShareLinks, and(
              eq(debtorShareLinks.id, debtorShareReceipts.debtorShareLinkId),
              eq(debtorShareLinks.ownerUserId, owner),
              isNull(debtorShareLinks.revokedAt),
              gt(debtorShareLinks.expiresAt, asOf),
            ))
            .innerJoin(expenseReceipts, and(
              eq(expenseReceipts.ownerUserId, owner),
              eq(expenseReceipts.expenseId, debtorShareReceipts.expenseId),
              eq(expenseReceipts.id, debtorShareReceipts.expenseReceiptId),
            ))
            .innerJoin(expenseShares, and(
              eq(expenseShares.ownerUserId, owner),
              eq(expenseShares.expenseId, debtorShareReceipts.expenseId),
              eq(expenseShares.friendId, friendId),
            ))
            .where(and(
              eq(debtorShareReceipts.ownerUserId, owner),
              eq(debtorShareReceipts.debtorShareLinkId, debtorShareLinkId),
              inArray(debtorShareReceipts.expenseId, expenseIds),
            ))
            .orderBy(asc(debtorShareReceipts.id))
        : [];

      const allocationsByRepayment = new Map<string, typeof allocationRows>();
      for (const allocation of allocationRows) {
        const allocations = allocationsByRepayment.get(allocation.repaymentId) ?? [];
        allocations.push(allocation);
        allocationsByRepayment.set(allocation.repaymentId, allocations);
      }
      return buildPagedDebtorStatement({
        friend: { id: summary.id, name: summary.name },
        shares: expenseRows,
        repayments: repaymentRows.map((repayment) => ({
          ...repayment,
          allocations: allocationsByRepayment.get(repayment.id) ?? [],
        })),
        publicReceipts,
        assignedAmount: assignedTotal,
        repaidAmount: repaidTotal,
        expensePage: { page: expensePage, totalItems: expenseTotalItems },
        repaymentPage: { page: repaymentPage, totalItems: repaymentTotalItems },
        asOf,
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function updateExpense(expenseId: string, input: UpdateExpenseInput) {
    assertExpenseId(expenseId);
    assertExpenseInput(input);
    try {
      return await database.transaction(async (transaction) => {
        const [currentExpense] = await transaction
          .select({ id: expenses.id, amount: expenses.amount })
          .from(expenses)
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
          .limit(1)
          .for("update");
        if (!currentExpense) return notFound();

        const currentShares = await transaction
          .select({ amountOwed: expenseShares.amountOwed })
          .from(expenseShares)
          .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.expenseId, expenseId)));
        const assignedTotal = currentShares.reduce((total, share) => total + share.amountOwed, 0);
        if (input.amount < assignedTotal) throw new ExpenseShareInvariantError();

        await assertOwnedOuting(transaction, input.outingId);
        const [expense] = await transaction
          .update(expenses)
          .set({ ...input, updatedAt: new Date() })
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
          .returning();
        if (!expense) return notFound();
        const [updated] = await transaction
          .select(expenseSelection())
          .from(expenses)
          .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
          .limit(1);
        if (!updated) return persistenceError(new Error("expense update returned no row"));
        return updated;
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getExpenseDeletionImpact(expenseId: string): Promise<ExpenseDeletionImpact> {
    assertExpenseId(expenseId);
    try {
      const [expense] = await database
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
        .limit(1);
      if (!expense) return notFound();
      const [receiptRows, shareRows] = await Promise.all([
        database.select({ id: expenseReceipts.id }).from(expenseReceipts).where(and(eq(expenseReceipts.ownerUserId, owner), eq(expenseReceipts.expenseId, expenseId))),
        database.select({ id: expenseShares.id, friendId: expenseShares.friendId }).from(expenseShares).where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.expenseId, expenseId))),
      ]);
      const shareIds = safeDeletionIds(shareRows.map((share) => share.id), "Expense share ID");
      const allocationRows = shareIds.length
        ? await database.select({ repaymentId: repaymentAllocations.repaymentId }).from(repaymentAllocations).where(and(eq(repaymentAllocations.ownerUserId, owner), inArray(repaymentAllocations.expenseShareId, shareIds)))
        : [];
      const affectedRepaymentIds = safeDeletionIds(allocationRows.map((allocation) => allocation.repaymentId), "Affected repayment ID");
      return {
        recordType: "expense",
        receiptCount: safeRetrievalInteger(receiptRows.length, "Expense receipt count"),
        shareCount: safeRetrievalInteger(shareRows.length, "Expense share count"),
        allocationCount: safeRetrievalInteger(allocationRows.length, "Expense allocation count"),
        affectedRepaymentCount: safeRetrievalInteger(affectedRepaymentIds.length, "Affected repayment count"),
        affectedRepaymentIds,
        affectedFriendIds: safeDeletionIds(shareRows.map((share) => share.friendId), "Affected friend ID"),
      };
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function deleteExpense(expenseId: string, options: DeleteRecordOptions = { cascadeDependents: false }) {
    assertExpenseId(expenseId);
    assertDeleteOptions(options);
    try {
      return await database.transaction(async (transaction) => {
        const [expense] = await transaction
          .select({ id: expenses.id })
          .from(expenses)
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
          .limit(1)
          .for("update");
        if (!expense) return notFound();
        const dependents = await lockExpenseDependents(transaction, [expenseId]);
        const affectedRepaymentIds = safeDeletionIds(dependents.allocations.map((allocation) => allocation.repaymentId), "Affected repayment ID");
        const impact: ExpenseDeletionImpact = {
          recordType: "expense",
          receiptCount: safeRetrievalInteger(dependents.receipts.length, "Expense receipt count"),
          shareCount: safeRetrievalInteger(dependents.shares.length, "Expense share count"),
          allocationCount: safeRetrievalInteger(dependents.allocations.length, "Expense allocation count"),
          affectedRepaymentCount: safeRetrievalInteger(affectedRepaymentIds.length, "Affected repayment count"),
          affectedRepaymentIds,
          affectedFriendIds: safeDeletionIds(dependents.shares.map((share) => share.friendId), "Affected friend ID"),
        };
        assertDeletionConfirmation(impact, options, ExpenseDeletionInvariantError);
        const deleted = await transaction
          .delete(expenses)
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
          .returning({ id: expenses.id });
        if (deleted.length === 0) return notFound();
        return { friendIds: impact.affectedFriendIds, repaymentIds: impact.affectedRepaymentIds };
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  function shareSelection() {
    return {
      id: expenseShares.id,
      friendId: friends.id,
      friendName: friends.name,
      friendArchivedAt: friends.archivedAt,
      baseAmount: expenseShares.baseAmount,
      amountOwed: expenseShares.amountOwed,
    };
  }

  async function listExpenseChargesFor(transaction: Pick<Database, "select">, expenseId: string): Promise<ExpenseChargeRecord[]> {
    const rows = await transaction
      .select({
        id: expenseCharges.id,
        name: expenseCharges.name,
        percentageBasisPoints: expenseCharges.percentageBasisPoints,
        scope: expenseCharges.scope,
        targetFriendId: expenseShares.friendId,
      })
      .from(expenseCharges)
      .leftJoin(expenseChargeTargets, and(
        eq(expenseChargeTargets.ownerUserId, owner),
        eq(expenseChargeTargets.expenseId, expenseId),
        eq(expenseChargeTargets.expenseChargeId, expenseCharges.id),
      ))
      .leftJoin(expenseShares, and(
        eq(expenseShares.ownerUserId, owner),
        eq(expenseShares.expenseId, expenseId),
        eq(expenseShares.id, expenseChargeTargets.expenseShareId),
      ))
      .where(and(eq(expenseCharges.ownerUserId, owner), eq(expenseCharges.expenseId, expenseId)))
      .orderBy(asc(expenseCharges.createdAt), asc(expenseCharges.id), asc(expenseShares.friendId));
    const charges = new Map<string, ExpenseChargeRecord>();
    for (const row of rows) {
      const charge = charges.get(row.id) ?? {
        id: row.id,
        name: row.name,
        percentageBasisPoints: row.percentageBasisPoints,
        scope: row.scope as ExpenseChargeInput["scope"],
        friendIds: [],
      };
      if (row.targetFriendId) charge.friendIds.push(row.targetFriendId);
      charges.set(row.id, charge);
    }
    return [...charges.values()];
  }

  async function listExpenseSharesFor(transaction: Pick<Database, "select">, expenseId: string) {
    const allocationTotals = transaction
      .select({
        ownerUserId: repaymentAllocations.ownerUserId,
        expenseShareId: repaymentAllocations.expenseShareId,
        appliedAmount: sql<number>`sum(${repaymentAllocations.amount})`.mapWith(Number).as("applied_amount"),
      })
      .from(repaymentAllocations)
      .where(eq(repaymentAllocations.ownerUserId, owner))
      .groupBy(repaymentAllocations.ownerUserId, repaymentAllocations.expenseShareId)
      .as("expense_share_allocations");
    const appliedAmount = sql<number>`coalesce(${allocationTotals.appliedAmount}, 0)`.mapWith(Number);
    const rows = await transaction
      .select({ ...shareSelection(), appliedAmount })
      .from(expenseShares)
      .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, expenseShares.friendId)))
      .leftJoin(allocationTotals, and(eq(allocationTotals.ownerUserId, owner), eq(allocationTotals.expenseShareId, expenseShares.id)))
      .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.expenseId, expenseId)))
      .orderBy(asc(friends.name), asc(expenseShares.id));
    return rows.map((share) => {
      if (share.appliedAmount > share.amountOwed) throw new LedgerIntegrityError(`Allocations exceed expense share ${share.id}.`);
      return { ...share, remainingAmount: share.amountOwed - share.appliedAmount, settled: share.appliedAmount === share.amountOwed };
    });
  }

  async function listExpenseShares(expenseId: string) {
    assertExpenseId(expenseId);
    try {
      const [expense] = await database
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
        .limit(1);
      if (!expense) return notFound();
      return await listExpenseSharesFor(database, expenseId);
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listExpenseCharges(expenseId: string) {
    assertExpenseId(expenseId);
    try {
      const [expense] = await database
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
        .limit(1);
      if (!expense) return notFound();
      return await listExpenseChargesFor(database, expenseId);
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getPreviousExpenseSplit(expenseId: string): Promise<ExpenseSplitDefinition | null> {
    assertExpenseId(expenseId);
    try {
      const [current] = await database
        .select({ outingId: expenses.outingId })
        .from(expenses)
        .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
        .limit(1);
      if (!current) return notFound();

      const [previous] = await database
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(
          eq(expenses.ownerUserId, owner),
          eq(expenses.outingId, current.outingId),
          ne(expenses.id, expenseId),
          sql`exists (select 1 from ${expenseShares} previous_shares where previous_shares.owner_user_id = ${owner} and previous_shares.expense_id = ${expenses.id})`,
        ))
        .orderBy(desc(expenses.createdAt), asc(expenses.id))
        .limit(1);
      if (!previous) return null;

      const [friendRows, charges] = await Promise.all([
        database
          .select({ friendId: friends.id, friendName: friends.name, friendArchivedAt: friends.archivedAt, baseAmount: expenseShares.baseAmount })
          .from(expenseShares)
          .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, expenseShares.friendId)))
          .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.expenseId, previous.id)))
          .orderBy(asc(friends.name), asc(expenseShares.id)),
        listExpenseChargesFor(database, previous.id),
      ]);

      return {
        friends: friendRows,
        charges: charges.map(({ name, percentageBasisPoints, scope, friendIds }) => ({ name, percentageBasisPoints, scope, friendIds })),
      };
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listOpenExpenseSharesByFriend(friendId?: string): Promise<OpenExpenseSharesByFriend> {
    if (friendId) assertFriendId(friendId);
    try {
      const shares = await database
        .select({
          id: expenseShares.id,
          friendId: friends.id,
          friendName: friends.name,
          expenseDescription: expenses.description,
          outingTitle: outings.title,
          outingOccurredAt: outings.occurredAt,
          amountOwed: expenseShares.amountOwed,
        })
        .from(expenseShares)
        .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, expenseShares.friendId)))
        .innerJoin(expenses, and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseShares.expenseId)))
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .where(and(eq(expenseShares.ownerUserId, owner), ...(friendId ? [eq(expenseShares.friendId, friendId)] : [])))
        .orderBy(asc(friends.name), asc(outings.occurredAt), asc(expenses.createdAt), asc(expenseShares.id));
      const allocations = shares.length
        ? await database
            .select({ expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
            .from(repaymentAllocations)
            .where(and(eq(repaymentAllocations.ownerUserId, owner), inArray(repaymentAllocations.expenseShareId, shares.map((share) => share.id))))
        : [];
      const repaidByShare = new Map<string, number>();
      for (const allocation of allocations) {
        if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) throw new LedgerIntegrityError(`Allocation for share ${allocation.expenseShareId} is invalid.`);
        const total = (repaidByShare.get(allocation.expenseShareId) ?? 0) + allocation.amount;
        if (!Number.isSafeInteger(total)) throw new LedgerIntegrityError(`Allocation for share ${allocation.expenseShareId} is unsafe.`);
        repaidByShare.set(allocation.expenseShareId, total);
      }
      const grouped: OpenExpenseSharesByFriend = {};
      for (const share of shares) {
        const repaidAmount = repaidByShare.get(share.id) ?? 0;
        const remainingAmount = share.amountOwed - repaidAmount;
        if (remainingAmount < 0) throw new LedgerIntegrityError(`Allocations exceed expense share ${share.id}.`);
        if (remainingAmount > 0) (grouped[share.friendId] ??= []).push({ ...share, repaidAmount, remainingAmount });
      }
      return grouped;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getRepaymentFriendContext(friendId: string, includeOpenExpenseShares = false): Promise<RepaymentFriendContext> {
    assertFriendId(friendId);
    const [friend, balances, shares] = await Promise.all([
      getFriend(friendId),
      getFriendBalances([friendId]),
      includeOpenExpenseShares ? listOpenExpenseSharesByFriend(friendId) : Promise.resolve({} as OpenExpenseSharesByFriend),
    ]);
    return {
      option: { id: friend.id, name: friend.name, archived: friend.archivedAt !== null },
      outstandingAmount: balances[0]?.outstandingAmount ?? 0,
      openExpenseShares: shares[friendId] ?? [],
    };
  }

  async function replaceExpenseShares(expenseId: string, shares: ExpenseShareInput[], charges?: ExpenseChargeInput[]) {
    assertExpenseId(expenseId);
    assertExpenseSharesInput(shares);
    if (charges !== undefined) assertExpenseChargesInput(charges);
    try {
      return await database.transaction(async (transaction) => {
        const [expense] = await transaction
          .select({ id: expenses.id, amount: expenses.amount })
          .from(expenses)
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
          .limit(1)
          .for("update");
        if (!expense) return notFound();

        const currentShares = await transaction
          .select({ id: expenseShares.id, friendId: expenseShares.friendId, baseAmount: expenseShares.baseAmount, amountOwed: expenseShares.amountOwed })
          .from(expenseShares)
          .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.expenseId, expenseId)));
        const currentByFriend = new Map(currentShares.map((share) => [share.friendId, share]));
        const requested = shares.map((share) => ({ friendId: share.friendId.trim().toLowerCase(), baseAmount: shareBaseAmount(share) }));
        const storedCharges = charges === undefined ? await listExpenseChargesFor(transaction, expenseId) : [];
        const requestedCharges: ExpenseChargeInput[] = charges ?? storedCharges.map(({ name, percentageBasisPoints, scope, friendIds }) => ({ name, percentageBasisPoints, scope, friendIds }));

        const friendIds = requested.map((share) => share.friendId);
        const ownedFriends = friendIds.length
          ? await transaction
              .select({ id: friends.id, archivedAt: friends.archivedAt })
              .from(friends)
              .where(and(eq(friends.ownerUserId, owner), inArray(friends.id, friendIds)))
          : [];
        if (ownedFriends.length !== new Set(friendIds).size) return notFound();
        for (const friend of ownedFriends) {
          if (friend.archivedAt !== null && !currentByFriend.has(friend.id)) {
            throw new LedgerRepositoryError("INVALID_INPUT", "Archived friends cannot be newly assigned.");
          }
        }
        const requestedFriendIds = new Set(friendIds);
        for (const charge of requestedCharges) {
          if (charge.scope === "selected" && charge.friendIds.some((friendId) => !requestedFriendIds.has(friendId.toLowerCase()))) {
            throw new LedgerRepositoryError("INVALID_INPUT", "Selected charge targets must have a share amount.");
          }
        }
        const finalByFriend = new Map(requested.map((share) => {
          try {
            return [share.friendId, calculateShareBreakdown(share.baseAmount, requestedCharges, share.friendId).finalAmount] as const;
          } catch {
            throw new LedgerRepositoryError("INVALID_INPUT", "The final share amount is too large.");
          }
        }));
        const total = [...finalByFriend.values()].reduce((sum, amount) => sum + amount, 0);
        if (total > expense.amount) throw new ExpenseShareInvariantError();

        const allocationTotals = currentShares.length
          ? await transaction
              .select({ expenseShareId: repaymentAllocations.expenseShareId, amount: sql<number>`coalesce(sum(${repaymentAllocations.amount}), 0)` })
              .from(repaymentAllocations)
              .where(and(eq(repaymentAllocations.ownerUserId, owner), inArray(repaymentAllocations.expenseShareId, currentShares.map((share) => share.id))))
              .groupBy(repaymentAllocations.expenseShareId)
          : [];
        const allocatedByShare = new Map(allocationTotals.map((allocation) => [allocation.expenseShareId, Number(allocation.amount)]));
        for (const requestedShare of requested) {
          const current = currentByFriend.get(requestedShare.friendId);
          if (current && finalByFriend.get(requestedShare.friendId)! < (allocatedByShare.get(current.id) ?? 0)) {
            throw new ExpenseShareAllocationInvariantError();
          }
        }

        const requestedByFriend = new Map(requested.map((share) => [share.friendId, share]));
        for (const current of currentShares) {
          const requestedShare = requestedByFriend.get(current.friendId);
          if (requestedShare === undefined) continue;
          const amountOwed = finalByFriend.get(current.friendId)!;
          if (requestedShare.baseAmount !== current.baseAmount || amountOwed !== current.amountOwed) {
            await transaction
              .update(expenseShares)
              .set({ baseAmount: requestedShare.baseAmount, amountOwed })
              .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.id, current.id)));
          }
        }

        const newShares = requested.filter((share) => !currentByFriend.has(share.friendId));
        if (newShares.length > 0) {
          await transaction.insert(expenseShares).values(
            newShares.map((share) => ({ ownerUserId: owner, expenseId, friendId: share.friendId, baseAmount: share.baseAmount, amountOwed: finalByFriend.get(share.friendId)! })),
          );
        }

        const omittedIds = currentShares.filter((share) => !requestedByFriend.has(share.friendId)).map((share) => share.id);
        if (omittedIds.length > 0) {
          await transaction
            .delete(expenseShares)
            .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.expenseId, expenseId), inArray(expenseShares.id, omittedIds)));
        }

        if (charges !== undefined) {
          await transaction.delete(expenseCharges).where(and(eq(expenseCharges.ownerUserId, owner), eq(expenseCharges.expenseId, expenseId)));
          const shareRows = requested.length
            ? await transaction
                .select({ id: expenseShares.id, friendId: expenseShares.friendId })
                .from(expenseShares)
                .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.expenseId, expenseId)))
            : [];
          const shareIdByFriend = new Map(shareRows.map((share) => [share.friendId, share.id]));
          const createdCharges = requestedCharges.length
            ? await transaction
                .insert(expenseCharges)
                .values(requestedCharges.map((charge) => ({ ownerUserId: owner, expenseId, name: charge.name.trim(), percentageBasisPoints: charge.percentageBasisPoints, scope: charge.scope })))
                .returning({ id: expenseCharges.id })
            : [];
          const targetRows = requestedCharges.flatMap((charge, index) => charge.scope === "selected"
            ? charge.friendIds.map((friendId) => ({ ownerUserId: owner, expenseId, expenseChargeId: createdCharges[index]!.id, expenseShareId: shareIdByFriend.get(friendId.toLowerCase())! }))
            : []);
          if (targetRows.length > 0) await transaction.insert(expenseChargeTargets).values(targetRows);
        }

        return await listExpenseSharesFor(transaction, expenseId);
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  function repaymentSelection() {
    return {
      id: repayments.id,
      ownerUserId: repayments.ownerUserId,
      friendId: repayments.friendId,
      amount: repayments.amount,
      paidAt: repayments.paidAt,
      paymentMethod: repayments.paymentMethod,
      notes: repayments.notes,
      createdAt: repayments.createdAt,
      friendName: friends.name,
      friendArchivedAt: friends.archivedAt,
    };
  }

  async function withRepaymentTotals(
    transaction: Pick<Database, "select">,
    rows: RepaymentRecord[],
    repaymentId?: string,
  ) {
    const allocations = await transaction
      .select({ repaymentId: repaymentAllocations.repaymentId, amount: repaymentAllocations.amount })
      .from(repaymentAllocations)
      .where(
        repaymentId
          ? and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.repaymentId, repaymentId))
          : eq(repaymentAllocations.ownerUserId, owner),
      );
    const allocatedByRepayment = new Map<string, number>();
    for (const allocation of allocations) {
      if (!Number.isSafeInteger(allocation.amount) || allocation.amount < 0) {
        throw new LedgerIntegrityError(`Allocated amount for repayment ${allocation.repaymentId} is invalid.`);
      }
      const total = (allocatedByRepayment.get(allocation.repaymentId) ?? 0) + allocation.amount;
      if (!Number.isSafeInteger(total)) throw new LedgerIntegrityError(`Allocated amount for repayment ${allocation.repaymentId} is unsafe.`);
      allocatedByRepayment.set(allocation.repaymentId, total);
    }
    return rows.map((repayment) => {
      if (!Number.isSafeInteger(repayment.amount) || repayment.amount < 0) {
        throw new LedgerIntegrityError(`Repayment ${repayment.id} amount is invalid.`);
      }
      const allocatedAmount = allocatedByRepayment.get(repayment.id) ?? 0;
      if (allocatedAmount > repayment.amount) throw new LedgerIntegrityError(`Allocations exceed repayment ${repayment.id}.`);
      return {
        ...repayment,
        allocatedAmount,
        unallocatedAmount: repayment.amount - allocatedAmount,
      };
    });
  }

  async function assertOwnedFriend(transaction: Pick<Database, "select">, friendId: string) {
    const [friend] = await transaction
      .select({ id: friends.id })
      .from(friends)
      .where(and(eq(friends.ownerUserId, owner), eq(friends.id, friendId)))
      .limit(1);
    if (!friend) return notFound();
  }

  async function createRepayment(input: CreateRepaymentInput) {
    assertRepaymentInput(input);
    const requested = { ...input, friendId: input.friendId.trim().toLowerCase() };
    try {
      return await database.transaction(async (transaction) => {
        await assertOwnedFriend(transaction, requested.friendId);
        const [repayment] = await transaction.insert(repayments).values({ ...requested, ownerUserId: owner }).returning();
        if (!repayment) return persistenceError(new Error("repayment insert returned no row"));
        return repayment;
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function lockOwnedFriend(transaction: Pick<Database, "select">, friendId: string) {
    const [friend] = await transaction
      .select({ id: friends.id })
      .from(friends)
      .where(and(eq(friends.ownerUserId, owner), eq(friends.id, friendId)))
      .limit(1)
      .for("update");
    if (!friend) return notFound();
  }

  async function createRepaymentWithAllocations(input: CreateRepaymentInput, allocations: RepaymentAllocationInput[]) {
    assertRepaymentInput(input);
    assertRepaymentAllocationsInput(allocations);
    const requested = { ...input, friendId: input.friendId.trim().toLowerCase() };
    const normalizedAllocations = allocations.map((allocation) => ({ ...allocation, expenseShareId: allocation.expenseShareId.trim().toLowerCase() }));
    try {
      return await database.transaction(async (transaction) => {
        await lockOwnedFriend(transaction, requested.friendId);
        const shareIds = normalizedAllocations.map((allocation) => allocation.expenseShareId).sort();
        const lockedShares = shareIds.length
          ? await transaction
              .select({ id: expenseShares.id, friendId: expenseShares.friendId, amountOwed: expenseShares.amountOwed })
              .from(expenseShares)
              .where(and(eq(expenseShares.ownerUserId, owner), inArray(expenseShares.id, shareIds)))
              .orderBy(asc(expenseShares.id))
              .for("update")
          : [];
        if (lockedShares.length !== shareIds.length || lockedShares.some((share) => share.friendId !== requested.friendId)) return notFound();
        const existingAllocations = shareIds.length
          ? await transaction
              .select({ expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
              .from(repaymentAllocations)
              .where(and(eq(repaymentAllocations.ownerUserId, owner), inArray(repaymentAllocations.expenseShareId, shareIds)))
              .orderBy(asc(repaymentAllocations.expenseShareId), asc(repaymentAllocations.repaymentId))
              .for("update")
          : [];
        const allocatedByShare = new Map<string, number>();
        for (const allocation of existingAllocations) {
          if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) throw new LedgerIntegrityError(`Allocation for share ${allocation.expenseShareId} is invalid.`);
          const total = (allocatedByShare.get(allocation.expenseShareId) ?? 0) + allocation.amount;
          if (!Number.isSafeInteger(total)) throw new LedgerIntegrityError(`Allocation for share ${allocation.expenseShareId} is unsafe.`);
          allocatedByShare.set(allocation.expenseShareId, total);
        }
        const requestedTotal = normalizedAllocations.reduce((total, allocation) => total + allocation.amount, 0);
        if (!Number.isSafeInteger(requestedTotal) || requestedTotal > requested.amount) throw new RepaymentAllocationAmountInvariantError();
        const shareById = new Map(lockedShares.map((share) => [share.id, share]));
        for (const allocation of normalizedAllocations) {
          const share = shareById.get(allocation.expenseShareId);
          if (!share) return notFound();
          if (allocation.amount > share.amountOwed - (allocatedByShare.get(share.id) ?? 0)) throw new RepaymentAllocationShareInvariantError();
        }
        const [repayment] = await transaction.insert(repayments).values({ ...requested, ownerUserId: owner }).returning();
        if (!repayment) return persistenceError(new Error("repayment insert returned no row"));
        if (normalizedAllocations.length > 0) {
          await transaction.insert(repaymentAllocations).values(normalizedAllocations.map((allocation) => ({ ownerUserId: owner, repaymentId: repayment.id, ...allocation })));
        }
        return repayment;
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getRepayment(repaymentId: string) {
    assertRepaymentId(repaymentId);
    try {
      const [repayment] = await database
        .select(repaymentSelection())
        .from(repayments)
        .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, repayments.friendId)))
        .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
        .limit(1);
      if (!repayment) return notFound();
      return (await withRepaymentTotals(database, [repayment], repaymentId))[0]!;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listRepayments() {
    try {
      const rows = await database
        .select(repaymentSelection())
        .from(repayments)
        .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, repayments.friendId)))
        .where(eq(repayments.ownerUserId, owner))
        .orderBy(desc(repayments.paidAt), desc(repayments.createdAt), asc(repayments.id));
      return await withRepaymentTotals(database, rows);
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listRepaymentRecords(options: { q?: unknown; friendId?: unknown; month?: unknown; allocation?: unknown; page?: unknown; timezoneOffsetMinutes?: unknown } = {}): Promise<RecordPage<RepaymentListRecord>> {
    const filters = normalizeRepaymentFilters(options);
    const timezoneOffsetMinutes = normalizeTimezoneOffset(options.timezoneOffsetMinutes) ?? 0;
    const allocationValue = sql<number>`coalesce((select sum(${repaymentAllocations.amount}) from ${repaymentAllocations} where ${repaymentAllocations.ownerUserId} = ${owner} and ${repaymentAllocations.repaymentId} = ${repayments.id}), 0)`.mapWith(Number);
    const allocationCondition = filters.allocation === "all"
      ? undefined
      : filters.allocation === "complete"
        ? sql`${allocationValue} >= ${repayments.amount}`
        : sql`${allocationValue} < ${repayments.amount}`;
    const conditions = [
      eq(repayments.ownerUserId, owner),
      eq(friends.ownerUserId, owner),
      ...(filters.q ? [sql`(${literalContains(friends.name, filters.q)} OR ${literalContains(repayments.paymentMethod, filters.q)})`] : []),
      ...(filters.friendId ? [eq(repayments.friendId, filters.friendId)] : []),
      ...(filters.month ? [gte(repayments.paidAt, monthStart(filters.month, timezoneOffsetMinutes)), lt(repayments.paidAt, nextMonthStart(filters.month, timezoneOffsetMinutes))] : []),
      ...(allocationCondition ? [allocationCondition] : []),
    ];
    try {
      const [{ count = 0 } = {}] = await database
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(repayments)
        .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, repayments.friendId)))
        .where(and(...conditions));
      const totalItems = safeRetrievalInteger(count, "Repayment count");
      const page = clampPage(filters.page, totalItems);
      const pageRepayments = database
        .select({ id: repayments.id, ownerUserId: repayments.ownerUserId, allocatedAmount: allocationValue.as("allocated_amount") })
        .from(repayments)
        .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, repayments.friendId)))
        .where(and(...conditions))
        .orderBy(desc(repayments.paidAt), desc(repayments.createdAt), asc(repayments.id))
        .limit(RECORD_PAGE_SIZE)
        .offset((page - 1) * RECORD_PAGE_SIZE)
        .as("repayment_page");
      const rows = await database
        .select({ ...repaymentSelection(), allocatedAmount: pageRepayments.allocatedAmount })
        .from(repayments)
        .innerJoin(pageRepayments, and(eq(pageRepayments.id, repayments.id), eq(pageRepayments.ownerUserId, repayments.ownerUserId)))
        .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, repayments.friendId)))
        .where(eq(repayments.ownerUserId, owner))
        .orderBy(desc(repayments.paidAt), desc(repayments.createdAt), asc(repayments.id));
      const items = rows.map(({ allocatedAmount, ...repayment }) => {
        const allocated = safeRetrievalInteger(allocatedAmount ?? 0, `Allocation for repayment ${repayment.id}`);
        if (!Number.isSafeInteger(repayment.amount) || repayment.amount < 0 || allocated > repayment.amount) {
          throw new LedgerIntegrityError(`Allocations exceed repayment ${repayment.id}.`);
        }
        return { ...repayment, allocatedAmount: allocated, unallocatedAmount: repayment.amount - allocated };
      });
      return pageResult(items, totalItems, page);
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function updateRepayment(repaymentId: string, input: UpdateRepaymentInput) {
    assertRepaymentId(repaymentId);
    assertRepaymentInput(input);
    const requested = { ...input, friendId: input.friendId.trim().toLowerCase() };
    try {
      return await database.transaction(async (transaction) => {
        const [current] = await transaction
          .select({ id: repayments.id, friendId: repayments.friendId, amount: repayments.amount })
          .from(repayments)
          .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
          .limit(1)
          .for("update");
        if (!current) return notFound();

        const allocations = await transaction
          .select({ amount: repaymentAllocations.amount })
          .from(repaymentAllocations)
          .where(and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.repaymentId, repaymentId)))
          .for("update");
        if (!Number.isSafeInteger(current.amount) || current.amount < 0) throw new LedgerIntegrityError(`Repayment ${repaymentId} amount is invalid.`);
        let allocatedAmount = 0;
        for (const allocation of allocations) {
          if (!Number.isSafeInteger(allocation.amount) || allocation.amount < 0) {
            throw new LedgerIntegrityError(`Allocated amount for repayment ${repaymentId} is invalid.`);
          }
          allocatedAmount += allocation.amount;
          if (!Number.isSafeInteger(allocatedAmount)) throw new LedgerIntegrityError(`Allocated amount for repayment ${repaymentId} is unsafe.`);
        }
        if (allocatedAmount > current.amount) throw new LedgerIntegrityError(`Allocations exceed repayment ${repaymentId}.`);
        if (requested.amount < allocatedAmount) throw new RepaymentAmountInvariantError();
        if (allocations.length > 0 && requested.friendId !== current.friendId) throw new RepaymentFriendInvariantError();

        await assertOwnedFriend(transaction, requested.friendId);
        const [repayment] = await transaction
          .update(repayments)
          .set(requested)
          .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
          .returning();
        if (!repayment) return notFound();

        const [updated] = await transaction
          .select(repaymentSelection())
          .from(repayments)
          .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, repayments.friendId)))
          .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
          .limit(1);
        if (!updated) return persistenceError(new Error("repayment update lookup returned no row"));
        return (await withRepaymentTotals(transaction, [updated], repaymentId))[0]!;
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getRepaymentDeletionImpact(repaymentId: string): Promise<RepaymentDeletionImpact> {
    assertRepaymentId(repaymentId);
    try {
      const [repayment] = await database
        .select({ id: repayments.id, friendId: repayments.friendId })
        .from(repayments)
        .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
        .limit(1);
      if (!repayment) return notFound();
      const allocations = await database
        .select({ expenseShareId: repaymentAllocations.expenseShareId })
        .from(repaymentAllocations)
        .where(and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.repaymentId, repaymentId)));
      const [friendId] = safeDeletionIds([repayment.friendId], "Affected friend ID");
      return {
        recordType: "repayment",
        allocationCount: safeRetrievalInteger(allocations.length, "Repayment allocation count"),
        friendId,
      };
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function deleteRepayment(repaymentId: string, options: DeleteRecordOptions = { cascadeDependents: false }) {
    assertRepaymentId(repaymentId);
    assertDeleteOptions(options);
    try {
      return await database.transaction(async (transaction) => {
        const [repayment] = await transaction
          .select({ id: repayments.id, friendId: repayments.friendId })
          .from(repayments)
          .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
          .limit(1)
          .for("update");
        if (!repayment) return notFound();
        const allocations = await transaction
          .select({ expenseShareId: repaymentAllocations.expenseShareId })
          .from(repaymentAllocations)
          .where(and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.repaymentId, repaymentId)))
          .orderBy(asc(repaymentAllocations.expenseShareId))
          .for("update");
        const [friendId] = safeDeletionIds([repayment.friendId], "Affected friend ID");
        const impact: RepaymentDeletionImpact = {
          recordType: "repayment",
          allocationCount: safeRetrievalInteger(allocations.length, "Repayment allocation count"),
          friendId,
        };
        assertDeletionConfirmation(impact, options, RepaymentDeletionInvariantError);
        const deleted = await transaction
          .delete(repayments)
          .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
          .returning({ id: repayments.id });
        if (deleted.length === 0) return notFound();
        return { friendIds: [friendId], repaymentIds: [] as string[] };
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function removeRepaymentAllocation(repaymentId: string, expenseShareId: string) {
    assertRepaymentId(repaymentId);
    if (typeof expenseShareId !== "string" || !expenseShareId.trim()) {
      throw new LedgerRepositoryError("INVALID_INPUT", "An expense share ID is required");
    }
    const shareId = expenseShareId.trim().toLowerCase();
    try {
      return await database.transaction(async (transaction) => {
        const [repayment] = await transaction
          .select({ id: repayments.id, friendId: repayments.friendId })
          .from(repayments)
          .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
          .limit(1)
          .for("update");
        if (!repayment) return notFound();

        const [share] = await transaction
          .select({ id: expenseShares.id, expenseId: expenseShares.expenseId, friendId: expenseShares.friendId })
          .from(expenseShares)
          .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.id, shareId)))
          .limit(1)
          .for("update");
        if (!share || share.friendId !== repayment.friendId) return notFound();

        const [allocation] = await transaction
          .select({ repaymentId: repaymentAllocations.repaymentId, expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
          .from(repaymentAllocations)
          .where(and(
            eq(repaymentAllocations.ownerUserId, owner),
            eq(repaymentAllocations.repaymentId, repayment.id),
            eq(repaymentAllocations.expenseShareId, share.id),
          ))
          .limit(1)
          .for("update");
        if (!allocation) return notFound();
        if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) {
          throw new LedgerIntegrityError(`Allocation for repayment ${repaymentId} is invalid.`);
        }

        const [deleted] = await transaction
          .delete(repaymentAllocations)
          .where(and(
            eq(repaymentAllocations.ownerUserId, owner),
            eq(repaymentAllocations.repaymentId, allocation.repaymentId),
            eq(repaymentAllocations.expenseShareId, allocation.expenseShareId),
          ))
          .returning({ repaymentId: repaymentAllocations.repaymentId, expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount });
        if (!deleted) return notFound();

        const reversalReceipt: RepaymentAllocationReversalReceipt = {
          version: 1,
          reversalId: randomUUID(),
          allocationId: repaymentAllocationId(deleted.repaymentId, deleted.expenseShareId),
          repaymentId: deleted.repaymentId,
          expenseShareId: deleted.expenseShareId,
          friendId: share.friendId,
          amount: deleted.amount,
        };
        return { expenseId: share.expenseId, friendId: share.friendId, repaymentId: repayment.id, reversalReceipt };
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function undoRepaymentAllocation(receipt: RepaymentAllocationReversalReceipt) {
    assertRepaymentAllocationReversalReceipt(receipt);
    try {
      return await database.transaction(async (transaction) => {
        const [repayment] = await transaction
          .select({ id: repayments.id, friendId: repayments.friendId, amount: repayments.amount })
          .from(repayments)
          .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, receipt.repaymentId)))
          .limit(1)
          .for("update");
        if (!repayment) return notFound();

        const [share] = await transaction
          .select({ id: expenseShares.id, expenseId: expenseShares.expenseId, friendId: expenseShares.friendId, amountOwed: expenseShares.amountOwed })
          .from(expenseShares)
          .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.id, receipt.expenseShareId)))
          .limit(1)
          .for("update");
        if (!share) return notFound();
        if (
          repayment.friendId !== receipt.friendId ||
          share.friendId !== receipt.friendId ||
          repayment.friendId !== share.friendId
        ) return notFound();

        const [existing] = await transaction
          .select({ repaymentId: repaymentAllocations.repaymentId, expenseShareId: repaymentAllocations.expenseShareId })
          .from(repaymentAllocations)
          .where(and(
            eq(repaymentAllocations.ownerUserId, owner),
            eq(repaymentAllocations.repaymentId, receipt.repaymentId),
            eq(repaymentAllocations.expenseShareId, receipt.expenseShareId),
          ))
          .limit(1)
          .for("update");
        if (existing) return notFound();

        if (!Number.isSafeInteger(repayment.amount) || repayment.amount < 0 || !Number.isSafeInteger(share.amountOwed) || share.amountOwed < 0) {
          throw new LedgerIntegrityError("Related allocation records contain an invalid amount.");
        }
        const repaymentAllocationsForRepayment = await transaction
          .select({ amount: repaymentAllocations.amount })
          .from(repaymentAllocations)
          .where(and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.repaymentId, receipt.repaymentId)))
          .for("update");
        let repaymentAllocatedAmount = 0;
        for (const allocation of repaymentAllocationsForRepayment) {
          if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) throw new LedgerIntegrityError(`Allocation for repayment ${receipt.repaymentId} is invalid.`);
          repaymentAllocatedAmount += allocation.amount;
          if (!Number.isSafeInteger(repaymentAllocatedAmount)) throw new LedgerIntegrityError(`Allocated amount for repayment ${receipt.repaymentId} is unsafe.`);
        }
        if (repaymentAllocatedAmount + receipt.amount > repayment.amount) throw new RepaymentAllocationAmountInvariantError();

        const repaymentAllocationsForShare = await transaction
          .select({ amount: repaymentAllocations.amount })
          .from(repaymentAllocations)
          .where(and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.expenseShareId, receipt.expenseShareId)))
          .for("update");
        let shareAllocatedAmount = 0;
        for (const allocation of repaymentAllocationsForShare) {
          if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) throw new LedgerIntegrityError(`Allocation for share ${receipt.expenseShareId} is invalid.`);
          shareAllocatedAmount += allocation.amount;
          if (!Number.isSafeInteger(shareAllocatedAmount)) throw new LedgerIntegrityError(`Allocated amount for share ${receipt.expenseShareId} is unsafe.`);
        }
        if (shareAllocatedAmount + receipt.amount > share.amountOwed) throw new RepaymentAllocationShareInvariantError();

        const [restored] = await transaction
          .insert(repaymentAllocations)
          .values({
            ownerUserId: owner,
            repaymentId: receipt.repaymentId,
            expenseShareId: receipt.expenseShareId,
            amount: receipt.amount,
          })
          .returning({ repaymentId: repaymentAllocations.repaymentId, expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount });
        if (!restored || repaymentAllocationId(restored.repaymentId, restored.expenseShareId) !== receipt.allocationId || restored.amount !== receipt.amount) {
          return persistenceError(new Error("allocation restore returned an unexpected row"));
        }
        return { expenseId: share.expenseId, friendId: share.friendId, repaymentId: repayment.id };
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function allocationPlanFor(transaction: Pick<Database, "select">, repaymentId: string): Promise<RepaymentAllocationPlan> {
    const [repayment] = await transaction
      .select(repaymentSelection())
      .from(repayments)
      .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, repayments.friendId)))
      .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
      .limit(1);
    if (!repayment) return notFound();

    const currentAllocations = await transaction
      .select({ expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
      .from(repaymentAllocations)
      .where(and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.repaymentId, repaymentId)));
    const eligibleShares = await transaction
      .select({
        id: expenseShares.id,
        expenseDescription: expenses.description,
        expenseCreatedAt: expenses.createdAt,
        outingTitle: outings.title,
        outingOccurredAt: outings.occurredAt,
        amountOwed: expenseShares.amountOwed,
      })
      .from(expenseShares)
      .innerJoin(expenses, and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseShares.expenseId)))
      .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
      .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.friendId, repayment.friendId)))
      .orderBy(asc(outings.occurredAt), asc(expenses.createdAt), asc(expenseShares.id));

    const eligibleById = new Map(eligibleShares.map((share) => [share.id, share]));
    const currentByShare = new Map<string, number>();
    let allocatedAmount = 0;
    for (const allocation of currentAllocations) {
      if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) {
        throw new LedgerIntegrityError(`Allocated amount for repayment ${repaymentId} is invalid.`);
      }
      if (!eligibleById.has(allocation.expenseShareId)) {
        throw new LedgerIntegrityError(`Repayment ${repaymentId} references an unavailable expense share.`);
      }
      currentByShare.set(allocation.expenseShareId, allocation.amount);
      allocatedAmount += allocation.amount;
      if (!Number.isSafeInteger(allocatedAmount)) throw new LedgerIntegrityError(`Allocated amount for repayment ${repaymentId} is unsafe.`);
    }
    if (allocatedAmount > repayment.amount) throw new LedgerIntegrityError(`Allocations exceed repayment ${repaymentId}.`);

    const shareIds = eligibleShares.map((share) => share.id);
    const allAllocations = shareIds.length
      ? await transaction
          .select({ repaymentId: repaymentAllocations.repaymentId, expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
          .from(repaymentAllocations)
          .where(and(eq(repaymentAllocations.ownerUserId, owner), inArray(repaymentAllocations.expenseShareId, shareIds)))
      : [];
    const allocatedByOther = new Map<string, number>();
    for (const allocation of allAllocations) {
      if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) {
        throw new LedgerIntegrityError(`Allocated amount for share ${allocation.expenseShareId} is invalid.`);
      }
      if (allocation.repaymentId === repaymentId) continue;
      const total = (allocatedByOther.get(allocation.expenseShareId) ?? 0) + allocation.amount;
      if (!Number.isSafeInteger(total)) throw new LedgerIntegrityError(`Allocated amount for share ${allocation.expenseShareId} is unsafe.`);
      allocatedByOther.set(allocation.expenseShareId, total);
    }

    return {
      ...repayment,
      allocatedAmount,
      unallocatedAmount: repayment.amount - allocatedAmount,
      shares: eligibleShares
        .map((share) => {
          const allocatedByOtherRepayments = allocatedByOther.get(share.id) ?? 0;
          const capacityAvailable = share.amountOwed - allocatedByOtherRepayments;
          if (!Number.isSafeInteger(capacityAvailable) || capacityAvailable < 0) {
            throw new LedgerIntegrityError(`Allocations exceed expense share ${share.id}.`);
          }
          return {
            id: share.id,
            expenseShareId: share.id,
            expenseDescription: share.expenseDescription,
            outingTitle: share.outingTitle,
            outingOccurredAt: share.outingOccurredAt,
            amountOwed: share.amountOwed,
            allocatedByOtherRepayments,
            currentAllocation: currentByShare.get(share.id) ?? 0,
            capacityAvailable,
          };
        })
        .filter((share) => share.capacityAvailable > 0 || share.currentAllocation > 0),
    };
  }

  async function getRepaymentAllocationPlan(repaymentId: string) {
    assertRepaymentId(repaymentId);
    try {
      return await allocationPlanFor(database, repaymentId);
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function replaceRepaymentAllocations(repaymentId: string, allocations: RepaymentAllocationInput[]) {
    assertRepaymentId(repaymentId);
    assertRepaymentAllocationsInput(allocations);
    const requested = allocations.map((allocation) => ({
      expenseShareId: allocation.expenseShareId.trim().toLowerCase(),
      amount: allocation.amount,
    }));
    try {
      return await database.transaction(async (transaction) => {
        const [repayment] = await transaction
          .select({ id: repayments.id, friendId: repayments.friendId, amount: repayments.amount })
          .from(repayments)
          .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
          .limit(1)
          .for("update");
        if (!repayment) return notFound();

        const currentAllocations = await transaction
          .select({ expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
          .from(repaymentAllocations)
          .where(and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.repaymentId, repaymentId)));
        const lockedShareIds = [...new Set([...currentAllocations.map((allocation) => allocation.expenseShareId), ...requested.map((allocation) => allocation.expenseShareId)])].sort();
        const lockedShares = lockedShareIds.length
          ? await transaction
              .select({ id: expenseShares.id, friendId: expenseShares.friendId, amountOwed: expenseShares.amountOwed })
              .from(expenseShares)
              .where(and(eq(expenseShares.ownerUserId, owner), inArray(expenseShares.id, lockedShareIds)))
              .orderBy(asc(expenseShares.id))
              .for("update")
          : [];
        if (lockedShares.length !== lockedShareIds.length) return notFound();
        if (lockedShares.some((share) => share.friendId !== repayment.friendId)) return notFound();

        const otherAllocations = lockedShareIds.length
          ? await transaction
              .select({ expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
              .from(repaymentAllocations)
              .where(and(
                eq(repaymentAllocations.ownerUserId, owner),
                inArray(repaymentAllocations.expenseShareId, lockedShareIds),
                ne(repaymentAllocations.repaymentId, repaymentId),
              ))
          : [];
        const allocatedByOther = new Map<string, number>();
        for (const allocation of otherAllocations) {
          if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) {
            throw new LedgerIntegrityError(`Allocated amount for share ${allocation.expenseShareId} is invalid.`);
          }
          const total = (allocatedByOther.get(allocation.expenseShareId) ?? 0) + allocation.amount;
          if (!Number.isSafeInteger(total)) throw new LedgerIntegrityError(`Allocated amount for share ${allocation.expenseShareId} is unsafe.`);
          allocatedByOther.set(allocation.expenseShareId, total);
        }

        const requestedTotal = requested.reduce((total, allocation) => total + allocation.amount, 0);
        if (!Number.isSafeInteger(requestedTotal)) throw new LedgerRepositoryError("INVALID_INPUT", "Repayment allocations are invalid");
        if (requestedTotal > repayment.amount) throw new RepaymentAllocationAmountInvariantError();
        const sharesById = new Map(lockedShares.map((share) => [share.id, share]));
        for (const allocation of requested) {
          const share = sharesById.get(allocation.expenseShareId);
          if (!share) return notFound();
          const capacityAvailable = share.amountOwed - (allocatedByOther.get(share.id) ?? 0);
          if (allocation.amount > capacityAvailable) throw new RepaymentAllocationShareInvariantError();
        }

        const currentById = new Map(currentAllocations.map((allocation) => [allocation.expenseShareId, allocation]));
        for (const allocation of requested) {
          if (currentById.has(allocation.expenseShareId)) {
            const current = currentById.get(allocation.expenseShareId)!;
            if (current.amount !== allocation.amount) {
              await transaction
                .update(repaymentAllocations)
                .set({ amount: allocation.amount })
                .where(and(
                  eq(repaymentAllocations.ownerUserId, owner),
                  eq(repaymentAllocations.repaymentId, repaymentId),
                  eq(repaymentAllocations.expenseShareId, allocation.expenseShareId),
                ));
            }
          } else {
            await transaction.insert(repaymentAllocations).values({
              ownerUserId: owner,
              repaymentId,
              expenseShareId: allocation.expenseShareId,
              amount: allocation.amount,
            });
          }
        }

        const requestedIds = new Set(requested.map((allocation) => allocation.expenseShareId));
        const omittedIds = currentAllocations.map((allocation) => allocation.expenseShareId).filter((id) => !requestedIds.has(id));
        if (omittedIds.length > 0) {
          await transaction
            .delete(repaymentAllocations)
            .where(and(
              eq(repaymentAllocations.ownerUserId, owner),
              eq(repaymentAllocations.repaymentId, repaymentId),
              inArray(repaymentAllocations.expenseShareId, omittedIds),
            ));
        }

        return await allocationPlanFor(transaction, repaymentId);
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  return {
    createFriend,
    getFriend,
    listFriends,
    searchFriends,
    listFriendRecords,
    updateFriend,
    setFriendArchived,
    archiveFriend,
    undoFriendArchive,
    createTrip,
    getTrip,
    searchTrips,
    listTripRecords,
    getTripSummary,
    updateTrip,
    deleteTrip,
    createOuting,
    getOuting,
    listOutings,
    searchOutings,
    listOutingRecords,
    updateOuting,
    getOutingDeletionImpact,
    deleteOuting,
    createExpense,
    getExpense,
    listExpenses,
    listRecentActivity,
    listExpenseRecords,
    listFriendExpenseShareRecords,
    getExpenseDeletionImpact,
    listLedgerHistory,
    getLedgerSummary,
    getLedgerOverviewSummary,
    getFriendBalances,
    getLedgerExportSnapshot,
    listEligibleDebtorShareReceipts,
    getFriendDebtorStatement,
    getPublicFriendDebtorStatement,
    updateExpense,
    deleteExpense,
    listExpenseShares,
    listExpenseCharges,
    getPreviousExpenseSplit,
    listOpenExpenseSharesByFriend,
    getRepaymentFriendContext,
    replaceExpenseShares,
    createRepayment,
    createRepaymentWithAllocations,
    getRepayment,
    listRepayments,
    listRepaymentRecords,
    updateRepayment,
    getRepaymentDeletionImpact,
    deleteRepayment,
    removeRepaymentAllocation,
    undoRepaymentAllocation,
    getRepaymentAllocationPlan,
    replaceRepaymentAllocations,
  };
}
