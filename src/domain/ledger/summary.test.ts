import { drizzle } from "drizzle-orm/pg-proxy";
import { describe, expect, it } from "vitest";
import type { Database } from "../../db/client";
import { readLedgerOverviewSummaries } from "./summary";

describe("batched ledger overview summaries", () => {
  it("parses allocated and unallocated repayment totals independently per scope", async () => {
    const queries: string[] = [];
    const common = {
      total_assigned_friend_count: "0",
      invalid_cross_friend_allocations: "0",
      invalid_repayment_allocations: "0",
      invalid_share_allocations: "0",
      invalid_owner_portions: "0",
      friend_balances: [],
    };
    const rows = [
      { ...common, scope_id: "scope-allocated", total_expense_amount: "100", total_assigned_amount: "80", total_repaid_amount: "30", total_received_amount: "50", owner_portion_amount: "20" },
      { ...common, scope_id: "scope-unallocated", total_expense_amount: "100", total_assigned_amount: "80", total_repaid_amount: "0", total_received_amount: "50", owner_portion_amount: "20" },
      { ...common, scope_id: "scope-empty", total_expense_amount: "100", total_assigned_amount: "80", total_repaid_amount: "0", total_received_amount: "0", owner_portion_amount: "20" },
      { ...common, scope_id: "scope-other", total_expense_amount: "900", total_assigned_amount: "300", total_repaid_amount: "100", total_received_amount: "100", owner_portion_amount: "600" },
    ];
    const database = drizzle(async (sql) => {
      queries.push(sql);
      return { rows };
    }) as unknown as Database;

    const summaries = await readLedgerOverviewSummaries(database, [
      "scope-allocated",
      "scope-unallocated",
      "scope-empty",
      "scope-other",
    ]);

    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(
      /COALESCE\(\(SELECT SUM\(amount::numeric\) FROM repayments WHERE ledger_scope_id = selected\.scope_id\), 0\)::text AS total_received_amount/i,
    );
    expect(queries[0]).toMatch(
      /totals\.total_repaid_amount,\s+totals\.total_received_amount,\s+totals\.owner_portion_amount/i,
    );
    expect(summaries.get("scope-allocated")).toEqual({
      totalExpenseAmount: 100,
      totalRepaidAmount: 30,
      totalOutstandingAmount: 50,
    });
    expect(summaries.get("scope-unallocated")).toEqual({
      totalExpenseAmount: 100,
      totalRepaidAmount: 0,
      totalOutstandingAmount: 80,
    });
    expect(summaries.get("scope-empty")).toEqual({
      totalExpenseAmount: 100,
      totalRepaidAmount: 0,
      totalOutstandingAmount: 80,
    });
    expect(summaries.get("scope-other")).toEqual({
      totalExpenseAmount: 900,
      totalRepaidAmount: 100,
      totalOutstandingAmount: 200,
    });
  });
});
