import "server-only";

import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { Database } from "@/db/client";
import { getDatabase } from "@/db/client";
import { friendConnections, friendLinkRequests, friends, notifications, users } from "@/db/schema";
import { NOTIFICATION_TYPES, type NotificationMetadata } from "@/domain/notifications";
import { normalizeUuid } from "@/domain/record-retrieval";
import { FRIEND_LINK_STATE_CHANGED_EVENT } from "@/domain/friend-links";
import { createNotificationInDatabase, publishNotificationStateChange } from "@/server/notifications";
import { publishRealtimeEvent } from "@/server/realtime";
import { requireSession } from "@/auth/require-session";

export type FriendLinkRequestStatus = "pending" | "accepted" | "declined" | "cancelled" | "connected" | "disconnected";

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

function canonicalPair(left: string, right: string) {
  return left < right ? [left, right] as const : [right, left] as const;
}

function connectionWhere(userAId: string, userBId: string) {
  return and(eq(friendConnections.userAId, userAId), eq(friendConnections.userBId, userBId));
}

function mappingWhere(userAId: string, userBId: string) {
  return or(
    and(eq(friends.ownerUserId, userAId), eq(friends.linkedUserId, userBId)),
    and(eq(friends.ownerUserId, userBId), eq(friends.linkedUserId, userAId)),
  );
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

    const [existingLink] = await transaction
      .select({ id: friends.id })
      .from(friends)
      .where(and(eq(friends.ownerUserId, ownerUserId), eq(friends.linkedUserId, targetUserId)))
      .limit(1);
    if (existingLink) throw new FriendLinkError("already_linked");

    const [pendingFriend] = await transaction
      .select({ id: friendLinkRequests.id })
      .from(friendLinkRequests)
      .where(and(
        eq(friendLinkRequests.ownerUserId, ownerUserId),
        eq(friendLinkRequests.friendId, friendId),
        eq(friendLinkRequests.status, "pending"),
      ))
      .limit(1);
    if (pendingFriend) throw new FriendLinkError("duplicate_request");

    const [pendingTarget] = await transaction
      .select({ id: friendLinkRequests.id })
      .from(friendLinkRequests)
      .where(and(
        eq(friendLinkRequests.ownerUserId, ownerUserId),
        eq(friendLinkRequests.targetUserId, targetUserId),
        eq(friendLinkRequests.status, "pending"),
      ))
      .limit(1);
    if (pendingTarget) throw new FriendLinkError("duplicate_request");

    const [request] = await transaction
      .insert(friendLinkRequests)
      .values({ ownerUserId, friendId, targetUserId })
      .returning();
    if (!request) throw new Error("Friend link request was not created");

    const metadata: NotificationMetadata["friend.link.request"] = {
      requestId: request.id,
      requesterDisplayName: requester.name,
      requesterUsername: requester.username,
      friendName: friend.name,
    };
    await createNotificationInDatabase(transaction as Database, {
      recipientUserId: target.id,
      type: NOTIFICATION_TYPES.friendLinkRequest,
      metadata,
      dedupeKey: `friend-link-request:${request.id}`,
    });
    return { request, targetUserId: target.id };
  }).catch((error) => {
    if (databaseCode(error) === "23505") throw new FriendLinkError("duplicate_request");
    throw error;
  });

  publishNotificationStateChange(created.targetUserId, "created");
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
    publishNotificationStateChange(result.request.targetUserId, "resolved");
    publishFriendLinkChange(ownerUserId, result.request.friendId, result.request.id, "cancelled");
  }
  return result.request;
}

async function lockOrCreateConnection(transaction: Database, userAId: string, userBId: string, now: Date) {
  await transaction
    .insert(friendConnections)
    .values({ userAId, userBId, status: "connected", connectedAt: now })
    .onConflictDoNothing({ target: [friendConnections.userAId, friendConnections.userBId] });
  const [connection] = await transaction
    .select()
    .from(friendConnections)
    .where(connectionWhere(userAId, userBId))
    .limit(1)
    .for("update");
  if (!connection) throw new FriendLinkError("conflict");
  if (connection.status === "disconnected") {
    const [reconnected] = await transaction
      .update(friendConnections)
      .set({ status: "connected", connectedAt: now, disconnectedAt: null, updatedAt: now })
      .where(eq(friendConnections.id, connection.id))
      .returning();
    if (!reconnected) throw new FriendLinkError("conflict");
    return reconnected;
  }
  return connection;
}

