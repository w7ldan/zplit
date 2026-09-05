import "server-only";

import { databaseCode } from "@/server/database-error-code";

import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { getDatabase, type Database } from "@/db/client";
import { friends, groupJoinRequests, groupMemberships, groupParticipants, groups, notifications, users } from "@/db/schema";
import type { GroupJoinRequestSummary } from "@/domain/group-contracts";
import { isGroupJoinRequestExpired, groupJoinRequestExpiresAt, type GroupJoinRequestKind, type GroupJoinRequestStatus } from "@/domain/group-join-requests";
import { normalizeUuid } from "@/domain/record-retrieval";
import { parseUsername } from "@/domain/username";
import { NOTIFICATION_TYPES, type NotificationMetadata } from "@/domain/notifications";
import { requireSession } from "@/auth/require-session";
import { createNotificationInDatabase, publishNotificationStateChange } from "@/server/notifications";
import { searchUsernameDirectoryInDatabase } from "@/server/user-directory";
import { GroupError, lockActiveGroupForOperationalMutation, requireGroupAccess } from "@/server/groups";

export class GroupJoinRequestError extends Error {
  constructor(readonly code: "invalid_id" | "forbidden" | "invalid_target" | "self" | "already_member" | "registered_participant" | "duplicate" | "not_found" | "resolved" | "expired" | "stale_authority" | "participant_not_found" | "already_linked" | "conflict") {
    super(code);
    this.name = "GroupJoinRequestError";
  }
}

export type GroupJoinRequestState = {
  id: string;
  groupId: string;
  kind: GroupJoinRequestKind;
  participantId: string | null;
  status: GroupJoinRequestStatus;
  expiresAt: Date;
};

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

function parseRequestTargetId(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new GroupJoinRequestError("invalid_target");
  return value.trim();
}

