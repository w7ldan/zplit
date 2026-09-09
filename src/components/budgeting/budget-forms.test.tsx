import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BudgetPlanForm, BudgetSetupForm, BudgetTransactionForm } from "./budget-forms";
import type { BudgetFormState, BudgetPlanValues, BudgetSetupValues, BudgetTransactionValues } from "@/app/app/personal/budget/actions";

const setupAction = vi.fn(async (state: BudgetFormState<BudgetSetupValues>) => state);
const planAction = vi.fn(async (state: BudgetFormState<BudgetPlanValues>) => state);
const transactionAction = vi.fn(async (state: BudgetFormState<BudgetTransactionValues>) => state);

describe("budget forms", () => {
  it("renders setup fields without asking the user to enter Uncategorized", () => {
    render(<BudgetSetupForm action={setupAction} />);
    expect(screen.getByLabelText("Period name")).toBeInTheDocument();
    expect(screen.getByLabelText("Starts on")).toHaveAttribute("type", "date");
    expect(screen.queryByLabelText(/Uncategorized/i)).not.toBeInTheDocument();
  });

  it("preserves plan category identity while keeping the system name immutable", () => {
    render(<BudgetPlanForm action={planAction} period={{ name: "September", startsOn: "2026-09-01", endsOn: "2026-09-30", updatedAt: "2026-09-09T00:00:00.000Z", totalBudget: 100000 }} categories={[{ id: "system", name: "Uncategorized", allocatedAmount: 0, systemKey: "uncategorized" }, { id: "food", name: "Food", allocatedAmount: 50000, systemKey: null }]} />);
    expect(screen.getByDisplayValue("Uncategorized")).toHaveAttribute("readonly");
    expect(screen.getByDisplayValue("Food")).toBeInTheDocument();
    expect(screen.getAllByDisplayValue("system")).toHaveLength(1);
  });

  it("maps transaction labels to date and category inputs", () => {
    render(<BudgetTransactionForm action={transactionAction} categories={[{ id: "food", name: "Food" }]} initialValues={{ direction: "inflow", amount: "100.000", description: "Refund", occurredOn: "2026-09-03", categoryId: "food" }} />);
    expect(screen.getByLabelText("Credit / refund")).toBeChecked();
    expect(screen.getByLabelText("Date")).toHaveValue("2026-09-03");
    expect(screen.getByLabelText("Category")).toHaveValue("food");
    expect(screen.getByDisplayValue("100.000")).toBeInTheDocument();
  });
});
