import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), listGroups: vi.fn(), getAuthenticatedLedger: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/groups", () => ({ listGroups: mocks.listGroups }));
vi.mock("@/server/authenticated-ledger", () => ({ getAuthenticatedLedger: mocks.getAuthenticatedLedger }));
import PersonalPage from "./page";

const emptySummary = {
  totalExpenseAmount: 0,
  totalAssignedAmount: 0,
  totalRepaidAmount: 0,
  totalReceivedAmount: 0,
  totalUnallocatedRepaymentAmount: 0,
  totalOutstandingAmount: 0,
  ownerPortionAmount: 0,
  totalAssignedFriendCount: 0,
  friendBalances: [],
};

describe("/app/personal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.listGroups.mockResolvedValue([]);
    mocks.getAuthenticatedLedger.mockResolvedValue({
      ledger: {
        getLedgerOverviewSummary: vi.fn().mockResolvedValue(emptySummary),
        listRecentActivity: vi.fn().mockResolvedValue([]),
      },
    });
  });

  it("keeps the existing ledger destinations and gives an empty Personal workspace honest states", async () => {
    render(await PersonalPage());

    expect(screen.getByRole("heading", { level: 1, name: "Personal" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Personal snapshot" })).toBeInTheDocument();
    expect(screen.getByText("Still owed to you")).toBeInTheDocument();
    expect(screen.getByText("All settled up.")).toBeInTheDocument();
    for (const [name, href] of [["Friends", "/app/friends"], ["Outings", "/app/outings"], ["Expenses", "/app/expenses"], ["Repayments", "/app/repayments"]]) {
      expect(screen.getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute("href", href);
    }
    expect(screen.getByRole("heading", { level: 2, name: "Your workspace" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Groups" })).toBeInTheDocument();
    expect(screen.getByText("No groups yet.")).toBeInTheDocument();
    expect(screen.getByText("No expenses or repayments yet.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/organization record|member count|permission/i);
  });

  it("renders canonical snapshot data, five meaningful balances, recent activity, and groups", async () => {
    const summary = {
      ...emptySummary,
      totalExpenseAmount: 120_000,
      totalAssignedAmount: 70_000,
      totalRepaidAmount: 20_000,
      totalReceivedAmount: 30_000,
      totalUnallocatedRepaymentAmount: 10_000,
      totalOutstandingAmount: 50_000,
      ownerPortionAmount: 50_000,
      totalAssignedFriendCount: 7,
      friendBalances: Array.from({ length: 7 }, (_, index) => ({
        friendId: `friend-${index}`,
        name: `Friend ${index}`,
        archived: false,
        assignedAmount: 20_000,
        repaidAmount: index === 6 ? 20_000 : 0,
        outstandingAmount: index === 6 ? 0 : 20_000 - index,
      })),
    };
    const getLedgerOverviewSummary = vi.fn().mockResolvedValue(summary);
    const listRecentActivity = vi.fn().mockResolvedValue([
      { kind: "Expense", id: "expense-a", title: "Dinner", detail: "Jakarta", amount: 80_000, date: new Date("2026-08-28T10:00:00Z") },
      { kind: "Repayment", id: "repayment-a", title: "Friend 0", detail: "Money received", amount: 20_000, date: new Date("2026-08-29T10:00:00Z") },
    ]);
    mocks.getAuthenticatedLedger.mockResolvedValue({ ledger: { getLedgerOverviewSummary, listRecentActivity } });
    mocks.listGroups.mockResolvedValue([{ id: "group-a", name: "Bandung Trip", description: null, role: "member", participantCount: 3, avatar: null }]);

    render(await PersonalPage());

    expect(getLedgerOverviewSummary).toHaveBeenCalledOnce();
    expect(listRecentActivity).toHaveBeenCalledExactlyOnceWith({ limit: 5 });
    expect(screen.getByText("Rp 50.000")).toBeInTheDocument();
    expect(screen.getByText("Rp 10.000")).toBeInTheDocument();
    const balances = screen.getByRole("heading", { level: 2, name: "Friend balances" }).closest("section")!;
    expect(within(balances).getAllByRole("link", { name: /Friend [0-4]/ })).toHaveLength(5);
    expect(screen.queryByRole("link", { name: /Friend 6/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Dinner/ })).toHaveAttribute("href", "/app/expenses/expense-a");
    expect(screen.getByRole("link", { name: /Friend 0.*Money received/ })).toHaveAttribute("href", "/app/repayments/repayment-a");
    expect(screen.getByRole("link", { name: /Bandung Trip/ })).toHaveAttribute("href", "/app/personal/groups/group-a");
    expect(document.querySelector(".personal-destination[href='/app/friends']")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/organization/i);
  });
});
