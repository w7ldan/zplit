import "server-only";

import { aliasedTable, and, desc, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { chatMessages, chatThreadReads, chatThreads, groupMemberships, groupParticipants, organizationMemberships, users } from "@/db/schema";
import { CHAT_PAGE_SIZE, CHAT_STATE_CHANGED_EVENT, type ChatScope, normalizeChatMessageBody } from "@/domain/chat";
import type { ChatMessageDto, ChatViewDto } from "@/domain/chat-contracts";
import { normalizeUuid } from "@/domain/record-retrieval";
import { requireGroupAccess, GroupError } from "@/server/groups";
import { requireOrganizationAccess } from "@/server/organizations";
import { publishRealtimeEvent, type RealtimeData } from "@/server/realtime";
import { getUserAvatarMetadataForViewer } from "@/server/user-avatar-access";

export class ChatError extends Error {
  constructor(readonly code: "invalid_id" | "not_found" | "message_not_found" | "forbidden" | "invalid_cursor" | "deleted" | "not_member") {
    super(code);
    this.name = "ChatError";
  }
}

type ChatCursor = { createdAt: string; id: string };
type ChatRow = {
  id: string;
  senderUserId: string;
  senderName: string;
  participantName: string | null;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
};
type ChatReadCursor = { id: string; createdAt: Date } | null;
type ChatReaderRow = { userId: string; displayName: string; cursor: ChatReadCursor };

function normalizeScope(scope: ChatScope): ChatScope {
  const id = normalizeUuid(scope.id);
  if (!id || (scope.type !== "organization" && scope.type !== "group")) throw new ChatError("invalid_id");
  return { type: scope.type, id };
}

function scopeWhere(scope: ChatScope) {
  return scope.type === "organization" ? eq(chatThreads.organizationId, scope.id) : eq(chatThreads.groupId, scope.id);
}

function encodeCursor(cursor: ChatCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: unknown): ChatCursor | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<ChatCursor>;
    const id = normalizeUuid(cursor.id);
    if (typeof cursor.createdAt !== "string" || Number.isNaN(new Date(cursor.createdAt).getTime()) || !id) throw new Error();
    return { createdAt: new Date(cursor.createdAt).toISOString(), id };
  } catch {
    throw new ChatError("invalid_cursor");
  }
}

function afterCursor(cursor: ChatReadCursor | undefined) {
  if (!cursor) return undefined;
  return or(
    gt(chatMessages.createdAt, cursor.createdAt),
    and(eq(chatMessages.createdAt, cursor.createdAt), gt(chatMessages.id, cursor.id)),
  );
}

function hasReadThrough(cursor: ChatReadCursor, message: Pick<ChatRow, "id" | "createdAt">) {
  return Boolean(cursor && (cursor.createdAt > message.createdAt || (cursor.createdAt.getTime() === message.createdAt.getTime() && cursor.id >= message.id)));
}

export function encodeChatCursor(cursor: { createdAt: Date; id: string }) {
  return encodeCursor({ createdAt: cursor.createdAt.toISOString(), id: cursor.id });
}

export function parseChatCursor(value: unknown) {
  return decodeCursor(value);
}

async function findThread(database: Database, scope: ChatScope) {
  const [thread] = await database.select({ id: chatThreads.id }).from(chatThreads).where(scopeWhere(scope)).limit(1);
  return thread ?? null;
}

async function ensureThread(database: Database, scope: ChatScope) {
  await database.insert(chatThreads).values(scope.type === "organization" ? { organizationId: scope.id } : { groupId: scope.id }).onConflictDoNothing();
  const thread = await findThread(database, scope);
  if (!thread) throw new ChatError("not_found");
  return thread;
}

async function advanceChatReadCursor(database: Database, input: { threadId: string; userId: string; messageId: string }) {
  const rows = await database
    .insert(chatThreadReads)
    .values({ threadId: input.threadId, userId: input.userId, lastReadMessageId: input.messageId })
    .onConflictDoUpdate({
      target: [chatThreadReads.threadId, chatThreadReads.userId],
      set: { lastReadMessageId: input.messageId, updatedAt: new Date() },
      setWhere: sql`${chatThreadReads.lastReadMessageId} IS NULL OR EXISTS (
        SELECT 1
        FROM chat_messages AS current_message
        JOIN chat_messages AS candidate_message
          ON candidate_message.id = excluded.last_read_message_id
        WHERE current_message.id = ${chatThreadReads.lastReadMessageId}
          AND candidate_message.thread_id = current_message.thread_id
          AND (candidate_message.created_at, candidate_message.id) > (current_message.created_at, current_message.id)
      )`,
    })
    .returning({ threadId: chatThreadReads.threadId });
  return rows.length > 0;
}

