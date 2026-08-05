import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ExpensesPage from "./page";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), createLedgerRepository: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/domain/ledger-repository", () => ({ createLedgerRepository: mocks.createLedgerRepository }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, useRouter: () => ({ replace: vi.fn() }) }));

const outing = { id: "outing-a", ownerUserId: "owner-a", title: "Jakarta dinner", occurredAt: new Date("2026-01-02T10:30:00.000Z"), notes: null, createdAt: new Date("2026-01-02T00:00:00.000Z"), updatedAt: new Date("2026-01-02T00:00:00.000Z") };
const expense = { id: "expense-a", ownerUserId: "owner-a", outingId: outing.id, description: "Dinner", amount: 84_000, createdAt: new Date("2026-01-02T00:00:00.000Z"), updatedAt: new Date("2026-01-02T00:00:00.000Z"), outingTitle: outing.title, outingOccurredAt: outing.occurredAt };
const expensePage = { items: [expense], page: 1, pageSize: 20, totalItems: 1, totalPages: 1 };

describe("/app/expenses", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects empty controlled parameters to the canonical URL", async () => {
    await expect(ExpensesPage({ searchParams: Promise.resolve({ assignment: "", outing: "", q: "" }) })).rejects.toThrow("redirect:/app/expenses");
    expect(mocks.requireSession).not.toHaveBeenCalled();
  });

  it("preserves task-panel and unrelated parameters while canonicalizing", async () => {
    await expect(ExpensesPage({ searchParams: Promise.resolve({ assignment: "", outing: "", q: "", create: "1", task: "confirm", source: "ledger" }) })).rejects.toThrow("redirect:/app/expenses?create=1&task=confirm&source=ledger");
  });

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
    expect(screen.getByLabelText("Assignment")).toHaveAttribute("name", "assignment");
    expect(screen.queryByLabelText("Amount in rupiah")).not.toBeInTheDocument();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("preselects an outing inside the creation panel", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listExpenseRecords: vi.fn().mockResolvedValue({ ...expensePage, items: [], totalItems: 0, totalPages: 1 }), listOutings: vi.fn().mockResolvedValue([outing]) });
    render(await ExpensesPage({ searchParams: Promise.resolve({ create: "1", outing: outing.id }) }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Amount in rupiah")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByLabelText("Outing")).toHaveValue(outing.id);
  });

  it("offers a continuation link when Add expense has no outing prerequisite", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listExpenseRecords: vi.fn().mockResolvedValue({ ...expensePage, items: [], totalItems: 0, totalPages: 1 }), listOutings: vi.fn().mockResolvedValue([]) });
    render(await ExpensesPage({ searchParams: Promise.resolve({ create: "1", q: "Dinner", month: "2026-04", page: "2", source: "ledger" }) }));

    const link = screen.getByRole("link", { name: "Create an outing and continue" });
    expect(link).toHaveAttribute("href", "/app/outings?create=1&returnTo=%2Fapp%2Fexpenses%3Fcreate%3D1%26q%3DDinner%26month%3D2026-04%26page%3D2%26source%3Dledger");
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  });

  it("preserves retrieval context when opening Add expense", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createLedgerRepository.mockReturnValue({ listExpenseRecords: vi.fn().mockResolvedValue(expensePage), listOutings: vi.fn().mockResolvedValue([outing]) });
    render(await ExpensesPage({ searchParams: Promise.resolve({ q: "Dinner", outing: outing.id, month: "2026-04", assignment: "assigned", page: "2", task: "open", source: "ledger" }) }));

    expect(screen.getByRole("link", { name: "Add expense" })).toHaveAttribute("href", `/app/expenses?q=Dinner&outing=${outing.id}&month=2026-04&assignment=assigned&page=2&task=open&source=ledger&create=1`);
  });
});
