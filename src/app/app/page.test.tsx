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
  totalReceivedAmount: 12_000,
  totalUnallocatedRepaymentAmount: 5_000,
  totalOutstandingAmount: 4_000,
  ownerPortionAmount: 19_000,
  friendBalances: [{ friendId: "friend-a", name: "Ari", archived: false, assignedAmount: 9_000, repaidAmount: 6_000, outstandingAmount: 3_000 }],
};

describe("/app overview", () => {
  it("answers outstanding, balances, recent activity, and unallocated attention", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({
      getLedgerSummary: vi.fn().mockResolvedValue(summary),
      listExpenses: vi.fn().mockResolvedValue([{ id: "expense-a", description: "Dinner", outingTitle: "Jakarta", amount: 8_000, outingOccurredAt: new Date("2026-01-02T10:30:00Z") }]),
      listRepayments: vi.fn().mockResolvedValue([{ id: "repayment-a", friendName: "Ari", amount: 5_000, paidAt: new Date("2026-01-03T10:30:00Z"), unallocatedAmount: 5_000 }]),
    });

    render(await AppPage());

    expect(screen.getByRole("heading", { level: 1, name: "What is still open?" })).toBeInTheDocument();
    for (const label of ["Outstanding", "Assigned", "Repaid", "Received", "Unallocated", "Your portion", "Paid out", "Friend balances", "Recent activity"]) {
      expect(screen.getAllByText(label, { exact: true }).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("Rp 4.000")).toBeInTheDocument();
    expect(screen.getAllByText("Ari").length).toBeGreaterThan(0);
    expect(screen.getByText("Needs allocation.")).toBeInTheDocument();
    expect(screen.getByText(/received remains unallocated/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Dinner/ })).toHaveAttribute("href", "/app/expenses/expense-a");
    expect(document.body).not.toHaveTextContent(/chart|dashboard|percentage/i);
  });
});
