import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { chatMessages, chatThreadReads } from "@/db/schema";

const mocks = vi.hoisted(() => ({
  requireOrganizationAccess: vi.fn(),
  requireGroupAccess: vi.fn(),
  getUserAvatarMetadataForViewer: vi.fn(),
  publishRealtimeEvent: vi.fn(async () => undefined),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/organizations", () => ({ requireOrganizationAccess: mocks.requireOrganizationAccess }));
vi.mock("@/server/groups", () => ({
  requireGroupAccess: mocks.requireGroupAccess,
  GroupError: class GroupError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
}));
vi.mock("@/server/realtime", () => ({ publishRealtimeEvent: mocks.publishRealtimeEvent }));
vi.mock("@/server/user-avatar-access", () => ({ getUserAvatarMetadataForViewer: mocks.getUserAvatarMetadataForViewer }));

import { deleteChatMessage, editChatMessage, getOrganizationChat, markChatRead, sendChatMessage } from "./chat";

const organizationId = "11111111-1111-4111-8111-111111111111";
const groupId = "22222222-2222-4222-8222-222222222222";
const threadId = "33333333-3333-4333-8333-333333333333";
const participantId = "44444444-4444-4444-8444-444444444444";

function queryBuilder(result: unknown) {
  const query = {} as Record<string, unknown> & { then: Promise<unknown>["then"] };
  for (const method of ["from", "innerJoin", "leftJoin", "where", "limit", "orderBy", "set", "onConflictDoUpdate"]) query[method] = vi.fn(() => query);
  query.returning = vi.fn(async () => result);
  query.onConflictDoNothing = vi.fn(() => query);
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return query;
}

function database(selects: unknown[], returning: unknown[] = [], readReturning: unknown[] = []) {
  const insertValues: unknown[] = [];
  const transaction = {
    select: vi.fn(() => queryBuilder(selects.shift() ?? [])),
    insert: vi.fn((table: unknown) => {
      const result = table === chatMessages ? returning : table === chatThreadReads ? readReturning : [];
      const query = queryBuilder(result);
      query.values = vi.fn((values: unknown) => {
        insertValues.push(values);
        return query;
      });
      return query;
    }),
    update: vi.fn(() => queryBuilder([])),
  };
  const result = {
    select: vi.fn(() => queryBuilder(selects.shift() ?? [])),
    transaction: vi.fn(async (callback: (transaction: unknown) => unknown) => callback(transaction)),
    insertValues,
    tx: transaction,
  } as unknown as Database & { insertValues: unknown[]; tx: typeof transaction };
  return result;
}

function organizationAccess(canSend = true, canModerate = false, canView = true) {
  return {
    can: (capability: string) => capability === "chat.view" ? canView : capability === "chat.send" ? canSend : capability === "chat.moderate" && canModerate,
    require: vi.fn((capability: string) => {
      if (capability === "chat.send" && !canSend || capability === "chat.view" && !canView) throw new Error("forbidden");
    }),
  };
}

describe("chat server ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrganizationAccess.mockResolvedValue(organizationAccess());
    mocks.requireGroupAccess.mockResolvedValue({ canManageGroup: false });
    mocks.getUserAvatarMetadataForViewer.mockResolvedValue(new Map());
  });

  it("requires organization capability and creates one thread with conflict safety", async () => {
    const db = database([[{ archivedAt: null }], [{ id: threadId }], [{ userId: "user-a" }, { userId: "user-b" }]], [{ id: "message-a" }], [{ threadId }]);
    await sendChatMessage(db, { scope: { type: "organization", id: organizationId }, userId: "user-a", body: " hello " });

    expect(mocks.requireOrganizationAccess).toHaveBeenCalledWith(db.tx, organizationId, "user-a");
    expect(db.insertValues).toEqual(expect.arrayContaining([{ organizationId }, expect.objectContaining({ organizationId, threadId: threadId, senderUserId: "user-a", body: "hello" }), expect.objectContaining({ threadId, userId: "user-a", lastReadMessageId: "message-a" })]));
    expect(mocks.publishRealtimeEvent).toHaveBeenCalledTimes(2);
    expect(mocks.publishRealtimeEvent).toHaveBeenCalledWith("user-b", expect.objectContaining({ type: "chat.state.changed", data: { scope: "organization", organizationId, threadId } }));
  });

  it("requires chat.view for Organization reads and chat.send for writes", async () => {
    mocks.requireOrganizationAccess.mockResolvedValueOnce(organizationAccess(true, false, false));
    await expect(getOrganizationChat(database([]), organizationId, "user-a")).rejects.toThrow("forbidden");

    mocks.requireOrganizationAccess.mockResolvedValueOnce(organizationAccess(false, false, true));
    await expect(sendChatMessage(database([]), { scope: { type: "organization", id: organizationId }, userId: "user-a", body: "message" })).rejects.toThrow("forbidden");
  });

  it("authorizes a read cursor, verifies its thread, and publishes only when it advances", async () => {
    const message = { id: "55555555-5555-4555-8555-555555555555", senderUserId: "user-b", deletedAt: null, threadId };
    const db = database([[message], [{ userId: "user-a" }]], [], [{ threadId }]);
    await expect(markChatRead(db, { scope: { type: "organization", id: organizationId }, userId: "user-a", messageId: message.id })).resolves.toMatchObject({ changed: true, threadId });
    expect(mocks.publishRealtimeEvent).toHaveBeenCalledWith("user-a", expect.objectContaining({ type: "chat.state.changed" }));

    mocks.publishRealtimeEvent.mockClear();
    const noOp = database([[message]], [], []);
    await expect(markChatRead(noOp, { scope: { type: "organization", id: organizationId }, userId: "user-a", messageId: message.id })).resolves.toMatchObject({ changed: false });
    expect(mocks.publishRealtimeEvent).not.toHaveBeenCalled();
  });

  it("rejects a message outside the authorized thread before touching the cursor", async () => {
    const db = database([[]]);
    await expect(markChatRead(db, { scope: { type: "group", id: groupId }, userId: "user-a", messageId: "55555555-5555-4555-8555-555555555555" })).rejects.toMatchObject({ code: "message_not_found" });
    expect(db.tx.insert).not.toHaveBeenCalled();
  });

  it("uses the active registered Group participant and never accepts an external identity", async () => {
    const db = database([[{ archivedAt: null }], [{ participantId }], [{ id: threadId }], [{ userId: "user-a" }]], [{ id: "message-a" }]);
    await sendChatMessage(db, { scope: { type: "group", id: groupId }, userId: "user-a", body: "message" });

    expect(mocks.requireGroupAccess).toHaveBeenCalledWith(db.tx, groupId, "user-a");
    expect(db.insertValues[1]).toEqual(expect.objectContaining({ groupId, senderParticipantId: participantId, senderUserId: "user-a" }));
  });

  it("maps deleted messages to tombstones and derives consecutive grouping server-side", async () => {
    const first = new Date("2026-08-29T00:00:00Z");
    const db = database([
      [{ archivedAt: null }],
      [{ id: threadId }],
      [
        { id: "message-c", senderUserId: "user-b", senderName: "Bob", participantName: null, body: "secret", createdAt: new Date(first.getTime() + 2_000), editedAt: null, deletedAt: first },
        { id: "message-b", senderUserId: "user-a", senderName: "Alice", participantName: null, body: "second", createdAt: new Date(first.getTime() + 1_000), editedAt: null, deletedAt: null },
        { id: "message-a", senderUserId: "user-a", senderName: "Alice", participantName: null, body: "first", createdAt: first, editedAt: null, deletedAt: null },
      ],
    ]);
    const chat = await getOrganizationChat(db, organizationId, "user-a");

    expect(chat.messages.map((message) => ({ id: message.id, body: message.body, grouped: message.grouped }))).toEqual([
      { id: "message-a", body: "first", grouped: false },
      { id: "message-b", body: "second", grouped: true },
      { id: "message-c", body: null, grouped: false },
    ]);
  });

  it("derives receipts from current member cursors without counting the sender", async () => {
    const first = new Date("2026-08-29T00:00:00Z");
    const db = database([
      [{ archivedAt: null }],
      [{ id: threadId }],
      [
        { id: "message-d", senderUserId: "user-b", senderName: "Bob", participantName: null, body: "latest", createdAt: new Date(first.getTime() + 3_000), editedAt: null, deletedAt: null },
        { id: "message-c", senderUserId: "user-b", senderName: "Bob", participantName: null, body: "deleted", createdAt: new Date(first.getTime() + 2_000), editedAt: null, deletedAt: first },
        { id: "message-b", senderUserId: "user-a", senderName: "Alice", participantName: null, body: "own", createdAt: new Date(first.getTime() + 1_000), editedAt: null, deletedAt: null },
        { id: "message-a", senderUserId: "user-b", senderName: "Bob", participantName: null, body: "first", createdAt: first, editedAt: null, deletedAt: null },
      ],
      [
        { userId: "user-a", displayName: "Alice", cursorId: "message-a", role: "owner", customCapabilities: [] },
        { userId: "user-b", displayName: "Bob", cursorId: "message-d", role: "member", customCapabilities: [] },
      ],
      [
        { messageId: "message-a", readerUserId: "user-a" },
        { messageId: "message-b", readerUserId: "user-b" },
      ],
      [{ count: 1 }],
    ]);
    const chat = await getOrganizationChat(db, organizationId, "user-a");
    expect(chat.unreadCount).toBe(1);
    expect(chat.messages[0]).toMatchObject({ id: "message-a", seenByCount: 1, seenBy: ["Alice"] });
    expect(chat.messages[1]).toMatchObject({ id: "message-b", seenByCount: 1, seenBy: ["Bob"] });
    expect(chat.messages[2]).toMatchObject({ id: "message-c", seenByCount: 0 });
    expect(chat.messages[3]).toMatchObject({ id: "message-d", seenByCount: 0, seenBy: [] });
    expect(db.select).toHaveBeenCalledTimes(6);
  });

  it.each([
    ["owner", [], true],
    ["admin", [], true],
    ["member", [], true],
    ["custom", ["chat.view"], true],
    ["custom", [], false],
  ] as const)("uses effective Organization chat.view for %s readers", async (role, customCapabilities, expected) => {
    const db = database([
      [{ archivedAt: null }],
      [{ id: threadId }],
      [{ id: "message-a", senderUserId: "user-b", senderName: "Bob", participantName: null, body: "hello", createdAt: new Date("2026-08-29T00:00:00Z"), editedAt: null, deletedAt: null }],
      [{ userId: "user-a", displayName: "Alice", cursorId: "message-a", role, customCapabilities }],
      ...(expected ? [[{ messageId: "message-a", readerUserId: "user-a" }]] : []),
      [{ count: 0 }],
    ]);
    const chat = await getOrganizationChat(db, organizationId, "user-a");

    expect(chat.messages[0]?.seenByCount).toBe(expected ? 1 : 0);
  });

  it("excludes a member after chat.view is removed while retaining its cursor row", async () => {
    const message = { id: "message-a", senderUserId: "user-b", senderName: "Bob", participantName: null, body: "hello", createdAt: new Date("2026-08-29T00:00:00Z"), editedAt: null, deletedAt: null };
    const withAccess = database([
      [{ archivedAt: null }],
      [{ id: threadId }],
      [message],
      [{ userId: "user-a", displayName: "Alice", cursorId: "message-a", role: "custom", customCapabilities: ["chat.view"] }],
      [{ messageId: "message-a", readerUserId: "user-a" }],
      [{ count: 0 }],
    ]);
    const before = await getOrganizationChat(withAccess, organizationId, "user-a");
    expect(before.messages[0]?.seenByCount).toBe(1);

    const withoutAccess = database([
      [{ archivedAt: null }],
      [{ id: threadId }],
      [message],
      [{ userId: "user-a", displayName: "Alice", cursorId: "message-a", role: "custom", customCapabilities: [] }],
      [{ count: 0 }],
    ]);
    const after = await getOrganizationChat(withoutAccess, organizationId, "user-a");
    expect(after.messages[0]?.seenByCount).toBe(0);
    expect(withoutAccess.select).toHaveBeenCalledTimes(5);
  });

  it("batches sender avatar metadata into the read DTO", async () => {
    const avatar = { sha256: "a".repeat(64) };
    const db = database([
      [{ archivedAt: null }],
      [{ id: threadId }],
      [{ id: "message-a", senderUserId: "user-b", senderName: "Bob", participantName: null, body: "hello", createdAt: new Date("2026-08-29T00:00:00Z"), editedAt: null, deletedAt: null }],
    ]);
    mocks.getUserAvatarMetadataForViewer.mockResolvedValueOnce(new Map([["user-b", avatar]]));

    const chat = await getOrganizationChat(db, organizationId, "user-a");

    expect(chat.messages[0]?.sender).toEqual({ userId: "user-b", displayName: "Bob", customAvatar: avatar });
    expect(mocks.getUserAvatarMetadataForViewer).toHaveBeenCalledWith(db, "user-a", ["user-b"], { type: "organization", id: organizationId });
  });

  it("edits only the author and publishes the existing entity scope", async () => {
    const db = database([[{ archivedAt: null }], [{ id: "message-a", senderUserId: "user-a", deletedAt: null, threadId }], [{ userId: "user-a" }]]);
    db.tx.update = vi.fn(() => queryBuilder([{ id: "message-a" }])) as never;
    await editChatMessage(db, { scope: { type: "organization", id: organizationId }, messageId: "message-a", userId: "user-a", body: "updated" });

    expect(mocks.publishRealtimeEvent).toHaveBeenCalledWith("user-a", expect.objectContaining({ data: expect.objectContaining({ organizationId, threadId }) }));
    await expect(editChatMessage(database([[{ archivedAt: null }], [{ id: "message-a", senderUserId: "user-b", deletedAt: null, threadId }]]), { scope: { type: "organization", id: organizationId }, messageId: "message-a", userId: "user-a", body: "updated" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rejects new messages for archived workspaces while keeping history readable", async () => {
    const archived = new Date("2026-01-01T00:00:00.000Z");
    await expect(sendChatMessage(database([[{ archivedAt: archived }]]), { scope: { type: "group", id: groupId }, userId: "user-a", body: "late" })).rejects.toMatchObject({ code: "archived" });
    await expect(sendChatMessage(database([[{ archivedAt: archived }]]), { scope: { type: "organization", id: organizationId }, userId: "user-a", body: "late" })).rejects.toMatchObject({ code: "archived" });
    await expect(editChatMessage(database([[{ archivedAt: archived }]]), { scope: { type: "group", id: groupId }, messageId: "message-a", userId: "user-a", body: "late" })).rejects.toMatchObject({ code: "archived" });
  });

  it("makes a second delete a safe no-op and allows Group management moderation", async () => {    mocks.requireGroupAccess.mockResolvedValue({ canManageGroup: true });
    const db = database([[{ id: "message-a", senderUserId: "user-b", deletedAt: new Date(), threadId }]]);
    await expect(deleteChatMessage(db, { scope: { type: "group", id: groupId }, messageId: "message-a", userId: "user-a" })).resolves.toMatchObject({ changed: false });
    expect(mocks.publishRealtimeEvent).not.toHaveBeenCalled();
  });
});
