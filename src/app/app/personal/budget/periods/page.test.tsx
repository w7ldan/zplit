import { render, screen, within } from "@testing-library/react";
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
      { id: "period-2", ordinal: 2, name: "October", startsOn: "2026-10-01", endsOn: "2026-10-31", status: "active", totalBudget: 100000, netSpent: 25000, remaining: 75000, categories: [{ id: "groceries", name: "Groceries", allocatedAmount: 50000, outflowApplied: 25000, inflowApplied: 0, netSpent: 25000, remaining: 25000 }] },
      { id: "period-1", ordinal: 1, name: "September", startsOn: "2026-09-01", endsOn: "2026-09-30", status: "closed", totalBudget: 80000, netSpent: 90000, remaining: -10000, categories: [{ id: "food", name: "Food", allocatedAmount: 80000, outflowApplied: 90000, inflowApplied: 0, netSpent: 90000, remaining: -10000 }] },
    ]);
  });

  it("shows newest-first read-only summaries and category detail", async () => {
    render(await BudgetPeriodsPage());
    expect(screen.getByRole("heading", { name: "Period history" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "October" })).toBeInTheDocument();
    expect(screen.getByText(/Closed/)).toBeInTheDocument();
    expect(screen.getByText("Food")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit|delete|reopen/i })).not.toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Budget sections" });
    expect(within(nav).getByRole("link", { name: "Period history" })).toHaveAttribute("href", "/app/personal/budget/periods");
    expect(within(nav).getByRole("link", { name: "Period history" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/app/personal/budget");
  });

  it("separates the current period from previous periods without exposing internal ordinals", async () => {
    render(await BudgetPeriodsPage());
    const current = screen.getByRole("heading", { level: 2, name: "October" }).closest("section")!;
    expect(within(current).getByText("Current period")).toBeInTheDocument();
    expect(within(current).getByText("Active")).toBeInTheDocument();
    for (const label of ["Remaining", "Net spent", "Total budget"]) {
      expect(within(current).getByText(label)).toBeInTheDocument();
    }
    const previous = screen.getByRole("heading", { level: 2, name: "Previous periods" }).closest("section")!;
    expect(within(previous).getByText("September")).toBeInTheDocument();
    expect(within(previous).getByText(/Closed/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("Ordinal");
  });

  it("keeps collapsed rows scannable and the category breakdown subordinate to the expanded detail", async () => {
    render(await BudgetPeriodsPage());
    const previous = screen.getByRole("heading", { level: 2, name: "Previous periods" }).closest("section")!;
    const row = within(previous).getByText("September").closest("details")!;
    const summary = row.querySelector("summary")!;
    expect(summary).toHaveTextContent("01 Sept 2026 – 30 Sept 2026");
    expect(summary).toHaveTextContent("Net spent");
    expect(summary).toHaveTextContent("-Rp 10.000 remaining");
    expect(summary).not.toHaveTextContent("Food");
    expect(row).not.toHaveAttribute("open");
    const breakdown = within(row).getByRole("heading", { level: 3, name: "Category breakdown" });
    expect(breakdown).toBeInTheDocument();
    expect(within(row).getByRole("heading", { level: 3, name: "Summary" })).toBeInTheDocument();
    expect(within(row).getByText("Allocated · Net spent · Remaining")).toBeInTheDocument();
  });

  it("keeps the current period breakdown behind a native disclosure", async () => {
    render(await BudgetPeriodsPage());
    const current = screen.getByRole("heading", { level: 2, name: "October" }).closest("section")!;
    const disclosure = within(current).getByText("View category breakdown").closest("details")!;
    expect(disclosure.tagName).toBe("DETAILS");
    expect(within(disclosure).getByText("Groceries")).toBeInTheDocument();
  });
});
