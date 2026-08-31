import "server-only";

import { and, asc, eq, gt, isNull, or } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  friendConnections,
  friends,
  groupJoinRequests,
  groupMemberships,
  groupParticipants,
  ledgerScopes,
  organizationInvitations,
  organizationMemberships,
  organizationParticipants,
  users,
} from "@/db/schema";
import { normalizeUsername } from "@/domain/username";
import type {
  PersonalFriendCandidate,
  RegisteredFriendCandidate,
} from "@/domain/collaboration-candidates";
import { getPersonalLedgerScopeId } from "@/server/ledger-scopes";

export type CollaborationCandidateTarget =
  | { kind: "organization"; id: string }
  | { kind: "group"; id: string }
  | { kind: "organization_expense_contact"; id: string };

type FriendCandidateRow = {
  personalFriendId: string;
  userId: string | null;
  friendDisplayName: string;
  linkedDisplayName: string | null;
  username: string | null;
  archivedAt: Date | null;
};

type ConnectionRow = {
  userAId: string;
  userBId: string;
  status: string;
};

type RepresentedOrganizationFriends = {
  sourcePersonalFriendIds: Set<string>;
  userIds: Set<string>;
};

type RepresentedOrganizationParticipants = {
  sourcePersonalFriendIds: Set<string>;
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
  if (target.kind === "organization_expense_contact") return new Set<string>();
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

  const [members, pending] = await Promise.all([
    database
      .select({ userId: groupMemberships.userId })
      .from(groupMemberships)
      .where(eq(groupMemberships.groupId, target.id)),
    database
      .select({ userId: groupJoinRequests.targetUserId })
      .from(groupJoinRequests)
      .where(and(
        eq(groupJoinRequests.groupId, target.id),
        eq(groupJoinRequests.status, "pending"),
        gt(groupJoinRequests.expiresAt, now),
      )),
  ]);
  return new Set([...members, ...pending].map(({ userId }) => userId));
}

async function representedGroupFriends(database: Database, target: CollaborationCandidateTarget) {
  if (target.kind !== "group") return new Set<string>();
  const rows = await database
    .select({ personalFriendId: groupParticipants.sourcePersonalFriendId })
    .from(groupParticipants)
    .where(eq(groupParticipants.groupId, target.id));
  return new Set(rows.flatMap(({ personalFriendId }) => personalFriendId ? [personalFriendId] : []));
}

async function getRepresentedOrganizationParticipants(database: Database, target: CollaborationCandidateTarget): Promise<RepresentedOrganizationParticipants> {
  if (target.kind !== "organization") return { sourcePersonalFriendIds: new Set<string>() };
  const rows = await database
    .select({ sourcePersonalFriendId: organizationParticipants.sourcePersonalFriendId })
    .from(organizationParticipants)
    .where(eq(organizationParticipants.organizationId, target.id));
  return {
    sourcePersonalFriendIds: new Set(rows.flatMap(({ sourcePersonalFriendId }) => sourcePersonalFriendId ? [sourcePersonalFriendId] : [])),
  };
}

async function representedOrganizationFriends(database: Database, target: CollaborationCandidateTarget): Promise<RepresentedOrganizationFriends> {
  if (target.kind !== "organization_expense_contact") {
    return {
      sourcePersonalFriendIds: new Set<string>(),
      userIds: new Set<string>(),
    };
  }
  const rows = await database
    .select({ sourcePersonalFriendId: friends.sourcePersonalFriendId, userId: friends.linkedUserId })
    .from(friends)
    .innerJoin(ledgerScopes, eq(ledgerScopes.id, friends.ledgerScopeId))
    .where(and(
      eq(ledgerScopes.kind, "organization"),
      eq(ledgerScopes.organizationId, target.id),
      isNull(friends.archivedAt),
    ));
  return {
    sourcePersonalFriendIds: new Set(rows.flatMap(({ sourcePersonalFriendId }) => (
      sourcePersonalFriendId ? [sourcePersonalFriendId] : []
    ))),
    userIds: new Set(rows.flatMap(({ userId }) => userId ? [userId] : [])),
  };
}

function matchesUsername(friend: FriendCandidateRow, usernameQuery: string) {
  return !usernameQuery || (friend.username !== null && friend.username.startsWith(usernameQuery));
}

function matchesQuery(friend: FriendCandidateRow, query: unknown) {
  if (typeof query !== "string" || !query.trim()) return true;
  const text = query.trim().toLowerCase();
  const username = normalizeUsername(query);
  return friend.friendDisplayName.toLowerCase().includes(text)
    || (friend.linkedDisplayName?.toLowerCase().includes(text) ?? false)
    || matchesUsername(friend, username);
}

