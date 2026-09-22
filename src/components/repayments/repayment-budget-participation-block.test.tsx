import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RepaymentBudgetParticipationBlock } from "./repayment-budget-participation-block";

describe("repayment Budget participation", () => {
  it("keeps actual cash separate from the amount applied to Budget", () => {
    render(<RepaymentBudgetParticipationBlock
      participation={{ status: "included", transactionId: "transaction-a", actualAmount: 300_000, appliedAmount: 150_000 }}
      repaymentId="repayment-a"
      actualAmount={300_000}
      action={vi.fn()}
    />);

    expect(screen.getByText("Included")).toBeInTheDocument();
    expect(screen.getByText("Actual repayment").nextElementSibling).toHaveTextContent("Rp 300.000");
    expect(screen.getByText("Applied to Budget").nextElementSibling).toHaveTextContent("Rp 150.000");
    expect(screen.getByRole("button", { name: "Exclude from Budget" })).toBeInTheDocument();
  });

  it("shows zero-impact included state and offers a way to include exclusions", () => {
    const { rerender } = render(<RepaymentBudgetParticipationBlock
      participation={{ status: "included", transactionId: "transaction-a", actualAmount: 300_000, appliedAmount: 0 }}
      repaymentId="repayment-a"
      actualAmount={300_000}
      action={vi.fn()}
    />);
    expect(screen.getByText("Applied to Budget").nextElementSibling).toHaveTextContent("Rp 0");

    rerender(<RepaymentBudgetParticipationBlock participation={{ status: "not_included" }} repaymentId="repayment-a" actualAmount={300_000} action={vi.fn()} />);
    expect(screen.getByText("Not included")).toBeInTheDocument();
    expect(screen.queryByText("Applied to Budget")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Include in Budget" })).toBeInTheDocument();
  });
});