function validateRequestTarget(input: { targetUserId?: unknown; username?: unknown }) {
  if (input.targetUserId !== undefined) parseRequestTargetId(input.targetUserId);
  else parseRequestUsername(input.username);
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

async function createRequestOutcomeNotification(database: Database, request: typeof groupJoinRequests.$inferSelect, status: "accepted" | "declined") {
  await createNotificationInDatabase(database, {
    recipientUserId: request.requesterUserId,
    type: request.kind === "member_invitation" ? NOTIFICATION_TYPES.groupInvitationOutcome : NOTIFICATION_TYPES.groupParticipantLinkOutcome,
    metadata: { requestId: request.id, groupId: request.groupId, status },
    dedupeKey: `group-join-request-outcome:${request.id}:${status}`,
  });
}

async function resolveTarget(database: Database, input: { targetUserId?: unknown; username?: unknown }) {
  const targetCondition = input.targetUserId !== undefined
    ? eq(users.id, parseRequestTargetId(input.targetUserId))
    : eq(users.username, parseRequestUsername(input.username));
  const [target] = await database
    .select({ id: users.id, name: users.name, username: users.username })
    .from(users)
    .where(targetCondition)
    .limit(1)
    .for("update");
  return target?.username ? target : null;
}

async function resolveGroupContext(database: Database, groupId: string, requesterUserId: string) {
  const [group] = await database.select({ id: groups.id, name: groups.name, archivedAt: groups.archivedAt }).from(groups).where(eq(groups.id, groupId)).limit(1).for("update");
  const [requester] = await database.select({ name: users.name, username: users.username }).from(users).where(eq(users.id, requesterUserId)).limit(1);
  if (!group || !requester) throw new GroupJoinRequestError("not_found");
  if (group.archivedAt) throw new GroupJoinRequestError("forbidden");
  return { group, requester };
}

async function ensureTargetIsUnrepresented(database: Database, groupId: string, targetUserId: string, kind: GroupJoinRequestKind) {
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
  if (participant && kind !== "member_invitation") throw new GroupJoinRequestError("registered_participant");
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

type CreateRequestInput = {
  groupId: string;
  requesterUserId: string;
  targetUserId?: unknown;
  username?: unknown;
  kind: GroupJoinRequestKind;
  participantId?: string;
};
type RequestParticipant = { id: string; displayName: string | null; label: string | null; userId?: string | null };

async function findParticipantForRequest(database: Database, input: CreateRequestInput): Promise<RequestParticipant | undefined> {
  if (input.kind !== "participant_link") return undefined;
  const [selected] = await database
    .select({ id: groupParticipants.id, displayName: groupParticipants.displayName, label: groupParticipants.label, userId: groupParticipants.userId })
    .from(groupParticipants)
    .where(and(eq(groupParticipants.groupId, input.groupId), eq(groupParticipants.id, input.participantId!)))
    .limit(1);
  if (!selected) throw new GroupJoinRequestError("participant_not_found");
  if (selected.userId) throw new GroupJoinRequestError("already_linked");
  return selected;
}

async function lockParticipantForRequest(database: Database, input: CreateRequestInput, participant: RequestParticipant | undefined) {
  if (input.kind !== "participant_link") return participant;
  const [lockedParticipant] = await database
    .select({ id: groupParticipants.id, displayName: groupParticipants.displayName, label: groupParticipants.label, userId: groupParticipants.userId })
    .from(groupParticipants)
    .where(and(eq(groupParticipants.groupId, input.groupId), eq(groupParticipants.id, input.participantId!)))
    .limit(1)
    .for("update");
  if (!lockedParticipant) throw new GroupJoinRequestError("participant_not_found");
  if (lockedParticipant.userId) throw new GroupJoinRequestError("already_linked");
  return lockedParticipant;
}

function requestMetadata(
  input: CreateRequestInput,
  request: typeof groupJoinRequests.$inferSelect,
  group: { name: string },
  requester: { name: string; username: string | null },
  participant: RequestParticipant | undefined,
): NotificationMetadata["group.invitation"] | NotificationMetadata["group.participant.link.request"] {
  if (input.kind === "member_invitation") {
    return {
      requestId: request.id,
      groupId: input.groupId,
      groupName: group.name,
      requesterDisplayName: requester.name,
      requesterUsername: requester.username,
      expiresAt: request.expiresAt.toISOString(),
    };
  }
  return {
    requestId: request.id,
    groupId: input.groupId,
    groupName: group.name,
    requesterDisplayName: requester.name,
    requesterUsername: requester.username,
    participantDisplayName: participant?.displayName ?? "Participant",
    participantLabel: participant?.label ?? null,
    expiresAt: request.expiresAt.toISOString(),
  };
}

async function createRequestInTransaction(database: Database, input: CreateRequestInput) {
  const access = await requireGroupAccess(database, input.groupId, input.requesterUserId);
  access.requireManageParticipants();
  validateRequestTarget(input);
  const { group, requester } = await resolveGroupContext(database, input.groupId, input.requesterUserId);
  const target = await resolveTarget(database, input);
  if (!target) throw new GroupJoinRequestError("invalid_target");
  if (target.id === input.requesterUserId) throw new GroupJoinRequestError("self");

  let participant = await findParticipantForRequest(database, input);
  const now = new Date();
  await expirePendingForTarget(database, input.groupId, target.id, now);
  if (input.kind === "participant_link") await expirePendingForParticipant(database, input.groupId, input.participantId!, now);
  await ensureTargetIsUnrepresented(database, input.groupId, target.id, input.kind);
  participant = await lockParticipantForRequest(database, input, participant);
  const expiresAt = groupJoinRequestExpiresAt(now);
  const [request] = await database
    .insert(groupJoinRequests)
    .values({ groupId: input.groupId, kind: input.kind, participantId: participant?.id ?? null, participantDisplayNameSnapshot: participant?.displayName ?? null, participantLabelSnapshot: participant?.label ?? null, targetUserId: target.id, requesterUserId: input.requesterUserId, status: "pending", expiresAt, createdAt: now, updatedAt: now })
    .returning();
  if (!request) throw new Error("Group join request was not created");

  await createNotificationInDatabase(database, {
    recipientUserId: target.id,
    type: notificationType(input.kind),
    metadata: requestMetadata(input, request, group, requester, participant),
    dedupeKey: "group-join-request:" + request.id,
  });
  return { request, targetUserId: target.id };
}

async function createRequest(database: Database, input: CreateRequestInput) {
  assertGroupId(input.groupId);
  assertUserId(input.requesterUserId);
  if (input.kind === "participant_link" && !input.participantId) throw new GroupJoinRequestError("participant_not_found");
  if (input.participantId !== undefined && !normalizeUuid(input.participantId)) throw new GroupJoinRequestError("participant_not_found");
  const created = await database.transaction((transaction) => createRequestInTransaction(transaction as Database, input)).catch((error) => {
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
  const [members, pending] = await Promise.all([
    database
      .select({ userId: groupMemberships.userId })
      .from(groupMemberships)
      .where(eq(groupMemberships.groupId, groupId)),
    database
      .select({ userId: groupJoinRequests.targetUserId })
      .from(groupJoinRequests)
      .where(and(
        eq(groupJoinRequests.groupId, groupId),
        eq(groupJoinRequests.status, "pending"),
        gt(groupJoinRequests.expiresAt, new Date()),
      )),
  ]);
  return searchUsernameDirectoryInDatabase(database, query, {
    excludeUserIds: [requesterUserId, ...members.map(({ userId }) => userId), ...pending.map(({ userId }) => userId)],
  });
}

function targetInput(value: unknown) {
  return typeof value === "object" && value !== null && "targetUserId" in value
    ? { targetUserId: (value as { targetUserId: unknown }).targetUserId }
    : { username: value };
}

export async function createGroupInvitation(database: Database, groupId: string, requesterUserId: string, target: unknown) {
  return createRequest(database, { groupId, requesterUserId, ...targetInput(target), kind: "member_invitation" });
}

export async function createGroupParticipantLinkRequest(database: Database, groupId: string, participantId: string, requesterUserId: string, target: unknown) {
  return createRequest(database, { groupId, requesterUserId, ...targetInput(target), kind: "participant_link", participantId });
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
      if (row.targetUsername) active.push({ ...row, kind: row.kind as GroupJoinRequestKind, status: row.status as GroupJoinRequestStatus, targetUsername: row.targetUsername, expiresAt: row.expiresAt.toISOString() });
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

type RequestResponse = {
  request: typeof groupJoinRequests.$inferSelect;
  changed: boolean;
  error?: GroupJoinRequestError["code"];
};

async function resolveNonAcceptance(
  database: Database,
  request: typeof groupJoinRequests.$inferSelect,
  response: "accept" | "decline",
  now: Date,
): Promise<RequestResponse | null> {
  if (isGroupJoinRequestExpired(request.expiresAt, now)) {
    const expired = await transitionPendingRequest(database, request, "expired", now);
    return { request: expired ?? request, changed: Boolean(expired), error: "expired" };
  }
  if (response !== "decline") return null;
  const declined = await transitionPendingRequest(database, request, "declined", now);
  if (!declined) throw new GroupJoinRequestError("resolved");
  await createRequestOutcomeNotification(database, request, "declined");
  return { request: declined, changed: true };
}

async function acceptMemberInvitation(database: Database, request: typeof groupJoinRequests.$inferSelect, targetUserId: string, now: Date): Promise<RequestResponse> {
  const [existingMembership] = await database
    .select({ userId: groupMemberships.userId })
    .from(groupMemberships)
    .where(and(eq(groupMemberships.groupId, request.groupId), eq(groupMemberships.userId, targetUserId)))
    .limit(1)
    .for("update");
  const [registered] = await database
    .select({ id: groupParticipants.id })
    .from(groupParticipants)
    .where(and(eq(groupParticipants.groupId, request.groupId), eq(groupParticipants.userId, targetUserId)))
    .limit(1)
    .for("update");
  if (existingMembership) {
    const revoked = await transitionPendingRequest(database, request, "revoked", now);
    return { request: revoked ?? request, changed: Boolean(revoked), error: "already_member" };
  }
  const [sourceLinked] = registered ? [] : await database
    .select({ id: groupParticipants.id })
    .from(groupParticipants)
    .innerJoin(friends, eq(friends.id, groupParticipants.sourcePersonalFriendId))
    .where(and(
      eq(groupParticipants.groupId, request.groupId),
      isNull(groupParticipants.userId),
      eq(friends.linkedUserId, targetUserId),
    ))
    .limit(1)
    .for("update");
  const participant = registered ?? sourceLinked ?? (await database
    .insert(groupParticipants)
    .values({ groupId: request.groupId, userId: targetUserId, displayName: null, createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .returning({ id: groupParticipants.id }))[0];
  if (!participant) throw new GroupJoinRequestError("conflict");
  if (sourceLinked) {
    const [linked] = await database
      .update(groupParticipants)
      .set({ userId: targetUserId, displayName: null, updatedAt: now })
      .where(and(eq(groupParticipants.groupId, request.groupId), eq(groupParticipants.id, sourceLinked.id), isNull(groupParticipants.userId)))
      .returning({ id: groupParticipants.id });
    if (!linked) throw new GroupJoinRequestError("conflict");
  }
  const [createdMembership] = await database
    .insert(groupMemberships)
    .values({ groupId: request.groupId, userId: targetUserId, participantId: participant.id, role: "member", joinedAt: now })
    .onConflictDoNothing({ target: [groupMemberships.groupId, groupMemberships.userId] })
    .returning();
  if (!createdMembership) {
    if (!registered && !sourceLinked) await database.delete(groupParticipants).where(and(eq(groupParticipants.groupId, request.groupId), eq(groupParticipants.id, participant.id), eq(groupParticipants.userId, targetUserId)));
    const revoked = await transitionPendingRequest(database, request, "revoked", now);
    return { request: revoked ?? request, changed: Boolean(revoked), error: "already_member" };
  }
  const accepted = await transitionPendingRequest(database, request, "accepted", now);
  if (!accepted) throw new GroupJoinRequestError("conflict");
  return { request: accepted, changed: true };
}

async function acceptParticipantLink(database: Database, request: typeof groupJoinRequests.$inferSelect, targetUserId: string, now: Date): Promise<RequestResponse> {
  const [participant] = await database
    .select()
    .from(groupParticipants)
    .where(and(eq(groupParticipants.groupId, request.groupId), eq(groupParticipants.id, request.participantId!)))
    .limit(1)
    .for("update");
  if (!participant) {
    const revoked = await transitionPendingRequest(database, request, "revoked", now);
    return { request: revoked ?? request, changed: Boolean(revoked), error: "participant_not_found" };
  }
  if (participant.userId) {
    const revoked = await transitionPendingRequest(database, request, "revoked", now);
    return { request: revoked ?? request, changed: Boolean(revoked), error: "already_linked" };
  }
  const [existingMembership] = await database
    .select({ userId: groupMemberships.userId })
    .from(groupMemberships)
    .where(and(eq(groupMemberships.groupId, request.groupId), eq(groupMemberships.userId, targetUserId)))
    .limit(1)
    .for("update");
  const [registered] = await database
    .select({ id: groupParticipants.id })
    .from(groupParticipants)
    .where(and(eq(groupParticipants.groupId, request.groupId), eq(groupParticipants.userId, targetUserId)))
    .limit(1)
    .for("update");
  if (existingMembership || registered) {
    const revoked = await transitionPendingRequest(database, request, "revoked", now);
    return { request: revoked ?? request, changed: Boolean(revoked), error: existingMembership ? "already_member" : "registered_participant" };
  }
  const [linked] = await database
    .update(groupParticipants)
    .set({ userId: targetUserId, displayName: null, updatedAt: now })
    .where(and(eq(groupParticipants.groupId, request.groupId), eq(groupParticipants.id, participant.id), isNull(groupParticipants.userId)))
    .returning({ id: groupParticipants.id });
  if (!linked) throw new GroupJoinRequestError("conflict");
  const [createdMembership] = await database
    .insert(groupMemberships)
    .values({ groupId: request.groupId, userId: targetUserId, participantId: participant.id, role: "member", joinedAt: now })
    .onConflictDoNothing({ target: [groupMemberships.groupId, groupMemberships.userId] })
    .returning();
  if (!createdMembership) {
    await database.update(groupParticipants).set({ userId: null, displayName: participant.displayName, updatedAt: now }).where(and(eq(groupParticipants.groupId, request.groupId), eq(groupParticipants.id, participant.id), eq(groupParticipants.userId, targetUserId)));
    const revoked = await transitionPendingRequest(database, request, "revoked", now);
    return { request: revoked ?? request, changed: Boolean(revoked), error: "already_member" };
  }
  const accepted = await transitionPendingRequest(database, request, "accepted", now);
  if (!accepted) throw new GroupJoinRequestError("conflict");
  return { request: accepted, changed: true };
}

async function respondToRequestInTransaction(database: Database, targetUserId: string, requestId: string, response: "accept" | "decline"): Promise<RequestResponse> {
  let request: typeof groupJoinRequests.$inferSelect | undefined;
  let archived = false;
  let referenceWasPending = false;
  if (response === "accept") {
    const [reference] = await database
      .select()
      .from(groupJoinRequests)
      .where(and(eq(groupJoinRequests.id, requestId), eq(groupJoinRequests.targetUserId, targetUserId)))
      .limit(1);
    if (!reference) throw new GroupJoinRequestError("not_found");
    referenceWasPending = reference.status === "pending";
    try {
      await lockActiveGroupForOperationalMutation(database, reference.groupId);
    } catch (error) {
      if (error instanceof GroupError && error.code === "archived") archived = true;
      else throw error;
    }
    [request] = await database
      .select()
      .from(groupJoinRequests)
      .where(and(eq(groupJoinRequests.id, requestId), eq(groupJoinRequests.targetUserId, targetUserId)))
      .limit(1)
      .for("update");
  } else {
    [request] = await database
      .select()
      .from(groupJoinRequests)
      .where(and(eq(groupJoinRequests.id, requestId), eq(groupJoinRequests.targetUserId, targetUserId)))
      .limit(1)
      .for("update");
  }
  if (!request) throw new GroupJoinRequestError("not_found");
  if (request.status !== "pending") return { request, changed: false, error: archived && referenceWasPending ? "resolved" : undefined };
  const now = new Date();
  if (archived) {
    const revoked = await transitionPendingRequest(database, request, "revoked", now);
    return { request: revoked ?? request, changed: Boolean(revoked), error: "resolved" };
  }
  const nonAcceptance = await resolveNonAcceptance(database, request, response, now);
  if (nonAcceptance) return nonAcceptance;
  if (!await currentRequesterHasAuthority(database, request.groupId, request.requesterUserId)) {
    const revoked = await transitionPendingRequest(database, request, "revoked", now);
    return { request: revoked ?? request, changed: Boolean(revoked), error: "stale_authority" };
  }
  const result = request.kind === "member_invitation"
    ? acceptMemberInvitation(database, request, targetUserId, now)
    : acceptParticipantLink(database, request, targetUserId, now);
  const resolved = await result;
  if (resolved.request.status === "accepted" || resolved.request.status === "declined") {
    await createRequestOutcomeNotification(database, request, resolved.request.status);
  }
  return resolved;
}

async function respondToRequest(database: Database, targetUserId: string, requestId: string, response: "accept" | "decline") {
  assertUserId(targetUserId);
  assertRequestId(requestId);
  const result = await database.transaction((transaction) => respondToRequestInTransaction(transaction as Database, targetUserId, requestId, response)).catch((error) => {
    if (databaseCode(error) === "23505") throw new GroupJoinRequestError("conflict");
    throw error;
  });
  if (result.changed) publishNotificationStateChange(targetUserId, "resolved");
  if (result.changed && (result.request.status === "accepted" || result.request.status === "declined")) publishNotificationStateChange(result.request.requesterUserId, "created");
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
