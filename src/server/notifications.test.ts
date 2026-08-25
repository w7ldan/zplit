import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  publishRealtimeEvent: vi.fn(),
  requireSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/realtime", () => ({ publishRealtimeEvent: mocks.publishRealtimeEvent }));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));

import { createNotification, createNotificationInDatabase, markCurrentUserNotificationRead } from "./notifications";

const row = {
  id: "notification-a",
  recipientUserId: "user-a",
  type: "system.test",
  metadata: { message: "Hello" },
  createdAt: new Date(),
  readAt: null,
  dedupeKey: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.publishRealtimeEvent.mockReturnValue({ type: "notification.state.changed" });
});

describe("notification service", () => {
  it("persists before publishing only to the recipient", async () => {
    const returning = vi.fn().mockImplementation(async () => {
      expect(mocks.publishRealtimeEvent).not.toHaveBeenCalled();
      return [row];
    });
    const builder = { values: vi.fn(), returning };
    builder.values.mockReturnValue(builder);
    mocks.getDatabase.mockReturnValue({ insert: vi.fn(() => builder) });

    await expect(createNotification({ recipientUserId: "user-a", type: "system.test", metadata: { message: "Hello" } })).resolves.toEqual(row);
    expect(mocks.publishRealtimeEvent).toHaveBeenCalledWith("user-a", { type: "notification.state.changed", data: { reason: "created" } });
  });

  it("scopes current-user read updates through the authenticated session", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "user-a" } });
    const returning = vi.fn().mockResolvedValue([]);
    const builder = { set: vi.fn(), where: vi.fn(), returning };
    builder.set.mockReturnValue(builder);
    builder.where.mockReturnValue(builder);
    mocks.getDatabase.mockReturnValue({ update: vi.fn(() => builder) });

    await expect(markCurrentUserNotificationRead("notification-b")).resolves.toBe(false);
    expect(mocks.requireSession).toHaveBeenCalledOnce();
    expect(mocks.publishRealtimeEvent).not.toHaveBeenCalled();
  });

  it("keeps a persisted row when publishing fails", async () => {
    mocks.publishRealtimeEvent.mockImplementation(() => { throw new Error("SSE unavailable"); });
    const builder = { values: vi.fn(), returning: vi.fn().mockResolvedValue([row]) };
    builder.values.mockReturnValue(builder);
    mocks.getDatabase.mockReturnValue({ insert: vi.fn(() => builder) });

    await expect(createNotification({ recipientUserId: "user-a", type: "system.test", metadata: { message: "Hello" } })).resolves.toEqual(row);
  });

  it("keeps caller-owned transaction insertion silent until the caller commits", async () => {
    const returning = vi.fn().mockResolvedValue([row]);
    const builder = { values: vi.fn(), returning };
    builder.values.mockReturnValue(builder);
    const transaction = { insert: vi.fn(() => builder) };
    await expect(createNotificationInDatabase(transaction as never, { recipientUserId: "user-a", type: "system.test", metadata: { message: "Hello" } })).resolves.toEqual(row);
    expect(mocks.publishRealtimeEvent).not.toHaveBeenCalled();
  });

  it("does not publish when durable insertion fails", async () => {
    const builder = { values: vi.fn(), returning: vi.fn().mockRejectedValue(new Error("database unavailable")) };
    builder.values.mockReturnValue(builder);
    mocks.getDatabase.mockReturnValue({ insert: vi.fn(() => builder) });
    await expect(createNotification({ recipientUserId: "user-a", type: "system.test", metadata: { message: "Hello" } })).rejects.toThrow("database unavailable");
    expect(mocks.publishRealtimeEvent).not.toHaveBeenCalled();
  });
});
