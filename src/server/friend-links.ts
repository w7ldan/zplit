import "server-only";

import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Database } from "@/db/client";
import { getDatabase } from "@/db/client";
import { friendLinkRequests, friends, notifications, users } from "@/db/schema";
import { NOTIFICATION_STATE_CHANGED_EVENT, NOTIFICATION_TYPES, type NotificationMetadata } from "@/domain/notifications";
import { normalizeUuid } from "@/domain/record-retrieval";
import { FRIEND_LINK_STATE_CHANGED_EVENT } from "@/domain/friend-links";
import { createNotificationInDatabase } from "@/server/notifications";
import { publishRealtimeEvent } from "@/server/realtime";
import { requireSession } from "@/auth/require-session";

export type FriendLinkRequestStatus = "pending" | "accepted" | "declined" | "cancelled";

export class FriendLinkError extends Error {
  constructor(readonly code: "not_found" | "invalid_target" | "self" | "already_linked" | "duplicate_request" | "resolved" | "conflict") {
    super(code);
    this.name = "FriendLinkError";
  }
}

type LinkUser = { displayName: string; username: string };

export type FriendLinkStatus =
  | { status: "unlinked" }
  | { status: "pending"; requestId: string; target: LinkUser }
  | { status: "linked"; user: LinkUser };

function assertUserId(userId: string) {
  if (typeof userId !== "string" || !userId.trim()) throw new TypeError("A friend link user id is required");
}

function assertFriendId(friendId: string) {
  if (!normalizeUuid(friendId)) throw new FriendLinkError("not_found");
}

function databaseCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function publishNotificationStateChange(userId: string) {
  try {
    publishRealtimeEvent(userId, {
      type: NOTIFICATION_STATE_CHANGED_EVENT,
      data: { reason: "resolved" },
    });
  } catch {
    // PostgreSQL remains authoritative when the freshness channel is unavailable.
  }
}

function publishFriendLinkChange(userId: string, friendId: string, requestId: string, status: FriendLinkRequestStatus) {
  try {
    publishRealtimeEvent(userId, {
      type: FRIEND_LINK_STATE_CHANGED_EVENT,
      data: { friendId, requestId, status },
    });
  } catch {
    // The requester refetches canonical state after reconnect.
  }
}

async function resolveRequestNotification(database: Database, targetUserId: string, requestId: string, now: Date) {
  await database
    .update(notifications)
    .set({ readAt: now })
    .where(and(
      eq(notifications.recipientUserId, targetUserId),
      eq(notifications.type, NOTIFICATION_TYPES.friendLinkRequest),
      eq(notifications.dedupeKey, `friend-link-request:${requestId}`),
      isNull(notifications.readAt),
    ));
}

export async function getFriendLinkStatus(database: Database, ownerUserId: string, friendId: string): Promise<FriendLinkStatus> {
  assertUserId(ownerUserId);
  assertFriendId(friendId);
  const [friend] = await database
    .select({ linkedUserId: friends.linkedUserId, linkedName: users.name, linkedUsername: users.username })
    .from(friends)
    .leftJoin(users, eq(users.id, friends.linkedUserId))
    .where(and(eq(friends.ownerUserId, ownerUserId), eq(friends.id, friendId)))
    .limit(1);
  if (!friend) throw new FriendLinkError("not_found");
  if (friend.linkedUserId && friend.linkedName && friend.linkedUsername) {
    return { status: "linked", user: { displayName: friend.linkedName, username: friend.linkedUsername } };
  }

  const [request] = await database
    .select({ id: friendLinkRequests.id, targetName: users.name, targetUsername: users.username })
    .from(friendLinkRequests)
    .innerJoin(users, eq(users.id, friendLinkRequests.targetUserId))
    .where(and(
      eq(friendLinkRequests.ownerUserId, ownerUserId),
      eq(friendLinkRequests.friendId, friendId),
      eq(friendLinkRequests.status, "pending"),
    ))
    .limit(1);
  if (!request || !request.targetUsername) return { status: "unlinked" };
  return { status: "pending", requestId: request.id, target: { displayName: request.targetName, username: request.targetUsername } };
}

