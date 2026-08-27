import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDatabase, type Database } from "@/db/client";
import { groupJoinRequests, groupMemberships, groupParticipants, groups, notifications, users } from "@/db/schema";
import { isGroupJoinRequestExpired, groupJoinRequestExpiresAt, type GroupJoinRequestKind, type GroupJoinRequestStatus } from "@/domain/group-join-requests";
import { normalizeUuid } from "@/domain/record-retrieval";
import { parseUsername } from "@/domain/username";
import { NOTIFICATION_TYPES, type NotificationMetadata } from "@/domain/notifications";
import { requireSession } from "@/auth/require-session";
import { createNotificationInDatabase, publishNotificationStateChange } from "@/server/notifications";
import { searchUsernameDirectoryInDatabase } from "@/server/user-directory";
import { GroupError, requireGroupAccess } from "@/server/groups";

export class GroupJoinRequestError extends Error {
  constructor(readonly code: "invalid_id" | "forbidden" | "invalid_target" | "self" | "already_member" | "registered_participant" | "duplicate" | "not_found" | "resolved" | "expired" | "stale_authority" | "participant_not_found" | "already_linked" | "conflict") {
    super(code);
    this.name = "GroupJoinRequestError";
  }
}

export type GroupJoinRequestSummary = {
  id: string;
  kind: GroupJoinRequestKind;
  status: GroupJoinRequestStatus;
  targetUserId: string;
  targetDisplayName: string;
  targetUsername: string;
  participantId: string | null;
  participantDisplayName: string | null;
  participantLabel: string | null;
  expiresAt: Date;
};

export type GroupJoinRequestState = {
  id: string;
  groupId: string;
  kind: GroupJoinRequestKind;
  participantId: string | null;
  status: GroupJoinRequestStatus;
  expiresAt: Date;
};

function databaseCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function assertUserId(userId: string) {
  if (typeof userId !== "string" || !userId.trim()) throw new TypeError("A Group request user id is required");
}

function assertGroupId(groupId: string) {
  if (!normalizeUuid(groupId)) throw new GroupJoinRequestError("invalid_id");
}

function assertRequestId(requestId: string) {
  if (!normalizeUuid(requestId)) throw new GroupJoinRequestError("not_found");
}

function parseRequestUsername(value: unknown) {
  const parsed = parseUsername(value);
  if (!parsed.ok) throw new GroupJoinRequestError("invalid_target");
  return parsed.value;
}

function notificationType(kind: GroupJoinRequestKind) {
  return kind === "member_invitation" ? NOTIFICATION_TYPES.groupInvitation : NOTIFICATION_TYPES.groupParticipantLinkRequest;
}

async function resolveRequestNotification(database: Database, targetUserId: string, request: { id: string; kind: GroupJoinRequestKind }, now: Date) {
  await database
    .update(notifications)
    .set({ readAt: now })
    .where(and(
      eq(notifications.recipientUserId, targetUserId),
      eq(notifications.type, notificationType(request.kind)),
      eq(notifications.dedupeKey, `group-join-request:${request.id}`),
      isNull(notifications.readAt),
    ));
}

async function transitionPendingRequest(database: Database, request: typeof groupJoinRequests.$inferSelect, status: Exclude<GroupJoinRequestStatus, "pending">, now: Date) {
  const values = status === "accepted"
    ? { status, acceptedAt: now, updatedAt: now }
    : status === "declined"
      ? { status, declinedAt: now, updatedAt: now }
      : status === "revoked"
        ? { status, revokedAt: now, updatedAt: now }
        : { status, expiredAt: now, updatedAt: now };
  const [updated] = await database
    .update(groupJoinRequests)
    .set(values)
    .where(and(eq(groupJoinRequests.id, request.id), eq(groupJoinRequests.status, "pending")))
    .returning();
  if (updated) await resolveRequestNotification(database, request.targetUserId, request, now);
  return updated;
}

async function resolveTarget(database: Database, username: string) {
  const [target] = await database
    .select({ id: users.id, name: users.name, username: users.username })
    .from(users)
    .where(eq(users.username, username))
    .limit(1)
    .for("update");
  return target?.username ? target : null;
}

