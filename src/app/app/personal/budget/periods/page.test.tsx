import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(() => "database"), listBudgetPeriodHistory: vi.fn() }));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/budgeting/reporting", () => ({ listBudgetPeriodHistory: mocks.listBudgetPeriodHistory }));

import BudgetPeriodsPage from "./page";

describe("Budget period history presentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.listBudgetPeriodHistory.mockResolvedValue([
      { id: "period-2", ordinal: 2, name: "October", startsOn: "2026-10-01", endsOn: "2026-10-31", status: "active", totalBudget: 100000, netSpent: 25000, remaining: 75000, categories: [{ id: "food", name: "Food", allocatedAmount: 50000, outflowApplied: 25000, inflowApplied: 0, netSpent: 25000, remaining: 25000 }] },
      { id: "period-1", ordinal: 1, name: "September", startsOn: "2026-09-01", endsOn: "2026-09-30", status: "closed", totalBudget: 80000, netSpent: 90000, remaining: -10000, categories: [] },
    ]);
  });

  it("shows newest-first read-only summaries and category detail", async () => {
    render(await BudgetPeriodsPage());
    expect(screen.getByRole("heading", { name: "Budget periods" })).toBeInTheDocument();
    expect(screen.getAllByRole("group")[0]).toHaveTextContent("October");
    expect(screen.getByText(/Closed/)).toBeInTheDocument();
    expect(screen.getByText("Food")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit|delete|reopen/i })).not.toBeInTheDocument();
  });
});