async function recipientIds(database: Database, scope: ChatScope) {
  const rows = scope.type === "organization"
    ? await database.select({ userId: organizationMemberships.userId }).from(organizationMemberships).where(eq(organizationMemberships.organizationId, scope.id))
    : await database.select({ userId: groupMemberships.userId }).from(groupMemberships).where(eq(groupMemberships.groupId, scope.id));
  return rows.map(({ userId }) => userId);
}

const cursorMessages = aliasedTable(chatMessages, "chat_read_cursor_messages");

async function listEligibleReaders(database: Database, scope: ChatScope, threadId: string): Promise<ChatReaderRow[]> {
  const rows = scope.type === "organization"
    ? await database
      .select({
        userId: organizationMemberships.userId,
        displayName: users.name,
        cursorId: chatThreadReads.lastReadMessageId,
        cursorCreatedAt: cursorMessages.createdAt,
      })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .leftJoin(chatThreadReads, and(eq(chatThreadReads.threadId, threadId), eq(chatThreadReads.userId, organizationMemberships.userId)))
      .leftJoin(cursorMessages, eq(cursorMessages.id, chatThreadReads.lastReadMessageId))
      .where(eq(organizationMemberships.organizationId, scope.id))
      : await database
        .select({
          userId: groupMemberships.userId,
          displayName: sql<string>`coalesce(${groupParticipants.displayName}, ${users.name})`,
          cursorId: chatThreadReads.lastReadMessageId,
          cursorCreatedAt: cursorMessages.createdAt,
        })
        .from(groupMemberships)
        .innerJoin(users, eq(users.id, groupMemberships.userId))
        .leftJoin(groupParticipants, and(eq(groupParticipants.groupId, groupMemberships.groupId), eq(groupParticipants.userId, groupMemberships.userId)))
        .leftJoin(chatThreadReads, and(eq(chatThreadReads.threadId, threadId), eq(chatThreadReads.userId, groupMemberships.userId)))
        .leftJoin(cursorMessages, eq(cursorMessages.id, chatThreadReads.lastReadMessageId))
        .where(eq(groupMemberships.groupId, scope.id));
  return rows.map((row) => ({
    userId: row.userId,
    displayName: row.displayName,
    cursor: row.cursorId && row.cursorCreatedAt ? { id: row.cursorId, createdAt: row.cursorCreatedAt } : null,
  }));
}

async function unreadCount(database: Database, threadId: string, viewerUserId: string, cursor: ChatReadCursor | undefined) {
  const [row] = await database
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(chatMessages)
    .where(and(
      eq(chatMessages.threadId, threadId),
      ne(chatMessages.senderUserId, viewerUserId),
      isNull(chatMessages.deletedAt),
      afterCursor(cursor),
    ));
  return Number(row?.count ?? 0);
}

function receiptNames(message: ChatRow, readers: ChatReaderRow[]) {
  return readers
    .filter((reader) => reader.userId !== message.senderUserId && hasReadThrough(reader.cursor, message))
    .map((reader) => reader.displayName);
}

function freshnessData(scope: ChatScope, threadId: string) {
  const data: RealtimeData = { scope: scope.type, threadId };
  if (scope.type === "organization") data.organizationId = scope.id;
  else data.groupId = scope.id;
  return data;
}

function publishFreshness(scope: ChatScope, threadId: string, userIds: string[]) {
  const data = freshnessData(scope, threadId);
  for (const userId of userIds) void publishRealtimeEvent(userId, { type: CHAT_STATE_CHANGED_EVENT, data }).catch(() => undefined);
}

