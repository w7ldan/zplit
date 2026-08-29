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

function settlement(state: "pending" | "confirmed", proof: object | null = null) {
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
      })),
    });
    render(await GroupSettlementDetailPage({ params: Promise.resolve({ groupId: "group-a", settlementId: "settlement-a" }) }));
    expect(screen.getByRole("heading", { name: /Confirmed/ })).toBeInTheDocument();
    expect(screen.getByText(/canonical Group balance already includes this payment/)).toBeInTheDocument();
    expect(screen.getByText(/read-only after confirmation/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add payment proof|Replace payment proof/ })).not.toBeInTheDocument();
  });
});
