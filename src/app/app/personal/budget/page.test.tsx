import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(() => "database"),
  getBudgetDashboard: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/budgeting/reporting", () => ({ getBudgetDashboard: mocks.getBudgetDashboard }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("./actions", () => ({ createBudgetSetupAction: vi.fn(), createBudgetTransactionAction: vi.fn(), updateBudgetPlanAction: vi.fn() }));

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
});