async function listMessages(database: Database, scope: ChatScope, threadId: string, viewerUserId: string, canSend: boolean, canModerate: boolean, before?: unknown) {
  const cursor = decodeCursor(before);
  const cursorWhere = cursor
    ? or(lt(chatMessages.createdAt, new Date(cursor.createdAt)), and(eq(chatMessages.createdAt, new Date(cursor.createdAt)), lt(chatMessages.id, cursor.id)))
    : undefined;
  const rows = await database
    .select({
      id: chatMessages.id,
      senderUserId: chatMessages.senderUserId,
      senderName: users.name,
      participantName: groupParticipants.displayName,
      body: chatMessages.body,
      createdAt: chatMessages.createdAt,
      editedAt: chatMessages.editedAt,
      deletedAt: chatMessages.deletedAt,
    })
    .from(chatMessages)
    .innerJoin(chatThreads, eq(chatThreads.id, chatMessages.threadId))
    .innerJoin(users, eq(users.id, chatMessages.senderUserId))
    .leftJoin(groupParticipants, eq(groupParticipants.id, chatMessages.senderParticipantId))
    .where(and(eq(chatMessages.threadId, threadId), scopeWhere(scope), cursorWhere))
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(CHAT_PAGE_SIZE + 1);
  const hasMore = rows.length > CHAT_PAGE_SIZE;
  const orderedRows = rows.slice(0, CHAT_PAGE_SIZE).reverse() as ChatRow[];
  const avatarMetadata = await getUserAvatarMetadataForViewer(database, viewerUserId, [...new Set(orderedRows.map((row) => row.senderUserId))], scope);
  const readers = await listEligibleReaders(database, scope, threadId);
  const viewer = readers.find((reader) => reader.userId === viewerUserId);
  const unread = await unreadCount(database, threadId, viewerUserId, viewer?.cursor ?? undefined);
  const latestVisibleMessageId = orderedRows.at(-1)?.id ?? null;
  const messages = orderedRows.map((row, index) => {
    const own = row.senderUserId === viewerUserId;
    const deleted = row.deletedAt !== null;
    const previous = orderedRows[index - 1];
    const grouped = Boolean(previous && !deleted && previous.deletedAt === null && previous.senderUserId === row.senderUserId && previous.createdAt.toISOString().slice(0, 10) === row.createdAt.toISOString().slice(0, 10));
    const seenBy = receiptNames(row, readers);
    const message: ChatMessageDto = {
      id: row.id,
      body: deleted ? null : row.body,
      deleted,
      edited: !deleted && row.editedAt !== null,
      createdAt: row.createdAt.toISOString(),
      sender: { userId: row.senderUserId, displayName: row.participantName ?? row.senderName, customAvatar: avatarMetadata.get(row.senderUserId) ?? null },
      own,
      grouped,
      canEdit: own && canSend && !deleted,
      canDelete: !deleted && (own ? canSend : canModerate),
      seenByCount: seenBy.length,
      seenBy: index === orderedRows.length - 1 ? [] : seenBy,
    };
    return message;
  });
  const oldest = orderedRows[0];
  return { messages, nextCursor: hasMore && oldest ? encodeChatCursor(oldest) : null, unreadCount: unread, latestVisibleMessageId };
}

export async function getOrganizationChat(database: Database, organizationId: string, viewerUserId: string, before?: unknown): Promise<ChatViewDto> {
  const scope = normalizeScope({ type: "organization", id: organizationId });
  const access = await requireOrganizationAccess(database, scope.id, viewerUserId);
  access.require("chat.view");
  const thread = await findThread(database, scope);
  const page = thread ? await listMessages(database, scope, thread.id, viewerUserId, access.can("chat.send"), access.can("chat.moderate"), before) : { messages: [], nextCursor: null, unreadCount: 0, latestVisibleMessageId: null };
  return { scope, threadId: thread?.id ?? null, ...page, canSend: access.can("chat.send"), canModerate: access.can("chat.moderate") };
}

export async function getGroupChat(database: Database, groupId: string, viewerUserId: string, before?: unknown): Promise<ChatViewDto> {
  const scope = normalizeScope({ type: "group", id: groupId });
  const access = await requireGroupAccess(database, scope.id, viewerUserId);
  const thread = await findThread(database, scope);
  const page = thread ? await listMessages(database, scope, thread.id, viewerUserId, true, access.canManageGroup, before) : { messages: [], nextCursor: null, unreadCount: 0, latestVisibleMessageId: null };
  return { scope, threadId: thread?.id ?? null, ...page, canSend: true, canModerate: access.canManageGroup };
}

