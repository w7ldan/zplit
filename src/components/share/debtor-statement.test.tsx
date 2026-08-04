import { render, screen } from "@testing-library/react";
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
    expect(screen.queryByText(/owner@example.com|phone|notes|payment method/i)).not.toBeInTheDocument();
  });
});
