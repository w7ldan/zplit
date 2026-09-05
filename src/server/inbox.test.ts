import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationRecord } from "./notifications";
import { presentNotification } from "@/domain/notifications";

const mocks = vi.hoisted(() => ({
  page: vi.fn(), unread: vi.fn(), friends: vi.fn(), organizations: vi.fn(), groups: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/notifications", () => ({ getCurrentUserNotificationPage: mocks.page, getCurrentUserUnreadNotificationCount: mocks.unread }));
vi.mock("@/server/friend-links", () => ({ getCurrentUserFriendLinkRequestStatuses: mocks.friends }));
vi.mock("@/server/organization-invitations", () => ({ getCurrentUserOrganizationInvitationStatuses: mocks.organizations }));
vi.mock("@/server/group-join-requests", () => ({ getCurrentUserGroupJoinRequestStatuses: mocks.groups }));

import { getCurrentUserInboxPage } from "./inbox";

const id = "11111111-1111-4111-8111-111111111111";
const groupId = "22222222-2222-4222-8222-222222222222";
const expiresAt = "2026-09-01T00:00:00.000Z";
const invitation = { requestId: id, groupId, groupName: "Trip", requesterDisplayName: "Alice", requesterUsername: "alice", expiresAt };
const groupHref = `/app/personal/groups/${groupId}`;

function notification(type: string, metadata: Record<string, unknown>): NotificationRecord {
  return { id: type, recipientUserId: "viewer", type, metadata: metadata as NotificationRecord["metadata"], dedupeKey: null, readAt: null, createdAt: new Date(expiresAt) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.unread.mockResolvedValue(7);
  mocks.friends.mockResolvedValue(new Map([[id, "pending"]]));
  mocks.organizations.mockResolvedValue(new Map());
  mocks.groups.mockResolvedValue(new Map());
});

describe("Inbox preparation", () => {
  it("hydrates a page in bounded batches while preserving order, unread state and catalog presentation", async () => {
    const rows = [
      notification("friend.link.request", { requestId: id, requesterDisplayName: "Alice", requesterUsername: "alice", friendName: "Office" }),
      notification("organization.invitation", { invitationId: id, organizationId: groupId, organizationName: "Team", inviterDisplayName: "Alice", role: "member", expiresAt }),
      notification("group.invitation", invitation),
      notification("group.participant.link.request", { ...invitation, participantDisplayName: "Bob", participantLabel: null }),
      notification("friend.link.request", { requestId: "invalid" }),
      notification("future.unknown", {}),
    ];
    const groupState = { id, groupId, kind: "member_invitation", participantId: null, status: "expired", expiresAt: new Date(expiresAt) };
    mocks.groups.mockResolvedValue(new Map([[id, groupState]]));
    mocks.page.mockResolvedValue({ rows, page: 2, pageSize: 20, totalItems: 26, totalPages: 2 });
    const result = await getCurrentUserInboxPage("2");
    expect(mocks.page).toHaveBeenCalledWith("2");
    expect(mocks.friends).toHaveBeenCalledExactlyOnceWith([id]);
    expect(mocks.organizations).toHaveBeenCalledExactlyOnceWith([id]);
    expect(mocks.groups).toHaveBeenCalledExactlyOnceWith([id, id]);
    expect(result).toMatchObject({ page: 2, pageSize: 20, totalItems: 26, totalPages: 2, unreadCount: 7 });
    expect(result.rows.map(({ id }) => id)).toEqual(rows.map(({ id }) => id));
    result.rows.forEach((row, index) => {
      expect(row).toMatchObject(rows[index]!);
      expect(row.presentation).toEqual(presentNotification(row.type, row.metadata));
    });
    expect(result.rows.map(({ action }) => action)).toEqual([
      { kind: "friend", requestId: id, status: "pending" },
      { kind: "organization", invitationId: id, status: undefined },
      { kind: "group", requestId: id, requestKind: "member_invitation", status: groupState },
      { kind: "group", requestId: id, requestKind: "participant_link", status: groupState },
      null, null,
    ]);
  });

  it.each([
    ["friend.link.request.outcome", { requestId: id, friendId: id, status: "declined" }, `/app/friends/${id}`, "Open Friend"],
    ["organization.invitation.outcome", { invitationId: id, organizationId: groupId, status: "accepted" }, `/app/organizations/${groupId}`, "Open organization"],
    ["group.invitation.outcome", { requestId: id, groupId, status: "accepted" }, groupHref, "Open Group"],
    ["group.participant.link.outcome", { requestId: id, groupId, status: "declined" }, groupHref, "Open Group"],
    ["group.expense.payer.claim.outcome", { expenseId: id, groupId, description: "Dinner", status: "rejected" }, `${groupHref}/expenses/${id}`, "Open expense"],
    ["group.settlement.confirmation", { settlementId: id, groupId, groupName: "Trip", senderParticipantId: id, senderDisplayName: "Alice" }, `${groupHref}/settlements/${id}`, "Review payment"],
    ["group.settlement.outcome", { settlementId: id, groupId, status: "confirmed" }, `${groupHref}/settlements/${id}`, "Open payment"],
    ["group.offset.confirmation", { offsetId: id, groupId, groupName: "Trip", initiatorParticipantId: id, initiatorDisplayName: "Alice" }, `${groupHref}/settlements/offsets/${id}`, "Review offset"],
    ["group.offset.outcome", { offsetId: id, groupId, status: "confirmed" }, `${groupHref}/settlements/offsets/${id}`, "Open offset"],
  ] as const)("preserves %s navigation", async (type, metadata, href, label) => {
    mocks.page.mockResolvedValue({ rows: [notification(type, metadata)], page: 1, pageSize: 20, totalItems: 1, totalPages: 1 });
    const result = await getCurrentUserInboxPage();
    expect(result.rows[0]?.action).toEqual({ kind: "link", href, label });
    expect(mocks.friends).toHaveBeenCalledExactlyOnceWith([]);
    expect(mocks.organizations).toHaveBeenCalledExactlyOnceWith([]);
    expect(mocks.groups).toHaveBeenCalledExactlyOnceWith([]);
  });

  it("prepares payer claims without moving action authorization into the read model", async () => {
    mocks.page.mockResolvedValue({ rows: [notification("group.expense.payer.claim", { expenseId: id, groupId, groupName: "Trip", description: "Dinner" })] });
    expect((await getCurrentUserInboxPage()).rows[0]?.action).toEqual({ kind: "expense", groupId, expenseId: id });
  });
});
