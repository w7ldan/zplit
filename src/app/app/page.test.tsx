import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AppPage from "./page";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  createLedgerRepository: vi.fn(),
  getDatabase: vi.fn(() => "database"),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/domain/ledger-repository", () => ({ createLedgerRepository: mocks.createLedgerRepository }));

const summary = {
  totalExpenseAmount: 30_000,
  totalAssignedAmount: 11_000,
  totalRepaidAmount: 7_000,
  totalReceivedAmount: 12_000,
  totalUnallocatedRepaymentAmount: 5_000,
  totalOutstandingAmount: 4_000,
  ownerPortionAmount: 19_000,
  totalAssignedFriendCount: 1,
  friendBalances: [{ friendId: "friend-a", name: "Ari", archived: false, assignedAmount: 9_000, repaidAmount: 6_000, outstandingAmount: 3_000 }],
};

describe("/app overview", () => {
  it("answers outstanding, balances, recent activity, and unallocated attention", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    const listRecentActivity = vi.fn().mockResolvedValue([
      { kind: "Expense", id: "expense-a", title: "Dinner", detail: "Jakarta", amount: 8_000, date: new Date("2026-01-02T10:30:00Z") },
      { kind: "Repayment", id: "repayment-a", title: "Ari", detail: "Money received · unallocated remains open", amount: 5_000, date: new Date("2026-01-03T10:30:00Z") },
    ]);
    const repository = {
      getLedgerOverviewSummary: vi.fn().mockResolvedValue(summary),
      listRecentActivity,
    };
    mocks.createLedgerRepository.mockReturnValue(repository);

    render(await AppPage());

    expect(listRecentActivity).toHaveBeenCalledExactlyOnceWith({ limit: 6 });
    expect("listExpenses" in repository).toBe(false);
    expect("listRepayments" in repository).toBe(false);
    expect(screen.getByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
    expect(screen.getByText("Overview · your balances")).toBeInTheDocument();
    expect(screen.getByText("See what friends still owe, what needs allocation, and your latest activity.")).toBeInTheDocument();
    const primary = document.querySelector<HTMLElement>(".overview-summary")!;
    expect(primary.querySelectorAll("strong")).toHaveLength(3);
    for (const label of ["Still owed to you", "Needs allocation", "Total spending"]) {
      expect(within(primary).getByText(label, { exact: true })).toBeInTheDocument();
    }
    expect(screen.getByText("Ledger totals")).toBeInTheDocument();
    for (const label of ["Assigned", "Repaid", "Received", "Your portion", "Friend balances", "Recent activity"]) {
      expect(screen.getAllByText(label, { exact: true }).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("Rp 4.000")).toBeInTheDocument();
    expect(screen.getAllByText("Ari").length).toBeGreaterThan(0);
    expect(screen.getByText("Received money still needs an expense.")).toBeInTheDocument();
    expect(screen.getByText(/received remains unallocated/)).toBeInTheDocument();
    const activityRows = [...document.querySelectorAll<HTMLAnchorElement>(".activity-row")];
    expect(activityRows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Dinner"),
      expect.stringContaining("Ari"),
    ]);
    expect(screen.getByRole("link", { name: /Dinner/ })).toHaveAttribute("href", "/app/expenses/expense-a");
    expect(activityRows[1]).toHaveAttribute("href", "/app/repayments/repayment-a");
    expect(screen.getByText("Rp 3.000")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/chart|dashboard|percentage/i);
  });

  it("keeps the empty activity and balance states", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    const repository = {
      getLedgerOverviewSummary: vi.fn().mockResolvedValue({
        ...summary,
        totalExpenseAmount: 0,
        totalAssignedAmount: 0,
        totalRepaidAmount: 0,
        totalReceivedAmount: 0,
        totalUnallocatedRepaymentAmount: 0,
        totalOutstandingAmount: 0,
        ownerPortionAmount: 0,
        totalAssignedFriendCount: 0,
        friendBalances: [],
      }),
      listRecentActivity: vi.fn().mockResolvedValue([]),
    };
    mocks.createLedgerRepository.mockReturnValue(repository);

    render(await AppPage());

    expect(screen.getByText("No expenses or repayments yet.")).toBeInTheDocument();
    expect(screen.getByText("No balances yet.")).toBeInTheDocument();
    expect(screen.getByText("Balances appear after assigning friends to an expense.")).toBeInTheDocument();
    expect(repository.listRecentActivity).toHaveBeenCalledExactlyOnceWith({ limit: 6 });
  });

  it("renders the bounded balance list and links to the full friend list", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({
      getLedgerOverviewSummary: vi.fn().mockResolvedValue({ ...summary, totalAssignedFriendCount: 9, friendBalances: Array.from({ length: 8 }, (_, index) => ({ ...summary.friendBalances[0]!, friendId: `friend-${index}`, name: `Friend ${index}` })) }),
      listRecentActivity: vi.fn().mockResolvedValue([]),
    });

    render(await AppPage());

    expect(document.querySelectorAll(".balance-row")).toHaveLength(8);
    expect(screen.getByRole("link", { name: /View all friends/ })).toHaveAttribute("href", "/app/friends");
  });

  it("keeps long balance and activity values in the overview data", async () => {
    const name = "friend-" + "x".repeat(240);
    const title = "expense-" + "z".repeat(240);
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({
      getLedgerOverviewSummary: vi.fn().mockResolvedValue({ ...summary, friendBalances: [{ ...summary.friendBalances[0]!, name }] }),
      listRecentActivity: vi.fn().mockResolvedValue([{ kind: "Expense", id: "expense-a", title, detail: "outing-" + "y".repeat(240), amount: 8_000, date: new Date("2026-01-02T10:30:00Z") }]),
    });

    render(await AppPage());

    expect(screen.getByRole("link", { name: new RegExp(name) })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: new RegExp(title) })).toBeInTheDocument();
  });
});
