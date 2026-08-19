export type RepaymentAllocationStrategy = "manual" | "oldest" | "newest";

export type RepaymentStrategyShare = { id: string; remainingAmount: number };
export type GeneratedRepaymentAllocation = { expenseShareId: string; amount: number };

export function calculateRepaymentAllocations(
  amount: number,
  shares: readonly RepaymentStrategyShare[],
  strategy: Exclude<RepaymentAllocationStrategy, "manual">,
): GeneratedRepaymentAllocation[] {
  if (!Number.isSafeInteger(amount) || amount <= 0) return [];
  let remaining = amount;
  const orderedShares = strategy === "newest" ? [...shares].reverse() : shares;
  const allocations: GeneratedRepaymentAllocation[] = [];

  for (const share of orderedShares) {
    if (!Number.isSafeInteger(share.remainingAmount) || share.remainingAmount < 0) throw new RangeError("Expense share remaining amount must be a safe non-negative integer");
    if (remaining === 0) break;
    const allocation = Math.min(remaining, share.remainingAmount);
    if (allocation > 0) {
      allocations.push({ expenseShareId: share.id, amount: allocation });
      remaining -= allocation;
    }
  }

  return allocations;
}
