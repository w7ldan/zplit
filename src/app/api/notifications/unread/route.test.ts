import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  headers: vi.fn(),
  getUnread: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/auth/runtime", () => ({ getAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/server/notifications", () => ({ getUnreadNotificationCountForUser: mocks.getUnread }));

import { GET } from "./route";

describe("GET /api/notifications/unread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.headers.mockResolvedValue(new Headers({ cookie: "session=test" }));
  });

  it("rejects anonymous requests", async () => {
    mocks.getSession.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.getUnread).not.toHaveBeenCalled();
  });

  it("uses only the authenticated recipient", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.getUnread.mockResolvedValue(7);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ unreadCount: 7 });
    expect(mocks.getUnread).toHaveBeenCalledWith("user-a");
  });
});