async function resolveGroupContext(database: Database, groupId: string, requesterUserId: string) {
  const [group] = await database.select({ id: groups.id, name: groups.name }).from(groups).where(eq(groups.id, groupId)).limit(1);
  const [requester] = await database.select({ name: users.name, username: users.username }).from(users).where(eq(users.id, requesterUserId)).limit(1);
  if (!group || !requester) throw new GroupJoinRequestError("not_found");
  return { group, requester };
}

async function ensureTargetIsUnrepresented(database: Database, groupId: string, targetUserId: string) {
  const [membership] = await database
    .select({ userId: groupMemberships.userId })
    .from(groupMemberships)
    .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, targetUserId)))
    .limit(1)
    .for("update");
  if (membership) throw new GroupJoinRequestError("already_member");
  const [participant] = await database
    .select({ id: groupParticipants.id })
    .from(groupParticipants)
    .where(and(eq(groupParticipants.groupId, groupId), eq(groupParticipants.userId, targetUserId)))
    .limit(1)
    .for("update");
  if (participant) throw new GroupJoinRequestError("registered_participant");
}

async function expirePendingForTarget(database: Database, groupId: string, targetUserId: string, now: Date) {
  const pending = await database
    .select()
    .from(groupJoinRequests)
    .where(and(eq(groupJoinRequests.groupId, groupId), eq(groupJoinRequests.targetUserId, targetUserId), eq(groupJoinRequests.status, "pending")))
    .limit(1)
    .for("update");
  const request = pending[0];
  if (!request) return;
  if (!isGroupJoinRequestExpired(request.expiresAt, now)) throw new GroupJoinRequestError("duplicate");
  await transitionPendingRequest(database, request, "expired", now);
}

async function expirePendingForParticipant(database: Database, groupId: string, participantId: string, now: Date) {
  const pending = await database
    .select()
    .from(groupJoinRequests)
    .where(and(eq(groupJoinRequests.groupId, groupId), eq(groupJoinRequests.participantId, participantId), eq(groupJoinRequests.kind, "participant_link"), eq(groupJoinRequests.status, "pending")))
    .limit(1)
    .for("update");
  const request = pending[0];
  if (!request) return;
  if (!isGroupJoinRequestExpired(request.expiresAt, now)) throw new GroupJoinRequestError("duplicate");
  await transitionPendingRequest(database, request, "expired", now);
}

