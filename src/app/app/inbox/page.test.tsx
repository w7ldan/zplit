import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InboxPage from "./page";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getPage: vi.fn(),
  getUnread: vi.fn(),
  markAll: vi.fn(),
  markOne: vi.fn(),
  getFriendLinkStatuses: vi.fn(),
  getOrganizationInvitationStatuses: vi.fn(),
  getGroupJoinRequestStatuses: vi.fn(),
}));

vi.mock("@/server/notifications", () => ({
  getCurrentUserNotificationPage: mocks.getPage,
  getCurrentUserUnreadNotificationCount: mocks.getUnread,
}));
vi.mock("@/server/friend-links", () => ({ getCurrentUserFriendLinkRequestStatuses: mocks.getFriendLinkStatuses }));
vi.mock("@/server/organization-invitations", () => ({ getCurrentUserOrganizationInvitationStatuses: mocks.getOrganizationInvitationStatuses }));
vi.mock("@/server/group-join-requests", () => ({ getCurrentUserGroupJoinRequestStatuses: mocks.getGroupJoinRequestStatuses }));
vi.mock("@/components/notifications/inbox-live-refresh", () => ({ InboxLiveRefresh: () => null }));
vi.mock("./actions", () => ({ markAllNotificationsReadAction: mocks.markAll, markNotificationReadAction: mocks.markOne, acceptFriendLinkRequestAction: vi.fn(), declineFriendLinkRequestAction: vi.fn(), unlinkFriendLinkRequestAction: vi.fn(), acceptOrganizationInvitationAction: vi.fn(), declineOrganizationInvitationAction: vi.fn(), acceptGroupJoinRequestAction: vi.fn(), declineGroupJoinRequestAction: vi.fn() }));

