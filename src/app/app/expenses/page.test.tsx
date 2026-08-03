import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ExpensesPage from "./page";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
  createLedgerRepository: vi.fn(),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/domain/ledger-repository", () => ({ createLedgerRepository: mocks.createLedgerRepository }));

const outing = {
  id: "11111111-1111-4111-8111-111111111111",
  ownerUserId: "owner-a",
  title: "Jakarta dinner",
  occurredAt: new Date("2026-01-02T10:30:00.000Z"),
  notes: null,
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

const expense = {
  id: "22222222-2222-4222-8222-222222222222",
  ownerUserId: "owner-a",
  outingId: outing.id,
  description: "Dinner",
  amount: 84000,
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  outingTitle: outing.title,
  outingOccurredAt: outing.occurredAt,
};

describe("/app/expenses", () => {
  it("renders owner-scoped rows, amount formatting, outing date, and create form", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a", name: "Wildan", email: "owner@example.com" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ listExpenses: vi.fn().mockResolvedValue([expense]), listOutings: vi.fn().mockResolvedValue([outing]) });
    render(await ExpensesPage());

    expect(screen.getByText("09 / EXPENSES")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Every amount, accounted for." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Dinner" })).toBeInTheDocument();
    expect(screen.getByText("Rp 84.000")).toBeInTheDocument();
    expect(screen.getAllByText("Jakarta dinner").length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector(`time[datetime="${outing.occurredAt.toISOString()}"]`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Edit/ })).toHaveAttribute("href", `/app/expenses/${expense.id}`);
    expect(screen.getByRole("heading", { level: 2, name: "Add an expense" })).toBeInTheDocument();
    expect(screen.getByLabelText("Amount in rupiah")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/UNASSIGNED|balance|pill|avatar|status dot|share control|dashboard/i);
  });

  it("requires an outing before rendering the expense form", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a", name: "Wildan", email: "owner@example.com" } });
    mocks.createLedgerRepository.mockReturnValue({ listExpenses: vi.fn().mockResolvedValue([]), listOutings: vi.fn().mockResolvedValue([]) });
    render(await ExpensesPage());

    expect(screen.getByText("No expenses yet.")).toBeInTheDocument();
    expect(screen.getByText("Create an outing before recording an expense.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Create an outing/ })).toHaveAttribute("href", "/app/outings");
    expect(screen.queryByLabelText("Amount in rupiah")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/balance|chart|repayment/i);
  });
});