async function getChatUnreadCount(database: Database, scope: ChatScope, viewerUserId: string) {
  const thread = await findThread(database, scope);
  if (!thread) return 0;
  const cursorMessage = aliasedTable(chatMessages, "chat_viewer_cursor_message");
  const [read] = await database
    .select({ lastReadMessageId: chatThreadReads.lastReadMessageId, cursorCreatedAt: cursorMessage.createdAt })
    .from(chatThreadReads)
    .leftJoin(cursorMessage, eq(cursorMessage.id, chatThreadReads.lastReadMessageId))
    .where(and(eq(chatThreadReads.threadId, thread.id), eq(chatThreadReads.userId, viewerUserId)))
    .limit(1);
  const cursor = read?.lastReadMessageId && read.cursorCreatedAt ? { id: read.lastReadMessageId, createdAt: read.cursorCreatedAt } : undefined;
  return unreadCount(database, thread.id, viewerUserId, cursor);
}

export async function getOrganizationChatUnreadCount(database: Database, organizationId: string, viewerUserId: string) {
  const scope = normalizeScope({ type: "organization", id: organizationId });
  const access = await requireOrganizationAccess(database, scope.id, viewerUserId);
  access.require("chat.view");
  return getChatUnreadCount(database, scope, viewerUserId);
}

export async function getGroupChatUnreadCount(database: Database, groupId: string, viewerUserId: string) {
  const scope = normalizeScope({ type: "group", id: groupId });
  await requireGroupAccess(database, scope.id, viewerUserId);
  return getChatUnreadCount(database, scope, viewerUserId);
}

async function activeGroupParticipant(database: Database, groupId: string, userId: string) {
  const [membership] = await database
    .select({ participantId: groupMemberships.participantId })
    .from(groupMemberships)
    .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, userId)))
    .limit(1);
  if (!membership) throw new GroupError("not_member");
  return membership.participantId;
}

export async function sendChatMessage(database: Database, input: { scope: ChatScope; userId: string; body: unknown }) {
  const scope = normalizeScope(input.scope);
  const body = normalizeChatMessageBody(input.body);
  const result = await database.transaction(async (transaction) => {
    const transactionalDatabase = transaction as Database;
    let senderParticipantId: string | undefined;
    if (scope.type === "organization") {
      const access = await requireOrganizationAccess(transactionalDatabase, scope.id, input.userId);
      access.require("chat.send");
    } else {
      await requireGroupAccess(transactionalDatabase, scope.id, input.userId);
      senderParticipantId = await activeGroupParticipant(transactionalDatabase, scope.id, input.userId);
    }
    const thread = await ensureThread(transactionalDatabase, scope);
    const [message] = await transaction
      .insert(chatMessages)
      .values({
        threadId: thread.id,
        organizationId: scope.type === "organization" ? scope.id : undefined,
        groupId: scope.type === "group" ? scope.id : undefined,
        senderUserId: input.userId,
        senderParticipantId,
        body,
      })
      .returning({ id: chatMessages.id });
    if (!message) throw new ChatError("not_found");
    await advanceChatReadCursor(transactionalDatabase, { threadId: thread.id, userId: input.userId, messageId: message.id });
    await transaction.update(chatThreads).set({ updatedAt: new Date() }).where(eq(chatThreads.id, thread.id));
    return { threadId: thread.id, userIds: await recipientIds(transactionalDatabase, scope) };
  });
  publishFreshness(scope, result.threadId, result.userIds);
  return result;
}

