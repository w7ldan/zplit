import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BudgetPlanForm, BudgetSetupForm, BudgetSpreadForm, BudgetTransactionForm, BudgetTransitionForm } from "./budget-forms";
import type { BudgetFormState, BudgetPlanValues, BudgetSetupValues, BudgetTransactionValues } from "@/app/app/personal/budget/actions";
import type { BudgetSpreadValues, BudgetTransitionValues } from "@/app/app/personal/budget/actions";

const setupAction = vi.fn(async (state: BudgetFormState<BudgetSetupValues>) => state);
const planAction = vi.fn(async (state: BudgetFormState<BudgetPlanValues>) => state);
const transactionAction = vi.fn(async (state: BudgetFormState<BudgetTransactionValues>) => state);
const spreadAction = vi.fn(async (state: BudgetFormState<BudgetSpreadValues>) => state);
const transitionAction = vi.fn(async (state: BudgetFormState<BudgetTransitionValues>) => state);

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

  it("shows a compact spread control and warns before closing a period", () => {
    render(<BudgetSpreadForm action={spreadAction} transactionId="transaction-a" amount={1200000} />);
    expect(screen.getByLabelText("Periods")).toHaveAttribute("max", "24");
    expect(screen.getByText(/positive whole Rupiah slices/)).toBeInTheDocument();
    render(<BudgetTransitionForm action={transitionAction} period={{ id: "period-a", name: "September", startsOn: "2026-09-01", endsOn: "2026-09-30", totalBudget: 100000 }} categories={[{ id: "uncategorized", name: "Uncategorized", allocation: "0" }, { id: "food", name: "Food", allocation: "50000" }]} pending={[{ categoryId: "food", categoryName: "Food", amount: 10000 }]} />);
    expect(document.body.textContent).toContain("closes September immediately");
    expect(screen.getByText("Coming into this period")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Uncategorized")).toHaveAttribute("readonly");
  });

  it("associates transaction field errors with their controls and announces the form error once", async () => {
    const failingAction = vi.fn(async () => ({
      fieldErrors: { amount: "Enter a whole Rupiah amount greater than zero.", description: "Description is required." },
      formError: "Please correct the marked fields.",
      values: { direction: "outflow" as const, amount: "", description: "", occurredOn: "", categoryId: "" },
    }));
    const { container } = render(<BudgetTransactionForm action={failingAction} categories={[{ id: "food", name: "Food" }]} />);

    fireEvent.submit(container.querySelector("form")!);

    const amount = await screen.findByLabelText("Amount");
    expect(amount).toHaveAttribute("aria-invalid", "true");
    expect(amount).toHaveAttribute("aria-describedby", "budget-transaction-amount-error");
    expect(screen.getByText("Enter a whole Rupiah amount greater than zero.")).toHaveAttribute("id", "budget-transaction-amount-error");
    const description = screen.getByLabelText("Description");
    expect(description).toHaveAttribute("aria-invalid", "true");
    expect(description).toHaveAttribute("aria-describedby", "budget-transaction-description-error");
    const message = screen.getByText("Please correct the marked fields.");
    expect(message).toHaveAttribute("role", "alert");
    expect(message).not.toHaveAttribute("aria-live");
  });

  it("previews recurring candidates for proposed dates and defaults them selected", () => {
    render(<BudgetTransitionForm
      action={transitionAction}
      period={{ id: "period-a", name: "September", startsOn: "2026-09-01", endsOn: "2026-09-30", totalBudget: 100000 }}
      categories={[{ id: "uncategorized", name: "Uncategorized", allocation: "0" }, { id: "food", name: "Food", allocation: "50000" }]}
      pending={[]}
      uncategorizedCategoryId="uncategorized"
      recurringTemplates={[{ id: "gym", name: "Gym", amount: 300000, categoryId: "food", frequency: "monthly", startsOn: "2026-01-31", spreadCount: 3 }]}
    />);
    expect(screen.queryByText("Gym")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Starts on"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Ends on"), { target: { value: "2026-11-30" } });
    expect(screen.getAllByText("Gym")).toHaveLength(2);
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    for (const checkbox of screen.getAllByRole("checkbox")) expect(checkbox).toBeChecked();
    expect(screen.getAllByText("Spread over 3 periods")).toHaveLength(2);
    expect(screen.getAllByLabelText(/Category for Gym/)[0]).toHaveValue("food");
  });
});