async function createRequest(database: Database, input: { groupId: string; requesterUserId: string; username: unknown; kind: GroupJoinRequestKind; participantId?: string }) {
  assertGroupId(input.groupId);
  assertUserId(input.requesterUserId);
  if (input.kind === "participant_link" && !input.participantId) throw new GroupJoinRequestError("participant_not_found");
  if (input.participantId !== undefined && !normalizeUuid(input.participantId)) throw new GroupJoinRequestError("participant_not_found");
  const created = await database.transaction(async (transaction) => {
    const access = await requireGroupAccess(transaction as Database, input.groupId, input.requesterUserId);
    access.requireManageParticipants();
    const username = parseRequestUsername(input.username);
    const target = await resolveTarget(transaction as Database, username);
    if (!target) throw new GroupJoinRequestError("invalid_target");
    if (target.id === input.requesterUserId) throw new GroupJoinRequestError("self");

    let participant: { id: string; displayName: string | null; label: string | null } | undefined;
    if (input.kind === "participant_link") {
      const [selected] = await transaction
        .select({ id: groupParticipants.id, displayName: groupParticipants.displayName, label: groupParticipants.label, userId: groupParticipants.userId })
        .from(groupParticipants)
        .where(and(eq(groupParticipants.groupId, input.groupId), eq(groupParticipants.id, input.participantId!)))
        .limit(1);
      if (!selected) throw new GroupJoinRequestError("participant_not_found");
      if (selected.userId) throw new GroupJoinRequestError("already_linked");
      participant = selected;
    }

    const now = new Date();
    await expirePendingForTarget(transaction as Database, input.groupId, target.id, now);
    if (input.kind === "participant_link") await expirePendingForParticipant(transaction as Database, input.groupId, input.participantId!, now);
    await ensureTargetIsUnrepresented(transaction as Database, input.groupId, target.id);
    if (input.kind === "participant_link") {
      const [lockedParticipant] = await transaction
        .select({ id: groupParticipants.id, displayName: groupParticipants.displayName, label: groupParticipants.label, userId: groupParticipants.userId })
        .from(groupParticipants)
        .where(and(eq(groupParticipants.groupId, input.groupId), eq(groupParticipants.id, input.participantId!)))
        .limit(1)
        .for("update");
      if (!lockedParticipant) throw new GroupJoinRequestError("participant_not_found");
      if (lockedParticipant.userId) throw new GroupJoinRequestError("already_linked");
      participant = lockedParticipant;
    }
    const { group, requester } = await resolveGroupContext(transaction as Database, input.groupId, input.requesterUserId);
    const expiresAt = groupJoinRequestExpiresAt(now);
    const [request] = await transaction
      .insert(groupJoinRequests)
      .values({ groupId: input.groupId, kind: input.kind, participantId: participant?.id ?? null, participantDisplayNameSnapshot: participant?.displayName ?? null, participantLabelSnapshot: participant?.label ?? null, targetUserId: target.id, requesterUserId: input.requesterUserId, status: "pending", expiresAt, createdAt: now, updatedAt: now })
      .returning();
    if (!request) throw new Error("Group join request was not created");

    const metadata = input.kind === "member_invitation"
      ? {
        requestId: request.id,
        groupId: input.groupId,
        groupName: group.name,
        requesterDisplayName: requester.name,
        requesterUsername: requester.username,
        expiresAt: request.expiresAt.toISOString(),
      } satisfies NotificationMetadata["group.invitation"]
      : {
        requestId: request.id,
        groupId: input.groupId,
        groupName: group.name,
        requesterDisplayName: requester.name,
        requesterUsername: requester.username,
        participantDisplayName: participant?.displayName ?? "Participant",
        participantLabel: participant?.label ?? null,
        expiresAt: request.expiresAt.toISOString(),
      } satisfies NotificationMetadata["group.participant.link.request"];
    await createNotificationInDatabase(transaction as Database, {
      recipientUserId: target.id,
      type: notificationType(input.kind),
      metadata,
      dedupeKey: `group-join-request:${request.id}`,
    });
    return { request, targetUserId: target.id };
  }).catch((error) => {
    if (databaseCode(error) === "23505") throw new GroupJoinRequestError("duplicate");
    throw error;
  });
  publishNotificationStateChange(created.targetUserId, "created");
  return created.request;
}

export async function searchGroupJoinUsers(database: Database, groupId: string, requesterUserId: string, query: unknown) {
  assertGroupId(groupId);
  assertUserId(requesterUserId);
  const access = await requireGroupAccess(database, groupId, requesterUserId);
  access.requireManageParticipants();
  const members = await database.select({ userId: groupMemberships.userId }).from(groupMemberships).where(eq(groupMemberships.groupId, groupId));
  const registered = await database.select({ userId: groupParticipants.userId }).from(groupParticipants).where(eq(groupParticipants.groupId, groupId));
  return searchUsernameDirectoryInDatabase(database, query, { excludeUserIds: [requesterUserId, ...members.map(({ userId }) => userId), ...registered.flatMap(({ userId }) => userId ? [userId] : [])] });
}

export async function createGroupInvitation(database: Database, groupId: string, requesterUserId: string, username: unknown) {
  return createRequest(database, { groupId, requesterUserId, username, kind: "member_invitation" });
}

export async function createGroupParticipantLinkRequest(database: Database, groupId: string, participantId: string, requesterUserId: string, username: unknown) {
  return createRequest(database, { groupId, requesterUserId, username, kind: "participant_link", participantId });
}

