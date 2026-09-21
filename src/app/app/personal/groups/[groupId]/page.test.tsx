import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
  getGroupForMember: vi.fn(),
  listGroupParticipants: vi.fn(),
  getGroupBalances: vi.fn(),
  createGroupAccountingRepository: vi.fn(),
  createGroupSettlementRepository: vi.fn(),
  listGroupJoinRequests: vi.fn(),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/groups", () => ({
  getGroupForMember: mocks.getGroupForMember,
  listGroupParticipants: mocks.listGroupParticipants,
}));
vi.mock("@/server/group-accounting", () => ({
  getGroupBalances: mocks.getGroupBalances,
  createGroupAccountingRepository: mocks.createGroupAccountingRepository,
}));
vi.mock("@/server/group-settlements", () => ({ createGroupSettlementRepository: mocks.createGroupSettlementRepository }));
vi.mock("@/server/group-join-requests", () => ({ listGroupJoinRequests: mocks.listGroupJoinRequests }));

import GroupDetailPage from "./page";

const alice = { id: "alice", userId: "user-a", displayName: "Alice", label: null, role: "owner" as const, isExternal: false, isFormer: false, status: "active" as const };
const bob = { id: "bob", userId: "user-b", displayName: "Bob", label: null, role: "member" as const, isExternal: false, isFormer: false, status: "active" as const };

describe("Group overview workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.getGroupForMember.mockResolvedValue({
      id: "group-a",
      name: "Bandung Trip",
      description: null,
      role: "owner",
      participantCount: 2,
      memberCount: 2,
      externalParticipantCount: 0,
      avatar: null,
      archivedAt: null,
      isOwner: true,
      canManageGroup: true,
      canManageParticipants: true,
      canManageRoles: true,
      canDelete: true,
    });
    mocks.listGroupParticipants.mockResolvedValue([alice, bob]);
    mocks.getGroupBalances.mockResolvedValue([{ debtorParticipantId: "bob", creditorParticipantId: "alice", amount: 120000 }]);
    mocks.createGroupAccountingRepository.mockReturnValue({
      listExpenses: vi.fn().mockResolvedValue({
        items: [{
          id: "expense-a",
          groupId: "group-a",
          creatorParticipantId: "alice",
          payerParticipantId: "alice",
          description: "Dinner",
          occurredAt: new Date("2026-09-10T12:00:00Z"),
          occurredOn: "2026-09-10",
          totalAmount: 240000,
          state: "confirmed",
          confirmedAt: new Date("2026-09-10T13:00:00Z"),
          createdAt: new Date("2026-09-10T12:00:00Z"),
          updatedAt: new Date("2026-09-10T13:00:00Z"),
          payer: { id: "alice", userId: "user-a", displayName: "Alice", label: null, status: "active" as const },
          shareCount: 2,
        }],
        page: 1,
        pageSize: 20,
        totalItems: 1,
        totalPages: 1,
      }),
    });
    mocks.createGroupSettlementRepository.mockReturnValue({
      listSettlements: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 1 }),
    });
    mocks.listGroupJoinRequests.mockResolvedValue({ invitations: [], links: [] });
  });

  it("composes canonical balances with recent financial ledgers and participant context", async () => {
    render(await GroupDetailPage({ params: Promise.resolve({ groupId: "group-a" }) }));

    expect(screen.getByRole("heading", { level: 1, name: "Bandung Trip" })).toBeInTheDocument();
    expect(screen.getByText("Owed to you")).toBeInTheDocument();
    expect(screen.getByLabelText("Owed to you: Rp 120.000")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent expenses" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dinner" })).toHaveAttribute("href", "/app/personal/groups/group-a/expenses/expense-a");
    expect(screen.getByRole("heading", { name: "People" })).toBeInTheDocument();
    expect(screen.getByText("Peer-to-peer by design")).toBeInTheDocument();
  });
});
