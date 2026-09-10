import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(() => "database"),
  listBudgetRecurringTemplates: vi.fn(),
  listDueBudgetRecurringOccurrences: vi.fn(),
  getBudgetRecurringDashboardSummary: vi.fn(),
  listActiveBudgetPlanCategoryOptions: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/budgeting/recurring", () => ({
  listBudgetRecurringTemplates: mocks.listBudgetRecurringTemplates,
  listDueBudgetRecurringOccurrences: mocks.listDueBudgetRecurringOccurrences,
  getBudgetRecurringDashboardSummary: mocks.getBudgetRecurringDashboardSummary,
}));
vi.mock("@/server/budgeting/categories", () => ({ listActiveBudgetPlanCategoryOptions: mocks.listActiveBudgetPlanCategoryOptions }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("../actions", () => ({
  archiveBudgetRecurringTemplateAction: vi.fn(),
  createBudgetRecurringTemplateAction: vi.fn(),
  recordBudgetRecurringOccurrenceAction: vi.fn(),
  skipBudgetRecurringOccurrenceAction: vi.fn(),
  updateBudgetRecurringTemplateAction: vi.fn(),
}));

import BudgetSubscriptionsPage from "./page";

describe("/app/personal/budget/subscriptions presentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.listActiveBudgetPlanCategoryOptions.mockResolvedValue([{ id: "category-food", name: "Food" }]);
    mocks.listBudgetRecurringTemplates.mockResolvedValue([{
      id: "template-gym",
      name: "Gym",
      amount: 300_000,
      categoryId: "category-food",
      categoryName: "Food",
      frequency: "monthly",
      startsOn: "2026-01-31",
      spreadCount: 3,
      dueCount: 1,
      nextDueOn: "2026-10-31",
    }]);
    mocks.listDueBudgetRecurringOccurrences.mockResolvedValue([{
      id: "occurrence-gym",
      templateId: "template-gym",
      templateName: "Gym",
      scheduledOn: "2026-10-31",
      amount: 300_000,
      categoryId: "category-food",
      categoryName: "Food",
      spreadCount: 3,
      status: "due",
      budgetTransactionId: null,
    }]);
    mocks.getBudgetRecurringDashboardSummary.mockResolvedValue({ dueCount: 1, expectedAmount: 300_000, nextDueOn: "2026-10-31" });
  });

  it("keeps recurring planning dense and separate from recorded cash", async () => {
    render(await BudgetSubscriptionsPage());
    expect(screen.getByRole("heading", { name: "Subscriptions" })).toBeInTheDocument();
    expect(screen.getAllByText("Gym").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Monthly").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Spread over 3 periods/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Record" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    expect(screen.getByLabelText("Payment date")).toBeInTheDocument();
    expect(screen.getByText(/Nothing here affects spending until a payment is recorded/)).toBeInTheDocument();
    expect(screen.getByText("1 due")).toBeInTheDocument();
  });

  it("reports the real due total when the bounded list is truncated", async () => {
    mocks.getBudgetRecurringDashboardSummary.mockResolvedValue({ dueCount: 140, expectedAmount: 300_000, nextDueOn: "2026-10-31" });
    render(await BudgetSubscriptionsPage());
    expect(screen.getByText("140 due · showing first 1")).toBeInTheDocument();
  });
});
