import { describe, expect, it } from "vitest";
import {
  buildBalancesCsv,
  buildExpenseSharesCsv,
  buildRepaymentsCsv,
  LedgerExportIntegrityError,
  type LedgerExportSnapshot,
} from "./ledger-export";

const snapshot: LedgerExportSnapshot = {
  friends: [
    { id: "friend-a", name: "Ada", archivedAt: null },
    { id: "friend-b", name: "Bima", archivedAt: new Date("2026-01-01T00:00:00Z") },
    { id: "friend-c", name: "Zero", archivedAt: null },
  ],
  expenses: [
    { id: "expense-old", description: "Zed", amount: 2_000, outingTitle: "Old outing", outingOccurredAt: "2026-08-03T00:00:00Z" },
    { id: "expense-new", description: "Dinner", amount: 10_000, outingTitle: "New outing", outingOccurredAt: "2026-08-04T00:00:00Z" },
  ],
  expenseShares: [
    { id: "share-b", expenseId: "expense-old", friendId: "friend-b", amountOwed: 2_000 },
    { id: "share-a", expenseId: "expense-new", friendId: "friend-a", amountOwed: 6_000 },
  ],
  repayments: [
    { id: "repayment-b", friendId: "friend-b", amount: 2_000, paidAt: "2026-08-03T00:00:00Z", paymentMethod: "cash" },
    { id: "repayment-a", friendId: "friend-a", amount: 8_000, paidAt: "2026-08-04T00:00:00Z", paymentMethod: null },
  ],
  repaymentAllocations: [
    { repaymentId: "repayment-b", expenseShareId: "share-b", amount: 2_000 },
    { repaymentId: "repayment-a", expenseShareId: "share-a", amount: 4_000 },
  ],
};

describe("ledger export CSV", () => {
  it("calculates balances, includes zero-balance friends, and leaves unallocated repayments out of balances", () => {
    const csv = buildBalancesCsv(snapshot);
    expect(csv).toBe([
      "\uFEFFfriend_name,friend_state,assigned_rupiah,repaid_rupiah,outstanding_rupiah",
      "Ada,active,6000,4000,2000",
      "Bima,archived,2000,2000,0",
      "Zero,active,0,0,0",
      "",
    ].join("\r\n"));
  });

  it("uses exact headers and required ordering", () => {
    const expenseCsv = buildExpenseSharesCsv(snapshot);
    const repaymentCsv = buildRepaymentsCsv(snapshot);
    expect(expenseCsv.split("\r\n")[0]).toBe("\uFEFFouting_occurred_at_utc,outing_title,expense_description,expense_total_rupiah,friend_name,share_rupiah,repaid_rupiah,outstanding_rupiah,state");
    expect(repaymentCsv.split("\r\n")[0]).toBe("\uFEFFpaid_at_utc,friend_name,received_rupiah,allocated_rupiah,unallocated_rupiah,payment_method");
    expect(expenseCsv).toContain("2026-08-04T00:00:00.000Z,New outing,Dinner,10000,Ada,6000,4000,2000,open");
    expect(expenseCsv.indexOf("New outing")).toBeLessThan(expenseCsv.indexOf("Old outing"));
    expect(repaymentCsv.indexOf("2026-08-04T00:00:00.000Z")).toBeLessThan(repaymentCsv.indexOf("2026-08-03T00:00:00.000Z"));
  });

  it("emits BOM, CRLF, quoting, embedded newlines, and formula-safe text", () => {
    const csv = buildExpenseSharesCsv({
      ...snapshot,
      friends: [{ id: "friend-a", name: "=Ada, \"One\"\nTwo", archivedAt: null }],
      expenses: [{ id: "expense-a", description: "-Dinner, \"late\"\nnow", amount: 1000, outingTitle: "@Trip", outingOccurredAt: "2026-08-05T00:00:00Z" }],
      expenseShares: [{ id: "share-a", expenseId: "expense-a", friendId: "friend-a", amountOwed: 1000 }],
      repayments: [],
      repaymentAllocations: [],
    });

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv).toContain(",'@Trip,");
    expect(csv).toContain("\"'-Dinner, \"\"late\"\"\nnow\"");
    expect(csv).toContain("\"'=Ada, \"\"One\"\"\nTwo\"");
    expect(csv).not.toContain("'1000");
    expect(csv).not.toMatch(/ownerUserId|phoneNumber|notes|tokenHash|expenseShareId/);
  });

  it.each([
    ["duplicate friend IDs", { friends: [...snapshot.friends, { id: "friend-a", name: "Again", archivedAt: null }] }],
    ["unknown friend", { expenseShares: [{ id: "share-x", expenseId: "expense-new", friendId: "missing", amountOwed: 1 }] }],
    ["unknown expense", { expenseShares: [{ id: "share-x", expenseId: "missing", friendId: "friend-a", amountOwed: 1 }] }],
    ["cross-friend allocation", { repaymentAllocations: [{ repaymentId: "repayment-b", expenseShareId: "share-a", amount: 1 }] }],
    ["share exceeds expense", { expenseShares: [{ id: "share-a", expenseId: "expense-new", friendId: "friend-a", amountOwed: 10_001 }] }],
    ["allocation exceeds share", { repaymentAllocations: [{ repaymentId: "repayment-a", expenseShareId: "share-a", amount: 6_001 }] }],
    ["allocation exceeds repayment", { repaymentAllocations: [{ repaymentId: "repayment-b", expenseShareId: "share-b", amount: 2_001 }] }],
    ["unsafe amount", { expenses: [{ id: "expense-new", description: "Dinner", amount: Number.MAX_SAFE_INTEGER + 1, outingTitle: "New outing", outingOccurredAt: "2026-08-04T00:00:00Z" }] }],
  ])("rejects %s", (_label, changes) => {
    expect(() => buildBalancesCsv({ ...snapshot, ...changes } as LedgerExportSnapshot)).toThrowError(LedgerExportIntegrityError);
  });
});
