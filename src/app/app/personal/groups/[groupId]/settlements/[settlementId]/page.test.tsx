import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
  createSettlementRepository: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/group-settlements", () => ({
  createGroupSettlementRepository: mocks.createSettlementRepository,
  GroupSettlementError: class GroupSettlementError extends Error {
    constructor(readonly code: string) { super(code); }
  },
}));
vi.mock("@/components/realtime/group-settlement-live-refresh", () => ({ GroupSettlementLiveRefresh: () => null }));
vi.mock("../actions", () => ({ confirmGroupSettlementAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  useRouter: () => ({ refresh: vi.fn() }),
}));

import GroupSettlementDetailPage from "./page";

const sender = {
  id: "sender",
  userId: "user-a",
  displayName: "Ari",
  label: null,
  status: "active" as const,
};
const recipient = {
  id: "recipient",
  userId: "user-b",
  displayName: "Bima",
  label: "Office",
  status: "active" as const,
};

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: "application-a",
    settlementId: "settlement-a",
    obligationId: "obligation-a",
    appliedAmount: 70000,
    createdAt: new Date("2026-08-27T13:00:00Z"),
    sourceExpenseId: "expense-a",
    sourceExpenseDescription: "Dinner",
    sourceExpenseOccurredAt: new Date("2026-08-26T12:00:00Z"),
    sourceExpenseState: "confirmed" as const,
    obligationOriginalAmount: 70000,
    obligationVoidedAt: null,
    debtor: sender,
    creditor: recipient,
    ...overrides,
  };
}

function settlement(
  state: "pending" | "confirmed",
  proof: object | null = null,
  applications: object[] = [],
) {
  return {
    id: "settlement-a",
    groupId: "group-a",
    senderParticipantId: sender.id,
    recipientParticipantId: recipient.id,
    amount: 70000,
    paymentMethod: "Cash",
    state,
    createdAt: new Date("2026-08-27T12:00:00Z"),
    confirmedAt: state === "confirmed" ? new Date("2026-08-27T13:00:00Z") : null,
    sender,
    recipient,
    proof,
    applications,
  };
}

describe("Group settlement detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDatabase.mockReturnValue("database");
    mocks.createSettlementRepository.mockReturnValue({
      getSettlement: vi.fn().mockResolvedValue(settlement("pending")),
    });
  });

  it("shows a pending payment without a sender confirmation control", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "user-a" } });
    render(await GroupSettlementDetailPage({ params: Promise.resolve({ groupId: "group-a", settlementId: "settlement-a" }) }));
    expect(screen.getByRole("heading", { name: /Pending/ })).toBeInTheDocument();
    expect(screen.getByText(/has not reduced the canonical Group balance yet/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Payment applications" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirm payment/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add payment proof" })).toBeDisabled();
  });

  it("shows the recipient-only confirm action for the current recipient", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "user-b" } });
    render(await GroupSettlementDetailPage({ params: Promise.resolve({ groupId: "group-a", settlementId: "settlement-a" }) }));
    expect(screen.getByRole("button", { name: "Confirm payment received" })).toBeInTheDocument();
    expect(screen.getByText(/matches the money you received/)).toBeInTheDocument();
  });

  it("keeps confirmed proof read-only and states that balance is already canonical", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.createSettlementRepository.mockReturnValue({
      getSettlement: vi.fn().mockResolvedValue(settlement("confirmed", {
        id: "proof-a",
        originalFilename: "transfer.png",
        mediaType: "image/png",
        byteSize: 8,
        createdAt: new Date("2026-08-27T12:30:00Z"),
      }, [application()])),
    });
    render(await GroupSettlementDetailPage({ params: Promise.resolve({ groupId: "group-a", settlementId: "settlement-a" }) }));
    expect(screen.getByRole("heading", { name: /Confirmed/ })).toBeInTheDocument();
    expect(screen.getByText(/canonical Group balance already includes this payment/)).toBeInTheDocument();
    expect(screen.getByText(/read-only after confirmation/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add payment proof|Replace payment proof/ })).not.toBeInTheDocument();
  });

  it("shows one confirmed application and links to its source expense", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.createSettlementRepository.mockReturnValue({
      getSettlement: vi.fn().mockResolvedValue(settlement("confirmed", null, [application()])),
    });

    render(await GroupSettlementDetailPage({ params: Promise.resolve({ groupId: "group-a", settlementId: "settlement-a" }) }));

    expect(screen.getByRole("heading", { name: "Payment applications" })).toBeInTheDocument();
    expect(screen.getByText("Dinner")).toBeInTheDocument();
    const expenseLink = screen.getByRole("link", { name: /View Dinner expense and payment application/ });
    expect(expenseLink).toHaveTextContent("Rp 70.000");
    expect(expenseLink).toHaveAttribute("href", "/app/personal/groups/group-a/expenses/expense-a");
  });

  it("shows each application across multiple obligations and preserves void history", async () => {
    const voided = application({
      id: "application-b",
      obligationId: "obligation-b",
      appliedAmount: 40000,
      sourceExpenseId: "expense-b",
      sourceExpenseDescription: "Taxi",
      sourceExpenseState: "voided",
      obligationOriginalAmount: 40000,
      obligationVoidedAt: new Date("2026-08-28T12:00:00Z"),
    });
    mocks.createSettlementRepository.mockReturnValue({
      getSettlement: vi.fn().mockResolvedValue({
        ...settlement("confirmed", null, [
          application({ appliedAmount: 60000 }),
          voided,
        ]),
        amount: 100000,
      }),
    });

    render(await GroupSettlementDetailPage({ params: Promise.resolve({ groupId: "group-a", settlementId: "settlement-a" }) }));

    expect(screen.getByText("Dinner")).toBeInTheDocument();
    expect(screen.getByText("Taxi")).toBeInTheDocument();
    expect(screen.getAllByText("Voided later")).toHaveLength(1);
    expect(screen.getByText(/source expense was later voided/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View Taxi expense/ })).toHaveAttribute("href", "/app/personal/groups/group-a/expenses/expense-b");
  });

  it("does not claim a complete allocation when confirmed application data is incomplete", async () => {
    mocks.createSettlementRepository.mockReturnValue({
      getSettlement: vi.fn().mockResolvedValue(settlement("confirmed")),
    });

    render(await GroupSettlementDetailPage({ params: Promise.resolve({ groupId: "group-a", settlementId: "settlement-a" }) }));

    expect(screen.getByRole("alert")).toHaveTextContent("unavailable or incomplete");
    expect(screen.queryByText("Applied")).not.toBeInTheDocument();
  });
});