export async function listGroupJoinRequests(database: Database, groupId: string, viewerUserId: string) {
  assertGroupId(groupId);
  assertUserId(viewerUserId);
  const result = await database.transaction(async (transaction) => {
    const access = await requireGroupAccess(transaction as Database, groupId, viewerUserId);
    access.requireManageParticipants();
    const rows = await transaction
      .select({
        id: groupJoinRequests.id,
        kind: groupJoinRequests.kind,
        status: groupJoinRequests.status,
        targetUserId: groupJoinRequests.targetUserId,
        targetDisplayName: users.name,
        targetUsername: users.username,
        participantId: groupJoinRequests.participantId,
        participantDisplayName: groupParticipants.displayName,
        participantLabel: groupParticipants.label,
        expiresAt: groupJoinRequests.expiresAt,
      })
      .from(groupJoinRequests)
      .innerJoin(users, eq(users.id, groupJoinRequests.targetUserId))
      .leftJoin(groupParticipants, and(eq(groupParticipants.groupId, groupJoinRequests.groupId), eq(groupParticipants.id, groupJoinRequests.participantId)))
      .where(and(eq(groupJoinRequests.groupId, groupId), eq(groupJoinRequests.status, "pending")))
      .orderBy(asc(groupJoinRequests.expiresAt), asc(groupJoinRequests.id));
    const now = new Date();
    const expiredTargetIds: string[] = [];
    const active: GroupJoinRequestSummary[] = [];
    for (const row of rows) {
      if (isGroupJoinRequestExpired(row.expiresAt, now)) {
        const [request] = await transaction.select().from(groupJoinRequests).where(eq(groupJoinRequests.id, row.id)).limit(1).for("update");
        if (request && await transitionPendingRequest(transaction as Database, request, "expired", now)) expiredTargetIds.push(row.targetUserId);
        continue;
      }
      if (row.targetUsername) active.push({ ...row, kind: row.kind as GroupJoinRequestKind, status: row.status as GroupJoinRequestStatus, targetUsername: row.targetUsername });
    }
    return { active, expiredTargetIds };
  });
  for (const targetUserId of result.expiredTargetIds) publishNotificationStateChange(targetUserId, "resolved");
  return {
    invitations: result.active.filter((request) => request.kind === "member_invitation"),
    links: result.active.filter((request) => request.kind === "participant_link"),
  };
}

function stateFromRequest(request: typeof groupJoinRequests.$inferSelect): GroupJoinRequestState {
  return { id: request.id, groupId: request.groupId, kind: request.kind as GroupJoinRequestKind, participantId: request.participantId, status: request.status as GroupJoinRequestStatus, expiresAt: request.expiresAt };
}

export async function getGroupJoinRequestStatuses(database: Database, targetUserId: string, requestIds: string[]) {
  assertUserId(targetUserId);
  const ids = [...new Set(requestIds.map(normalizeUuid).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map<string, GroupJoinRequestState>();
  const result = await database.transaction(async (transaction) => {
    const rows = await transaction
      .select()
      .from(groupJoinRequests)
      .where(and(eq(groupJoinRequests.targetUserId, targetUserId), inArray(groupJoinRequests.id, ids)))
      .for("update");
    const states = new Map<string, GroupJoinRequestState>();
    const expired = new Set<string>();
    const now = new Date();
    for (const row of rows) {
      let current = row;
      if (row.status === "pending" && isGroupJoinRequestExpired(row.expiresAt, now)) {
        current = await transitionPendingRequest(transaction as Database, row, "expired", now) ?? row;
        if (current.status === "expired") expired.add(targetUserId);
      }
      states.set(current.id, stateFromRequest(current));
    }
    return { states, expired: [...expired] };
  });
  for (const userId of result.expired) publishNotificationStateChange(userId, "resolved");
  return result.states;
}

export async function getCurrentUserGroupJoinRequestStatuses(requestIds: string[]) {
  const session = await requireSession();
  return getGroupJoinRequestStatuses(getDatabase(), session.user.id, requestIds);
}

async function currentRequesterHasAuthority(database: Database, groupId: string, requesterUserId: string) {
  const [lockedMembership] = await database
    .select({ userId: groupMemberships.userId })
    .from(groupMemberships)
    .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, requesterUserId)))
    .limit(1)
    .for("update");
  if (!lockedMembership) return false;
  try {
    const access = await requireGroupAccess(database, groupId, requesterUserId);
    access.requireManageParticipants();
    return true;
  } catch (error) {
    if (error instanceof GroupError) return false;
    throw error;
  }
}

