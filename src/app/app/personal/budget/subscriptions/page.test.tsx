import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(() => "database"),
  listBudgetRecurringTemplates: vi.fn(),
  listDueBudgetRecurringOccurrences: vi.fn(),
  getBudgetRecurringDashboardSummary: vi.fn(),
  listActiveBudgetPlanCategoryOptions: vi.fn(),
  replace: vi.fn(),
  archiveBudgetRecurringTemplateAction: vi.fn(),
  skipBudgetRecurringOccurrenceAction: vi.fn(),
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
  archiveBudgetRecurringTemplateAction: mocks.archiveBudgetRecurringTemplateAction,
  createBudgetRecurringTemplateAction: vi.fn(),
  recordBudgetRecurringOccurrenceAction: vi.fn(),
  skipBudgetRecurringOccurrenceAction: mocks.skipBudgetRecurringOccurrenceAction,
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
    expect(screen.getByRole("heading", { name: "Recurring" })).toBeInTheDocument();
    expect(screen.getAllByText("Gym").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Monthly").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Spread over 3 periods/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Record Gym payment" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Skip Gym occurrence scheduled/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive Gym recurring expense" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Payment date for Gym/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing here affects spending until a payment is recorded/)).toBeInTheDocument();
    expect(screen.getByText("1 due")).toBeInTheDocument();
  });

  it("requires confirmation before archiving a recurring expense", async () => {
    render(await BudgetSubscriptionsPage());
    fireEvent.click(screen.getByRole("button", { name: "Archive Gym recurring expense" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Archive recurring expense?" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Gym");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mocks.archiveBudgetRecurringTemplateAction).not.toHaveBeenCalled();
    fireEvent.transitionEnd(dialog, { propertyName: "transform" });
    fireEvent.click(screen.getByRole("button", { name: "Archive Gym recurring expense" }));
    const reopened = screen.getByRole("dialog");
    fireEvent.submit(within(reopened).getByRole("button", { name: "Archive recurring expense" }).closest("form")!);
    await waitFor(() => expect(mocks.archiveBudgetRecurringTemplateAction).toHaveBeenCalledOnce());
  });

  it("requires confirmation before skipping an occurrence", async () => {
    render(await BudgetSubscriptionsPage());
    fireEvent.click(screen.getByRole("button", { name: /Skip Gym occurrence scheduled/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Skip occurrence?" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Gym");
    fireEvent.submit(within(dialog).getByRole("button", { name: "Skip occurrence" }).closest("form")!);
    await waitFor(() => expect(mocks.skipBudgetRecurringOccurrenceAction).toHaveBeenCalledOnce());
  });

  it("explains the unresolved-occurrence empty state with a forward action", async () => {
    mocks.listDueBudgetRecurringOccurrences.mockResolvedValue([]);
    mocks.getBudgetRecurringDashboardSummary.mockResolvedValue({ dueCount: 0, expectedAmount: 0, nextDueOn: null });
    render(await BudgetSubscriptionsPage());
    expect(screen.getByText("No recurring payments are due right now.")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Upcoming and due" })).getByRole("link", { name: "Add recurring expense" })).toHaveAttribute("href", "/app/personal/budget/subscriptions?create=template");
  });

  it("reports the real due total when the bounded list is truncated", async () => {
    mocks.getBudgetRecurringDashboardSummary.mockResolvedValue({ dueCount: 140, expectedAmount: 300_000, nextDueOn: "2026-10-31" });
    render(await BudgetSubscriptionsPage());
    expect(screen.getByText("140 due · showing first 1")).toBeInTheDocument();
  });

  it("links to the semantic Budget sections and marks the current one", async () => {
    render(await BudgetSubscriptionsPage());
    const nav = screen.getByRole("navigation", { name: "Budget sections" });
    expect(within(nav).getByRole("link", { name: "Recurring" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Transactions" })).toHaveAttribute("href", "/app/personal/budget/transactions");
    expect(within(nav).getByRole("link", { name: "Period history" })).toHaveAttribute("href", "/app/personal/budget/periods");
  });
});
