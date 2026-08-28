import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), createGroupAccountingRepository: vi.fn() }));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/group-accounting", () => ({ createGroupAccountingRepository: mocks.createGroupAccountingRepository, GroupAccountingError: class GroupAccountingError extends Error { constructor(readonly code: string) { super(code); } } }));

import GroupExpenseDetailPage from "./page";

const active = { id: "alice", userId: "user-a", displayName: "Alice", label: null, status: "active" as const };

describe("Group expense detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.getDatabase.mockReturnValue("database");
  });

  it("shows shares and a payer-only confirmation for pending claims", async () => {
    mocks.createGroupAccountingRepository.mockReturnValue({ getExpense: vi.fn().mockResolvedValue({ id: "expense-a", groupId: "group-a", creatorParticipantId: "alice", payerParticipantId: "alice", description: "Dinner", occurredAt: new Date("2026-08-27T12:00:00Z"), totalAmount: 150000, state: "pending", confirmedAt: null, createdAt: new Date(), updatedAt: new Date(), creator: active, payer: active, shares: [{ id: "share-a", groupId: "group-a", expenseId: "expense-a", participantId: "alice", amount: 50000, createdAt: new Date(), updatedAt: new Date(), participant: active }], obligations: [], receipts: [] }) });
    render(await GroupExpenseDetailPage({ params: Promise.resolve({ groupId: "group-a", expenseId: "expense-a" }) }));
    expect(screen.getByRole("heading", { name: "Pending confirmation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm I paid" })).toBeInTheDocument();
    expect(screen.getByText("Rp 50.000")).toBeInTheDocument();
    expect(screen.getByText("No obligations yet. This expense becomes authoritative after Alice confirms that they paid.")).toBeInTheDocument();
  });

  it("renders former identities and exact confirmed obligations", async () => {
    const former = { id: "former", userId: "user-c", displayName: "Charlie", label: null, status: "former" as const };
    mocks.createGroupAccountingRepository.mockReturnValue({ getExpense: vi.fn().mockResolvedValue({ id: "expense-a", groupId: "group-a", creatorParticipantId: "former", payerParticipantId: "alice", description: "Dinner", occurredAt: new Date("2026-08-27T12:00:00Z"), totalAmount: 150000, state: "confirmed", confirmedAt: new Date("2026-08-27T13:00:00Z"), createdAt: new Date(), updatedAt: new Date(), creator: former, payer: active, shares: [{ id: "share-a", groupId: "group-a", expenseId: "expense-a", participantId: "former", amount: 50000, createdAt: new Date(), updatedAt: new Date(), participant: former }], obligations: [{ id: "obligation-a", groupId: "group-a", sourceExpenseId: "expense-a", sourceShareId: "share-a", debtorParticipantId: "former", creditorParticipantId: "alice", originalAmount: 50000, createdAt: new Date(), debtor: former, creditor: active }], receipts: [] }) });
    render(await GroupExpenseDetailPage({ params: Promise.resolve({ groupId: "group-a", expenseId: "expense-a" }) }));
    expect(screen.getAllByText("Charlie · Former member").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Charlie · Former member")[1]?.closest(".group-expense__obligation-row")).toHaveTextContent("owes Alice");
    expect(screen.getAllByText("Rp 50.000").length).toBe(2);
    expect(screen.queryByRole("button", { name: "Confirm I paid" })).not.toBeInTheDocument();
  });
});
