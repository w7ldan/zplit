import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ExpenseRecordPage from "./page";

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

const expense = {
  id: "22222222-2222-4222-8222-222222222222",
  ownerUserId: "owner-a",
  outingId: "11111111-1111-4111-8111-111111111111",
  description: "Dinner",
  amount: 84000,
  occurredAt: new Date("2026-01-02T10:30:00.000Z"),
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  outingTitle: "Jakarta dinner",
};

describe("expense record", () => {
  it("renders identity, rupiah amount, local metadata, assignment, and edit fields", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a", name: "Wildan", email: "owner@example.com" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ getExpense: vi.fn().mockResolvedValue(expense), listOutings: vi.fn().mockResolvedValue([]) });
    render(await ExpenseRecordPage({ params: Promise.resolve({ expenseId: expense.id }) }));

    expect(screen.getByText("09 / EXPENSE RECORD")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Dinner" })).toBeInTheDocument();
    expect(screen.getByText("Rp 84.000")).toBeInTheDocument();
    expect(screen.getAllByText("Jakarta dinner").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText("Description")).toHaveValue("Dinner");
    expect(screen.getByLabelText("Amount in rupiah")).toHaveValue("84000");
    expect(screen.getByRole("link", { name: /Back to expenses/ })).toHaveAttribute("href", "/app/expenses");
    expect(screen.getByText(/Friend-share assignment arrives/)).toBeInTheDocument();
  });

  it("uses the same not-found path for absent and foreign expenses", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a", name: "Wildan", email: "owner@example.com" } });
    mocks.createLedgerRepository.mockReturnValue({ getExpense: vi.fn().mockRejectedValue(new (await import("@/domain/ledger-repository")).LedgerNotFoundError()) });

    await expect(ExpenseRecordPage({ params: Promise.resolve({ expenseId: "foreign" }) })).rejects.toThrow("not-found");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