async function respondToRequest(database: Database, targetUserId: string, requestId: string, response: "accept" | "decline") {
  assertUserId(targetUserId);
  assertRequestId(requestId);
  const result = await database.transaction(async (transaction) => {
    const [request] = await transaction
      .select()
      .from(groupJoinRequests)
      .where(and(eq(groupJoinRequests.id, requestId), eq(groupJoinRequests.targetUserId, targetUserId)))
      .limit(1)
      .for("update");
    if (!request) throw new GroupJoinRequestError("not_found");
    if (request.status !== "pending") return { request, changed: false, error: undefined as GroupJoinRequestError["code"] | undefined };
    const now = new Date();
    if (isGroupJoinRequestExpired(request.expiresAt, now)) {
      const expired = await transitionPendingRequest(transaction as Database, request, "expired", now);
      return { request: expired ?? request, changed: Boolean(expired), error: "expired" as const };
    }
    if (response === "decline") {
      const declined = await transitionPendingRequest(transaction as Database, request, "declined", now);
      if (!declined) throw new GroupJoinRequestError("resolved");
      return { request: declined, changed: true, error: undefined };
    }

    if (!await currentRequesterHasAuthority(transaction as Database, request.groupId, request.requesterUserId)) {
      const revoked = await transitionPendingRequest(transaction as Database, request, "revoked", now);
      return { request: revoked ?? request, changed: Boolean(revoked), error: "stale_authority" as const };
    }

    if (request.kind === "member_invitation") {
      const [existingMembership] = await transaction
        .select({ userId: groupMemberships.userId })
        .from(groupMemberships)
        .where(and(eq(groupMemberships.groupId, request.groupId), eq(groupMemberships.userId, targetUserId)))
        .limit(1)
        .for("update");
      const [registered] = await transaction
        .select({ id: groupParticipants.id })
        .from(groupParticipants)
        .where(and(eq(groupParticipants.groupId, request.groupId), eq(groupParticipants.userId, targetUserId)))
        .limit(1)
        .for("update");
      if (existingMembership || registered) {
        const revoked = await transitionPendingRequest(transaction as Database, request, "revoked", now);
        return { request: revoked ?? request, changed: Boolean(revoked), error: existingMembership ? "already_member" : "registered_participant" };
      }
      const [participant] = await transaction
        .insert(groupParticipants)
        .values({ groupId: request.groupId, userId: targetUserId, displayName: null, createdAt: now, updatedAt: now })
        .onConflictDoNothing()
        .returning({ id: groupParticipants.id });
      if (!participant) {
        const revoked = await transitionPendingRequest(transaction as Database, request, "revoked", now);
        return { request: revoked ?? request, changed: Boolean(revoked), error: "registered_participant" as const };
      }
      const [createdMembership] = await transaction
        .insert(groupMemberships)
        .values({ groupId: request.groupId, userId: targetUserId, participantId: participant.id, role: "member", joinedAt: now })
        .onConflictDoNothing({ target: [groupMemberships.groupId, groupMemberships.userId] })
        .returning();
      if (!createdMembership) {
        await transaction.delete(groupParticipants).where(and(eq(groupParticipants.groupId, request.groupId), eq(groupParticipants.id, participant.id), eq(groupParticipants.userId, targetUserId)));
        const revoked = await transitionPendingRequest(transaction as Database, request, "revoked", now);
        return { request: revoked ?? request, changed: Boolean(revoked), error: "already_member" as const };
      }
      const accepted = await transitionPendingRequest(transaction as Database, request, "accepted", now);
      if (!accepted) throw new GroupJoinRequestError("conflict");
      return { request: accepted, changed: true, error: undefined };
    }

    const [participant] = await transaction
      .select()
      .from(groupParticipants)
      .where(and(eq(groupParticipants.groupId, request.groupId), eq(groupParticipants.id, request.participantId!)))
      .limit(1)
      .for("update");
    if (!participant) {
      const revoked = await transitionPendingRequest(transaction as Database, request, "revoked", now);
      return { request: revoked ?? request, changed: Boolean(revoked), error: "participant_not_found" as const };
    }
    if (participant.userId) {
      const revoked = await transitionPendingRequest(transaction as Database, request, "revoked", now);
      return { request: revoked ?? request, changed: Boolean(revoked), error: "already_linked" as const };
    }
    const [existingMembership] = await transaction
      .select({ userId: groupMemberships.userId })
      .from(groupMemberships)
      .where(and(eq(groupMemberships.groupId, request.groupId), eq(groupMemberships.userId, targetUserId)))
      .limit(1)
      .for("update");
    const [registered] = await transaction
      .select({ id: groupParticipants.id })
      .from(groupParticipants)
      .where(and(eq(groupParticipants.groupId, request.groupId), eq(groupParticipants.userId, targetUserId)))
      .limit(1)
      .for("update");
    if (existingMembership || registered) {
      const revoked = await transitionPendingRequest(transaction as Database, request, "revoked", now);
      return { request: revoked ?? request, changed: Boolean(revoked), error: existingMembership ? "already_member" : "registered_participant" };
    }
    const [linked] = await transaction
      .update(groupParticipants)
      .set({ userId: targetUserId, displayName: null, updatedAt: now })
      .where(and(eq(groupParticipants.groupId, request.groupId), eq(groupParticipants.id, participant.id), isNull(groupParticipants.userId)))
      .returning({ id: groupParticipants.id });
    if (!linked) throw new GroupJoinRequestError("conflict");
    const [createdMembership] = await transaction
      .insert(groupMemberships)
      .values({ groupId: request.groupId, userId: targetUserId, participantId: participant.id, role: "member", joinedAt: now })
      .onConflictDoNothing({ target: [groupMemberships.groupId, groupMemberships.userId] })
      .returning();
    if (!createdMembership) {
      await transaction.update(groupParticipants).set({ userId: null, displayName: participant.displayName, updatedAt: now }).where(and(eq(groupParticipants.groupId, request.groupId), eq(groupParticipants.id, participant.id), eq(groupParticipants.userId, targetUserId)));
      const revoked = await transitionPendingRequest(transaction as Database, request, "revoked", now);
      return { request: revoked ?? request, changed: Boolean(revoked), error: "already_member" as const };
    }
    const accepted = await transitionPendingRequest(transaction as Database, request, "accepted", now);
    if (!accepted) throw new GroupJoinRequestError("conflict");
    return { request: accepted, changed: true, error: undefined };
  }).catch((error) => {
    if (databaseCode(error) === "23505") throw new GroupJoinRequestError("conflict");
    throw error;
  });
  if (result.changed) publishNotificationStateChange(targetUserId, "resolved");
  if (result.error) throw new GroupJoinRequestError(result.error as GroupJoinRequestError["code"]);
  return result.request;
}

