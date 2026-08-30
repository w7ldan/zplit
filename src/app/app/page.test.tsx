import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppPage from "./page";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  createLedgerRepository: vi.fn(),
  getDatabase: vi.fn(() => "database"),
  readOverviewSpaces: vi.fn(),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/app-overview", () => ({ readOverviewSpaces: mocks.readOverviewSpaces }));
vi.mock("@/server/authenticated-ledger", () => ({ getAuthenticatedLedger: async (session?: { user: { id: string } }) => { const current = session ?? await mocks.requireSession(); return { user: current.user, ledger: mocks.createLedgerRepository(mocks.getDatabase(), current.user.id) }; } }));
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
  beforeEach(() => {
    mocks.readOverviewSpaces.mockResolvedValue({ groups: [], organizations: [] });
  });

  it("answers outstanding, balances, and actionable partial allocation attention", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    const listRecentActivity = vi.fn().mockResolvedValue([
      { kind: "Expense", id: "expense-a", title: "Dinner", detail: "Jakarta", amount: 8_000, date: new Date("2026-01-02T10:30:00Z") },
      { kind: "Repayment", id: "repayment-a", title: "Ari", detail: "Money received · unallocated remains open", amount: 5_000, date: new Date("2026-01-03T10:30:00Z") },
    ]);
    const repository = {
      getLedgerOverviewSummary: vi.fn().mockResolvedValue(summary),
      listRecentActivity,
      listNeedsAttentionRepayments: vi.fn().mockResolvedValue({ items: [{ id: "repayment-a", ownerUserId: "owner-a", friendId: "friend-a", amount: 8_000, paidAt: new Date("2026-01-03T10:30:00Z"), paymentMethod: null, notes: null, createdAt: new Date("2026-01-03T10:30:00Z"), friendName: "Ari", friendArchivedAt: null, allocatedAmount: 3_000, unallocatedAmount: 5_000 }], totalItems: 1 }),
    };
    mocks.createLedgerRepository.mockReturnValue(repository);

    render(await AppPage());

    expect(listRecentActivity).toHaveBeenCalledExactlyOnceWith({ limit: 6 });
    expect("listExpenses" in repository).toBe(false);
    expect("listRepayments" in repository).toBe(false);
    expect(screen.getByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
    expect(screen.getByText("Overview · your Zplit")).toBeInTheDocument();
    expect(screen.getByText("Your Zplit workspace across Personal, Groups, and Organizations.")).toBeInTheDocument();
    const primary = document.querySelector<HTMLElement>(".overview-summary")!;
    expect(primary.querySelectorAll("strong")).toHaveLength(3);
    for (const label of ["Still owed to you", "Needs allocation", "Total spending"]) {
      expect(within(primary).getByText(label, { exact: true })).toBeInTheDocument();
    }
    const clarity = document.querySelector<HTMLDetailsElement>(".overview-ledger-clarity");
    expect(clarity).toBeInTheDocument();
    expect(clarity).not.toHaveAttribute("open");
    expect(within(clarity!).getByText("How are these totals calculated?", { exact: true })).toBeInTheDocument();
    for (const label of ["Spending", "Friend debt", "Repayments", "Friend balances", "Recent activity"]) {
      expect(screen.getAllByText(label, { exact: true }).length).toBeGreaterThan(0);
    }
    expect(within(clarity!).getByText("Total spending = Your portion + Assigned to friends")).toBeInTheDocument();
    expect(within(clarity!).getByText("Assigned to friends = Applied to shares + Still owed")).toBeInTheDocument();
    expect(within(clarity!).getByText("Received = Applied to shares + Needs allocation")).toBeInTheDocument();
    for (const amount of ["Rp 30.000", "Rp 19.000", "Rp 11.000", "Rp 7.000", "Rp 4.000", "Rp 12.000"]) {
      expect(within(clarity!).queryByText(amount, { exact: true })).not.toBeInTheDocument();
    }
    expect(screen.queryByText("Repaid", { exact: true })).not.toBeInTheDocument();
    expect(screen.getAllByText("Rp 4.000").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ari").length).toBeGreaterThan(0);
    expect(screen.getByText("Received money still needs an expense.")).toBeInTheDocument();
    const attention = screen.getByRole("heading", { level: 2, name: "Needs attention" }).closest("section")!;
    expect(attention.querySelectorAll(".overview-attention__row")).toHaveLength(1);
    expect(within(attention).getByText("Rp 5.000 needs allocation")).toBeInTheDocument();
    expect(within(attention).getByRole("link", { name: /Review/ })).toHaveAttribute("href", "/app/repayments/repayment-a#repayment-allocations");
    expect(within(attention).queryByRole("link", { name: /View all/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/received remains unallocated/)).not.toBeInTheDocument();
    const activityRows = [...document.querySelectorAll<HTMLAnchorElement>(".activity-row")];
    expect(activityRows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Dinner"),
      expect.stringContaining("Ari"),
    ]);
    expect(screen.getByRole("link", { name: /Dinner/ })).toHaveAttribute("href", "/app/expenses/expense-a");
    expect(activityRows[1]).toHaveAttribute("href", "/app/repayments/repayment-a");
    expect(screen.getAllByText("Rp 3.000").length).toBeGreaterThan(0);
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
      listNeedsAttentionRepayments: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    };
    mocks.createLedgerRepository.mockReturnValue(repository);

    render(await AppPage());

    expect(screen.getByText("No expenses or repayments yet.")).toBeInTheDocument();
    expect(screen.getByText("No balances yet.")).toBeInTheDocument();
    expect(screen.getByText("No groups yet.")).toBeInTheDocument();
    expect(screen.getByText("No organizations yet.")).toBeInTheDocument();
    expect(screen.getByText("Balances appear after assigning friends to an expense.")).toBeInTheDocument();
    expect(screen.getByText("All received money is applied to shares.")).toBeInTheDocument();
    expect(screen.queryByText("All received money is assigned.")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "Needs attention" })).not.toBeInTheDocument();
    expect(repository.listRecentActivity).toHaveBeenCalledExactlyOnceWith({ limit: 6 });
  });

  it("renders accessible Group and Organization workspaces with scoped financial summaries", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({
      getLedgerOverviewSummary: vi.fn().mockResolvedValue(summary),
      listRecentActivity: vi.fn().mockResolvedValue([]),
      listNeedsAttentionRepayments: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    });
    mocks.readOverviewSpaces.mockResolvedValue({
      groups: [{ id: "group-a", name: "Bandung Trip", description: null, role: "owner", participantCount: 2, avatar: null, youOwe: 20_000, owedToYou: 0 }],
      organizations: [{ id: "org-a", name: "Acme", description: null, role: "member", memberCount: 3, avatar: null, canViewLedger: true, ledgerSummary: { totalOutstandingAmount: 40_000, totalExpenseAmount: 80_000, totalRepaidAmount: 25_000 } }],
    });

    render(await AppPage());

    expect(screen.getByRole("link", { name: /Bandung Trip/ })).toHaveAttribute("href", "/app/personal/groups/group-a");
    expect(screen.getByText("You owe")).toBeInTheDocument();
    expect(screen.getByText("Rp 20.000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Acme/ })).toHaveAttribute("href", "/app/organizations/org-a");
    expect(screen.getByText("OUTSTANDING")).toBeInTheDocument();
    expect(screen.getByText("Rp 40.000")).toBeInTheDocument();
    expect(screen.queryByText("Rp 80.000")).not.toBeInTheDocument();
    expect(screen.queryByText("EXPENSES")).not.toBeInTheDocument();
    expect(screen.queryByText("REPAID")).not.toBeInTheDocument();
    expect(screen.queryByText("Groups will appear here when they are available.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organizations yet.")).not.toBeInTheDocument();
  });

  it("renders a settled Group without inventing a balance", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({
      getLedgerOverviewSummary: vi.fn().mockResolvedValue(summary),
      listRecentActivity: vi.fn().mockResolvedValue([]),
      listNeedsAttentionRepayments: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    });
    mocks.readOverviewSpaces.mockResolvedValue({
      groups: [{
        id: "group-a",
        name: "Bandung Trip",
        description: null,
        role: "member",
        participantCount: 2,
        avatar: null,
        youOwe: 0,
        owedToYou: 0,
      }],
      organizations: [],
    });

    render(await AppPage());

    expect(screen.getByRole("link", { name: /Bandung Trip/ })).toHaveAttribute("href", "/app/personal/groups/group-a");
    expect(screen.getByText("Settled up")).toBeInTheDocument();
  });

  it("keeps an Organization card visible without protected ledger values", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({
      getLedgerOverviewSummary: vi.fn().mockResolvedValue(summary),
      listRecentActivity: vi.fn().mockResolvedValue([]),
      listNeedsAttentionRepayments: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    });
    mocks.readOverviewSpaces.mockResolvedValue({
      groups: [],
      organizations: [{ id: "org-a", name: "Acme", description: null, role: "custom", memberCount: 1, avatar: null, canViewLedger: false, ledgerSummary: null }],
    });

    render(await AppPage());

    expect(screen.getByRole("link", { name: /Acme/ })).toHaveAttribute("href", "/app/organizations/org-a");
    expect(screen.queryByText("OUTSTANDING")).not.toBeInTheDocument();
    expect(screen.queryByText("EXPENSES")).not.toBeInTheDocument();
    expect(screen.queryByText("REPAID")).not.toBeInTheDocument();
  });

  it("shows at most three oldest unresolved repayments and links to the full needs filter", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    const items = ["Oldest", "Next", "Newest", "Beyond"].map((friendName, index) => ({
      id: `repayment-${index}`,
      ownerUserId: "owner-a",
      friendId: `friend-${index}`,
      amount: 10_000,
      paidAt: new Date(`2026-01-0${index + 1}T10:30:00Z`),
      paymentMethod: null,
      notes: null,
      createdAt: new Date(`2026-01-0${index + 1}T10:30:00Z`),
      friendName,
      friendArchivedAt: null,
      allocatedAmount: index === 0 ? 0 : 4_000,
      unallocatedAmount: index === 0 ? 10_000 : 6_000,
    }));
    mocks.createLedgerRepository.mockReturnValue({
      getLedgerOverviewSummary: vi.fn().mockResolvedValue(summary),
      listRecentActivity: vi.fn().mockResolvedValue([]),
      listNeedsAttentionRepayments: vi.fn().mockResolvedValue({ items, totalItems: 4 }),
    });

    render(await AppPage());

    const attention = screen.getByRole("heading", { level: 2, name: "Needs attention" }).closest("section")!;
    expect([...attention.querySelectorAll<HTMLElement>(".overview-attention__friend strong")].map((element) => element.textContent)).toEqual(["Oldest", "Next", "Newest"]);
    expect(attention.querySelectorAll(".overview-attention__row")).toHaveLength(3);
    expect(within(attention).getByText("Rp 10.000 needs allocation")).toBeInTheDocument();
    expect(within(attention).getAllByRole("time")).toHaveLength(3);
    expect(within(attention).queryByText("Beyond", { exact: true })).not.toBeInTheDocument();
    expect(within(attention).getByText("4", { exact: true })).toBeInTheDocument();
    expect(within(attention).getByRole("link", { name: /View all unresolved repayments/ })).toHaveAttribute("href", "/app/repayments?allocation=needs");
  });

  it("renders the bounded balance list and links to the full friend list", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({
      getLedgerOverviewSummary: vi.fn().mockResolvedValue({ ...summary, totalAssignedFriendCount: 9, friendBalances: Array.from({ length: 8 }, (_, index) => ({ ...summary.friendBalances[0]!, friendId: `friend-${index}`, name: `Friend ${index}` })) }),
      listRecentActivity: vi.fn().mockResolvedValue([]),
      listNeedsAttentionRepayments: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
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
      listNeedsAttentionRepayments: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    });

    render(await AppPage());

    expect(screen.getByRole("link", { name: new RegExp(name) })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: new RegExp(title) })).toBeInTheDocument();
  });
});
