import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InboxPage from "./page";

const mocks = vi.hoisted(() => ({
  getPage: vi.fn(),
  getUnread: vi.fn(),
  markAll: vi.fn(),
  markOne: vi.fn(),
  getFriendLinkStatuses: vi.fn(),
}));

vi.mock("@/server/notifications", () => ({
  getCurrentUserNotificationPage: mocks.getPage,
  getCurrentUserUnreadNotificationCount: mocks.getUnread,
}));
vi.mock("@/server/friend-links", () => ({ getCurrentUserFriendLinkRequestStatuses: mocks.getFriendLinkStatuses }));
vi.mock("@/components/notifications/inbox-live-refresh", () => ({ InboxLiveRefresh: () => null }));
vi.mock("./actions", () => ({ markAllNotificationsReadAction: mocks.markAll, markNotificationReadAction: mocks.markOne, acceptFriendLinkRequestAction: vi.fn(), declineFriendLinkRequestAction: vi.fn(), unlinkFriendLinkRequestAction: vi.fn() }));

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

  it("shows the target-side connected state and unlink consequence without ledger details", async () => {
    mocks.getPage.mockResolvedValue({
      rows: [{ id: "notification-link", type: "friend.link.request", metadata: { requestId: "11111111-1111-4111-8111-111111111111", requesterDisplayName: "Owner", requesterUsername: "owner", friendName: "Office" }, createdAt: new Date("2026-08-25T07:00:00Z"), readAt: new Date("2026-08-25T08:00:00Z"), recipientUserId: "user-a", dedupeKey: "friend-link-request:11111111-1111-4111-8111-111111111111" }],
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
    });
    mocks.getUnread.mockResolvedValue(0);
    mocks.getFriendLinkStatuses.mockResolvedValue(new Map([["11111111-1111-4111-8111-111111111111", "connected"]]));
    render(await InboxPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Active friend")).toBeInTheDocument();
    expect(screen.getByText("Unlink", { selector: "summary" })).toBeInTheDocument();
    expect(screen.getByText("Unlink @owner?")).toBeInTheDocument();
    expect(screen.getByText(/Existing Friend balances and history remain unchanged/)).toBeInTheDocument();
    expect(screen.queryByText(/email|private ledger|expense history/i)).not.toBeInTheDocument();
  });
});