describe("/app/inbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPage.mockResolvedValue({
      rows: [
        { id: "notification-a", type: "system.test", metadata: { message: "<not html>" }, createdAt: new Date("2026-08-25T07:00:00Z"), readAt: null, recipientUserId: "user-a", dedupeKey: null },
        { id: "notification-b", type: "system.test", metadata: { message: "Already handled" }, createdAt: new Date("2026-08-24T07:00:00Z"), readAt: new Date("2026-08-24T08:00:00Z"), recipientUserId: "user-a", dedupeKey: null },
      ],
      page: 1,
      pageSize: 20,
      totalItems: 21,
      totalPages: 2,
    });
    mocks.getUnread.mockResolvedValue(1);
    mocks.getFriendLinkStatuses.mockResolvedValue(new Map());
    mocks.getOrganizationInvitationStatuses.mockResolvedValue(new Map());
    mocks.getGroupJoinRequestStatuses.mockResolvedValue(new Map());
  });

  it("renders bounded newest rows with safe text and explicit read actions", async () => {
    render(await InboxPage({ searchParams: Promise.resolve({ page: "0" }) }));
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getByText("<not html>")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Mark read" })).toHaveLength(1);
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark all as read" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/app/inbox?page=2#inbox-list");
    expect(mocks.getPage).toHaveBeenCalledWith("0");
  });

  it("keeps the empty state concise and hides mark-all when nothing is unread", async () => {
    mocks.getPage.mockResolvedValue({ rows: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 1 });
    mocks.getUnread.mockResolvedValue(0);
    render(await InboxPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("You’re all caught up.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark all as read" })).not.toBeInTheDocument();
  });

  it("renders a Friend-link request with safe identity-only actions", async () => {
    mocks.getPage.mockResolvedValue({
      rows: [{ id: "notification-link", type: "friend.link.request", metadata: { requestId: "11111111-1111-4111-8111-111111111111", requesterDisplayName: "Owner", requesterUsername: "owner", friendName: "Office" }, createdAt: new Date("2026-08-25T07:00:00Z"), readAt: null, recipientUserId: "user-a", dedupeKey: "friend-link-request:11111111-1111-4111-8111-111111111111" }],
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
    });
    mocks.getFriendLinkStatuses.mockResolvedValue(new Map([["11111111-1111-4111-8111-111111111111", "pending"]]));
    render(await InboxPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Owner @owner wants to link “Office”.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
    expect(screen.queryByText(/email|private ledger|expense history/i)).not.toBeInTheDocument();
  });

  it("keeps accepted history terminal while a later request stays independently actionable", async () => {
    const firstRequestId = "11111111-1111-4111-8111-111111111111";
    const laterRequestId = "22222222-2222-4222-8222-222222222222";
    mocks.getPage.mockResolvedValue({
      rows: [
        { id: "notification-r2", type: "friend.link.request", metadata: { requestId: laterRequestId, requesterDisplayName: "Owner", requesterUsername: "owner", friendName: "Office" }, createdAt: new Date("2026-08-26T07:00:00Z"), readAt: null, recipientUserId: "user-a", dedupeKey: `friend-link-request:${laterRequestId}` },
        { id: "notification-r1", type: "friend.link.request", metadata: { requestId: firstRequestId, requesterDisplayName: "Owner", requesterUsername: "owner", friendName: "Office" }, createdAt: new Date("2026-08-25T07:00:00Z"), readAt: new Date("2026-08-25T08:00:00Z"), recipientUserId: "user-a", dedupeKey: `friend-link-request:${firstRequestId}` },
      ],
      page: 1,
      pageSize: 20,
      totalItems: 2,
      totalPages: 1,
    });
    mocks.getUnread.mockResolvedValue(0);
    mocks.getFriendLinkStatuses.mockResolvedValue(new Map([[firstRequestId, "accepted"], [laterRequestId, "pending"]]));
    render(await InboxPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.queryByText("Active friend")).not.toBeInTheDocument();
    expect(screen.queryByText("Unlink", { selector: "summary" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Accept" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Decline" })).toHaveLength(1);
    expect(screen.queryByText(/email|private ledger|expense history/i)).not.toBeInTheDocument();
  });

  it("renders pending and resolved Organization invitation states without email fields", async () => {
    const invitationId = "33333333-3333-4333-8333-333333333333";
    const organizationId = "44444444-4444-4444-8444-444444444444";
    mocks.getPage.mockResolvedValue({
      rows: [{ id: "notification-invitation", type: "organization.invitation", metadata: { invitationId, organizationId, organizationName: "Zplit Team", inviterDisplayName: "Wildan", role: "treasurer", expiresAt: "2026-09-01T00:00:00.000Z" }, createdAt: new Date("2026-08-25T07:00:00Z"), readAt: null, recipientUserId: "user-a", dedupeKey: `organization-invitation:${invitationId}` }],
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
    });
    mocks.getOrganizationInvitationStatuses.mockResolvedValue(new Map([[invitationId, { id: invitationId, organizationId, status: "pending", role: "treasurer", expiresAt: new Date("2026-09-01T00:00:00Z") }]]));
    render(await InboxPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Wildan invited you to join Zplit Team as Treasurer.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
    expect(screen.getAllByRole("time").map((time) => time.getAttribute("dateTime"))).toContain("2026-09-01T00:00:00.000Z");
    expect(screen.queryByText(/Expires .* UTC\./)).not.toBeInTheDocument();
    expect(screen.queryByText(/email|example\.com/i)).not.toBeInTheDocument();
  });

  it("renders an external participant link request with explicit consent copy", async () => {
    const requestId = "55555555-5555-4555-8555-555555555555";
    const groupId = "66666666-6666-4666-8666-666666666666";
    mocks.getPage.mockResolvedValue({
      rows: [{ id: "notification-group-link", type: "group.participant.link.request", metadata: { requestId, groupId, groupName: "Bandung Trip", requesterDisplayName: "Wildan", requesterUsername: "wildan", participantDisplayName: "Alice", participantLabel: "Fasilkom", expiresAt: "2026-09-01T00:00:00.000Z" }, createdAt: new Date("2026-08-25T07:00:00Z"), readAt: null, recipientUserId: "user-a", dedupeKey: `group-join-request:${requestId}` }],
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
    });
    mocks.getGroupJoinRequestStatuses.mockResolvedValue(new Map([[requestId, { id: requestId, groupId, kind: "participant_link", participantId: "participant-a", status: "pending", expiresAt: new Date("2026-09-01T00:00:00Z") }]]));
    render(await InboxPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Wildan @wildan wants to link your Zplit account to “Alice · Fasilkom” in Bandung Trip.")).toBeInTheDocument();
    expect(screen.getByText("This links your account to an existing Group participant.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
  });

  it("links repeated payer-claim notifications to their own Group expenses", async () => {
    const groupId = "66666666-6666-4666-8666-666666666666";
    const firstExpenseId = "77777777-7777-4777-8777-777777777777";
    const secondExpenseId = "88888888-8888-4888-8888-888888888888";
    const notification = (id: string, expenseId: string) => ({ id, type: "group.expense.payer.claim", metadata: { expenseId, groupId, groupName: "Bandung Trip", description: "Dinner" }, createdAt: new Date("2026-08-25T07:00:00Z"), readAt: null, recipientUserId: "user-a", dedupeKey: `group-expense-payer-claim:${expenseId}` });
    mocks.getPage.mockResolvedValue({ rows: [notification("notification-a", firstExpenseId), notification("notification-b", secondExpenseId)], page: 1, pageSize: 20, totalItems: 2, totalPages: 1 });
    mocks.getUnread.mockResolvedValue(2);
    render(await InboxPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getAllByRole("link", { name: "Review expense" }).map((link) => link.getAttribute("href"))).toEqual([
      `/app/personal/groups/${groupId}/expenses/${firstExpenseId}`,
      `/app/personal/groups/${groupId}/expenses/${secondExpenseId}`,
    ]);
  });

  it("navigates settlement notifications to the matching Group payment", async () => {
    const groupId = "66666666-6666-4666-8666-666666666666";
    const settlementId = "99999999-9999-4999-8999-999999999999";
    mocks.getPage.mockResolvedValue({
      rows: [{
        id: "notification-settlement",
        type: "group.settlement.confirmation",
        metadata: {
          settlementId,
          groupId,
          groupName: "Bandung Trip",
          senderParticipantId: "88888888-8888-4888-8888-888888888888",
          senderDisplayName: "Wildan",
        },
        createdAt: new Date("2026-08-25T07:00:00Z"),
        readAt: null,
        recipientUserId: "user-a",
        dedupeKey: `group-settlement-confirmation:${settlementId}`,
      }],
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
    });
    render(await InboxPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Wildan recorded a payment to you in Bandung Trip.")).toBeInTheDocument();
    expect(screen.getByText("Confirmation is required.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review payment" })).toHaveAttribute("href", `/app/personal/groups/${groupId}/settlements/${settlementId}`);
  });

  it("navigates offset notifications to the matching Group offset", async () => {
    const groupId = "66666666-6666-4666-8666-666666666666";
    const offsetId = "99999999-9999-4999-8999-999999999999";
    mocks.getPage.mockResolvedValue({
      rows: [{
        id: "notification-offset",
        type: "group.offset.confirmation",
        metadata: {
          offsetId,
          groupId,
          groupName: "Bandung Trip",
          initiatorParticipantId: "88888888-8888-4888-8888-888888888888",
          initiatorDisplayName: "Wildan",
        },
        createdAt: new Date("2026-08-25T07:00:00Z"),
        readAt: null,
        recipientUserId: "user-a",
        dedupeKey: `group-offset-confirmation:${offsetId}`,
      }],
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
    });
    render(await InboxPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Wildan proposed an offset with you in Bandung Trip.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review offset" })).toHaveAttribute("href", `/app/personal/groups/${groupId}/settlements/offsets/${offsetId}`);
  });

  it("navigates terminal outcomes by their own durable object identity", async () => {
    const friendId = "11111111-1111-4111-8111-111111111111";
    const requestId = "22222222-2222-4222-8222-222222222222";
    const organizationId = "33333333-3333-4333-8333-333333333333";
    const invitationId = "44444444-4444-4444-8444-444444444444";
    const groupId = "55555555-5555-4555-8555-555555555555";
    const expenseId = "66666666-6666-4666-8666-666666666666";
    const settlementId = "77777777-7777-4777-8777-777777777777";
    const offsetId = "88888888-8888-4888-8888-888888888888";
    const metadata = { createdAt: new Date("2026-08-25T07:00:00Z"), readAt: new Date("2026-08-25T08:00:00Z"), recipientUserId: "user-a" };
    mocks.getPage.mockResolvedValue({
      rows: [
        { ...metadata, id: "friend-outcome", type: "friend.link.request.outcome", metadata: { requestId, friendId, status: "accepted" }, dedupeKey: `friend-link-request-outcome:${requestId}:accepted` },
        { ...metadata, id: "organization-outcome", type: "organization.invitation.outcome", metadata: { invitationId, organizationId, status: "declined" }, dedupeKey: `organization-invitation-outcome:${invitationId}:declined` },
        { ...metadata, id: "group-outcome", type: "group.invitation.outcome", metadata: { requestId, groupId, status: "accepted" }, dedupeKey: `group-join-request-outcome:${requestId}:accepted` },
        { ...metadata, id: "link-outcome", type: "group.participant.link.outcome", metadata: { requestId, groupId, status: "declined" }, dedupeKey: `group-join-request-outcome:${requestId}:declined` },
        { ...metadata, id: "expense-outcome", type: "group.expense.payer.claim.outcome", metadata: { expenseId, groupId, description: "Dinner", status: "rejected" }, dedupeKey: `group-expense-payer-claim-outcome:${expenseId}:rejected` },
        { ...metadata, id: "settlement-outcome", type: "group.settlement.outcome", metadata: { settlementId, groupId, status: "confirmed" }, dedupeKey: `group-settlement-outcome:${settlementId}:confirmed` },
        { ...metadata, id: "offset-outcome", type: "group.offset.outcome", metadata: { offsetId, groupId, status: "confirmed" }, dedupeKey: `group-offset-outcome:${offsetId}:confirmed` },
      ],
      page: 1,
      pageSize: 20,
      totalItems: 7,
      totalPages: 1,
    });
    mocks.getUnread.mockResolvedValue(0);
    render(await InboxPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Your Friend link request was accepted.")).toBeInTheDocument();
    expect(screen.getByText("Your payer claim for “Dinner” was rejected.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Friend" })).toHaveAttribute("href", `/app/friends/${friendId}`);
    expect(screen.getByRole("link", { name: "Open organization" })).toHaveAttribute("href", `/app/organizations/${organizationId}`);
    expect(screen.getAllByRole("link", { name: "Open Group" })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Open expense" })).toHaveAttribute("href", `/app/personal/groups/${groupId}/expenses/${expenseId}`);
    expect(screen.getByRole("link", { name: "Open payment" })).toHaveAttribute("href", `/app/personal/groups/${groupId}/settlements/${settlementId}`);
    expect(screen.getByRole("link", { name: "Open offset" })).toHaveAttribute("href", `/app/personal/groups/${groupId}/settlements/offsets/${offsetId}`);
  });
});
