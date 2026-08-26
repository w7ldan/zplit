import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ExpenseRecordPage from "./page";
import { deletionImpactRevision } from "@/domain/ledger-repository";
import { ToastProvider } from "@/components/feedback/toast";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
  createLedgerRepository: vi.fn(),
  listExpenseReceipts: vi.fn(),
  replace: vi.fn(),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/authenticated-ledger", () => ({ getAuthenticatedLedger: async (session?: { user: { id: string } }) => { const current = session ?? await mocks.requireSession(); return { user: current.user, ledger: mocks.createLedgerRepository(mocks.getDatabase(), current.user.id) }; } }));
vi.mock("@/domain/ledger-repository", async () => {
  const actual = await vi.importActual<typeof import("@/domain/ledger-repository")>("@/domain/ledger-repository");
  return { ...actual, createLedgerRepository: mocks.createLedgerRepository };
});
vi.mock("@/server/expense-receipts", () => ({ listExpenseReceipts: mocks.listExpenseReceipts }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, useRouter: () => ({ replace: mocks.replace, refresh: vi.fn() }) }));

const expense = {
  id: "22222222-2222-4222-8222-222222222222",
  ownerUserId: "owner-a",
  outingId: "11111111-1111-4111-8111-111111111111",
  description: "Dinner",
  amount: 84000,
  outingOccurredAt: new Date("2026-01-02T10:30:00.000Z"),
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  outingTitle: "Jakarta dinner",
};
const deletionImpact = { recordType: "expense" as const, receiptCount: 0, shareCount: 0, allocationCount: 0, affectedRepaymentCount: 0, affectedRepaymentIds: [], affectedFriendIds: [] };

function prepareRecord(shares: unknown[]) {
  mocks.requireSession.mockResolvedValue({ user: { id: "owner-a", name: "Wildan", email: "owner@example.com" } });
  mocks.getDatabase.mockReturnValue("database");
  mocks.listExpenseReceipts.mockResolvedValue([]);
  mocks.createLedgerRepository.mockReturnValue({
    getExpense: vi.fn().mockResolvedValue(expense),
    searchOutings: vi.fn().mockResolvedValue([{ id: expense.outingId, title: expense.outingTitle }]),
    searchFriends: vi.fn().mockResolvedValue([]),
    listExpenseShares: vi.fn().mockResolvedValue(shares),
    listExpenseCharges: vi.fn().mockResolvedValue([]),
    getPreviousExpenseSplit: vi.fn().mockResolvedValue(null),
    getExpenseDeletionImpact: vi.fn().mockResolvedValue(deletionImpact),
  });
}

