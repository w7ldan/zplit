import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RepaymentRecordPage from "./page";
import { deletionImpactRevision } from "@/domain/ledger-repository";
import { ToastProvider } from "@/components/feedback/toast";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
  createLedgerRepository: vi.fn(),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/domain/ledger-repository", async () => {
  const actual = await vi.importActual<typeof import("@/domain/ledger-repository")>("@/domain/ledger-repository");
  return { ...actual, createLedgerRepository: mocks.createLedgerRepository };
});
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, useRouter: () => ({ refresh: vi.fn() }) }));

const repayment = {
  id: "33333333-3333-4333-8333-333333333333",
  friendId: "11111111-1111-4111-8111-111111111111",
  friendName: "Ari",
  friendArchivedAt: null,
  amount: 84_000,
  paidAt: new Date("2026-01-02T02:30:00.000Z"),
  paymentMethod: "Bank transfer",
  notes: "Received in full",
  allocatedAmount: 40_000,
  unallocatedAmount: 44_000,
};
const friend = { id: repayment.friendId, name: "Ari", archivedAt: null };
const allocationPlan = {
  ...repayment,
  ownerUserId: "owner-a",
  createdAt: repayment.paidAt,
  shares: [{
    id: "22222222-2222-4222-8222-222222222222",
    expenseShareId: "22222222-2222-4222-8222-222222222222",
    expenseDescription: "Dinner",
    outingTitle: "Friday night",
    outingOccurredAt: new Date("2026-01-01T10:00:00.000Z"),
    amountOwed: 70000,
    allocatedByOtherRepayments: 30000,
    currentAllocation: 40000,
    capacityAvailable: 40000,
  }],
};
const deletionImpact = { recordType: "repayment" as const, allocationCount: 0, friendId: repayment.friendId };

describe("repayment record", () => {
  it("renders the friend identity, totals, local date metadata, and editable fields", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a", name: "Wildan", email: "owner@example.com" } });
    mocks.getDatabase.mockReturnValue("database");
    const getRepaymentDeletionImpact = vi.fn().mockResolvedValue(deletionImpact);
    mocks.createLedgerRepository.mockReturnValue({ getRepaymentAllocationPlan: vi.fn().mockResolvedValue(allocationPlan), getRepaymentDeletionImpact, searchFriends: vi.fn().mockResolvedValue([{ id: friend.id, name: friend.name, archived: false }]), getRepaymentFriendContext: vi.fn().mockResolvedValue({ option: { id: friend.id, name: friend.name, archived: false }, outstandingAmount: 44_000, openExpenseShares: [] }), listRecentPaymentMethods: vi.fn().mockResolvedValue([]) });

    render(<ToastProvider>{await RepaymentRecordPage({ params: Promise.resolve({ repaymentId: repayment.id }) })}</ToastProvider>);

    expect(screen.getByText("Repayment · allocate received money")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Ari" })).toBeInTheDocument();
    for (const label of ["Received", "Applied to shares", "Needs allocation"]) expect(screen.getAllByText(label, { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Rp 84.000")).not.toHaveLength(0);
    expect(screen.getAllByText("Rp 40.000")).not.toHaveLength(0);
    expect(screen.getAllByText("Rp 44.000")).not.toHaveLength(0);
    expect(screen.getAllByText("Bank transfer")).not.toHaveLength(0);
    expect(screen.getByLabelText("Notes")).toHaveValue("Received in full");
    expect(document.querySelector(`time[datetime="${repayment.paidAt.toISOString()}"]`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to repayments/ })).toHaveAttribute("href", "/app/repayments");
    expect(screen.getByRole("combobox", { name: "Friend" })).toHaveTextContent(friend.name);
    expect(screen.getByText("Apply the received money")).toBeInTheDocument();
    expect(screen.queryByText("How this repayment adds up")).not.toBeInTheDocument();
    expect(screen.getByText("Rp 44.000 needs allocation. Only applied money reduces outstanding balances.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Friend" })).toBeDisabled();
    expect(screen.getByText("The friend is fixed while this repayment has allocations.")).toBeInTheDocument();
    expect(screen.getByText("Dinner")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Delete repayment" })).toBeInTheDocument();
    expect(document.querySelector(".repayment-record__primary-task .repayment-record__allocations")).toBeInTheDocument();
    expect(document.querySelector(".repayment-record__sidebar .repayment-record__meta")).toBeInTheDocument();
    expect(document.querySelector(".repayment-record__sidebar .repayment-record__form")).toBeInTheDocument();
    expect(document.querySelector(".repayment-record__controls .delete-record-form")).toBeInTheDocument();
    expect(document.querySelector(".repayment-record__sidebar .repayment-record__controls")).toContainElement(document.querySelector(".repayment-record__meta"));
    expect(screen.queryByText(/Remove this repayment's allocations before deleting it/)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/allocation editor|debtor|card|pill|status dot/i);
    expect(screen.getByDisplayValue(deletionImpactRevision(deletionImpact))).toHaveAttribute("name", "impactRevision");
    expect(getRepaymentDeletionImpact).toHaveBeenCalledOnce();
  });

  it("uses one not-found path for foreign and absent records", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ getRepaymentAllocationPlan: vi.fn().mockRejectedValue(new (await import("@/domain/ledger-repository")).LedgerNotFoundError()) });

    await expect(RepaymentRecordPage({ params: Promise.resolve({ repaymentId: "foreign" }) })).rejects.toThrow("not-found");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
