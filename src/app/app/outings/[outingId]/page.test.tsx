import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OutingRecordPage from "./page";
import { deletionImpactRevision } from "@/domain/ledger-repository";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
  createLedgerRepository: vi.fn(),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/authenticated-ledger", () => ({ getAuthenticatedLedger: async (session?: { user: { id: string } }) => { const current = session ?? await mocks.requireSession(); return { user: current.user, ledger: mocks.createLedgerRepository(mocks.getDatabase(), current.user.id) }; } }));
vi.mock("@/domain/ledger-repository", async () => {
  const actual = await vi.importActual<typeof import("@/domain/ledger-repository")>("@/domain/ledger-repository");
  return { ...actual, createLedgerRepository: mocks.createLedgerRepository };
});
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

const outing = {
  id: "11111111-1111-4111-8111-111111111111",
  ownerUserId: "owner-a",
  title: "Jakarta dinner",
  occurredAt: new Date("2026-01-02T10:30:00.000Z"),
  notes: "Bring the receipt.",
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};
const deletionImpact = { recordType: "outing" as const, expenseCount: 0, expenseTotal: 0, receiptCount: 0, shareCount: 0, allocationCount: 0, affectedRepaymentCount: 0, affectedRepaymentIds: [], affectedFriendIds: [] };
const expense = { id: "22222222-2222-4222-8222-222222222222", ownerUserId: "owner-a", outingId: outing.id, description: "Dinner", amount: 120_000, createdAt: new Date("2026-01-02T11:00:00.000Z"), updatedAt: new Date("2026-01-02T11:00:00.000Z"), outingTitle: outing.title, outingOccurredAt: outing.occurredAt };
const expensePage = { items: [expense], page: 1, pageSize: 20 as const, totalItems: 1, totalPages: 1 };
const emptyExpensePage = { items: [], page: 1, pageSize: 20 as const, totalItems: 0, totalPages: 1 };

describe("outing record", () => {
  it("renders identity, metadata, notes, and edit fields", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a", name: "Wildan", email: "owner@example.com" } });
    mocks.getDatabase.mockReturnValue("database");
    const getOutingDeletionImpact = vi.fn().mockResolvedValue(deletionImpact);
    const listExpenseRecords = vi.fn().mockResolvedValue(expensePage);
    mocks.createLedgerRepository.mockReturnValue({ getOuting: vi.fn().mockResolvedValue(outing), getOutingDeletionImpact, listExpenseRecords });
    render(await OutingRecordPage({ params: Promise.resolve({ outingId: outing.id }), searchParams: Promise.resolve({ expensePage: "1" }) }));

    expect(screen.getByText("Outing · editable record")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Jakarta dinner" })).toBeInTheDocument();
    expect(document.querySelector(".outing-record__summary")!).toContainElement(document.querySelector(".outing-record__meta"));
    expect(document.querySelector(".outing-record__summary")!).toContainElement(document.querySelector(".outing-record__notes"));
    expect(document.querySelector(".outing-record__workspace")!).toContainElement(document.querySelector(".outing-record__form"));
    expect(document.querySelector(".outing-record__workspace")!).toContainElement(document.querySelector(".delete-record-form"));
    expect(document.querySelector(`time[datetime="${outing.occurredAt.toISOString()}"]`)).toBeInTheDocument();
    expect(document.querySelector(`time[datetime="${outing.createdAt.toISOString()}"]`)).toBeInTheDocument();
    expect(screen.getByLabelText("Notes")).toHaveValue("Bring the receipt.");
    expect(screen.getByLabelText("Title")).toHaveValue("Jakarta dinner");
    expect(screen.getByRole("link", { name: "Add expense" })).toHaveAttribute("href", `/app/expenses?create=1&outing=${outing.id}`);
    expect(screen.getByRole("heading", { level: 2, name: "Expenses" })).toBeInTheDocument();
    expect(screen.getByText("Dinner", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open expense" })).toHaveAttribute("href", `/app/expenses/${expense.id}`);
    expect(screen.getByText("1 entries", { exact: true })).toBeInTheDocument();
    expect(listExpenseRecords).toHaveBeenCalledExactlyOnceWith({ outingId: outing.id, page: "1" });
    expect(screen.getByRole("link", { name: "← Outings" })).toHaveAttribute("href", "/app/outings");
    expect(screen.getByText(/Expenses recorded under this outing keep its occurrence timestamp/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Delete outing" })).toBeInTheDocument();
    expect(screen.queryByText(/Move or delete this outing's expenses first/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete outing" })).toBeDisabled();
    expect(screen.getByDisplayValue(deletionImpactRevision(deletionImpact))).toHaveAttribute("name", "impactRevision");
    expect(getOutingDeletionImpact).toHaveBeenCalledOnce();
  });

  it("renders a clean empty expense history", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ getOuting: vi.fn().mockResolvedValue(outing), getOutingDeletionImpact: vi.fn().mockResolvedValue(deletionImpact), listExpenseRecords: vi.fn().mockResolvedValue(emptyExpensePage) });

    render(await OutingRecordPage({ params: Promise.resolve({ outingId: outing.id }) }));

    expect(screen.getByText("No expenses recorded for this outing yet.", { exact: true })).toBeInTheDocument();
    expect(within(document.querySelector(".ledger-empty")!).getByRole("link", { name: "Add expense" })).toHaveAttribute("href", `/app/expenses?create=1&outing=${outing.id}`);
    expect(screen.getByText("0 entries", { exact: true })).toBeInTheDocument();
  });

  it("uses the outing expense page parameter and anchor", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ getOuting: vi.fn().mockResolvedValue(outing), getOutingDeletionImpact: vi.fn().mockResolvedValue(deletionImpact), listExpenseRecords: vi.fn().mockResolvedValue({ ...expensePage, totalItems: 21, totalPages: 2 }) });

    render(await OutingRecordPage({ params: Promise.resolve({ outingId: outing.id }), searchParams: Promise.resolve({ expensePage: "1", saved: "1", future: "keep" }) }));

    expect(within(screen.getByRole("region", { name: "Expenses" })).getByRole("link", { name: "Next" })).toHaveAttribute("href", `/app/outings/${outing.id}?expensePage=2&future=keep#outing-expenses`);
  });

  it("uses the same not-found path for absent and foreign outings", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a", name: "Wildan", email: "owner@example.com" } });
    mocks.createLedgerRepository.mockReturnValue({ getOuting: vi.fn().mockRejectedValue(new (await import("@/domain/ledger-repository")).LedgerNotFoundError()) });

    await expect(OutingRecordPage({ params: Promise.resolve({ outingId: "foreign" }) })).rejects.toThrow("not-found");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