describe("expense record", () => {
  it("uses the outing date and has no independent occurrence field", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a", name: "Wildan", email: "owner@example.com" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.listExpenseReceipts.mockResolvedValue([]);
    const getExpenseDeletionImpact = vi.fn().mockResolvedValue(deletionImpact);
    const searchFriends = vi.fn().mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333", name: "Rani", archived: false }]);
    const listFriends = vi.fn();
    mocks.createLedgerRepository.mockReturnValue({
      getExpense: vi.fn().mockResolvedValue(expense),
      searchOutings: vi.fn().mockResolvedValue([{ id: expense.outingId, title: expense.outingTitle }]),
      searchFriends,
      listFriends,
      listExpenseShares: vi.fn().mockResolvedValue([{ id: "share-a", friendId: "33333333-3333-4333-8333-333333333333", friendName: "Rani", friendArchivedAt: null, baseAmount: 40000, amountOwed: 40000 }]),
      listExpenseCharges: vi.fn().mockResolvedValue([]),
      getPreviousExpenseSplit: vi.fn().mockResolvedValue(null),
      getExpenseDeletionImpact,
    });
    render(<ToastProvider>{await ExpenseRecordPage({ params: Promise.resolve({ expenseId: expense.id }) })}</ToastProvider>);

    expect(screen.getByText("Expense · assign shares")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Dinner" })).toBeInTheDocument();
    expect(screen.getAllByText("Rp 84.000").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Jakarta dinner").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Outing date")).toBeInTheDocument();
    expect(document.querySelector(`time[datetime="${expense.outingOccurredAt.toISOString()}"]`)).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toHaveValue("Dinner");
    expect(screen.getByLabelText("Amount in rupiah")).toHaveValue("84000");
    expect(screen.getByRole("link", { name: /Back to expenses/ })).toHaveAttribute("href", "/app/expenses");
    expect(screen.getByRole("heading", { level: 2, name: "Assign the split" })).toBeInTheDocument();
    expect(screen.getByLabelText("Rani")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Rani" })).toBeInTheDocument();
    expect(searchFriends).toHaveBeenCalledWith({ activeOnly: true });
    expect(listFriends).not.toHaveBeenCalled();
    expect(screen.getByText("Your portion")).toBeInTheDocument();
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
    expect(screen.getByRole("heading", { name: "Delete expense" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Receipts" })).toBeInTheDocument();
    expect(document.querySelector(".expense-record__primary-task .expense-record__shares")).toBeInTheDocument();
    expect(document.querySelector(".expense-record__sidebar .expense-record__meta")).toBeInTheDocument();
    expect(document.querySelector(".expense-record__sidebar .expense-record__form")).toBeInTheDocument();
    expect(document.querySelector(".expense-record__controls .delete-record-form")).toBeInTheDocument();
    expect(document.querySelector(".expense-record__sidebar .expense-record__controls")).toContainElement(document.querySelector(".expense-record__meta"));
    expect(screen.queryByText(/Remove repayment allocations before deleting this expense/)).not.toBeInTheDocument();
    expect(screen.getByDisplayValue(deletionImpactRevision(deletionImpact))).toHaveAttribute("name", "impactRevision");
    expect(getExpenseDeletionImpact).toHaveBeenCalledOnce();
  });

  it("uses the same not-found path for absent and foreign expenses", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a", name: "Wildan", email: "owner@example.com" } });
    mocks.listExpenseReceipts.mockResolvedValue([]);
    mocks.createLedgerRepository.mockReturnValue({ getExpense: vi.fn().mockRejectedValue(new (await import("@/domain/ledger-repository")).LedgerNotFoundError()) });

    await expect(ExpenseRecordPage({ params: Promise.resolve({ expenseId: "foreign" }) })).rejects.toThrow("not-found");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("lands create success at Friend shares with a formatted amount and focuses once", async () => {
    prepareRecord([{ id: "share-a", friendId: "33333333-3333-4333-8333-333333333333", friendName: "Rani", friendArchivedAt: null, baseAmount: 40000, amountOwed: 40000 }]);
    window.history.replaceState({}, "", `/app/expenses/${expense.id}?created=1#friend-shares`);

    render(<ToastProvider>{await ExpenseRecordPage({ params: Promise.resolve({ expenseId: expense.id }), searchParams: Promise.resolve({ created: "1" }) })}</ToastProvider>);

    expect(screen.getByText("Expense saved · Rp 84.000", { exact: true })).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById("friend-shares")).toHaveFocus());
    expect(mocks.replace).toHaveBeenCalledWith(`/app/expenses/${expense.id}#friend-shares`, { scroll: false });
  });

  it("distinguishes expense updates and split saves using final persisted totals", async () => {
    const shares = [
      { id: "share-a", friendId: "33333333-3333-4333-8333-333333333333", friendName: "Rani", friendArchivedAt: null, baseAmount: 100000, amountOwed: 100000 },
      { id: "share-b", friendId: "44444444-4444-4444-8444-444444444444", friendName: "Siti", friendArchivedAt: null, baseAmount: 25000, amountOwed: 26500 },
    ];
    prepareRecord(shares);
    window.history.replaceState({}, "", `/app/expenses/${expense.id}?splitSaved=1&expensePage=3&repaymentPage=4#friend-shares`);
    const splitView = render(<ToastProvider>{await ExpenseRecordPage({ params: Promise.resolve({ expenseId: expense.id }), searchParams: Promise.resolve({ splitSaved: "1" }) })}</ToastProvider>);

    expect(screen.getByText("Split saved · Rp 126.500 assigned to 2 friends", { exact: true })).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById("friend-shares")).toHaveFocus());
    expect(mocks.replace).toHaveBeenCalledWith(`/app/expenses/${expense.id}?expensePage=3&repaymentPage=4#friend-shares`, { scroll: false });
    splitView.unmount();

    prepareRecord(shares);
    window.history.replaceState({}, "", `/app/expenses/${expense.id}?updated=1#expense-details`);
    render(<ToastProvider>{await ExpenseRecordPage({ params: Promise.resolve({ expenseId: expense.id }), searchParams: Promise.resolve({ updated: "1" }) })}</ToastProvider>);

    expect(screen.getByText("Expense updated · Rp 84.000", { exact: true })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById("expense-details")));
  });

  it("uses a restrained zero-share success message", async () => {
    prepareRecord([]);
    window.history.replaceState({}, "", `/app/expenses/${expense.id}?splitSaved=1#friend-shares`);
    render(<ToastProvider>{await ExpenseRecordPage({ params: Promise.resolve({ expenseId: expense.id }), searchParams: Promise.resolve({ splitSaved: "1" }) })}</ToastProvider>);

    expect(screen.getByText("Split saved · No friend shares assigned", { exact: true })).toBeInTheDocument();
  });
});
