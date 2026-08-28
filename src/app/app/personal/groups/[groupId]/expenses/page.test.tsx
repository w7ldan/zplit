import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), createGroupAccountingRepository: vi.fn(), notFound: vi.fn() }));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/group-accounting", () => ({ createGroupAccountingRepository: mocks.createGroupAccountingRepository, GroupAccountingError: class GroupAccountingError extends Error { constructor(readonly code: string) { super(code); } } }));
vi.mock("@/components/realtime/group-expense-live-refresh", () => ({ GroupExpenseLiveRefresh: () => null }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import GroupExpensesPage from "./page";

const payer = { id: "alice", userId: "user-a", displayName: "Alice", label: null, status: "active" as const };

describe("Group expenses page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createGroupAccountingRepository.mockReturnValue({
      listExpenses: vi.fn().mockResolvedValue({ items: [{ id: "expense-a", groupId: "group-a", creatorParticipantId: "alice", payerParticipantId: "alice", description: "Dinner", occurredAt: new Date("2026-08-27T12:00:00Z"), totalAmount: 100000, state: "pending", confirmedAt: null, createdAt: new Date(), updatedAt: new Date(), payer, shareCount: 2 }], page: 1, pageSize: 20, totalItems: 1, totalPages: 1 }),
      getParticipantEligibility: vi.fn().mockResolvedValue([]),
    });
  });

  it("is Group-scoped and presents pending payer attention", async () => {
    render(await GroupExpensesPage({ params: Promise.resolve({ groupId: "group-a" }), searchParams: Promise.resolve({ q: "Dinner", state: "pending" }) }));
    expect(screen.getByRole("heading", { level: 1, name: "Expenses" })).toBeInTheDocument();
    expect(screen.getByText("Shared spending recorded inside this Group. Confirmed expenses create participant-to-participant obligations.")).toBeInTheDocument();
    expect(screen.getByText("Needs your confirmation")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dinner" })).toHaveAttribute("href", "/app/personal/groups/group-a/expenses/expense-a");
    expect(screen.getByRole("option", { name: "Rejected" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Voided" })).toBeInTheDocument();
    expect(mocks.createGroupAccountingRepository).toHaveBeenCalledWith("database", "group-a");
  });
});
