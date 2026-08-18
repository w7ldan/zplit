import { describe, expect, it } from "vitest";
import {
  buildDebtorStatement,
  buildPagedDebtorStatement,
  DebtorStatementIntegrityError,
  type DebtorStatementInput,
} from "./debtor-statement";

const base: DebtorStatementInput = {
  friend: { id: "friend-a", name: "Ada" },
  shares: [
    { id: "share-old", friendId: "friend-a", expenseId: "expense-old", expenseDescription: "Museum", outingTitle: "Saturday", outingOccurredAt: new Date("2026-01-01T00:00:00Z"), amountOwed: 40_000 },
    { id: "share-new", friendId: "friend-a", expenseId: "expense-new", expenseDescription: "Dinner", outingTitle: "Sunday", outingOccurredAt: new Date("2026-01-02T00:00:00Z"), amountOwed: 60_000 },
  ],
  repayments: [
    { id: "repayment-a", friendId: "friend-a", amount: 50_000 },
    { id: "repayment-unallocated", friendId: "friend-a", amount: 90_000 },
  ],
  allocations: [
    { repaymentId: "repayment-a", expenseShareId: "share-old", amount: 40_000 },
    { repaymentId: "repayment-a", expenseShareId: "share-new", amount: 10_000 },
  ],
  asOf: new Date("2026-01-03T00:00:00Z"),
};

describe("debtor statement", () => {
  it("excludes unallocated repayments and orders open items before settled items", () => {
    const statement = buildDebtorStatement(base);
    expect(statement).toMatchObject({
      friendName: "Ada",
      generatedAt: new Date("2026-01-03T00:00:00Z"),
      assignedAmount: 100_000,
      repaidAmount: 50_000,
      outstandingAmount: 50_000,
    });
    expect(statement.items).toEqual([
      expect.objectContaining({ expenseDescription: "Dinner", repaidAmount: 10_000, remainingAmount: 50_000, state: "open" }),
      expect.objectContaining({ expenseDescription: "Museum", repaidAmount: 40_000, remainingAmount: 0, state: "settled" }),
    ]);
  });

  it("rejects unknown, negative, and over-allocated records", () => {
    expect(() => buildDebtorStatement({ ...base, allocations: [{ repaymentId: "missing", expenseShareId: "share-old", amount: 1 }] })).toThrow(DebtorStatementIntegrityError);
    expect(() => buildDebtorStatement({ ...base, allocations: [{ repaymentId: "repayment-a", expenseShareId: "share-old", amount: -1 }] })).toThrow(DebtorStatementIntegrityError);
    expect(() => buildDebtorStatement({ ...base, allocations: [{ repaymentId: "repayment-a", expenseShareId: "share-old", amount: 40_001 }] })).toThrow(DebtorStatementIntegrityError);
    expect(() => buildDebtorStatement({ ...base, shares: [{ ...base.shares[0]!, amountOwed: Number.MAX_SAFE_INTEGER }, base.shares[1]!] })).toThrow(DebtorStatementIntegrityError);
  });

  it("rejects unsafe totals and mismatched owner records", () => {
    expect(() => buildDebtorStatement({ ...base, friend: { id: "friend-b", name: "Other" } })).toThrow(DebtorStatementIntegrityError);
    expect(() => buildDebtorStatement({ ...base, repayments: [{ id: "repayment-a", friendId: "friend-a", amount: Number.MAX_SAFE_INTEGER }], allocations: [] })).not.toThrow();
    expect(() => buildDebtorStatement({ ...base, repayments: [{ id: "repayment-a", friendId: "friend-a", amount: -1 }] })).toThrow(DebtorStatementIntegrityError);
  });

  it("adds only selected public receipt references to matching expense items", () => {
    const statement = buildDebtorStatement({ ...base, publicReceipts: [{ expenseId: "expense-new", publicId: "receipt-public", mediaType: "image/png" }] });
    expect(statement.items[0]?.sharedReceipts).toEqual([{ publicId: "receipt-public", label: "Receipt image", mediaType: "image/png" }]);
    expect(statement.items[1]).not.toHaveProperty("sharedReceipts");
    expect(() => buildDebtorStatement({ ...base, publicReceipts: [{ expenseId: "foreign-expense", publicId: "receipt-public", mediaType: "image/png" }] })).toThrow(DebtorStatementIntegrityError);
  });

  it("threads public payment methods through paged repayment items", () => {
    const statement = buildPagedDebtorStatement({
      friend: base.friend,
      shares: [],
      repayments: [
        { id: "repayment-a", friendId: "friend-a", amount: 50_000, paidAt: new Date("2026-01-03T00:00:00Z"), paymentMethod: "Bank transfer", allocatedAmount: 0, allocations: [] },
        { id: "repayment-b", friendId: "friend-a", amount: 25_000, paidAt: new Date("2026-01-02T00:00:00Z"), paymentMethod: null, allocatedAmount: 0, allocations: [] },
      ],
      assignedAmount: 0,
      repaidAmount: 0,
      expensePage: { page: 1, totalItems: 0 },
      repaymentPage: { page: 1, totalItems: 2 },
      asOf: new Date("2026-01-04T00:00:00Z"),
    });
    expect(statement.repaymentPage?.items).toEqual([
      expect.objectContaining({ paymentMethod: "Bank transfer" }),
      expect.objectContaining({ paymentMethod: null }),
    ]);
  });
});