export async function respondToFriendLinkRequest(database: Database, targetUserId: string, requestId: string, response: "accept" | "decline") {
  assertUserId(targetUserId);
  assertFriendId(requestId);
  const result = await database.transaction(async (transaction) => {
    const [request] = await transaction
      .select()
      .from(friendLinkRequests)
      .where(and(eq(friendLinkRequests.id, requestId), eq(friendLinkRequests.targetUserId, targetUserId)))
      .limit(1)
      .for("update");
    if (!request) throw new FriendLinkError("not_found");
    if (request.status !== "pending") return { request, changed: false, targetUserIds: [] as string[] };

    const [friend] = await transaction
      .select({ id: friends.id, linkedUserId: friends.linkedUserId })
      .from(friends)
      .where(and(eq(friends.ownerUserId, request.ownerUserId), eq(friends.id, request.friendId)))
      .limit(1)
      .for("update");
    if (!friend) throw new FriendLinkError("not_found");

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

    const [existingLink] = await transaction
      .select({ id: friends.id })
      .from(friends)
      .where(and(eq(friends.ownerUserId, request.ownerUserId), eq(friends.linkedUserId, targetUserId), ne(friends.id, request.friendId)))
      .limit(1);
    if (existingLink || friend.linkedUserId && friend.linkedUserId !== targetUserId) {
      const [cancelled] = await transaction
        .update(friendLinkRequests)
        .set({ status: "cancelled", cancelledAt: now })
        .where(and(eq(friendLinkRequests.id, request.id), eq(friendLinkRequests.status, "pending")))
        .returning();
      if (!cancelled) throw new FriendLinkError("resolved");
      await resolveRequestNotification(transaction as Database, targetUserId, request.id, now);
      return { request: cancelled, changed: true, targetUserIds: [targetUserId] };
    }

    const [userAId, userBId] = canonicalPair(request.ownerUserId, targetUserId);
    await lockOrCreateConnection(transaction as Database, userAId, userBId, now);
    try {
      const updatedFriends = await transaction
        .update(friends)
        .set({ linkedUserId: targetUserId, updatedAt: now })
        .where(and(eq(friends.ownerUserId, request.ownerUserId), eq(friends.id, request.friendId), or(isNull(friends.linkedUserId), eq(friends.linkedUserId, targetUserId))))
        .returning({ id: friends.id });
      if (updatedFriends.length === 0) throw new FriendLinkError("conflict");
    } catch (error) {
      if (error instanceof FriendLinkError) throw error;
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
        eq(friendLinkRequests.status, "pending"),
        ne(friendLinkRequests.id, request.id),
        or(eq(friendLinkRequests.friendId, request.friendId), eq(friendLinkRequests.targetUserId, targetUserId)),
      ))
      .returning({ id: friendLinkRequests.id, targetUserId: friendLinkRequests.targetUserId });
    await resolveRequestNotification(transaction as Database, targetUserId, request.id, now);
    for (const cancelledRequest of cancelled) {
      await resolveRequestNotification(transaction as Database, cancelledRequest.targetUserId, cancelledRequest.id, now);
    }
    return { request: accepted, changed: true, targetUserIds: [targetUserId, ...cancelled.map(({ targetUserId: id }) => id)] };
  }).catch((error) => {
    if (databaseCode(error) === "23505") throw new FriendLinkError("conflict");
    throw error;
  });

  if (result.changed) {
    for (const userId of result.targetUserIds) publishNotificationStateChange(userId, "resolved");
    publishNotificationStateChange(result.request.ownerUserId, "resolved");
    publishFriendLinkChange(result.request.ownerUserId, result.request.friendId, result.request.id, result.request.status as FriendLinkRequestStatus);
  }
  return result.request;
}

type UnlinkInput = { friendId?: string; requestId?: string };

