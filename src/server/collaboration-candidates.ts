import "server-only";

import { and, asc, eq, gt, isNotNull, isNull, or } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  friendConnections,
  friends,
  groupJoinRequests,
  groupParticipants,
  organizationInvitations,
  organizationMemberships,
  users,
} from "@/db/schema";
import { normalizeUsername } from "@/domain/username";
import type { RegisteredFriendCandidate } from "@/domain/collaboration-candidates";
import { getPersonalLedgerScopeId } from "@/server/ledger-scopes";

export type CollaborationCandidateTarget =
  | { kind: "organization"; id: string }
  | { kind: "group"; id: string };

type FriendCandidateRow = {
  userId: string | null;
  displayName: string;
  username: string | null;
  archivedAt: Date | null;
};

type ConnectionRow = {
  userAId: string;
  userBId: string;
  status: string;
};

function connectedUserIds(userId: string, rows: ConnectionRow[]) {
  const connected = new Set<string>();
  for (const row of rows) {
    if (row.status !== "connected") continue;
    if (row.userAId === userId) connected.add(row.userBId);
    if (row.userBId === userId) connected.add(row.userAId);
  }
  return connected;
}

async function excludedTargetUsers(database: Database, target: CollaborationCandidateTarget, now: Date) {
  if (target.kind === "organization") {
    const [members, pending] = await Promise.all([
      database
        .select({ userId: organizationMemberships.userId })
        .from(organizationMemberships)
        .where(eq(organizationMemberships.organizationId, target.id)),
      database
        .select({ userId: organizationInvitations.targetUserId })
        .from(organizationInvitations)
        .where(and(
          eq(organizationInvitations.organizationId, target.id),
          eq(organizationInvitations.status, "pending"),
          gt(organizationInvitations.expiresAt, now),
        )),
    ]);
    return new Set([...members, ...pending].map(({ userId }) => userId));
  }

  const [participants, pending] = await Promise.all([
    database
      .select({ userId: groupParticipants.userId })
      .from(groupParticipants)
      .where(and(eq(groupParticipants.groupId, target.id), isNotNull(groupParticipants.userId))),
    database
      .select({ userId: groupJoinRequests.targetUserId })
      .from(groupJoinRequests)
      .where(and(
        eq(groupJoinRequests.groupId, target.id),
        eq(groupJoinRequests.status, "pending"),
        gt(groupJoinRequests.expiresAt, now),
      )),
  ]);
  return new Set([...participants, ...pending].map(({ userId }) => userId));
}

export async function listRegisteredFriendCandidates(
  database: Database,
  ownerUserId: string,
  target: CollaborationCandidateTarget,
  query?: unknown,
): Promise<RegisteredFriendCandidate[]> {
  const scopeId = await getPersonalLedgerScopeId(database, ownerUserId);
  const now = new Date();
  const [friendRows, connectionRows, excludedUsers] = await Promise.all([
    database
      .select({
        userId: friends.linkedUserId,
        displayName: users.name,
        username: users.username,
        archivedAt: friends.archivedAt,
      })
      .from(friends)
      .innerJoin(users, eq(users.id, friends.linkedUserId))
      .where(and(
        eq(friends.ledgerScopeId, scopeId),
        isNull(friends.archivedAt),
        isNotNull(friends.linkedUserId),
      ))
      .orderBy(asc(users.name), asc(users.username), asc(users.id)),
    database
      .select({
        userAId: friendConnections.userAId,
        userBId: friendConnections.userBId,
        status: friendConnections.status,
      })
      .from(friendConnections)
      .where(or(eq(friendConnections.userAId, ownerUserId), eq(friendConnections.userBId, ownerUserId))),
    excludedTargetUsers(database, target, now),
  ]);
  const connected = connectedUserIds(ownerUserId, connectionRows);
  const usernameQuery = normalizeUsername(query);
  const seen = new Set<string>();

  return (friendRows as FriendCandidateRow[]).flatMap((friend) => {
    if (
      !friend.userId ||
      friend.userId === ownerUserId ||
      friend.archivedAt !== null ||
      !friend.username ||
      !connected.has(friend.userId) ||
      excludedUsers.has(friend.userId) ||
      (usernameQuery && !friend.username.startsWith(usernameQuery)) ||
      seen.has(friend.userId)
    ) {
      return [];
    }
    seen.add(friend.userId);
    return [{ userId: friend.userId, displayName: friend.displayName, username: friend.username }];
  });
}
