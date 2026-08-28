import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), createGroupAccountingRepository: vi.fn() }));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/group-accounting", () => ({ createGroupAccountingRepository: mocks.createGroupAccountingRepository, GroupAccountingError: class GroupAccountingError extends Error { constructor(readonly code: string) { super(code); } } }));
vi.mock("@/components/realtime/group-expense-live-refresh", () => ({ GroupExpenseLiveRefresh: () => null }));

import GroupExpenseDetailPage from "./page";

const active = { id: "alice", userId: "user-a", displayName: "Alice", label: null, status: "active" as const };
const creator = { id: "creator", userId: "user-c", displayName: "Charlie", label: null, status: "active" as const };

function expense(state: "pending" | "confirmed" | "rejected" | "voided", overrides: Record<string, unknown> = {}) {
  return { id: "expense-a", groupId: "group-a", creatorParticipantId: creator.id, payerParticipantId: active.id, description: "Dinner", occurredAt: new Date("2026-08-27T12:00:00Z"), totalAmount: 150000, state, confirmedAt: state === "confirmed" || state === "voided" ? new Date("2026-08-27T13:00:00Z") : null, createdAt: new Date("2026-08-27T12:00:00Z"), updatedAt: new Date("2026-08-27T13:00:00Z"), creator, payer: active, shares: [], obligations: [], receipts: [], lifecycleEvents: [], ...overrides };
}

function configureExpense(value: unknown) {
  mocks.createGroupAccountingRepository.mockReturnValue({ getExpense: vi.fn().mockResolvedValue(value) });
}

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

  it("shows confirm and reject only to the active claimed payer", async () => {
    configureExpense(expense("pending"));
    const payerView = render(await GroupExpenseDetailPage({ params: Promise.resolve({ groupId: "group-a", expenseId: "expense-a" }) }));
    expect(screen.getByRole("button", { name: "Confirm I paid" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject claim" })).toBeInTheDocument();
    payerView.unmount();

    mocks.requireSession.mockResolvedValue({ user: { id: "user-c" } });
    configureExpense(expense("pending"));
    const creatorView = await GroupExpenseDetailPage({ params: Promise.resolve({ groupId: "group-a", expenseId: "expense-a" }) });
    render(creatorView);
    expect(screen.queryByRole("button", { name: "Confirm I paid" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject claim" })).not.toBeInTheDocument();
    cleanup();

    mocks.requireSession.mockResolvedValue({ user: { id: "user-b" } });
    configureExpense(expense("pending"));
    const unrelatedView = await GroupExpenseDetailPage({ params: Promise.resolve({ groupId: "group-a", expenseId: "expense-a" }) });
    render(unrelatedView);
    expect(screen.queryByRole("button", { name: "Confirm I paid" })).not.toBeInTheDocument();
  });

  it("shows void only to the active payer and keeps terminal states read-only", async () => {
    configureExpense(expense("confirmed"));
    const payerView = render(await GroupExpenseDetailPage({ params: Promise.resolve({ groupId: "group-a", expenseId: "expense-a" }) }));
    expect(screen.getByText("Void expense", { selector: "summary" })).toBeInTheDocument();
    payerView.unmount();

    mocks.requireSession.mockResolvedValue({ user: { id: "user-c" } });
    configureExpense(expense("confirmed"));
    render(await GroupExpenseDetailPage({ params: Promise.resolve({ groupId: "group-a", expenseId: "expense-a" }) }));
    expect(screen.queryByText("Void expense", { selector: "summary" })).not.toBeInTheDocument();
    cleanup();

    for (const state of ["rejected", "voided"] as const) {
      configureExpense(expense(state, { obligations: state === "voided" ? [{ id: "obligation-a", groupId: "group-a", sourceExpenseId: "expense-a", sourceShareId: "share-a", debtorParticipantId: "creator", creditorParticipantId: "alice", originalAmount: 50000, voidedAt: new Date(), createdAt: new Date(), debtor: creator, creditor: active }] : [] }));
      render(await GroupExpenseDetailPage({ params: Promise.resolve({ groupId: "group-a", expenseId: "expense-a" }) }));
      expect(screen.queryByRole("button", { name: "Confirm I paid" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reject claim" })).not.toBeInTheDocument();
      expect(screen.queryByText("Void expense", { selector: "summary" })).not.toBeInTheDocument();
      expect(screen.getByText("Receipts are read-only after an expense leaves pending state.")).toBeInTheDocument();
      cleanup();
    }
  });

  it("renders durable lifecycle history and does not invent self-payer confirmation", async () => {
    configureExpense(expense("confirmed", {
      creator: active,
      creatorParticipantId: active.id,
      lifecycleEvents: [{ id: "event-created", eventType: "created", actorUserId: "user-a", fromState: null, toState: "confirmed", createdAt: new Date("2026-08-27T12:00:00Z") }],
    }));
    render(await GroupExpenseDetailPage({ params: Promise.resolve({ groupId: "group-a", expenseId: "expense-a" }) }));
    expect(screen.getByText("Created by Alice")).toBeInTheDocument();
    expect(screen.queryByText(/Confirmed by/)).not.toBeInTheDocument();

    configureExpense(expense("voided", {
      obligations: [{ id: "obligation-a", groupId: "group-a", sourceExpenseId: "expense-a", sourceShareId: "share-a", debtorParticipantId: "creator", creditorParticipantId: "alice", originalAmount: 50000, voidedAt: new Date(), createdAt: new Date(), debtor: creator, creditor: active }],
      lifecycleEvents: [
        { id: "event-created", eventType: "created", actorUserId: "user-c", fromState: null, toState: "pending", createdAt: new Date("2026-08-27T12:00:00Z") },
        { id: "event-confirmed", eventType: "payer_confirmed", actorUserId: "user-a", fromState: "pending", toState: "confirmed", createdAt: new Date("2026-08-27T12:05:00Z") },
        { id: "event-voided", eventType: "voided", actorUserId: "user-a", fromState: "confirmed", toState: "voided", createdAt: new Date("2026-08-27T12:10:00Z") },
      ],
    }));
    cleanup();
    render(await GroupExpenseDetailPage({ params: Promise.resolve({ groupId: "group-a", expenseId: "expense-a" }) }));
    expect(screen.getByText("Previous participant debt")).toBeInTheDocument();
    expect(screen.getByText("Reversed")).toBeInTheDocument();
    expect(screen.getByText("Confirmed by Alice")).toBeInTheDocument();
    expect(screen.getByText("Voided by Alice")).toBeInTheDocument();
  });
});