export async function createFriendLinkRequest(database: Database, ownerUserId: string, friendId: string, targetUserId: string) {
  assertUserId(ownerUserId);
  assertFriendId(friendId);
  assertUserId(targetUserId);
  const created = await database.transaction(async (transaction) => {
    const [friend] = await transaction
      .select({ id: friends.id, name: friends.name, linkedUserId: friends.linkedUserId })
      .from(friends)
      .where(and(eq(friends.ownerUserId, ownerUserId), eq(friends.id, friendId)))
      .limit(1)
      .for("update");
    if (!friend) throw new FriendLinkError("not_found");
    if (friend.linkedUserId) throw new FriendLinkError("already_linked");
    if (targetUserId === ownerUserId) throw new FriendLinkError("self");

    const [target] = await transaction
      .select({ id: users.id, name: users.name, username: users.username })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);
    if (!target || !target.username) throw new FriendLinkError("invalid_target");

    const [requester] = await transaction
      .select({ name: users.name, username: users.username })
      .from(users)
      .where(eq(users.id, ownerUserId))
      .limit(1);
    if (!requester || !requester.username) throw new FriendLinkError("invalid_target");
    const requesterUsername = requester.username;

    const [existingLink] = await transaction
      .select({ id: friends.id })
      .from(friends)
      .where(and(eq(friends.ownerUserId, ownerUserId), eq(friends.linkedUserId, targetUserId)))
      .limit(1);
    if (existingLink) throw new FriendLinkError("already_linked");

    const [existingRequest] = await transaction
      .select({ id: friendLinkRequests.id })
      .from(friendLinkRequests)
      .where(and(
        eq(friendLinkRequests.ownerUserId, ownerUserId),
        eq(friendLinkRequests.friendId, friendId),
        eq(friendLinkRequests.targetUserId, targetUserId),
        eq(friendLinkRequests.status, "pending"),
      ))
      .limit(1);
    if (existingRequest) throw new FriendLinkError("duplicate_request");

    const [request] = await transaction
      .insert(friendLinkRequests)
      .values({ ownerUserId, friendId, targetUserId })
      .returning();
    if (!request) throw new Error("Friend link request was not created");
    return { request, friend, target, requester: { name: requester.name, username: requesterUsername } };
  }).catch((error) => {
    if (databaseCode(error) === "23505") throw new FriendLinkError("duplicate_request");
    throw error;
  });

  const metadata: NotificationMetadata["friend.link.request"] = {
    requestId: created.request.id,
    requesterDisplayName: created.requester.name,
    requesterUsername: created.requester.username,
    friendName: created.friend.name,
  };
  await createNotificationInDatabase(database, {
    recipientUserId: created.target.id,
    type: NOTIFICATION_TYPES.friendLinkRequest,
    metadata,
    dedupeKey: `friend-link-request:${created.request.id}`,
  });
  return created.request;
}

export async function cancelFriendLinkRequest(database: Database, ownerUserId: string, requestId: string) {
  assertUserId(ownerUserId);
  assertFriendId(requestId);
  const result = await database.transaction(async (transaction) => {
    const [request] = await transaction
      .select()
      .from(friendLinkRequests)
      .where(and(eq(friendLinkRequests.id, requestId), eq(friendLinkRequests.ownerUserId, ownerUserId)))
      .limit(1)
      .for("update");
    if (!request) throw new FriendLinkError("not_found");
    if (request.status !== "pending") return { request, changed: false };
    const now = new Date();
    const [cancelled] = await transaction
      .update(friendLinkRequests)
      .set({ status: "cancelled", cancelledAt: now })
      .where(and(eq(friendLinkRequests.id, request.id), eq(friendLinkRequests.status, "pending")))
      .returning();
    if (!cancelled) throw new FriendLinkError("resolved");
    await resolveRequestNotification(transaction as Database, request.targetUserId, request.id, now);
    return { request: cancelled, changed: true };
  });
  if (result.changed) {
    publishNotificationStateChange(result.request.targetUserId);
    publishFriendLinkChange(ownerUserId, result.request.friendId, result.request.id, "cancelled");
  }
  return result.request;
}

