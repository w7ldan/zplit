import type { RepaymentAllocationInput } from "../repayment-allocation-input";
import { MAX_RUPIAH } from "../rupiah";
import { MAX_PERCENTAGE_BASIS_POINTS } from "../expense-share-input";
import { normalizeUuid } from "../record-retrieval";
import { LedgerRepositoryError } from "./errors";
import type {
  ExpenseChargeInput,
  ExpenseMutationInput,
  ExpenseShareInput as ExpenseShareRepositoryInput,
  FriendArchiveReversalReceipt,
  FriendMutationInput,
  OutingMutationInput,
  RepaymentAllocationReversalReceipt,
  RepaymentMutationInput,
  TripMutationInput,
} from "./types";

export function assertInput(input: unknown): asserts input is Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Ledger input is invalid");
  }
  if (Object.prototype.hasOwnProperty.call(input, "ownerUserId") || Object.prototype.hasOwnProperty.call(input, "owner_user_id")) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Ledger ownership is server managed");
  }
}

export function assertFriendInput(input: unknown): asserts input is FriendMutationInput {
  assertInput(input);
  const keys = Object.keys(input);
  if (keys.some((key) => !["name", "phoneNumber", "notes"].includes(key))) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Friend fields are invalid");
  }
}

export function assertFriendId(friendId: string) {
  if (typeof friendId !== "string" || !friendId.trim()) {
    throw new LedgerRepositoryError("INVALID_INPUT", "A friend ID is required");
  }
}

export function assertFriendArchiveReversalReceipt(value: unknown): asserts value is FriendArchiveReversalReceipt {
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

export function repaymentAllocationId(repaymentId: string, expenseShareId: string) {
  return `${repaymentId}:${expenseShareId}`;
}

export function assertRepaymentAllocationReversalReceipt(value: unknown): asserts value is RepaymentAllocationReversalReceipt {
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

export function assertOutingInput(input: unknown): asserts input is OutingMutationInput {
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

export function assertTripInput(input: unknown): asserts input is TripMutationInput {
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

export function assertOutingId(outingId: string) {
  if (typeof outingId !== "string" || !outingId.trim()) {
    throw new LedgerRepositoryError("INVALID_INPUT", "An outing ID is required");
  }
}

export function assertTripId(tripId: string) {
  if (typeof tripId !== "string" || !normalizeUuid(tripId)) {
    throw new LedgerRepositoryError("INVALID_INPUT", "A trip ID is required");
  }
}

export function assertExpenseInput(input: unknown): asserts input is ExpenseMutationInput {
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

export function assertExpenseId(expenseId: string) {
  if (typeof expenseId !== "string" || !expenseId.trim()) {
    throw new LedgerRepositoryError("INVALID_INPUT", "An expense ID is required");
  }
}

export function assertRepaymentId(repaymentId: string) {
  if (typeof repaymentId !== "string" || !repaymentId.trim()) {
    throw new LedgerRepositoryError("INVALID_INPUT", "A repayment ID is required");
  }
}

export function assertRepaymentInput(input: unknown): asserts input is RepaymentMutationInput {
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

export function assertRepaymentAllocationsInput(input: unknown): asserts input is RepaymentAllocationInput[] {
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

export function assertExpenseSharesInput(shares: unknown): asserts shares is ExpenseShareRepositoryInput[] {
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
      typeof (share as ExpenseShareRepositoryInput).friendId !== "string" ||
      !(share as ExpenseShareRepositoryInput).friendId.trim() ||
      typeof baseAmount !== "number" ||
      !Number.isInteger(baseAmount) ||
      baseAmount <= 0 ||
      baseAmount > MAX_RUPIAH
    ) {
      throw new LedgerRepositoryError("INVALID_INPUT", "Expense shares are invalid");
    }
    const friendId = (share as ExpenseShareRepositoryInput).friendId.trim().toLowerCase();
    if (seen.has(friendId)) throw new LedgerRepositoryError("INVALID_INPUT", "Each friend can have only one share per expense.");
    seen.add(friendId);
  }
}

export function assertExpenseChargesInput(charges: unknown): asserts charges is ExpenseChargeInput[] {
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

export function shareBaseAmount(share: ExpenseShareRepositoryInput) {
  return "baseAmount" in share ? share.baseAmount : share.amountOwed;
}
