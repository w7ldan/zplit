import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RepaymentsPage from "./page";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), createLedgerRepository: vi.fn() }));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/domain/ledger-repository", () => ({ createLedgerRepository: mocks.createLedgerRepository }));

const activeFriend = { id: "friend-a", name: "Ari", archivedAt: null };
const archivedFriend = { id: "friend-b", name: "Bima", archivedAt: new Date("2026-01-01T00:00:00.000Z") };
const summary = { friendBalances: [{ friendId: activeFriend.id, name: "Ari", archived: false, assignedAmount: 84_000, repaidAmount: 20_000, outstandingAmount: 64_000 }] };
const repayment = { id: "repayment-a", friendName: "Ari", friendArchivedAt: null, amount: 84_000, paidAt: new Date("2026-01-02T02:30:00.000Z"), paymentMethod: "Bank transfer", allocatedAmount: 40_000, unallocatedAmount: 44_000 };

describe("/app/repayments", () => {
  it("keeps allocation state explicit and provides outstanding friend context", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listRepayments: vi.fn().mockResolvedValue([repayment]), listFriends: vi.fn(({ archived } = {}) => Promise.resolve(archived ? [archivedFriend] : [activeFriend])), getLedgerSummary: vi.fn().mockResolvedValue(summary), listOpenExpenseSharesByFriend: vi.fn().mockResolvedValue({}) });
    render(await RepaymentsPage());

    expect(screen.getByRole("heading", { level: 1, name: "Repayments" })).toBeInTheDocument();
    expect(screen.getByText("Repayments · money returned")).toBeInTheDocument();
    expect(screen.getByText("Record money received and apply it to outstanding expense shares.")).toBeInTheDocument();
    expect(screen.getByText("Rp 44.000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add repayment" })).toHaveAttribute("href", "/app/repayments?create=1");
    expect(screen.queryByLabelText("Amount in rupiah")).not.toBeInTheDocument();
  });

  it("opens the repayment form only with create=1 and retains archived friends", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listRepayments: vi.fn().mockResolvedValue([]), listFriends: vi.fn(({ archived } = {}) => Promise.resolve(archived ? [archivedFriend] : [activeFriend])), getLedgerSummary: vi.fn().mockResolvedValue(summary), listOpenExpenseSharesByFriend: vi.fn().mockResolvedValue({}) });
    render(await RepaymentsPage({ searchParams: Promise.resolve({ create: "1" }) }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Bima (ARCHIVED)" })).toBeInTheDocument();
    expect(screen.getByText(/Outstanding for Ari/)).toBeInTheDocument();
  });
});
