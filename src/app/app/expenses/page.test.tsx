import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ExpensesPage from "./page";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), createLedgerRepository: vi.fn() }));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/domain/ledger-repository", () => ({ createLedgerRepository: mocks.createLedgerRepository }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

const outing = { id: "outing-a", ownerUserId: "owner-a", title: "Jakarta dinner", occurredAt: new Date("2026-01-02T10:30:00.000Z"), notes: null, createdAt: new Date("2026-01-02T00:00:00.000Z"), updatedAt: new Date("2026-01-02T00:00:00.000Z") };
const expense = { id: "expense-a", ownerUserId: "owner-a", outingId: outing.id, description: "Dinner", amount: 84_000, createdAt: new Date("2026-01-02T00:00:00.000Z"), updatedAt: new Date("2026-01-02T00:00:00.000Z"), outingTitle: outing.title, outingOccurredAt: outing.occurredAt };
const expensePage = { items: [expense], page: 1, pageSize: 20, totalItems: 1, totalPages: 1 };

describe("/app/expenses", () => {
  it("prioritizes the chronological ledger and keeps Add expense visible", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listExpenseRecords: vi.fn().mockResolvedValue(expensePage), listOutings: vi.fn().mockResolvedValue([outing]) });
    render(await ExpensesPage());

    expect(screen.getByRole("heading", { level: 1, name: "Expenses" })).toBeInTheDocument();
    expect(screen.getByText("Expenses · money you paid")).toBeInTheDocument();
    expect(screen.getByText("Record shared spending and assign the amounts each friend owes.")).toBeInTheDocument();
    expect(screen.getByText("Rp 84.000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add expense" })).toHaveAttribute("href", "/app/expenses?create=1");
    expect(screen.getByLabelText("Assignment")).toHaveValue("");
    expect(screen.getByLabelText("Assignment")).not.toHaveAttribute("name");
    expect(screen.queryByLabelText("Amount in rupiah")).not.toBeInTheDocument();
  });

  it("preselects an outing inside the creation panel", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listExpenseRecords: vi.fn().mockResolvedValue({ ...expensePage, items: [], totalItems: 0, totalPages: 1 }), listOutings: vi.fn().mockResolvedValue([outing]) });
    render(await ExpensesPage({ searchParams: Promise.resolve({ create: "1", outing: outing.id }) }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Amount in rupiah")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByLabelText("Outing")).toHaveValue(outing.id);
  });

  it("preserves retrieval context when opening Add expense", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listExpenseRecords: vi.fn().mockResolvedValue(expensePage), listOutings: vi.fn().mockResolvedValue([outing]) });
    render(await ExpensesPage({ searchParams: Promise.resolve({ q: "Dinner", outing: outing.id, month: "2026-04", assignment: "assigned", page: "2", task: "open", source: "ledger" }) }));

    expect(screen.getByRole("link", { name: "Add expense" })).toHaveAttribute("href", `/app/expenses?q=Dinner&outing=${outing.id}&month=2026-04&assignment=assigned&page=2&task=open&source=ledger&create=1`);
  });
});
