import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InboxPage from "./page";

const mocks = vi.hoisted(() => ({
  getPage: vi.fn(),
  getUnread: vi.fn(),
  markAll: vi.fn(),
  markOne: vi.fn(),
}));

vi.mock("@/server/notifications", () => ({
  getCurrentUserNotificationPage: mocks.getPage,
  getCurrentUserUnreadNotificationCount: mocks.getUnread,
}));
vi.mock("@/components/notifications/inbox-live-refresh", () => ({ InboxLiveRefresh: () => null }));
vi.mock("./actions", () => ({ markAllNotificationsReadAction: mocks.markAll, markNotificationReadAction: mocks.markOne }));

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
});