export async function markChatRead(database: Database, input: { scope: ChatScope; userId: string; messageId: string }) {
  const scope = normalizeScope(input.scope);
  const messageId = normalizeUuid(input.messageId);
  if (!messageId) throw new ChatError("invalid_id");
  const result = await database.transaction(async (transaction) => {
    const transactionalDatabase = transaction as Database;
    if (scope.type === "organization") {
      const access = await requireOrganizationAccess(transactionalDatabase, scope.id, input.userId);
      access.require("chat.view");
    } else {
      await requireGroupAccess(transactionalDatabase, scope.id, input.userId);
    }
    const message = await findMessage(transactionalDatabase, scope, messageId);
    if (!message) throw new ChatError("message_not_found");
    const changed = await advanceChatReadCursor(transactionalDatabase, { threadId: message.threadId, userId: input.userId, messageId });
    if (scope.type === "organization") {
      const access = await requireOrganizationAccess(transactionalDatabase, scope.id, input.userId);
      access.require("chat.view");
    } else {
      await requireGroupAccess(transactionalDatabase, scope.id, input.userId);
    }
    return changed
      ? { changed: true, threadId: message.threadId, userIds: await recipientIds(transactionalDatabase, scope) }
      : { changed: false, threadId: message.threadId, userIds: [] as string[] };
  });
  if (result.changed) publishFreshness(scope, result.threadId, result.userIds);
  return result;
}

async function findMessage(database: Database, scope: ChatScope, messageId: string) {
  const [message] = await database
    .select({ id: chatMessages.id, senderUserId: chatMessages.senderUserId, deletedAt: chatMessages.deletedAt, threadId: chatMessages.threadId })
    .from(chatMessages)
    .innerJoin(chatThreads, eq(chatThreads.id, chatMessages.threadId))
    .where(and(eq(chatMessages.id, messageId), scopeWhere(scope)))
    .limit(1);
  return message ?? null;
}

export async function editChatMessage(database: Database, input: { scope: ChatScope; messageId: string; userId: string; body: unknown }) {
  const scope = normalizeScope(input.scope);
  const body = normalizeChatMessageBody(input.body);
  const result = await database.transaction(async (transaction) => {
    const transactionalDatabase = transaction as Database;
    if (scope.type === "organization") {
      const access = await requireOrganizationAccess(transactionalDatabase, scope.id, input.userId);
      access.require("chat.send");
    } else {
      await requireGroupAccess(transactionalDatabase, scope.id, input.userId);
    }
    const message = await findMessage(transactionalDatabase, scope, input.messageId);
    if (!message) throw new ChatError("message_not_found");
    if (message.senderUserId !== input.userId) throw new ChatError("forbidden");
    if (message.deletedAt) throw new ChatError("deleted");
    const [updated] = await transaction.update(chatMessages).set({ body, editedAt: new Date() }).where(and(eq(chatMessages.id, input.messageId), isNull(chatMessages.deletedAt))).returning({ id: chatMessages.id });
    if (!updated) throw new ChatError("deleted");
    return { threadId: message.threadId, userIds: await recipientIds(transactionalDatabase, scope) };
  });
  publishFreshness(scope, result.threadId, result.userIds);
  return result;
}

export async function deleteChatMessage(database: Database, input: { scope: ChatScope; messageId: string; userId: string }) {
  const scope = normalizeScope(input.scope);
  const result = await database.transaction(async (transaction) => {
    const transactionalDatabase = transaction as Database;
    let canModerate = false;
    if (scope.type === "organization") {
      const access = await requireOrganizationAccess(transactionalDatabase, scope.id, input.userId);
      canModerate = access.can("chat.moderate");
    } else {
      const access = await requireGroupAccess(transactionalDatabase, scope.id, input.userId);
      canModerate = access.canManageGroup;
    }
    const message = await findMessage(transactionalDatabase, scope, input.messageId);
    if (!message) throw new ChatError("message_not_found");
    if (message.senderUserId === input.userId) {
      if (scope.type === "organization") {
        const access = await requireOrganizationAccess(transactionalDatabase, scope.id, input.userId);
        access.require("chat.send");
      }
    } else if (!canModerate) {
      throw new ChatError("forbidden");
    }
    if (message.deletedAt) return { changed: false, threadId: message.threadId, userIds: [] as string[] };
    const [deleted] = await transaction.update(chatMessages).set({ deletedAt: new Date(), deletedByUserId: input.userId }).where(and(eq(chatMessages.id, input.messageId), isNull(chatMessages.deletedAt))).returning({ id: chatMessages.id });
    if (!deleted) return { changed: false, threadId: message.threadId, userIds: [] as string[] };
    return { changed: true, threadId: message.threadId, userIds: await recipientIds(transactionalDatabase, scope) };
  });
  if (result.changed) publishFreshness(scope, result.threadId, result.userIds);
  return result;
}
