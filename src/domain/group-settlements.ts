import { parsePaymentMethodFields } from "./payment-method";
import { normalizeUuid } from "./record-retrieval";
import { MAX_RUPIAH, parseRupiah } from "./rupiah";

export type GroupSettlementState = "pending" | "confirmed";

export const GROUP_SETTLEMENT_CHANGED_EVENT = "group.settlement.changed";

export type GroupSettlementInput = {
  senderParticipantId: string;
  recipientParticipantId: string;
  amount: number;
  paymentMethod: string;
};

export type GroupSettlementAllocationObligation = {
  id: string;
  authoritativeAt: Date;
  originalAmount: number;
  appliedAmount: number;
};

export type GroupSettlementApplicationAllocation = {
  obligationId: string;
  amount: number;
};

export class GroupSettlementAllocationError extends Error {
  constructor(readonly code: "unallocatable") {
    super(code);
    this.name = "GroupSettlementAllocationError";
  }
}

export class GroupSettlementInputError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_amount" | "invalid_payment_method" | "same_participant") {
    super(code);
    this.name = "GroupSettlementInputError";
  }
}

function inputRecord(input: unknown) {
  return input !== null && typeof input === "object" ? input as Record<string, unknown> : {};
}

function requiredParticipant(value: unknown) {
  const id = normalizeUuid(value);
  if (!id) throw new GroupSettlementInputError("invalid_input");
  return id;
}

function requiredAmount(value: unknown) {
  const amount = typeof value === "number" ? value : parseRupiah(value);
  if (amount === null || !Number.isSafeInteger(amount) || amount < 1 || amount > MAX_RUPIAH) throw new GroupSettlementInputError("invalid_amount");
  return amount;
}

function paymentMethodValue(input: Record<string, unknown>) {
  if ("paymentMethodChoice" in input || "paymentMethodOther" in input) {
    const parsed = parsePaymentMethodFields(input.paymentMethodChoice, input.paymentMethodOther);
    if (parsed.error) throw new GroupSettlementInputError("invalid_payment_method");
    return parsed.value;
  }
  return typeof input.paymentMethod === "string" ? input.paymentMethod.trim() : "";
}

export function normalizeGroupSettlementInput(input: unknown): GroupSettlementInput {
  const record = inputRecord(input);
  const senderParticipantId = requiredParticipant(record.senderParticipantId);
  const recipientParticipantId = requiredParticipant(record.recipientParticipantId);
  if (senderParticipantId === recipientParticipantId) throw new GroupSettlementInputError("same_participant");
  const amount = requiredAmount(record.amount ?? record.amountRupiah);
  const paymentMethod = paymentMethodValue(record);
  if (!paymentMethod || paymentMethod.length > 40) throw new GroupSettlementInputError("invalid_payment_method");
  return { senderParticipantId, recipientParticipantId, amount, paymentMethod };
}

export function allocateGroupSettlement(
  amount: number,
  obligations: GroupSettlementAllocationObligation[],
): GroupSettlementApplicationAllocation[] {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_RUPIAH) {
    throw new GroupSettlementAllocationError("unallocatable");
  }
  const ordered = [...obligations].sort((left, right) =>
    left.authoritativeAt.getTime() - right.authoritativeAt.getTime() || left.id.localeCompare(right.id));
  let remaining = BigInt(amount);
  const allocations: GroupSettlementApplicationAllocation[] = [];
  for (const obligation of ordered) {
    const capacity = BigInt(obligation.originalAmount) - BigInt(obligation.appliedAmount);
    if (capacity <= BigInt(0)) continue;
    const applied = remaining < capacity ? remaining : capacity;
    allocations.push({ obligationId: obligation.id, amount: Number(applied) });
    remaining -= applied;
    if (remaining === BigInt(0)) return allocations;
  }
  throw new GroupSettlementAllocationError("unallocatable");
}
