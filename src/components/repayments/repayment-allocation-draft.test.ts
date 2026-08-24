import { describe, expect, it } from "vitest";
import {
  addRepaymentAllocation,
  applyRepaymentAllocationStrategy,
  createRepaymentAllocationDraft,
  deriveRepaymentAllocationTotals,
  removeRepaymentAllocation,
  serializeRepaymentAllocations,
  updateRepaymentAllocationDraft,
} from "./repayment-allocation-draft";

const shares = [
  { id: "old", remainingAmount: 64_000 },
  { id: "new", remainingAmount: 64_000 },
];

describe("repayment allocation draft", () => {
  it("initializes from returned allocations or contextual allocation IDs", () => {
    expect(createRepaymentAllocationDraft([{ expenseShareId: "old", amountRupiah: "12000" }], ["new"])).toEqual({
      selectedAllocationIds: ["old"],
      draftAllocations: { old: "12000" },
    });
    expect(createRepaymentAllocationDraft([], ["new"])).toEqual({
      selectedAllocationIds: ["new"],
      draftAllocations: { new: "" },
    });
  });

  it("updates, adds, and removes draft rows immutably", () => {
    const initial = createRepaymentAllocationDraft([], ["old"]);
    const updated = updateRepaymentAllocationDraft(addRepaymentAllocation(initial, "new"), "old", "12000");
    expect(updated).toEqual({ selectedAllocationIds: ["old", "new"], draftAllocations: { old: "12000", new: "" } });
    expect(removeRepaymentAllocation(updated, "old")).toEqual({ selectedAllocationIds: ["new"], draftAllocations: { new: "" } });
  });

  it.each([
    ["oldest", ["old", "new"]],
    ["newest", ["new", "old"]],
  ] as const)("applies the %s strategy in share order", (strategy, expectedIds) => {
    expect(applyRepaymentAllocationStrategy("70000", shares, strategy)).toEqual({
      selectedAllocationIds: expectedIds,
      draftAllocations: { [expectedIds[0]]: "64000", [expectedIds[1]]: "6000" },
    });
  });

  it("treats empty and zero draft values as unallocated and preserves invalid amount state", () => {
    expect(deriveRepaymentAllocationTotals("84000", { old: "", new: "0", other: "84.000" })).toEqual({ allocatedAmount: 84_000, unallocatedAmount: 0 });
    expect(deriveRepaymentAllocationTotals("84.00", { old: "12000" })).toEqual({ allocatedAmount: 12_000, unallocatedAmount: null });
    expect(applyRepaymentAllocationStrategy("0", shares, "oldest")).toEqual({ selectedAllocationIds: [], draftAllocations: {} });
  });

  it("serializes selected rows in display order without changing draft text", () => {
    expect(serializeRepaymentAllocations(["new", "old"], { old: "84.00", new: "30.000" })).toEqual([
      { expenseShareId: "new", amountRupiah: "30.000" },
      { expenseShareId: "old", amountRupiah: "84.00" },
    ]);
  });
});