export async function respondToFriendLinkRequest(database: Database, targetUserId: string, requestId: string, response: "accept" | "decline") {
  assertUserId(targetUserId);
  assertFriendId(requestId);
  const result = await database.transaction(async (transaction) => {
    const [preview] = await transaction
      .select({ ownerUserId: friendLinkRequests.ownerUserId, friendId: friendLinkRequests.friendId })
      .from(friendLinkRequests)
      .where(and(eq(friendLinkRequests.id, requestId), eq(friendLinkRequests.targetUserId, targetUserId)))
      .limit(1);
    if (!preview) throw new FriendLinkError("not_found");

    const [friend] = await transaction
      .select({ id: friends.id, linkedUserId: friends.linkedUserId })
      .from(friends)
      .where(and(eq(friends.ownerUserId, preview.ownerUserId), eq(friends.id, preview.friendId)))
      .limit(1)
      .for("update");
    if (!friend) throw new FriendLinkError("not_found");

    const [request] = await transaction
      .select()
      .from(friendLinkRequests)
      .where(and(eq(friendLinkRequests.id, requestId), eq(friendLinkRequests.targetUserId, targetUserId)))
      .limit(1)
      .for("update");
    if (!request) throw new FriendLinkError("not_found");
    if (request.status !== "pending") return { request, changed: false, targetUserIds: [] as string[] };

    const now = new Date();
    if (response === "decline") {
      const [declined] = await transaction
        .update(friendLinkRequests)
        .set({ status: "declined", declinedAt: now })
        .where(and(eq(friendLinkRequests.id, request.id), eq(friendLinkRequests.status, "pending")))
        .returning();
      if (!declined) throw new FriendLinkError("resolved");
      await resolveRequestNotification(transaction as Database, targetUserId, request.id, now);
      return { request: declined, changed: true, targetUserIds: [targetUserId] };
    }

    if (friend.linkedUserId) throw new FriendLinkError("already_linked");
    const [existingLink] = await transaction
      .select({ id: friends.id })
      .from(friends)
      .where(and(eq(friends.ownerUserId, request.ownerUserId), eq(friends.linkedUserId, targetUserId)))
      .limit(1);
    if (existingLink) throw new FriendLinkError("already_linked");

    try {
      await transaction
        .update(friends)
        .set({ linkedUserId: targetUserId, updatedAt: now })
        .where(and(eq(friends.ownerUserId, request.ownerUserId), eq(friends.id, request.friendId), isNull(friends.linkedUserId)));
    } catch (error) {
      if (databaseCode(error) === "23505") throw new FriendLinkError("conflict");
      throw error;
    }

    const [accepted] = await transaction
      .update(friendLinkRequests)
      .set({ status: "accepted", acceptedAt: now })
      .where(and(eq(friendLinkRequests.id, request.id), eq(friendLinkRequests.status, "pending")))
      .returning();
    if (!accepted) throw new FriendLinkError("resolved");

    const cancelled = await transaction
      .update(friendLinkRequests)
      .set({ status: "cancelled", cancelledAt: now })
      .where(and(
        eq(friendLinkRequests.ownerUserId, request.ownerUserId),
        eq(friendLinkRequests.friendId, request.friendId),
        eq(friendLinkRequests.status, "pending"),
        ne(friendLinkRequests.id, request.id),
      ))
      .returning({ id: friendLinkRequests.id, targetUserId: friendLinkRequests.targetUserId });
    const targetUserIds = [targetUserId, ...cancelled.map(({ targetUserId: id }) => id)];
    await resolveRequestNotification(transaction as Database, targetUserId, request.id, now);
    for (const cancelledRequest of cancelled) {
      await resolveRequestNotification(transaction as Database, cancelledRequest.targetUserId, cancelledRequest.id, now);
    }
    return { request: accepted, changed: true, targetUserIds };
  }).catch((error) => {
    if (databaseCode(error) === "23505") throw new FriendLinkError("conflict");
    throw error;
  });

  if (result.changed) {
    for (const userId of result.targetUserIds) publishNotificationStateChange(userId);
    publishFriendLinkChange(result.request.ownerUserId, result.request.friendId, result.request.id, result.request.status as FriendLinkRequestStatus);
  }
  return result.request;
}

export async function getFriendLinkRequestStatuses(database: Database, targetUserId: string, requestIds: string[]) {
  assertUserId(targetUserId);
  const ids = [...new Set(requestIds.map(normalizeUuid).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map<string, FriendLinkRequestStatus>();
  const rows = await database
    .select({ id: friendLinkRequests.id, status: friendLinkRequests.status })
    .from(friendLinkRequests)
    .where(and(eq(friendLinkRequests.targetUserId, targetUserId), inArray(friendLinkRequests.id, ids)));
  return new Map(rows.map((row) => [row.id, row.status as FriendLinkRequestStatus]));
}

export async function getCurrentUserFriendLinkRequestStatuses(requestIds: string[]) {
  const session = await requireSession();
  return getFriendLinkRequestStatuses(getDatabase(), session.user.id, requestIds);
}