function registeredFriendIsEligible(
  friend: FriendCandidateRow,
  ownerUserId: string,
  target: CollaborationCandidateTarget,
  connected: Set<string>,
  excludedUsers: Set<string>,
  representedOrganizationContacts: RepresentedOrganizationFriends,
  seenUsers: Set<string>,
) {
  const userId = friend.userId;
  if (!userId) return false;
  return userId !== ownerUserId
    && friend.username !== null
    && connected.has(userId)
    && !excludedUsers.has(userId)
    && !(target.kind === "organization_expense_contact" && representedOrganizationContacts.userIds.has(userId))
    && !seenUsers.has(userId);
}

function localFriendIsEligible(
  friend: FriendCandidateRow,
  target: CollaborationCandidateTarget,
  representedFriends: Set<string>,
  representedOrganizationParticipants: RepresentedOrganizationParticipants,
  representedOrganizationContacts: RepresentedOrganizationFriends,
) {
  return !(target.kind === "group" && representedFriends.has(friend.personalFriendId))
    && !(target.kind === "organization" && representedOrganizationParticipants.sourcePersonalFriendIds.has(friend.personalFriendId))
    && !(target.kind === "organization_expense_contact" && representedOrganizationContacts.sourcePersonalFriendIds.has(friend.personalFriendId));
}

function friendIsEligible(
  friend: FriendCandidateRow,
  ownerUserId: string,
  target: CollaborationCandidateTarget,
  usernameQuery: string,
  connected: Set<string>,
  excludedUsers: Set<string>,
  representedFriends: Set<string>,
  representedOrganizationParticipants: RepresentedOrganizationParticipants,
  representedOrganizationContacts: RepresentedOrganizationFriends,
  seenUsers: Set<string>,
) {
  if (!friend.personalFriendId || friend.archivedAt !== null || !matchesQuery(friend, usernameQuery)) return false;
  return friend.userId
    ? registeredFriendIsEligible(friend, ownerUserId, target, connected, excludedUsers, representedOrganizationContacts, seenUsers)
    : localFriendIsEligible(friend, target, representedFriends, representedOrganizationParticipants, representedOrganizationContacts);
}

export async function listPersonalFriendCandidates(
  database: Database,
  ownerUserId: string,
  target: CollaborationCandidateTarget,
  query?: unknown,
): Promise<PersonalFriendCandidate[]> {
  const scopeId = await getPersonalLedgerScopeId(database, ownerUserId);
  const now = new Date();
  const [
    friendRows,
    connectionRows,
    excludedUsers,
    representedFriends,
    representedOrganizationParticipants,
    representedOrganizationContacts,
  ] = await Promise.all([
    database
      .select({
        personalFriendId: friends.id,
        userId: friends.linkedUserId,
        friendDisplayName: friends.name,
        linkedDisplayName: users.name,
        username: users.username,
        archivedAt: friends.archivedAt,
      })
      .from(friends)
      .leftJoin(users, eq(users.id, friends.linkedUserId))
      .where(and(eq(friends.ledgerScopeId, scopeId), isNull(friends.archivedAt)))
      .orderBy(asc(friends.name), asc(users.name), asc(users.username), asc(users.id)),
    database
      .select({
        userAId: friendConnections.userAId,
        userBId: friendConnections.userBId,
        status: friendConnections.status,
      })
      .from(friendConnections)
      .where(or(eq(friendConnections.userAId, ownerUserId), eq(friendConnections.userBId, ownerUserId))),
    excludedTargetUsers(database, target, now),
    representedGroupFriends(database, target),
    getRepresentedOrganizationParticipants(database, target),
    representedOrganizationFriends(database, target),
  ]);
  const connected = connectedUserIds(ownerUserId, connectionRows as ConnectionRow[]);
  const usernameQuery = normalizeUsername(query);
  const seenUsers = new Set<string>();

  return (friendRows as FriendCandidateRow[]).flatMap((friend) => {
    if (!friendIsEligible(
      friend,
      ownerUserId,
      target,
      usernameQuery,
      connected,
      excludedUsers,
      representedFriends,
      representedOrganizationParticipants,
      representedOrganizationContacts,
      seenUsers,
    )) return [];
    if (friend.userId) seenUsers.add(friend.userId);
    return [{
      personalFriendId: friend.personalFriendId,
      kind: friend.userId ? "registered" : "local",
      userId: friend.userId,
      displayName: friend.linkedDisplayName ?? friend.friendDisplayName,
      username: friend.username,
      label: null,
    }];
  });
}

export async function listRegisteredFriendCandidates(
  database: Database,
  ownerUserId: string,
  target: CollaborationCandidateTarget,
  query?: unknown,
): Promise<RegisteredFriendCandidate[]> {
  const candidates = await listPersonalFriendCandidates(database, ownerUserId, target, query);
  return candidates.flatMap((candidate) => candidate.kind === "registered" && candidate.userId && candidate.username
    ? [{ userId: candidate.userId, displayName: candidate.displayName, username: candidate.username }]
    : []);
}
