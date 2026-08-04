import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ExpensesPage from "./page";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), createLedgerRepository: vi.fn() }));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/domain/ledger-repository", () => ({ createLedgerRepository: mocks.createLedgerRepository }));

const outing = { id: "outing-a", ownerUserId: "owner-a", title: "Jakarta dinner", occurredAt: new Date("2026-01-02T10:30:00.000Z"), notes: null, createdAt: new Date("2026-01-02T00:00:00.000Z"), updatedAt: new Date("2026-01-02T00:00:00.000Z") };
const expense = { id: "expense-a", ownerUserId: "owner-a", outingId: outing.id, description: "Dinner", amount: 84_000, createdAt: new Date("2026-01-02T00:00:00.000Z"), updatedAt: new Date("2026-01-02T00:00:00.000Z"), outingTitle: outing.title, outingOccurredAt: outing.occurredAt };

describe("/app/expenses", () => {
  it("prioritizes the chronological ledger and keeps Add expense visible", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listExpenses: vi.fn().mockResolvedValue([expense]), listOutings: vi.fn().mockResolvedValue([outing]) });
    render(await ExpensesPage());

    expect(screen.getByRole("heading", { level: 1, name: "Every amount, accounted for." })).toBeInTheDocument();
    expect(screen.getByText("Rp 84.000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add expense" })).toHaveAttribute("href", "/app/expenses?create=1");
    expect(screen.queryByLabelText("Amount in rupiah")).not.toBeInTheDocument();
  });

  it("preselects an outing inside the creation panel", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listExpenses: vi.fn().mockResolvedValue([]), listOutings: vi.fn().mockResolvedValue([outing]) });
    render(await ExpensesPage({ searchParams: Promise.resolve({ create: "1", outing: outing.id }) }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Amount in rupiah")).toBeInTheDocument();
    expect(screen.getByLabelText("Outing")).toHaveValue(outing.id);
  });
});
