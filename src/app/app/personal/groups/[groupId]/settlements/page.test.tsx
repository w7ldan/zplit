import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
  createSettlementRepository: vi.fn(),
  createAccountingRepository: vi.fn(),
  createSettlementAction: vi.fn(),
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
vi.mock("@/server/group-accounting", () => ({
  createGroupAccountingRepository: mocks.createAccountingRepository,
  GroupAccountingError: class GroupAccountingError extends Error {
    constructor(readonly code: string) { super(code); }
  },
}));
vi.mock("@/components/realtime/group-settlement-live-refresh", () => ({ GroupSettlementLiveRefresh: () => null }));
vi.mock("@/components/app/task-panel", () => ({ TaskPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("./actions", () => ({ createGroupSettlementAction: mocks.createSettlementAction }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import GroupSettlementsPage from "./page";

const sender = {
  id: "sender",
  userId: "user-a",
  displayName: "Ari",
  label: null,
  status: "active" as const,
  canCreate: true,
  canPay: true,
  canParticipate: true,
  canBeCreditor: true,
};
const recipient = {
  id: "recipient",
  userId: "user-b",
  displayName: "Bima",
  label: "Office",
  status: "active" as const,
  canCreate: true,
  canPay: true,
  canParticipate: true,
  canBeCreditor: true,
};
const external = {
  id: "external",
  userId: null,
  displayName: "Cash taxi",
  label: null,
  status: "external" as const,
  canCreate: false,
  canPay: false,
  canParticipate: true,
  canBeCreditor: false,
};
const former = {
  id: "former",
  userId: "user-c",
  displayName: "Charlie",
  label: null,
  status: "former" as const,
  canCreate: false,
  canPay: false,
  canParticipate: false,
  canBeCreditor: false,
};

const settlement = {
  id: "settlement-a",
  groupId: "group-a",
  senderParticipantId: sender.id,
  recipientParticipantId: recipient.id,
  amount: 70000,
  paymentMethod: "Cash",
  state: "pending" as const,
  createdAt: new Date("2026-08-27T12:00:00Z"),
  confirmedAt: null,
  sender,
  recipient,
  proof: null,
};

describe("Group settlements page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createSettlementRepository.mockReturnValue({
      listSettlements: vi.fn().mockResolvedValue({ items: [settlement], page: 1, pageSize: 20, totalItems: 1, totalPages: 1 }),
      getBalances: vi.fn().mockResolvedValue([{ debtorParticipantId: sender.id, creditorParticipantId: recipient.id, amount: 100000 }]),
    });
    mocks.createAccountingRepository.mockReturnValue({
      getParticipantEligibility: vi.fn().mockResolvedValue([sender, recipient, external, former]),
    });
  });

  it("shows pending history and explains that canonical balance is unchanged", async () => {
    render(await GroupSettlementsPage({ params: Promise.resolve({ groupId: "group-a" }) }));
    expect(screen.getByRole("heading", { name: "Payments" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ari.*Bima/ })).toHaveAttribute("href", "/app/personal/groups/group-a/settlements/settlement-a");
    expect(screen.getByText("Pending · awaiting recipient confirmation")).toBeInTheDocument();
    expect(screen.getByText(/Pending payments stay in the outstanding debt/)).toBeInTheDocument();
    expect(screen.getByText("Rp 100.000")).toBeInTheDocument();
  });

  it("offers only active registered recipients and never a sender selector", async () => {
    render(await GroupSettlementsPage({
      params: Promise.resolve({ groupId: "group-a" }),
      searchParams: Promise.resolve({ create: "1" }),
    }));
    expect(screen.getByLabelText("Paid to")).toHaveValue(recipient.id);
    expect(screen.getByRole("option", { name: "Bima · Office" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Cash taxi|Charlie|Ari/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Paid by")).not.toBeInTheDocument();
    expect(screen.getByText("Current debt from you")).toBeInTheDocument();
  });
});
