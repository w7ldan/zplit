import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(() => "database"),
  listBudgetTransactions: vi.fn(),
  listBudgetCategoryOptions: vi.fn(),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/budgeting/transactions", () => ({ listBudgetTransactions: mocks.listBudgetTransactions }));
vi.mock("@/server/budgeting/categories", () => ({ listBudgetCategoryOptions: mocks.listBudgetCategoryOptions }));
vi.mock("../actions", () => ({
  changePersonalExpenseBudgetCategoryAction: vi.fn(),
  voidBudgetTransactionAction: vi.fn(),
}));

import BudgetTransactionsPage from "./page";

describe("/app/personal/budget/transactions presentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.listBudgetTransactions.mockResolvedValue([
      {
        id: "transaction-expense",
        direction: "outflow",
        amount: 600,
        description: "Dinner",
        occurredOn: "2026-09-05",
        status: "posted",
        origin: "linked",
        sourceType: "personal_expense",
        sourceId: "expense-a",
        categoryName: "Food + Transport + Dining",
        categoryNames: ["Food", "Transport", "Dining"],
        categoryId: null,
      },
      {
        id: "transaction-repayment",
        direction: "inflow",
        amount: 300,
        description: "Repayment",
        occurredOn: "2026-09-06",
        status: "voided",
        origin: "linked",
        sourceType: "personal_repayment",
        sourceId: null,
        categoryName: "Not absorbed",
        categoryNames: [],
        categoryId: null,
      },
    ]);
    mocks.listBudgetCategoryOptions.mockResolvedValue([{ id: "food", name: "Food" }]);
  });

  it("keeps category changes closed and bounds multi-category repayment labels", async () => {
    render(await BudgetTransactionsPage());

    expect(screen.getByText("Multiple categories", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("Food + Transport + Dining")).not.toBeInTheDocument();
    const categoryDisclosure = screen.getByText("Change budget category").closest("details");
    expect(categoryDisclosure).toBeInTheDocument();
    expect(categoryDisclosure).not.toHaveAttribute("open");
    expect(screen.queryByRole("button", { name: "Void" })).not.toBeInTheDocument();
    expect(screen.getByText("Personal repayment")).toBeInTheDocument();
  });
});
