import { describe, expect, it } from "vitest";
import {
  buildLedgerSummary,
  LedgerIntegrityError,
  type LedgerSummaryInput,
} from "./ledger-summary";

const emptyLedger: LedgerSummaryInput = {
  friends: [],
  expenses: [],
  expenseShares: [],
  repayments: [],
  repaymentAllocations: [],
};

function expectIntegrity(input: LedgerSummaryInput) {
  expect(() => buildLedgerSummary(input)).toThrowError(LedgerIntegrityError);
}

describe("ledger summary", () => {
  it("calculates an empty ledger", () => {
    expect(buildLedgerSummary(emptyLedger)).toEqual({
      totalExpenseAmount: 0,
      totalAssignedAmount: 0,
      totalRepaidAmount: 0,
      totalReceivedAmount: 0,
      totalUnallocatedRepaymentAmount: 0,
      totalOutstandingAmount: 0,
      ownerPortionAmount: 0,
      friendBalances: [],
    });
  });

  it("calculates multiple expenses, partial and complete repayments, owner portion, and unallocated money", () => {
    const summary = buildLedgerSummary({
      friends: [
        { id: "friend-a", name: "Ari", archivedAt: null },
        { id: "friend-b", name: "Bima", archivedAt: new Date("2026-01-01T00:00:00Z") },
        { id: "friend-c", name: "No share", archivedAt: null },
      ],
      expenses: [
        { id: "expense-a", amount: 10_000 },
        { id: "expense-b", amount: 20_000 },
      ],
      expenseShares: [
        { id: "share-a1", expenseId: "expense-a", friendId: "friend-a", amountOwed: 6_000 },
        { id: "share-b1", expenseId: "expense-a", friendId: "friend-b", amountOwed: 2_000 },
        { id: "share-a2", expenseId: "expense-b", friendId: "friend-a", amountOwed: 3_000 },
      ],
      repayments: [
        { id: "repayment-a", friendId: "friend-a", amount: 6_000 },
        { id: "repayment-b", friendId: "friend-b", amount: 1_000 },
        { id: "repayment-unallocated", friendId: "friend-a", amount: 5_000 },
      ],
      repaymentAllocations: [
        { repaymentId: "repayment-a", expenseShareId: "share-a1", amount: 6_000 },
        { repaymentId: "repayment-b", expenseShareId: "share-b1", amount: 1_000 },
      ],
    });

    expect(summary).toEqual({
      totalExpenseAmount: 30_000,
      totalAssignedAmount: 11_000,
      totalRepaidAmount: 7_000,
      totalReceivedAmount: 12_000,
      totalUnallocatedRepaymentAmount: 5_000,
      totalOutstandingAmount: 4_000,
      ownerPortionAmount: 19_000,
      friendBalances: [
        { friendId: "friend-a", name: "Ari", archived: false, assignedAmount: 9_000, repaidAmount: 6_000, outstandingAmount: 3_000 },
        { friendId: "friend-b", name: "Bima", archived: true, assignedAmount: 2_000, repaidAmount: 1_000, outstandingAmount: 1_000 },
      ],
    });
  });

  it("sorts by outstanding amount, then name, then friend ID", () => {
    const summary = buildLedgerSummary({
      ...emptyLedger,
      friends: [
        { id: "friend-z", name: "Zed", archivedAt: null },
        { id: "friend-c", name: "Ari", archivedAt: null },
        { id: "friend-a", name: "Ari", archivedAt: null },
      ],
      expenses: [
        { id: "expense-z", amount: 3 },
        { id: "expense-c", amount: 2 },
        { id: "expense-a", amount: 2 },
      ],
      expenseShares: [
        { id: "share-z", expenseId: "expense-z", friendId: "friend-z", amountOwed: 3 },
        { id: "share-c", expenseId: "expense-c", friendId: "friend-c", amountOwed: 2 },
        { id: "share-a", expenseId: "expense-a", friendId: "friend-a", amountOwed: 2 },
      ],
    });

    expect(summary.friendBalances.map(({ friendId }) => friendId)).toEqual(["friend-z", "friend-a", "friend-c"]);
  });

  it.each([
    ["unknown expense", { expenseShares: [{ id: "share", expenseId: "missing", friendId: "friend", amountOwed: 1 }] }],
    ["unknown friend", { friends: [], expenses: [{ id: "expense", amount: 1 },], expenseShares: [{ id: "share", expenseId: "expense", friendId: "missing", amountOwed: 1 }] }],
  ])("rejects a share with an %s", (_, override) => {
    expectIntegrity({ ...emptyLedger, friends: [{ id: "friend", name: "Friend", archivedAt: null }], expenses: [{ id: "expense", amount: 1 }], ...override });
  });

  it("rejects an allocation with an unknown share or repayment", () => {
    expectIntegrity({ ...emptyLedger, repayments: [{ id: "repayment", friendId: "friend", amount: 1 }], repaymentAllocations: [{ repaymentId: "repayment", expenseShareId: "missing", amount: 1 }] });
    expectIntegrity({ ...emptyLedger, expenseShares: [{ id: "share", expenseId: "expense", friendId: "friend", amountOwed: 1 }], repaymentAllocations: [{ repaymentId: "missing", expenseShareId: "share", amount: 1 }] });
  });

  it("rejects allocations across different friends", () => {
    expectIntegrity({
      ...emptyLedger,
      friends: [{ id: "friend-a", name: "A", archivedAt: null }, { id: "friend-b", name: "B", archivedAt: null }],
      expenses: [{ id: "expense", amount: 2 }],
      expenseShares: [{ id: "share", expenseId: "expense", friendId: "friend-a", amountOwed: 1 }],
      repayments: [{ id: "repayment", friendId: "friend-b", amount: 1 }],
      repaymentAllocations: [{ repaymentId: "repayment", expenseShareId: "share", amount: 1 }],
    });
  });

  it("rejects a repayment with an unknown friend", () => {
    expectIntegrity({
      ...emptyLedger,
      repayments: [{ id: "repayment", friendId: "missing", amount: 1 }],
    });
  });

  it("rejects shares and allocations that exceed their source amounts", () => {
    expectIntegrity({ ...emptyLedger, friends: [{ id: "friend", name: "Friend", archivedAt: null }], expenses: [{ id: "expense", amount: 1 }], expenseShares: [{ id: "share", expenseId: "expense", friendId: "friend", amountOwed: 2 }] });
    expectIntegrity({ ...emptyLedger, friends: [{ id: "friend", name: "Friend", archivedAt: null }], expenses: [{ id: "expense", amount: 1 }], expenseShares: [{ id: "share", expenseId: "expense", friendId: "friend", amountOwed: 1 }], repayments: [{ id: "repayment", friendId: "friend", amount: 1 }], repaymentAllocations: [{ repaymentId: "repayment", expenseShareId: "share", amount: 2 }] });
    expectIntegrity({ ...emptyLedger, friends: [{ id: "friend", name: "Friend", archivedAt: null }], expenses: [{ id: "expense", amount: 2 }], expenseShares: [{ id: "share", expenseId: "expense", friendId: "friend", amountOwed: 2 }], repayments: [{ id: "repayment", friendId: "friend", amount: 1 }], repaymentAllocations: [{ repaymentId: "repayment", expenseShareId: "share", amount: 2 }] });
  });

  it("rejects negative and unsafe whole-rupiah amounts", () => {
    expectIntegrity({ ...emptyLedger, expenses: [{ id: "expense", amount: -1 }] });
    expectIntegrity({ ...emptyLedger, expenses: [{ id: "expense", amount: Number.MAX_SAFE_INTEGER + 1 }] });
  });
});