export async function unlinkFriendLink(database: Database, actorUserId: string, input: UnlinkInput) {
  assertUserId(actorUserId);
  if (Boolean(input.friendId) === Boolean(input.requestId)) throw new FriendLinkError("not_found");
  if (input.friendId) assertFriendId(input.friendId);
  if (input.requestId) assertFriendId(input.requestId);

  const result = await database.transaction(async (transaction) => {
    let friendId = input.friendId;
    let requestId = input.requestId;
    let ownerUserId = actorUserId;
    let targetUserId: string | null = null;

    if (requestId) {
      const [request] = await transaction
        .select()
        .from(friendLinkRequests)
        .where(and(eq(friendLinkRequests.id, requestId), eq(friendLinkRequests.status, "accepted"), or(eq(friendLinkRequests.ownerUserId, actorUserId), eq(friendLinkRequests.targetUserId, actorUserId))))
        .limit(1)
        .for("update");
      if (!request) throw new FriendLinkError("not_found");
      ownerUserId = request.ownerUserId;
      targetUserId = request.targetUserId;
      friendId = request.friendId;
    }

    if (!friendId) throw new FriendLinkError("not_found");
    const [friend] = await transaction
      .select({ id: friends.id, linkedUserId: friends.linkedUserId })
      .from(friends)
      .where(and(eq(friends.ownerUserId, actorUserId), eq(friends.id, friendId)))
      .limit(1)
      .for("update");

    if (input.friendId) {
      if (!friend) throw new FriendLinkError("not_found");
      targetUserId = friend.linkedUserId;
      if (!targetUserId) {
        const [accepted] = await transaction
          .select({ id: friendLinkRequests.id, targetUserId: friendLinkRequests.targetUserId })
          .from(friendLinkRequests)
          .where(and(eq(friendLinkRequests.ownerUserId, actorUserId), eq(friendLinkRequests.friendId, friendId), eq(friendLinkRequests.status, "accepted")))
          .orderBy(desc(friendLinkRequests.acceptedAt), desc(friendLinkRequests.id))
          .limit(1);
        targetUserId = accepted?.targetUserId ?? null;
        requestId = accepted?.id ?? null;
      }
    }

    if (!targetUserId) return { changed: false, friendIds: [] as string[], friendMappings: [], userIds: [actorUserId], requestId: requestId ?? "", ownerUserId };
    const [userAId, userBId] = canonicalPair(ownerUserId, targetUserId);
    const mappingRows = await transaction
      .select({ id: friends.id, ownerUserId: friends.ownerUserId })
      .from(friends)
      .where(mappingWhere(userAId, userBId))
      .for("update");
    const now = new Date();
    const cleared = await transaction
      .update(friends)
      .set({ linkedUserId: null, updatedAt: now })
      .where(mappingWhere(userAId, userBId))
      .returning({ id: friends.id, ownerUserId: friends.ownerUserId });

    const [connection] = await transaction
      .select()
      .from(friendConnections)
      .where(connectionWhere(userAId, userBId))
      .limit(1)
      .for("update");
    if (connection) {
      if (connection.status === "connected") {
        await transaction
          .update(friendConnections)
          .set({ status: "disconnected", disconnectedAt: now, updatedAt: now })
          .where(eq(friendConnections.id, connection.id));
      }
    } else {
      await transaction.insert(friendConnections).values({
        userAId,
        userBId,
        status: "disconnected",
        createdAt: now,
        connectedAt: now,
        disconnectedAt: now,
        updatedAt: now,
      });
    }

    const friendMappings = [...new Map(
      [...mappingRows, ...cleared].map(({ id, ownerUserId: mappingOwnerUserId }) => [
        `${mappingOwnerUserId}\u0000${id}`,
        { ownerUserId: mappingOwnerUserId, friendId: id },
      ]),
    ).values()];
    return {
      changed: cleared.length > 0 || connection?.status === "connected",
      friendIds: [...new Set(friendMappings.map(({ friendId }) => friendId))],
      friendMappings,
      userIds: [userAId, userBId],
      requestId: requestId ?? "",
      ownerUserId,
    };
  });

  if (result.changed) {
    for (const userId of result.userIds) publishNotificationStateChange(userId, "resolved");
    for (const { ownerUserId, friendId } of result.friendMappings) publishFriendLinkChange(ownerUserId, friendId, result.requestId, "disconnected");
  }
  return result;
}

export async function getFriendLinkRequestStatuses(database: Database, targetUserId: string, requestIds: string[]) {
  assertUserId(targetUserId);
  const ids = [...new Set(requestIds.map(normalizeUuid).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map<string, FriendLinkRequestStatus>();
  const rows = await database
    .select({ id: friendLinkRequests.id, status: friendLinkRequests.status, ownerUserId: friendLinkRequests.ownerUserId, targetUserId: friendLinkRequests.targetUserId })
    .from(friendLinkRequests)
    .where(and(eq(friendLinkRequests.targetUserId, targetUserId), inArray(friendLinkRequests.id, ids)));
  const pairs = [...new Set(rows.map(({ ownerUserId, targetUserId: target }) => canonicalPair(ownerUserId, target).join("\u0000")))];
  const connections = pairs.length === 0 ? [] : await database
    .select({ userAId: friendConnections.userAId, userBId: friendConnections.userBId, status: friendConnections.status })
    .from(friendConnections)
    .where(or(...pairs.map((key) => {
      const [userAId, userBId] = key.split("\u0000");
      return connectionWhere(userAId!, userBId!);
    })));
  const connectionStates = new Map(connections.map((connection) => [`${connection.userAId}\u0000${connection.userBId}`, connection.status]));
  return new Map(rows.map((row) => {
    const pair = canonicalPair(row.ownerUserId, row.targetUserId).join("\u0000");
    const status = row.status === "accepted" ? connectionStates.get(pair) === "connected" ? "connected" : "disconnected" : row.status;
    return [row.id, status as FriendLinkRequestStatus];
  }));
}

export async function getCurrentUserFriendLinkRequestStatuses(requestIds: string[]) {
  const session = await requireSession();
  return getFriendLinkRequestStatuses(getDatabase(), session.user.id, requestIds);
}