export async function acceptGroupJoinRequest(database: Database, targetUserId: string, requestId: string) {
  return respondToRequest(database, targetUserId, requestId, "accept");
}

export async function declineGroupJoinRequest(database: Database, targetUserId: string, requestId: string) {
  return respondToRequest(database, targetUserId, requestId, "decline");
}

export async function revokeGroupJoinRequest(database: Database, groupId: string, actorUserId: string, requestId: string) {
  assertGroupId(groupId);
  assertUserId(actorUserId);
  assertRequestId(requestId);
  const result = await database.transaction(async (transaction) => {
    const access = await requireGroupAccess(transaction as Database, groupId, actorUserId);
    access.requireManageParticipants();
    const [request] = await transaction
      .select()
      .from(groupJoinRequests)
      .where(and(eq(groupJoinRequests.id, requestId), eq(groupJoinRequests.groupId, groupId)))
      .limit(1)
      .for("update");
    if (!request) throw new GroupJoinRequestError("not_found");
    if (request.status !== "pending") return { request, changed: false };
    const now = new Date();
    if (isGroupJoinRequestExpired(request.expiresAt, now)) {
      const expired = await transitionPendingRequest(transaction as Database, request, "expired", now);
      return { request: expired ?? request, changed: Boolean(expired) };
    }
    const revoked = await transitionPendingRequest(transaction as Database, request, "revoked", now);
    if (!revoked) throw new GroupJoinRequestError("resolved");
    return { request: revoked, changed: true };
  });
  if (result.changed) publishNotificationStateChange(result.request.targetUserId, "resolved");
  return result.request;
}
