import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
  createOffsetRepository: vi.fn(),
  confirmOffsetAction: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/group-offsets", () => ({
  createGroupOffsetRepository: mocks.createOffsetRepository,
  GroupOffsetError: class GroupOffsetError extends Error {
    constructor(readonly code: string) { super(code); }
  },
}));
vi.mock("@/components/realtime/group-settlement-live-refresh", () => ({ GroupSettlementLiveRefresh: () => null }));
vi.mock("../../actions", () => ({ confirmGroupOffsetAction: mocks.confirmOffsetAction }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, useRouter: () => ({ refresh: vi.fn() }) }));

import GroupOffsetDetailPage from "./page";

const initiator = { id: "initiator", userId: "user-a", displayName: "Ari", label: null, status: "active" as const };
const counterparty = { id: "counterparty", userId: "user-b", displayName: "Bima", label: null, status: "active" as const };

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: "application-a",
    offsetSettlementId: "offset-a",
    obligationId: "obligation-a",
    appliedAmount: 60000,
    createdAt: new Date("2026-08-27T13:00:00Z"),
    sourceExpenseId: "expense-a",
    sourceExpenseDescription: "Dinner",
    sourceExpenseOccurredAt: new Date("2026-08-26T12:00:00Z"),
    sourceExpenseState: "confirmed" as const,
    obligationOriginalAmount: 60000,
    obligationVoidedAt: null,
    debtor: initiator,
    creditor: counterparty,
    ...overrides,
  };
}

function offset(state: "pending" | "confirmed", applications: object[] = []) {
  return {
    id: "offset-a",
    groupId: "group-a",
    initiatorParticipantId: initiator.id,
    counterpartyParticipantId: counterparty.id,
    amount: 60000,
    state,
    createdAt: new Date("2026-08-27T12:00:00Z"),
    confirmedAt: state === "confirmed" ? new Date("2026-08-27T13:00:00Z") : null,
    initiator,
    counterparty,
    applications,
  };
}

describe("Group offset detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDatabase.mockReturnValue("database");
    mocks.createOffsetRepository.mockReturnValue({ getOffset: vi.fn().mockResolvedValue(offset("pending")) });
  });

  it("shows pending no-effect language and only the counterparty confirmation control", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "user-a" } });
    render(await GroupOffsetDetailPage({ params: Promise.resolve({ groupId: "group-a", offsetId: "offset-a" }) }));
    expect(screen.getByRole("heading", { name: /Pending/ })).toBeInTheDocument();
    expect(screen.getByText(/no applications and no effect until then/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm offset" })).not.toBeInTheDocument();

    mocks.requireSession.mockResolvedValue({ user: { id: "user-b" } });
    render(await GroupOffsetDetailPage({ params: Promise.resolve({ groupId: "group-a", offsetId: "offset-a" }) }));
    expect(screen.getByRole("button", { name: "Confirm offset" })).toBeInTheDocument();
  });

  it("shows both reciprocal application histories and preserved later-voided source history", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.createOffsetRepository.mockReturnValue({
      getOffset: vi.fn().mockResolvedValue(offset("confirmed", [
        application(),
        application({ id: "application-b", obligationId: "obligation-b", debtor: counterparty, creditor: initiator, sourceExpenseId: "expense-b", sourceExpenseDescription: "Taxi", sourceExpenseState: "voided", obligationVoidedAt: new Date("2026-08-28T12:00:00Z") }),
      ])),
    });
    render(await GroupOffsetDetailPage({ params: Promise.resolve({ groupId: "group-a", offsetId: "offset-a" }) }));
    expect(screen.getByRole("heading", { name: "Offset applications" })).toBeInTheDocument();
    expect(screen.getByText("Dinner")).toBeInTheDocument();
    expect(screen.getByText("Taxi")).toBeInTheDocument();
    expect(screen.getByText(/offset history preserved/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View Taxi expense/ })).toHaveAttribute("href", "/app/personal/groups/group-a/expenses/expense-b");
  });
});
