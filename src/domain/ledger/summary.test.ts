import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../db/client";
import { readLedgerOverviewSummaries } from "./summary";

describe("batched ledger overview summaries", () => {
  it("returns one scoped result per ledger without a cross-scope total", async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        { scope_id: "scope-a", total_expense_amount: "100", total_assigned_amount: "80", total_repaid_amount: "20", total_received_amount: "20", owner_portion_amount: "20", total_assigned_friend_count: "0", invalid_cross_friend_allocations: "0", invalid_repayment_allocations: "0", invalid_share_allocations: "0", invalid_owner_portions: "0", friend_balances: [] },
        { scope_id: "scope-b", total_expense_amount: "900", total_assigned_amount: "300", total_repaid_amount: "100", total_received_amount: "100", owner_portion_amount: "600", total_assigned_friend_count: "0", invalid_cross_friend_allocations: "0", invalid_repayment_allocations: "0", invalid_share_allocations: "0", invalid_owner_portions: "0", friend_balances: [] },
      ],
    });

    const summaries = await readLedgerOverviewSummaries({ execute } as unknown as Database, ["scope-a", "scope-b"]);

    expect(execute).toHaveBeenCalledOnce();
    expect(summaries.get("scope-a")).toEqual({ totalExpenseAmount: 100, totalRepaidAmount: 20, totalOutstandingAmount: 60 });
    expect(summaries.get("scope-b")).toEqual({ totalExpenseAmount: 900, totalRepaidAmount: 100, totalOutstandingAmount: 200 });
  });
});
