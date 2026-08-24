import { describe, expect, it } from "vitest";
import { calculateRepaymentAllocations } from "./ledger/allocations";

const shares = [
  { id: "old", remainingAmount: 3_000 },
  { id: "middle", remainingAmount: 4_000 },
  { id: "new", remainingAmount: 5_000 },
];

describe("repayment allocation strategies", () => {
  it("fills an exact fit across one or multiple shares", () => {
    expect(calculateRepaymentAllocations(3_000, shares, "oldest")).toEqual([{ expenseShareId: "old", amount: 3_000 }]);
    expect(calculateRepaymentAllocations(7_000, shares, "oldest")).toEqual([
      { expenseShareId: "old", amount: 3_000 },
      { expenseShareId: "middle", amount: 4_000 },
    ]);
  });

  it("partially fills the final share and leaves excess unallocated", () => {
    expect(calculateRepaymentAllocations(8_000, shares, "oldest")).toEqual([
      { expenseShareId: "old", amount: 3_000 },
      { expenseShareId: "middle", amount: 4_000 },
      { expenseShareId: "new", amount: 1_000 },
    ]);
    expect(calculateRepaymentAllocations(20_000, shares, "oldest")).toEqual([
      { expenseShareId: "old", amount: 3_000 },
      { expenseShareId: "middle", amount: 4_000 },
      { expenseShareId: "new", amount: 5_000 },
    ]);
  });

  it("reverses the same deterministic share order for newest first", () => {
    expect(calculateRepaymentAllocations(7_000, shares, "newest")).toEqual([
      { expenseShareId: "new", amount: 5_000 },
      { expenseShareId: "middle", amount: 2_000 },
    ]);
    expect(calculateRepaymentAllocations(7_000, [{ id: "same-date-a", remainingAmount: 2_000 }, { id: "same-date-b", remainingAmount: 2_000 }], "oldest")).toEqual([
      { expenseShareId: "same-date-a", amount: 2_000 },
      { expenseShareId: "same-date-b", amount: 2_000 },
    ]);
  });

  it("does not create zero rows for invalid or blank amounts", () => {
    expect(calculateRepaymentAllocations(0, shares, "oldest")).toEqual([]);
    expect(calculateRepaymentAllocations(Number.NaN, shares, "newest")).toEqual([]);
  });
});
