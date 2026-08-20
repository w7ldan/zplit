import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DebtorStatementView } from "./debtor-statement";

const statement = {
  friendName: "Ada Lovelace",
  generatedAt: new Date("2026-08-04T00:00:00Z"),
  assignedAmount: 100_000,
  repaidAmount: 40_000,
  outstandingAmount: 60_000,
  items: [{
    expenseDescription: "Dinner",
    outingTitle: "Sunday outing",
    outingOccurredAt: new Date("2026-08-03T00:00:00Z"),
    assignedAmount: 100_000,
    repaidAmount: 40_000,
    remainingAmount: 60_000,
    state: "open" as const,
  }],
};

describe("DebtorStatementView", () => {
  it("renders the public data allowlist and explicit repayment states", () => {
    render(<DebtorStatementView statement={statement} expiresAt={new Date("2026-08-11T00:00:00Z")} />);
    expect(screen.getByText("READ-ONLY BALANCE")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
    expect(screen.getAllByText("Rp 60.000")).toHaveLength(2);
    expect(screen.getByText("Dinner")).toBeInTheDocument();
    expect(screen.getByText(/Sunday outing/)).toBeInTheDocument();
    expect(screen.getByText("OPEN")).toBeInTheDocument();
    expect(screen.getByText(/The ledger owner controls the records shown here/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/owner@example.com|phone|notes/i)).not.toBeInTheDocument();
  });

  it("renders complete totals, repayment details, and independent anchored pagers", () => {
    const repayment = {
      paidAt: new Date("2026-08-05T00:00:00Z"),
      amount: 50_000,
      paymentMethod: "Bank transfer",
      allocatedAmount: 30_000,
      unallocatedAmount: 20_000,
      allocations: [{ expenseDescription: "Dinner", outingTitle: "Sunday outing", amount: 30_000 }],
    };
    const noMethodRepayment = { ...repayment, paidAt: new Date("2026-08-04T00:00:00Z"), paymentMethod: null };
    render(<DebtorStatementView
      token="11111111-1111-4111-8111-111111111111"
      statement={{
        ...statement,
        items: [statement.items[0]!],
        expensePage: { items: [statement.items[0]!], page: 2, pageSize: 10, totalItems: 25, totalPages: 3 },
        repayments: [repayment, noMethodRepayment],
        repaymentPage: { items: [repayment, noMethodRepayment], page: 3, pageSize: 10, totalItems: 23, totalPages: 3 },
      }}
      expiresAt={new Date("2026-08-11T00:00:00Z")}
    />);

    expect(screen.getByText("25 items")).toBeInTheDocument();
    expect(screen.getByText("23 items")).toBeInTheDocument();
    expect(screen.getAllByText("Repayment amount")).toHaveLength(2);
    expect(screen.getByText("Bank transfer")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getAllByText("Rp 20.000")).toHaveLength(2);
    expect(screen.getAllByText(/Dinner · Sunday outing/)).toHaveLength(2);

    const expensePagination = screen.getByRole("navigation", { name: "Expense shares pagination" });
    expect(within(expensePagination).getByText("Page 2 of 3")).toBeInTheDocument();
    expect(within(expensePagination).getByRole("link", { name: "Next" })).toHaveAttribute("href", "/share/11111111-1111-4111-8111-111111111111?expensePage=3&repaymentPage=3#expense-shares");

    const repaymentPagination = screen.getByRole("navigation", { name: "Repayment history pagination" });
    expect(within(repaymentPagination).getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/share/11111111-1111-4111-8111-111111111111?expensePage=2&repaymentPage=2#repayment-history");
  });

  it("keeps long private-statement values semantic without adding owner actions", () => {
    const friendName = "friend-" + "x".repeat(240);
    const expenseDescription = "expense-" + "y".repeat(240);
    const outingTitle = "outing-" + "z".repeat(240);
    render(<DebtorStatementView
      statement={{ ...statement, friendName, items: [{ ...statement.items[0]!, expenseDescription, outingTitle }] }}
      expiresAt={new Date("2026-08-11T00:00:00Z")}
    />);

    expect(screen.getByRole("heading", { name: friendName })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: expenseDescription })).toBeInTheDocument();
    expect(screen.getByText(outingTitle, { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
