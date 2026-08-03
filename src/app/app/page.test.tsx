import { render, screen } from "@testing-library/react";
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
  totalOutstandingAmount: 4_000,
  ownerPortionAmount: 19_000,
  friendBalances: [
    { friendId: "friend-a", name: "Ari", archived: false, assignedAmount: 9_000, repaidAmount: 6_000, outstandingAmount: 3_000 },
    { friendId: "friend-b", name: "Bima", archived: true, assignedAmount: 2_000, repaidAmount: 1_000, outstandingAmount: 1_000 },
  ],
};

describe("/app", () => {
  it("renders owner-scoped totals and friend balances", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ getLedgerSummary: vi.fn().mockResolvedValue(summary) });

    render(await AppPage());

    expect(screen.getByText("06 / LEDGER OVERVIEW")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "What is still owed." })).toBeInTheDocument();
    expect(screen.getByText("Balances represent assigned shares minus allocated repayments.")).toBeInTheDocument();
    for (const label of ["Outstanding", "Assigned to friends", "Repaid toward shares", "Your portion", "Total paid out", "Friend balances"]) {
      expect(screen.getAllByText(label, { exact: true }).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("Rp 4.000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ari/ })).toHaveAttribute("href", "/app/friends/friend-a");
    expect(screen.getByText("ARCHIVED")).toBeInTheDocument();
    expect(screen.queryByText("SETTLED")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/chart|analytics|dashboard|fake|repayment form|payment entry/i);
    expect(document.querySelector("form")).not.toBeInTheDocument();
    expect(document.querySelector("[class*=card]")).not.toBeInTheDocument();
    expect(document.querySelector("[class*=pill]")).not.toBeInTheDocument();
    expect(mocks.createLedgerRepository).toHaveBeenCalledWith("database", "owner-a");
  });

  it("renders the real totals and links for an empty balance list", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({
      getLedgerSummary: vi.fn().mockResolvedValue({ ...summary, totalExpenseAmount: 25_000, totalAssignedAmount: 0, totalRepaidAmount: 0, totalOutstandingAmount: 0, ownerPortionAmount: 25_000, friendBalances: [] }),
    });

    render(await AppPage());

    expect(screen.getByRole("heading", { level: 3, name: "No balances yet." })).toBeInTheDocument();
    expect(screen.getByText("Balances appear after assigning friends to an expense.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Expenses/ })).toHaveAttribute("href", "/app/expenses");
    expect(screen.getByRole("link", { name: /Friends/ })).toHaveAttribute("href", "/app/friends");
    expect(screen.getAllByText("Rp 25.000")).toHaveLength(2);
  });
});
