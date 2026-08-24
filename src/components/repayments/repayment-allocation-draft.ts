import type { RepaymentAllocationInputValues } from "@/domain/repayment-allocation-input";
import type { OpenExpenseShare } from "@/domain/ledger-repository";
import { calculateRepaymentAllocations, type RepaymentAllocationStrategy } from "@/domain/repayment-allocation-strategy";
import { parseRupiah } from "@/domain/rupiah";

export type RepaymentAllocationDraftState = {
  selectedAllocationIds: string[];
  draftAllocations: Record<string, string>;
};

export function createRepaymentAllocationDraft(
  allocations: RepaymentAllocationInputValues | undefined,
  initialAllocationIds: readonly string[] = [],
): RepaymentAllocationDraftState {
  const rows = allocations?.length
    ? allocations
    : initialAllocationIds.map((expenseShareId) => ({ expenseShareId, amountRupiah: "" }));
  return {
    selectedAllocationIds: rows.map((allocation) => allocation.expenseShareId),
    draftAllocations: Object.fromEntries(rows.map((allocation) => [allocation.expenseShareId, allocation.amountRupiah])),
  };
}

export function updateRepaymentAllocationDraft(
  state: RepaymentAllocationDraftState,
  expenseShareId: string,
  amountRupiah: string,
): RepaymentAllocationDraftState {
  return { ...state, draftAllocations: { ...state.draftAllocations, [expenseShareId]: amountRupiah } };
}

export function addRepaymentAllocation(state: RepaymentAllocationDraftState, expenseShareId: string): RepaymentAllocationDraftState {
  if (state.selectedAllocationIds.includes(expenseShareId)) return state;
  return {
    selectedAllocationIds: [...state.selectedAllocationIds, expenseShareId],
    draftAllocations: { ...state.draftAllocations, [expenseShareId]: "" },
  };
}

export function removeRepaymentAllocation(state: RepaymentAllocationDraftState, expenseShareId: string): RepaymentAllocationDraftState {
  const draftAllocations = { ...state.draftAllocations };
  delete draftAllocations[expenseShareId];
  return {
    selectedAllocationIds: state.selectedAllocationIds.filter((id) => id !== expenseShareId),
    draftAllocations,
  };
}

export function applyRepaymentAllocationStrategy(
  amountRupiah: string,
  shares: readonly Pick<OpenExpenseShare, "id" | "remainingAmount">[],
  strategy: RepaymentAllocationStrategy,
): RepaymentAllocationDraftState | null {
  if (strategy === "manual") return null;
  const amount = parseRupiah(amountRupiah);
  const allocations = amount === null ? [] : calculateRepaymentAllocations(amount, shares, strategy);
  return {
    selectedAllocationIds: allocations.map((allocation) => allocation.expenseShareId),
    draftAllocations: Object.fromEntries(allocations.map((allocation) => [allocation.expenseShareId, allocation.amount.toString()])),
  };
}

export function deriveRepaymentAllocationTotals(amountRupiah: string, draftAllocations: Record<string, string>) {
  const allocatedAmount = Object.values(draftAllocations).reduce((total, value) => total + (parseRupiah(value) ?? 0), 0);
  const amount = parseRupiah(amountRupiah);
  return { allocatedAmount, unallocatedAmount: amount === null ? null : amount - allocatedAmount };
}

export function serializeRepaymentAllocations(
  selectedAllocationIds: readonly string[],
  draftAllocations: Record<string, string>,
): RepaymentAllocationInputValues {
  return selectedAllocationIds.map((expenseShareId) => ({ expenseShareId, amountRupiah: draftAllocations[expenseShareId] ?? "" }));
}
