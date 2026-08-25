import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";

const mocks = vi.hoisted(() => ({
  createNotificationInDatabase: vi.fn(),
  publishNotificationStateChange: vi.fn(),
  publishRealtimeEvent: vi.fn(),
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/notifications", () => ({ createNotificationInDatabase: mocks.createNotificationInDatabase, publishNotificationStateChange: mocks.publishNotificationStateChange }));
vi.mock("@/server/realtime", () => ({ publishRealtimeEvent: mocks.publishRealtimeEvent }));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));

import { cancelFriendLinkRequest, createFriendLinkRequest, respondToFriendLinkRequest, unlinkFriendLink } from "./friend-links";

function builder(result: unknown) {
  const current: Record<string, ReturnType<typeof vi.fn> | ((resolve: (value: unknown) => void, reject: (reason?: unknown) => void) => void)> = {};
  const chain = current as typeof current & { then: Promise<unknown>["then"] };
  for (const method of ["from", "innerJoin", "leftJoin", "where", "limit", "for", "set", "values", "onConflictDoNothing", "orderBy"]) current[method] = vi.fn(() => chain);
  current.returning = vi.fn(() => Promise.resolve(result));
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

type FakeDatabase = Database & { transactionDb: { update: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn> } };

function database(selectResults: unknown[][], insertResults: unknown[][] = [], updateResults: unknown[][] = []): FakeDatabase {
  const selects = [...selectResults];
  const inserts = [...insertResults];
  const updates = [...updateResults];
  const transaction = {
    select: vi.fn(() => builder(selects.shift() ?? [])),
    insert: vi.fn(() => builder(inserts.shift() ?? [])),
    update: vi.fn(() => builder(updates.shift() ?? [])),
  };
  const run = vi.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction));
  return {
    transaction: run,
    transactionDb: transaction,
  } as unknown as FakeDatabase;
}

const friendId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const targetId = "target-user";
const ownerId = "owner-user";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createNotificationInDatabase.mockResolvedValue({ id: "notification" });
});

