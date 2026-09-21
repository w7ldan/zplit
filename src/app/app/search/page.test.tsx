import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SearchPage from "./page";

const mocks = vi.hoisted(() => ({
  searchGlobalRecords: vi.fn(),
  getAuthenticatedLedger: vi.fn(),
}));

vi.mock("@/server/authenticated-ledger", () => ({ getAuthenticatedLedger: mocks.getAuthenticatedLedger }));

describe("/app/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedLedger.mockResolvedValue({ ledger: { searchGlobalRecords: mocks.searchGlobalRecords } });
    mocks.searchGlobalRecords.mockResolvedValue([
      { kind: "friend", id: "friend-a", title: "Ari", detail: "Open balance" },
      { kind: "expense", id: "expense-a", title: "Dinner", detail: "Saturday", amount: 125000 },
      { kind: "repayment", id: "repayment-a", title: "Ari", amount: 50000, date: "2026-08-04T00:00:00.000Z" },
    ]);
  });

  it("keeps query state in the URL and groups real ledger result types", async () => {
    render(await SearchPage({ searchParams: Promise.resolve({ q: "Ari" }) }));
    expect(mocks.searchGlobalRecords).toHaveBeenCalledWith("Ari");
    expect(screen.getByRole("search")).toHaveAttribute("action", "/app/search");
    expect(screen.getByRole("searchbox", { name: "Search records" })).toHaveValue("Ari");
    expect(screen.getByRole("heading", { name: "Friends" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Expenses" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Repayments" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Friend: Ari" })).toHaveAttribute("href", "/app/friends/friend-a");
    expect(screen.getByRole("link", { name: "Expense: Dinner" })).toHaveAttribute("href", "/app/expenses/expense-a");
    expect(screen.getByRole("link", { name: "Repayment: Ari" })).toHaveAttribute("href", "/app/repayments/repayment-a");
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("distinguishes the initial no-query state from no results", async () => {
    const { unmount } = render(await SearchPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Type a query to search your ledger.")).toBeInTheDocument();
    expect(mocks.searchGlobalRecords).not.toHaveBeenCalled();
    unmount();

    mocks.searchGlobalRecords.mockResolvedValue([]);
    render(await SearchPage({ searchParams: Promise.resolve({ q: "missing" }) }));
    expect(screen.getByRole("heading", { name: "No matching records." })).toBeInTheDocument();
    expect(screen.getByText("0 results for “missing”")).toBeInTheDocument();
  });
});
