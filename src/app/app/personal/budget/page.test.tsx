import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(() => "database"),
  getBudgetDashboard: vi.fn(),
  replace: vi.fn(),
  changePersonalExpenseBudgetCategoryAction: vi.fn(),
  changeGroupExpenseBudgetCategoryAction: vi.fn(),
  changeGroupObligationBudgetCategoryAction: vi.fn(),
  importPersonalActivityAction: vi.fn(),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/budgeting/reporting", () => ({ getBudgetDashboard: mocks.getBudgetDashboard }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("./actions", () => ({
  changeGroupExpenseBudgetCategoryAction: mocks.changeGroupExpenseBudgetCategoryAction,
  changeGroupObligationBudgetCategoryAction: mocks.changeGroupObligationBudgetCategoryAction,
  changePersonalExpenseBudgetCategoryAction: mocks.changePersonalExpenseBudgetCategoryAction,
  createBudgetSetupAction: vi.fn(),
  createBudgetTransactionAction: vi.fn(),
  importPersonalActivityAction: mocks.importPersonalActivityAction,
  updateBudgetPlanAction: vi.fn(),
}));

import BudgetPage from "./page";

const period = {
  id: "period-a",
  ordinal: 1,
  name: "September",
  startsOn: "2026-09-01",
  endsOn: "2026-09-30",
  updatedAt: "2026-09-09T00:00:00.000Z",
  totalBudget: 100_000,
  totalAllocated: 50_000,
  unallocatedBudget: 50_000,
  outflowApplied: 0,
  inflowApplied: 0,
  netSpent: 0,
  remaining: 100_000,
  categories: [
    { id: "category-system", name: "Uncategorized", systemKey: "uncategorized", allocatedAmount: 0, outflowApplied: 0, inflowApplied: 0, netSpent: 0, remaining: 0 },
    { id: "category-food", name: "Food", systemKey: null, allocatedAmount: 50_000, outflowApplied: 0, inflowApplied: 0, netSpent: 0, remaining: 50_000 },
  ],
};

describe("/app/personal/budget task-panel modes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getBudgetDashboard.mockResolvedValue({ configured: true, period, recentTransactions: [] });
  });

  it.each([
    [undefined, undefined],
    [{ create: "transaction" }, "Add transaction"],
    [{ create: "plan" }, "Manage plan"],
    [{ create: "unknown" }, undefined],
  ])("derives one panel mode from the shared create query contract (%s)", async (query, title) => {
    render(query === undefined ? await BudgetPage() : await BudgetPage({ searchParams: Promise.resolve(query) }));
    if (title) expect(screen.getByRole("dialog")).toHaveTextContent(title);
    else expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uses the same create values that TaskPanel clears", async () => {
    render(await BudgetPage());
    expect(screen.getByRole("link", { name: "Add transaction" })).toHaveAttribute("href", "/app/personal/budget?create=transaction");
    expect(screen.getByRole("link", { name: "Manage plan" })).toHaveAttribute("href", "/app/personal/budget?create=plan");
  });

  it("labels linked Personal activity and keeps Expected Back outside Remaining", async () => {
    mocks.getBudgetDashboard.mockResolvedValue({
      configured: true,
      period,
      expectedBack: 40_000,
      stillOwe: 20_000,
      groupObligations: [{ id: "obligation-a", groupId: "group-a", groupName: "Trip", description: "Hotel", amount: 20_000, categoryId: null, categoryName: "Uncategorized" }],
      importAvailable: true,
      recurringSummary: { dueCount: 2, expectedAmount: 50_000, nextDueOn: "2026-10-01" },
      recurringTemplates: [],
      recentTransactions: [{
        id: "transaction-expense",
        direction: "outflow",
        amount: 600,
        description: "Dinner",
        occurredOn: "2026-09-05",
        status: "posted",
        origin: "linked",
        sourceType: "personal_expense",
        sourceId: "expense-a",
        categoryName: "Uncategorized",
        categoryNames: ["Uncategorized"],
        categoryId: "category-system",
      }],
    });
    render(await BudgetPage());
    expect(screen.getByText("Personal expense")).toBeInTheDocument();
    const sharedMoney = screen.getByRole("region", { name: "SHARED MONEY" });
    expect(within(sharedMoney).getByText("Expected back")).toBeInTheDocument();
    expect(within(sharedMoney).getByText("Rp 40.000")).toBeInTheDocument();
    expect(within(sharedMoney).getAllByText("You still owe").length).toBeGreaterThan(0);
    expect(within(sharedMoney).getByText("View Group obligations")).toBeInTheDocument();
    expect(document.querySelector(".budget-summary__grid")).not.toHaveTextContent("Expected back");
    const categoryDisclosure = screen.getByText("Change budget category").closest("details");
    expect(categoryDisclosure).toBeInTheDocument();
    expect(categoryDisclosure).not.toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "Import activity" })).toBeInTheDocument();
    expect(screen.getByText(/Upcoming recurring/)).toBeInTheDocument();
    expect(document.querySelector(".budget-summary__grid")).not.toHaveTextContent("Upcoming recurring");
  });
});
