import { normalizeUuid } from "./record-retrieval";
import { MAX_RUPIAH } from "./rupiah";

export type GroupOffsetSettlementState = "pending" | "confirmed";

export const GROUP_OFFSET_CHANGED_EVENT = "group.offset.changed";

export type GroupOffsetAllocationObligation = {
  id: string;
  authoritativeAt: Date;
  originalAmount: number;
  paymentAppliedAmount: number;
  offsetAppliedAmount: number;
};

export type GroupOffsetApplicationAllocation = {
  obligationId: string;
  amount: number;
};

export class GroupOffsetAllocationError extends Error {
  constructor(readonly code: "unallocatable") {
    super(code);
    this.name = "GroupOffsetAllocationError";
  }
}

export class GroupOffsetInputError extends Error {
  constructor(readonly code: "invalid_input") {
    super(code);
    this.name = "GroupOffsetInputError";
  }
}

function inputRecord(input: unknown) {
  return input !== null && typeof input === "object" ? input as Record<string, unknown> : {};
}

function requiredParticipant(value: unknown) {
  const id = normalizeUuid(value);
  if (!id) throw new GroupOffsetInputError("invalid_input");
  return id;
}

export type GroupOffsetInput = {
  counterpartyParticipantId: string;
};

export function normalizeGroupOffsetInput(input: unknown): GroupOffsetInput {
  const record = inputRecord(input);
  const counterpartyParticipantId = requiredParticipant(record.counterpartyParticipantId);
  return { counterpartyParticipantId };
}

export function allocateGroupOffset(
  amount: number,
  obligations: GroupOffsetAllocationObligation[],
): GroupOffsetApplicationAllocation[] {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_RUPIAH) {
    throw new GroupOffsetAllocationError("unallocatable");
  }
  const ordered = [...obligations].sort((left, right) =>
    left.authoritativeAt.getTime() - right.authoritativeAt.getTime() || left.id.localeCompare(right.id));
  let remaining = BigInt(amount);
  const allocations: GroupOffsetApplicationAllocation[] = [];
  for (const obligation of ordered) {
    const capacity = BigInt(obligation.originalAmount) - BigInt(obligation.paymentAppliedAmount) - BigInt(obligation.offsetAppliedAmount);
    if (capacity <= BigInt(0)) continue;
    const applied = remaining < capacity ? remaining : capacity;
    allocations.push({ obligationId: obligation.id, amount: Number(applied) });
    remaining -= applied;
    if (remaining === BigInt(0)) return allocations;
  }
  throw new GroupOffsetAllocationError("unallocatable");
}

export function offsettableAmount(obligations: GroupOffsetAllocationObligation[]) {
  const total = obligations.reduce((total, obligation) => {
    const capacity = BigInt(obligation.originalAmount) - BigInt(obligation.paymentAppliedAmount) - BigInt(obligation.offsetAppliedAmount);
    if (capacity <= BigInt(0)) return total;
    const next = total + capacity;
    if (next > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Group offset capacity exceeds safe integer range");
    return next;
  }, BigInt(0));
  return Number(total);
}
