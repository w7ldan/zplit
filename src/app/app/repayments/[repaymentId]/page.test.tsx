import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RepaymentRecordPage from "./page";

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
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

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

describe("repayment record", () => {
  it("renders the friend identity, totals, local date metadata, and editable fields", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a", name: "Wildan", email: "owner@example.com" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ getRepayment: vi.fn().mockResolvedValue(repayment), listFriends: vi.fn(({ archived } = {}) => Promise.resolve(archived ? [] : [friend])) });

    render(await RepaymentRecordPage({ params: Promise.resolve({ repaymentId: repayment.id }) }));

    expect(screen.getByText("10 / REPAYMENT RECORD")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Ari" })).toBeInTheDocument();
    expect(screen.getByText("Rp 84.000")).toBeInTheDocument();
    expect(screen.getByText("Rp 40.000")).toBeInTheDocument();
    expect(screen.getByText("Rp 44.000")).toBeInTheDocument();
    expect(screen.getByText("Bank transfer")).toBeInTheDocument();
    expect(screen.getByLabelText("Notes")).toHaveValue("Received in full");
    expect(document.querySelector(`time[datetime="${repayment.paidAt.toISOString()}"]`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to repayments/ })).toHaveAttribute("href", "/app/repayments");
    expect(screen.getByLabelText("Friend")).toHaveValue(friend.id);
    expect(screen.getByText(/Allocation management arrives next/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/delete|allocation editor|debtor|card|pill|status dot/i);
  });

  it("uses one not-found path for foreign and absent records", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ getRepayment: vi.fn().mockRejectedValue(new (await import("@/domain/ledger-repository")).LedgerNotFoundError()) });

    await expect(RepaymentRecordPage({ params: Promise.resolve({ repaymentId: "foreign" }) })).rejects.toThrow("not-found");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
