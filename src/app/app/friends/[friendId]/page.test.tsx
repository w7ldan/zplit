import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FriendRecordPage from "./page";
import { ToastProvider } from "@/components/feedback/toast";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
  createLedgerRepository: vi.fn(),
  getDebtorShareLinkStatus: vi.fn(),
  getDebtorShareReceiptSelection: vi.fn(),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/domain/ledger-repository", async () => {
  const actual = await vi.importActual<typeof import("@/domain/ledger-repository")>("@/domain/ledger-repository");
  return { ...actual, createLedgerRepository: mocks.createLedgerRepository };
});
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/server/debtor-share-links", () => ({ getDebtorShareLinkStatus: mocks.getDebtorShareLinkStatus, getDebtorShareReceiptSelection: mocks.getDebtorShareReceiptSelection }));

const friend = {
  id: "11111111-1111-4111-8111-111111111111",
  ownerUserId: "owner-a",
  name: "Ada Lovelace",
  phoneNumber: null,
  notes: "First record",
  archivedAt: null,
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};
const expenseShare = { id: "44444444-4444-4444-8444-444444444444", expenseId: "22222222-2222-4222-8222-222222222222", expenseDescription: "Dinner", outingTitle: "Jakarta dinner", outingOccurredAt: new Date("2026-01-02T10:30:00.000Z"), amountOwed: 8_000, appliedAmount: 3_000, remainingAmount: 5_000, settled: false };
const expenseSharePage = { items: [expenseShare], page: 1, pageSize: 20 as const, totalItems: 1, totalPages: 1 };
const repayment = { id: "33333333-3333-4333-8333-333333333333", ownerUserId: "owner-a", friendId: friend.id, amount: 4_000, paidAt: new Date("2026-01-03T10:30:00.000Z"), paymentMethod: null, notes: null, createdAt: new Date("2026-01-03T10:30:00.000Z"), friendName: friend.name, friendArchivedAt: null, allocatedAmount: 3_000, unallocatedAmount: 1_000 };
const repaymentPage = { items: [repayment], page: 1, pageSize: 20 as const, totalItems: 1, totalPages: 1 };
const emptyExpenseSharePage = { items: [], page: 1, pageSize: 20 as const, totalItems: 0, totalPages: 1 };
const emptyRepaymentPage = { items: [], page: 1, pageSize: 20 as const, totalItems: 0, totalPages: 1 };