describe("Friend ↔ Zplit-user linking", () => {
  it("persists one owner-scoped request and notifies only the username target", async () => {
    const db = database([
      [{ id: friendId, name: "Office", linkedUserId: null }],
      [{ id: targetId, name: "Alice Tan", username: "alice" }],
      [{ name: "Owner", username: "owner" }],
      [],
      [],
    ], [[{ id: requestId, ownerUserId: ownerId, friendId, targetUserId: targetId, status: "pending" }]]);

    await expect(createFriendLinkRequest(db, ownerId, friendId, targetId)).resolves.toMatchObject({ id: requestId, status: "pending" });
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(mocks.createNotificationInDatabase).toHaveBeenCalledWith(db.transactionDb, expect.objectContaining({
      recipientUserId: targetId,
      type: "friend.link.request",
      metadata: { requestId, requesterDisplayName: "Owner", requesterUsername: "owner", friendName: "Office" },
    }));
    expect(mocks.publishNotificationStateChange).toHaveBeenCalledWith(targetId, "created");
  });

  it("rolls back the request path when durable notification insertion fails", async () => {
    const db = database([
      [{ id: friendId, name: "Office", linkedUserId: null }],
      [{ id: targetId, name: "Alice Tan", username: "alice" }],
      [{ name: "Owner", username: "owner" }],
      [],
      [],
      [],
    ], [[{ id: requestId, ownerUserId: ownerId, friendId, targetUserId: targetId, status: "pending" }]]);
    mocks.createNotificationInDatabase.mockRejectedValueOnce(new Error("notification insert failed"));
    await expect(createFriendLinkRequest(db, ownerId, friendId, targetId)).rejects.toThrow("notification insert failed");
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(mocks.publishNotificationStateChange).not.toHaveBeenCalled();
  });

  it.each([
    ["foreign Friend", [], [], [], [], "not_found"],
    ["self target", [{ id: friendId, name: "Office", linkedUserId: null }], [], [], [], "self"],
  ])("rejects %s before creating a request", async (_label, friend, target, requester, existingLink, code) => {
    const db = database([friend, target, requester, existingLink, []]);
    await expect(createFriendLinkRequest(db, ownerId, friendId, ownerId)).rejects.toMatchObject({ code });
    expect(mocks.createNotificationInDatabase).not.toHaveBeenCalled();
  });

  it("accepts transactionally, keeps the request target-scoped, and publishes freshness after persistence", async () => {
    const request = { id: requestId, ownerUserId: ownerId, friendId, targetUserId: targetId, status: "pending" };
    const accepted = { ...request, status: "accepted" };
    const db = database([
      [request],
      [{ id: friendId, linkedUserId: null }],
      [],
      [{ id: "connection", userAId: ownerId, userBId: targetId, status: "connected" }],
    ], [[]], [[{ id: friendId }], [accepted], [], []]);

    await expect(respondToFriendLinkRequest(db, targetId, requestId, "accept")).resolves.toMatchObject({ status: "accepted" });
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(db.transactionDb.insert).toHaveBeenCalledOnce();
    expect(db.transactionDb.update).toHaveBeenCalledTimes(4);
    expect(mocks.publishRealtimeEvent).toHaveBeenCalledWith(ownerId, expect.objectContaining({ type: "friend.link.state.changed", data: expect.objectContaining({ friendId, status: "accepted" }) }));
    expect(mocks.publishNotificationStateChange).toHaveBeenCalledWith(targetId, "resolved");
  });

  it("rejects a response from a different user without touching the Friend", async () => {
    const db = database([[]]);
    await expect(respondToFriendLinkRequest(db, "wrong-user", requestId, "accept")).rejects.toMatchObject({ code: "not_found" });
    expect(db.transactionDb.update).not.toHaveBeenCalled();
  });

  it("declines without changing the Friend", async () => {
    const request = { id: requestId, ownerUserId: ownerId, friendId, targetUserId: targetId, status: "pending" };
    const declined = { ...request, status: "declined" };
    const db = database([
      [request],
      [{ id: friendId, linkedUserId: null }],
    ], [], [[declined], []]);

    await expect(respondToFriendLinkRequest(db, targetId, requestId, "decline")).resolves.toMatchObject({ status: "declined" });
    expect(mocks.publishRealtimeEvent).toHaveBeenCalledWith(ownerId, expect.objectContaining({ type: "friend.link.state.changed", data: expect.objectContaining({ status: "declined" }) }));
  });

  it("rejects duplicate active requests before notification creation", async () => {
    const db = database([
      [{ id: friendId, name: "Office", linkedUserId: null }],
      [{ id: targetId, name: "Alice", username: "alice" }],
      [{ name: "Owner", username: "owner" }],
      [],
      [{ id: requestId }],
    ]);
    await expect(createFriendLinkRequest(db, ownerId, friendId, targetId)).rejects.toMatchObject({ code: "duplicate_request" });
    expect(mocks.createNotificationInDatabase).not.toHaveBeenCalled();
  });

  it("rejects a pending request for the same owner and target on another Friend", async () => {
    const db = database([
      [{ id: friendId, name: "Office", linkedUserId: null }],
      [{ id: targetId, name: "Alice", username: "alice" }],
      [{ name: "Owner", username: "owner" }],
      [],
      [],
      [{ id: requestId }],
    ]);
    await expect(createFriendLinkRequest(db, ownerId, friendId, targetId)).rejects.toMatchObject({ code: "duplicate_request" });
    expect(mocks.createNotificationInDatabase).not.toHaveBeenCalled();
  });

  it("cancels only a pending owner request and refreshes the target Inbox", async () => {
    const request = { id: requestId, ownerUserId: ownerId, friendId, targetUserId: targetId, status: "pending" };
    const cancelled = { ...request, status: "cancelled" };
    const db = database([[request]], [], [[cancelled], []]);
    await expect(cancelFriendLinkRequest(db, ownerId, requestId)).resolves.toMatchObject({ status: "cancelled" });
    expect(mocks.publishNotificationStateChange).toHaveBeenCalledWith(targetId, "resolved");
  });

  it("lets either connected user unlink the same pair without deleting ledger-facing Friend rows", async () => {
    const accepted = { id: requestId, ownerUserId: ownerId, friendId, targetUserId: targetId, status: "accepted" };
    const db = database([
      [accepted],
      [],
      [{ id: friendId, ownerUserId: ownerId }],
      [{ id: "connection", userAId: ownerId, userBId: targetId, status: "connected" }],
    ], [], [[{ id: friendId, ownerUserId: ownerId }], []]);
    await expect(unlinkFriendLink(db, targetId, { requestId })).resolves.toMatchObject({ changed: true, friendIds: [friendId] });
    expect(db.transactionDb.update).toHaveBeenCalledTimes(2);
    expect(mocks.publishNotificationStateChange).toHaveBeenCalledWith(ownerId, "resolved");
    expect(mocks.publishNotificationStateChange).toHaveBeenCalledWith(targetId, "resolved");
  });

  it("rejects unlink from an unrelated user and leaves the transaction untouched", async () => {
    const db = database([[]]);
    await expect(unlinkFriendLink(db, "intruder", { requestId })).rejects.toMatchObject({ code: "not_found" });
    expect(db.transactionDb.update).not.toHaveBeenCalled();
  });

  it("makes a repeated unlink idempotent after the connection is disconnected", async () => {
    const accepted = { id: requestId, ownerUserId: ownerId, friendId, targetUserId: targetId, status: "accepted" };
    const db = database([
      [accepted],
      [],
      [],
      [{ id: "connection", userAId: ownerId, userBId: targetId, status: "disconnected" }],
    ], [], [[]]);
    await expect(unlinkFriendLink(db, targetId, { requestId })).resolves.toMatchObject({ changed: false });
    expect(mocks.publishNotificationStateChange).not.toHaveBeenCalled();
  });
});
