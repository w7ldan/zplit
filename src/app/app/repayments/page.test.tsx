import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RepaymentsPage from "./page";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
  createLedgerRepository: vi.fn(),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/domain/ledger-repository", () => ({ createLedgerRepository: mocks.createLedgerRepository }));

const activeFriend = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ari",
  archivedAt: null,
};
const archivedFriend = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Bima",
  archivedAt: new Date("2026-01-01T00:00:00.000Z"),
};
const repayment = {
  id: "33333333-3333-4333-8333-333333333333",
  friendName: "Ari",
  friendArchivedAt: null,
  amount: 84_000,
  paidAt: new Date("2026-01-02T02:30:00.000Z"),
  paymentMethod: "Bank transfer",
  allocatedAmount: 40_000,
  unallocatedAmount: 44_000,
};

describe("/app/repayments", () => {
  it("renders repayment rows, allocation totals, archived options, and the create form", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({
      listRepayments: vi.fn().mockResolvedValue([repayment]),
      listFriends: vi.fn(({ archived } = {}) => Promise.resolve(archived ? [archivedFriend] : [activeFriend])),
    });

    render(await RepaymentsPage());

    expect(screen.getByText("10 / REPAYMENTS")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Money received, recorded." })).toBeInTheDocument();
    expect(screen.getByText(/Only allocated money reduces an outstanding share/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Ari" })).toBeInTheDocument();
    expect(screen.getByText("Rp 84.000")).toBeInTheDocument();
    expect(screen.getByText("Rp 40.000")).toBeInTheDocument();
    expect(screen.getByText("Rp 44.000")).toBeInTheDocument();
    expect(screen.getByText("Bank transfer")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Edit/ })).toHaveAttribute("href", `/app/repayments/${repayment.id}`);
    expect(screen.getByRole("option", { name: "Bima (ARCHIVED)" })).toBeInTheDocument();
    expect(screen.getByLabelText("Amount in rupiah")).toHaveAttribute("inputmode", "numeric");
    expect(document.body).not.toHaveTextContent(/delete|allocation editor|status dot|pill|card/i);
  });

  it("uses plain UNALLOCATED text and an intentional empty state", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({
      listRepayments: vi.fn().mockResolvedValue([{ ...repayment, allocatedAmount: 0, unallocatedAmount: repayment.amount, paymentMethod: null }]),
      listFriends: vi.fn(({ archived } = {}) => Promise.resolve(archived ? [] : [activeFriend])),
    });
    const firstRender = render(await RepaymentsPage());
    expect(screen.getByText("UNALLOCATED")).toBeInTheDocument();
    firstRender.unmount();

    mocks.createLedgerRepository.mockReturnValue({ listRepayments: vi.fn().mockResolvedValue([]), listFriends: vi.fn().mockResolvedValue([]) });
    render(await RepaymentsPage());
    expect(screen.getByRole("heading", { level: 2, name: "No repayments yet." })).toBeInTheDocument();
    expect(screen.getByText("Add a friend before recording money received.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Add a friend/ })).toHaveAttribute("href", "/app/friends");
    expect(screen.queryAllByLabelText("Amount in rupiah")).toHaveLength(0);
  });
});
