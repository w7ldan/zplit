import { describe, expect, it } from "vitest";
import {
  buildLedgerHistory,
  encodeLedgerHistoryCursor,
  parseLedgerHistoryCursor,
  type LedgerHistoryExpenseRecord,
  type LedgerHistoryRepaymentRecord,
} from "./ledger-history";

const share = { id: "share-a", friendId: "friend-a", amountOwed: 4_000, allocatedAmount: 0 };
const expenses: LedgerHistoryExpenseRecord[] = [
  { id: "expense-late", description: "Late dinner", outingTitle: "Saturday", outingOccurredAt: new Date("2026-08-04T02:00:00.000Z"), amount: 10_000, shares: [] },
  { id: "expense-early", description: "Early dinner", outingTitle: "Friday", outingOccurredAt: new Date("2026-08-01T02:00:00.000Z"), amount: 8_000, shares: [share] },
];
const repayments: LedgerHistoryRepaymentRecord[] = [
  { id: "repayment-late", friendId: "friend-a", friendName: "Ari", paidAt: new Date("2026-08-04T02:00:00.000Z"), amount: 4_000, allocations: [] },
];

describe("ledger history domain", () => {
  it("orders newest events first with a stable type and ID tie-breaker", () => {
    const history = buildLedgerHistory({ expenses, repayments });
    expect(history.items.map((item) => `${item.type}:${item.id}`)).toEqual([
      "expense:expense-late",
      "repayment:repayment-late",
      "expense:expense-early",
    ]);
    expect(history.items[0]).toMatchObject({ totalAmount: 10_000, assignedAmount: 0, ownerPortionAmount: 10_000 });
  });

  it("filters, clamps limits, and round-trips opaque cursors without duplicates", () => {
    const first = buildLedgerHistory({ expenses, repayments }, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const second = buildLedgerHistory({ expenses, repayments }, { cursor: first.nextCursor!, limit: 99 });
    expect(second.items.map((item) => item.id)).toEqual(["repayment-late", "expense-early"]);
    expect(buildLedgerHistory({ expenses, repayments }, { type: "repayment" }).items.map((item) => item.id)).toEqual(["repayment-late"]);
    const parsed = parseLedgerHistoryCursor(first.nextCursor!);
    expect(parseLedgerHistoryCursor(encodeLedgerHistoryCursor(parsed))).toEqual(parsed);
    expect(first.nextCursor).not.toContain("owner");
  });

  it("rejects malformed cursors and inconsistent financial data", () => {
    expect(() => parseLedgerHistoryCursor("not-a-cursor")).toThrow("Ledger history cursor is invalid.");
    expect(() => parseLedgerHistoryCursor(`${encodeLedgerHistoryCursor({ effectiveAt: new Date("2026-08-01T00:00:00.000Z"), eventType: "expense", recordId: "x" })}=`)).toThrow();
    expect(() => buildLedgerHistory({ expenses: [{ ...expenses[0]!, amount: 1, shares: [{ ...share, amountOwed: 2, allocatedAmount: 0 }] }], repayments: [] })).toThrow("Expense shares exceed");
    expect(() => buildLedgerHistory({ expenses: [{ ...expenses[0]!, shares: [{ ...share, allocatedAmount: 1 }] }], repayments: [] })).toThrow("inconsistent repayment allocations");
    expect(() => buildLedgerHistory({ expenses: [{ ...expenses[0]!, shares: [{ ...share, friendId: "friend-a", allocatedAmount: 0 }] }], repayments: [{ ...repayments[0]!, allocations: [{ expenseShareId: "missing", amount: 1 }] }] })).toThrow("unknown expense share");
  });
});