describe("friend record", () => {
  it("renders identity, metadata, edit fields, and archive action", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a", name: "Wildan", email: "owner@example.com" } });
    mocks.getDatabase.mockReturnValue("database");
    const getFriendBalances = vi.fn().mockResolvedValue([{ friendId: friend.id, assignedAmount: 10_000, repaidAmount: 4_000, outstandingAmount: 6_000 }]);
    const listFriendExpenseShareRecords = vi.fn().mockResolvedValue(expenseSharePage);
    const listRepaymentRecords = vi.fn().mockResolvedValue(repaymentPage);
    mocks.createLedgerRepository.mockReturnValue({ getFriend: vi.fn().mockResolvedValue(friend), getFriendBalances, listEligibleDebtorShareReceipts: vi.fn().mockResolvedValue([]), listFriendExpenseShareRecords, listRepaymentRecords });
    mocks.getDebtorShareLinkStatus.mockResolvedValue({ status: "none", expiresAt: null });
    mocks.getDebtorShareReceiptSelection.mockResolvedValue([]);
    render(<ToastProvider>{await FriendRecordPage({ params: Promise.resolve({ friendId: friend.id }) })}</ToastProvider>);

    expect(screen.getByText("Friend · editable record")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Ada Lovelace" })).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getAllByText("02 Jan 2026")).toHaveLength(2);
    expect(getFriendBalances).toHaveBeenCalledExactlyOnceWith([friend.id]);
    expect(screen.getByRole("heading", { level: 2, name: "Balance" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Expense shares" })).toBeInTheDocument();
    expect(screen.getByText("Dinner", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("OPEN", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open expense" })).toHaveAttribute("href", `/app/expenses/${expenseShare.expenseId}`);
    expect(screen.getByRole("heading", { level: 2, name: "Repayments" })).toBeInTheDocument();
    expect(screen.getByText("—", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open repayment" })).toHaveAttribute("href", `/app/repayments/${repayment.id}`);
    expect(listFriendExpenseShareRecords).toHaveBeenCalledExactlyOnceWith(friend.id, { page: undefined });
    expect(listRepaymentRecords).toHaveBeenCalledExactlyOnceWith({ friendId: friend.id, page: undefined });
    for (const label of ["Assigned", "Applied", "Still owes"]) expect(screen.getAllByText(label, { exact: true }).length).toBeGreaterThan(0);
    for (const amount of ["Rp 10.000", "Rp 4.000", "Rp 6.000"]) expect(screen.getAllByText(amount, { exact: true }).length).toBeGreaterThan(0);
    expect(screen.queryByText("Rp 6.000 remains outstanding.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Ada Lovelace");
    expect(screen.getByRole("button", { name: "Archive friend" })).toBeInTheDocument();
    expect(screen.getByText("A private, read-only view")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create balance link" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Record repayment" })[0]).toHaveAttribute("href", `/app/repayments?create=1&friendId=${friend.id}`);
    expect(screen.getAllByRole("link", { name: "Record repayment" })[1]).toHaveAttribute("href", `/app/repayments?create=1&friendId=${friend.id}&expenseShareId=${expenseShare.id}`);
    expect(screen.getByRole("link", { name: "Settle Rp 6.000" })).toHaveAttribute("href", `/app/repayments?create=1&friendId=${friend.id}&amount=6000`);
    expect(screen.getByRole("link", { name: /Back to friends/ })).toHaveAttribute("href", "/app/friends");
  });

  it("uses zero values and distinguishes a never-assigned friend", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    const getFriendBalances = vi.fn().mockResolvedValue([]);
    mocks.createLedgerRepository.mockReturnValue({ getFriend: vi.fn().mockResolvedValue(friend), getFriendBalances, listEligibleDebtorShareReceipts: vi.fn().mockResolvedValue([]), listFriendExpenseShareRecords: vi.fn().mockResolvedValue(emptyExpenseSharePage), listRepaymentRecords: vi.fn().mockResolvedValue(emptyRepaymentPage) });
    mocks.getDebtorShareLinkStatus.mockResolvedValue({ status: "none", expiresAt: null });
    mocks.getDebtorShareReceiptSelection.mockResolvedValue([]);

    render(<ToastProvider>{await FriendRecordPage({ params: Promise.resolve({ friendId: friend.id }) })}</ToastProvider>);

    expect(getFriendBalances).toHaveBeenCalledExactlyOnceWith([friend.id]);
    expect(screen.getAllByText("Rp 0", { exact: true })).toHaveLength(3);
    expect(screen.getByText("No balance yet", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("No expense shares recorded for this friend yet.", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("No repayments recorded for this friend yet.", { exact: true })).toBeInTheDocument();
  });

  it("distinguishes a settled friend from a never-assigned friend", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({
      getFriend: vi.fn().mockResolvedValue(friend),
      getFriendBalances: vi.fn().mockResolvedValue([{ friendId: friend.id, assignedAmount: 10_000, repaidAmount: 10_000, outstandingAmount: 0 }]),
      listEligibleDebtorShareReceipts: vi.fn().mockResolvedValue([]),
      listFriendExpenseShareRecords: vi.fn().mockResolvedValue(emptyExpenseSharePage),
      listRepaymentRecords: vi.fn().mockResolvedValue(emptyRepaymentPage),
    });
    mocks.getDebtorShareLinkStatus.mockResolvedValue({ status: "none", expiresAt: null });
    mocks.getDebtorShareReceiptSelection.mockResolvedValue([]);

    render(<ToastProvider>{await FriendRecordPage({ params: Promise.resolve({ friendId: friend.id }) })}</ToastProvider>);

    expect(screen.getByText("Settled", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("No expense shares recorded for this friend yet.", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("No repayments recorded for this friend yet.", { exact: true })).toBeInTheDocument();
  });

  it("keeps the two history pagers independent", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({
      getFriend: vi.fn().mockResolvedValue(friend),
      getFriendBalances: vi.fn().mockResolvedValue([]),
      listEligibleDebtorShareReceipts: vi.fn().mockResolvedValue([]),
      listFriendExpenseShareRecords: vi.fn().mockResolvedValue({ ...emptyExpenseSharePage, page: 1, totalItems: 21, totalPages: 2 }),
      listRepaymentRecords: vi.fn().mockResolvedValue({ ...emptyRepaymentPage, page: 2, totalItems: 41, totalPages: 3 }),
    });
    mocks.getDebtorShareLinkStatus.mockResolvedValue({ status: "none", expiresAt: null });
    mocks.getDebtorShareReceiptSelection.mockResolvedValue([]);

    render(<ToastProvider>{await FriendRecordPage({ params: Promise.resolve({ friendId: friend.id }), searchParams: Promise.resolve({ expensePage: "1", repaymentPage: "2", saved: "1" }) })}</ToastProvider>);

    expect(within(screen.getByRole("region", { name: "Expense shares" })).getByRole("link", { name: "Next" })).toHaveAttribute("href", `/app/friends/${friend.id}?expensePage=2&repaymentPage=2#friend-expense-shares`);
    expect(within(screen.getByRole("region", { name: "Repayments" })).getByRole("link", { name: "Next" })).toHaveAttribute("href", `/app/friends/${friend.id}?expensePage=1&repaymentPage=3#friend-repayments`);
  });

  it("uses the same not-found path for an absent or foreign record", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a", name: "Wildan", email: "owner@example.com" } });
    mocks.createLedgerRepository.mockReturnValue({ getFriend: vi.fn().mockRejectedValue(new (await import("@/domain/ledger-repository")).LedgerNotFoundError()) });

    await expect(FriendRecordPage({ params: Promise.resolve({ friendId: "foreign" }) })).rejects.toThrow("not-found");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
