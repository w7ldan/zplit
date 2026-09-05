import "server-only";

import { databaseCode } from "@/server/database-error-code";

import { and, asc, count, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  chatMessages,
  friends,
  groupAvatars,
  groupExpenseLifecycleEvents,
  groupExpenseReceipts,
  groupExpenseShares,
  groupExpenses,
  groupJoinRequests,
  groupMemberships,
  groupObligations,
  groupOffsetApplications,
  groupOffsetSettlements,
  groupParticipants,
  groupSettlementApplications,
  groupSettlementProofs,
  groupSettlements,
  groups,
  users,
} from "@/db/schema";
import type { GroupAvatarMetadata, GroupCapabilities, GroupDetail, GroupParticipant, GroupSummary } from "@/domain/group-contracts";
import { calculateGroupBalances } from "@/domain/group-accounting";
import { groupAccessForRole, isGroupRole, type GroupRole } from "@/domain/group-permissions";
import { normalizeUuid } from "@/domain/record-retrieval";
import { getPersonalLedgerScopeId } from "@/server/ledger-scopes";
import { publishNotificationStateChange } from "@/server/notifications";

export type { GroupRole } from "@/domain/group-permissions";
export class GroupError extends Error {
  constructor(readonly code:
    | "not_found"
    | "invalid_id"
    | "invalid_input"
    | "not_member"
    | "forbidden"
    | "participant_not_found"
    | "registered_participant"
    | "personal_friend_not_found"
    | "registered_personal_friend"
    | "owner_required"
    | "archived"
    | "financial_history") {
    super(code);
    this.name = "GroupError";
  }
}

function assertGroupId(groupId: string) {
  if (!normalizeUuid(groupId)) throw new GroupError("invalid_id");
}

function cleanInput(input: { name: string; description?: string | null }) {
  const name = input.name.trim();
  const description = input.description?.trim() || null;
  if (!name || name.length > 160 || (description && description.length > 1000)) throw new GroupError("invalid_input");
  return { name, description };
}

function cleanParticipantInput(input: { displayName: string; label?: string | null }) {
  const displayName = input.displayName.trim();
  const label = input.label?.trim() || null;
  if (!displayName || displayName.length > 160 || (label && label.length > 120)) throw new GroupError("invalid_input");
  return { displayName, label };
}

function avatarSelection() {
  return { mediaType: groupAvatars.mediaType, byteSize: groupAvatars.byteSize, sha256: groupAvatars.sha256 };
}

function mapAvatar(avatar: { mediaType: string; byteSize: number; sha256: string } | null | undefined): GroupAvatarMetadata | null {
  return avatar ? { mediaType: "image/webp", byteSize: avatar.byteSize, sha256: avatar.sha256 } : null;
}

export type GroupAccess = ReturnType<typeof groupAccessForRole> & {
  role: GroupRole;
  requireManageGroup(): void;
  requireManageParticipants(): void;
  requireManageRoles(): void;
  requireDelete(): void;
};

function toGroupCapabilities(access: GroupAccess): GroupCapabilities {
  return {
    isOwner: access.isOwner,
    canManageGroup: access.canManageGroup,
    canManageParticipants: access.canManageParticipants,
    canManageRoles: access.canManageRoles,
    canDelete: access.canDelete,
  };
}

export async function requireGroupAccess(database: Database, groupId: string, userId: string): Promise<GroupAccess> {
  assertGroupId(groupId);
  const [membership] = await database
    .select({ role: groupMemberships.role })
    .from(groupMemberships)
    .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, userId)))
    .limit(1);
  if (!membership) throw new GroupError("not_member");
  if (!isGroupRole(membership.role)) throw new GroupError("forbidden");
  const access = groupAccessForRole(membership.role);
  return {
    ...access,
    role: membership.role,
    requireManageGroup: () => { if (!access.canManageGroup) throw new GroupError("forbidden"); },
    requireManageParticipants: () => { if (!access.canManageParticipants) throw new GroupError("forbidden"); },
    requireManageRoles: () => { if (!access.canManageRoles) throw new GroupError("forbidden"); },
    requireDelete: () => { if (!access.canDelete) throw new GroupError("forbidden"); },
  };
}

async function requireLockedGroupAccess(database: Database, groupId: string, userId: string) {
  const [membership] = await database
    .select({ userId: groupMemberships.userId })
    .from(groupMemberships)
    .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, userId)))
    .limit(1)
    .for("update");
  if (!membership) throw new GroupError("not_member");
  const access = await requireGroupAccess(database, groupId, userId);
  access.requireManageParticipants();
  return access;
}

export type GroupListScope = "active" | "archived" | "all";

async function getGroupLifecycle(database: Database, groupId: string) {
  const [row] = await database
    .select({ id: groups.id, archivedAt: groups.archivedAt })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  return row ?? null;
}

export async function assertGroupActiveForOperationalMutation(database: Database, groupId: string) {
  const row = await getGroupLifecycle(database, groupId);
  if (!row) throw new GroupError("not_found");
  if (row.archivedAt) throw new GroupError("archived");
}

export async function listGroups(database: Database, userId: string, limit?: number, scope: GroupListScope = "active"): Promise<GroupSummary[]> {
  const archivedFilter = scope === "active"
    ? isNull(groups.archivedAt)
    : scope === "archived"
      ? sql`${groups.archivedAt} IS NOT NULL`
      : undefined;
  const query = database
    .select({
      id: groups.id,
      name: groups.name,
      description: groups.description,
      role: groupMemberships.role,
      participantCount: sql<number>`(select count(*) from group_participants participants where participants.group_id = ${groups.id})`.mapWith(Number),
      avatar: avatarSelection(),
      archivedAt: groups.archivedAt,
    })
    .from(groupMemberships)
    .innerJoin(groups, eq(groups.id, groupMemberships.groupId))
    .leftJoin(groupAvatars, eq(groupAvatars.groupId, groups.id))
    .where(archivedFilter ? and(eq(groupMemberships.userId, userId), archivedFilter) : eq(groupMemberships.userId, userId))
    .orderBy(asc(groups.name), asc(groups.id));
  const rows = await (limit === undefined ? query : query.limit(limit));
  return rows.map((row) => ({ ...row, role: row.role as GroupRole, participantCount: Number(row.participantCount), avatar: mapAvatar(row.avatar), archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null }));
}

export type GroupOverviewSummary = GroupSummary & {
  youOwe: number;
  owedToYou: number;
};

export async function listGroupOverviewSummaries(
  database: Database,
  userId: string,
  limit = 4,
): Promise<GroupOverviewSummary[]> {
  const groupsForOverview = await listGroups(database, userId, limit);
  if (groupsForOverview.length === 0) return [];
  const groupIds = groupsForOverview.map(({ id }) => id);
  const [memberships, obligations, settlements] = await Promise.all([
    database
      .select({
        groupId: groupMemberships.groupId,
        participantId: groupMemberships.participantId,
      })
      .from(groupMemberships)
      .where(and(eq(groupMemberships.userId, userId), inArray(groupMemberships.groupId, groupIds))),
    database
      .select({
        groupId: groupObligations.groupId,
        debtorParticipantId: groupObligations.debtorParticipantId,
        creditorParticipantId: groupObligations.creditorParticipantId,
        originalAmount: groupObligations.originalAmount,
      })
      .from(groupObligations)
      .where(and(inArray(groupObligations.groupId, groupIds), isNull(groupObligations.voidedAt))),
    database
      .select({
        groupId: groupSettlements.groupId,
        senderParticipantId: groupSettlements.senderParticipantId,
        recipientParticipantId: groupSettlements.recipientParticipantId,
        amount: groupSettlements.amount,
        state: groupSettlements.state,
      })
      .from(groupSettlements)
      .where(inArray(groupSettlements.groupId, groupIds)),
  ]);
  const participantByGroup = new Map(memberships.map(({ groupId, participantId }) => [groupId, participantId]));
  const obligationsByGroup = new Map<string, typeof obligations>();
  const settlementsByGroup = new Map<string, typeof settlements>();
  for (const obligation of obligations) {
    const groupObligations = obligationsByGroup.get(obligation.groupId) ?? [];
    groupObligations.push(obligation);
    obligationsByGroup.set(obligation.groupId, groupObligations);
  }
  for (const settlement of settlements) {
    const groupSettlements = settlementsByGroup.get(settlement.groupId) ?? [];
    groupSettlements.push(settlement);
    settlementsByGroup.set(settlement.groupId, groupSettlements);
  }
  return groupsForOverview.map((group) => {
    const participantId = participantByGroup.get(group.id);
    const balances = calculateGroupBalances(obligationsByGroup.get(group.id) ?? [], settlementsByGroup.get(group.id) ?? []);
    let youOwe = 0;
    let owedToYou = 0;
    for (const balance of balances) {
      if (balance.debtorParticipantId === participantId) youOwe += balance.amount;
      if (balance.creditorParticipantId === participantId) owedToYou += balance.amount;
    }
    return {
      ...group,
      youOwe,
      owedToYou,
    };
  });
}

export async function getGroupForMember(database: Database, groupId: string, userId: string): Promise<GroupDetail> {
  const access = await requireGroupAccess(database, groupId, userId);
  const [row] = await database
    .select({ id: groups.id, name: groups.name, description: groups.description, role: groupMemberships.role, avatar: avatarSelection(), archivedAt: groups.archivedAt })
    .from(groupMemberships)
    .innerJoin(groups, eq(groups.id, groupMemberships.groupId))
    .leftJoin(groupAvatars, eq(groupAvatars.groupId, groups.id))
    .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, userId)))
    .limit(1);
  if (!row) throw new GroupError("not_found");
  const [participantCounts] = await database
    .select({ memberCount: sql<number>`count(*) filter (where ${groupParticipants.userId} is not null)`.mapWith(Number), externalParticipantCount: sql<number>`count(*) filter (where ${groupParticipants.userId} is null)`.mapWith(Number), participantCount: count() })
    .from(groupParticipants)
    .where(eq(groupParticipants.groupId, groupId));
  const [memberCounts] = await database.select({ memberCount: count() }).from(groupMemberships).where(eq(groupMemberships.groupId, groupId));
  return {
    ...row,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    participantCount: Number(participantCounts?.participantCount ?? 0),
    memberCount: Number(memberCounts?.memberCount ?? 0),
    externalParticipantCount: Number(participantCounts?.externalParticipantCount ?? 0),
    avatar: mapAvatar(row.avatar),
    ...toGroupCapabilities(access),
    role: row.role as GroupRole,
  };
}

export async function listGroupParticipants(database: Database, groupId: string, userId: string): Promise<GroupParticipant[]> {
  await requireGroupAccess(database, groupId, userId);
  const rows = await database
    .select({ id: groupParticipants.id, userId: groupParticipants.userId, externalName: groupParticipants.displayName, label: groupParticipants.label, userName: users.name, role: groupMemberships.role })
    .from(groupParticipants)
    .leftJoin(users, eq(users.id, groupParticipants.userId))
    .leftJoin(groupMemberships, and(eq(groupMemberships.groupId, groupParticipants.groupId), eq(groupMemberships.userId, groupParticipants.userId)))
    .where(eq(groupParticipants.groupId, groupId))
    .orderBy(asc(groupParticipants.userId), asc(groupParticipants.displayName), asc(groupParticipants.id));
  return rows.map((row) => ({ id: row.id, userId: row.userId, displayName: row.userName ?? row.externalName ?? "Participant", label: row.label, role: row.role && isGroupRole(row.role) ? row.role : null, isExternal: row.userId === null, isFormer: row.userId !== null && row.role === null }));
}

export async function createGroup(database: Database, userId: string, input: { name: string; description?: string | null; avatar?: { mediaType: "image/webp"; byteSize: number; sha256: string; content: Uint8Array } }) {
  const values = cleanInput(input);
  return database.transaction(async (transaction) => {
    const [group] = await transaction.insert(groups).values({ ...values, createdByUserId: userId }).returning();
    if (!group) throw new Error("Group was not created");
    const [participant] = await transaction.insert(groupParticipants).values({ groupId: group.id, userId }).returning({ id: groupParticipants.id });
    if (!participant) throw new Error("Group participant was not created");
    await transaction.insert(groupMemberships).values({ groupId: group.id, userId, participantId: participant.id, role: "owner" });
    if (input.avatar) await transaction.insert(groupAvatars).values({ ...input.avatar, groupId: group.id, content: Buffer.from(input.avatar.content) });
    return group;
  });
}

export async function updateGroup(database: Database, groupId: string, userId: string, input: { name: string; description?: string | null }) {
  assertGroupId(groupId);
  const access = await requireGroupAccess(database, groupId, userId);
  access.requireManageGroup();
  await assertGroupActiveForOperationalMutation(database, groupId);
  const [group] = await database.update(groups).set({ ...cleanInput(input), updatedAt: new Date() }).where(eq(groups.id, groupId)).returning();
  if (!group) throw new GroupError("not_found");
  return group;
}

export async function deleteGroup(database: Database, groupId: string, userId: string) {
  assertGroupId(groupId);
  return database.transaction(async (transaction) => {
    const transactionalDatabase = transaction as Database;
    const access = await requireGroupAccess(transactionalDatabase, groupId, userId);
    access.requireDelete();
    if (await hasFinancialHistory(transactionalDatabase, groupId)) throw new GroupError("financial_history");
    try {
      const deleted = await transaction.delete(groups).where(eq(groups.id, groupId)).returning({ id: groups.id });
      if (deleted.length === 0) throw new GroupError("not_found");
      return true;
    } catch (error) {
      if (error instanceof GroupError) throw error;
      if (databaseCode(error, true) === "23503") throw new GroupError("financial_history");
      throw error;
    }
  });
}

export async function archiveGroup(database: Database, groupId: string, userId: string) {
  assertGroupId(groupId);
  return database.transaction(async (transaction) => {
    const transactionalDatabase = transaction as Database;
    const access = await requireGroupAccess(transactionalDatabase, groupId, userId);
    access.requireDelete();
    const [row] = await transaction
      .select({ id: groups.id, archivedAt: groups.archivedAt })
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1)
      .for("update");
    if (!row) throw new GroupError("not_found");
    if (row.archivedAt) return row;
    const now = new Date();
    const [archived] = await transaction
      .update(groups)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(groups.id, groupId))
      .returning();
    if (!archived) throw new GroupError("not_found");
    await transaction
      .update(groupJoinRequests)
      .set({ status: "revoked", revokedAt: now, updatedAt: now })
      .where(and(eq(groupJoinRequests.groupId, groupId), eq(groupJoinRequests.status, "pending")));
    return archived;
  });
}

export async function restoreGroup(database: Database, groupId: string, userId: string) {
  assertGroupId(groupId);
  return database.transaction(async (transaction) => {
    const transactionalDatabase = transaction as Database;
    const access = await requireGroupAccess(transactionalDatabase, groupId, userId);
    access.requireDelete();
    const [row] = await transaction
      .select({ id: groups.id, archivedAt: groups.archivedAt })
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1)
      .for("update");
    if (!row) throw new GroupError("not_found");
    if (!row.archivedAt) return row;
    const [restored] = await transaction
      .update(groups)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(eq(groups.id, groupId))
      .returning();
    if (!restored) throw new GroupError("not_found");
    return restored;
  });
}

export async function createExternalParticipant(database: Database, groupId: string, userId: string, input: { displayName: string; label?: string | null }) {
  assertGroupId(groupId);
  const access = await requireGroupAccess(database, groupId, userId);
  access.requireManageParticipants();
  await assertGroupActiveForOperationalMutation(database, groupId);
  const [participant] = await database.insert(groupParticipants).values({ groupId, ...cleanParticipantInput(input) }).returning();
  if (!participant) throw new Error("External participant was not created");
  return participant;
}

export async function addPersonalFriendAsGroupParticipant(
  database: Database,
  groupId: string,
  actorUserId: string,
  personalFriendId: string,
) {
  assertGroupId(groupId);
  if (!normalizeUuid(personalFriendId)) throw new GroupError("personal_friend_not_found");
  return database.transaction(async (transaction) => {
    const transactionalDatabase = transaction as Database;
    await requireLockedGroupAccess(transactionalDatabase, groupId, actorUserId);
    await assertGroupActiveForOperationalMutation(transactionalDatabase, groupId);
    const personalScopeId = await getPersonalLedgerScopeId(transactionalDatabase, actorUserId);
    const [friend] = await transaction
      .select({ id: friends.id, name: friends.name, linkedUserId: friends.linkedUserId, archivedAt: friends.archivedAt })
      .from(friends)
      .where(and(eq(friends.ledgerScopeId, personalScopeId), eq(friends.id, personalFriendId)))
      .limit(1)
      .for("update");
    if (!friend || friend.archivedAt) throw new GroupError("personal_friend_not_found");
    if (friend.linkedUserId) throw new GroupError("registered_personal_friend");

    const [existing] = await transaction
      .select()
      .from(groupParticipants)
      .where(and(eq(groupParticipants.groupId, groupId), eq(groupParticipants.sourcePersonalFriendId, friend.id)))
      .limit(1)
      .for("update");
    if (existing) return existing;

    const [participant] = await transaction
      .insert(groupParticipants)
      .values({
        groupId,
        displayName: cleanParticipantInput({ displayName: friend.name }).displayName,
        sourcePersonalFriendId: friend.id,
      })
      .onConflictDoNothing()
      .returning();
    if (participant) return participant;
    const [existingParticipant] = await transaction
      .select()
      .from(groupParticipants)
      .where(and(eq(groupParticipants.groupId, groupId), eq(groupParticipants.sourcePersonalFriendId, friend.id)))
      .limit(1)
      .for("update");
    if (!existingParticipant) throw new Error("External participant was not created");
    return existingParticipant;
  });
}

async function getParticipant(database: Database, groupId: string, participantId: string) {
  const [participant] = await database.select().from(groupParticipants).where(and(eq(groupParticipants.groupId, groupId), eq(groupParticipants.id, participantId))).limit(1);
  if (!participant) throw new GroupError("participant_not_found");
  return participant;
}

async function revokePendingParticipantLinks(database: Database, groupId: string, participantId: string, now: Date) {
  return database
    .update(groupJoinRequests)
    .set({ status: "revoked", revokedAt: now, updatedAt: now })
    .where(and(eq(groupJoinRequests.groupId, groupId), eq(groupJoinRequests.participantId, participantId), eq(groupJoinRequests.kind, "participant_link"), eq(groupJoinRequests.status, "pending")))
    .returning({ targetUserId: groupJoinRequests.targetUserId });
}

export async function hasFinancialHistory(database: Database, groupId: string, participantId?: string) {
  const expenseFilter = participantId === undefined ? eq(groupExpenses.groupId, groupId) : and(eq(groupExpenses.groupId, groupId), or(eq(groupExpenses.creatorParticipantId, participantId), eq(groupExpenses.payerParticipantId, participantId)));
  const [expense] = await database
    .select({ id: groupExpenses.id })
    .from(groupExpenses)
    .where(expenseFilter)
    .limit(1);
  if (expense) return true;
  const shareFilter = participantId === undefined ? eq(groupExpenseShares.groupId, groupId) : and(eq(groupExpenseShares.groupId, groupId), eq(groupExpenseShares.participantId, participantId));
  const [share] = await database.select({ id: groupExpenseShares.id }).from(groupExpenseShares).where(shareFilter).limit(1);
  if (share) return true;
  const obligationFilter = participantId === undefined ? eq(groupObligations.groupId, groupId) : and(eq(groupObligations.groupId, groupId), or(eq(groupObligations.debtorParticipantId, participantId), eq(groupObligations.creditorParticipantId, participantId)));
  const [obligation] = await database
    .select({ id: groupObligations.id })
    .from(groupObligations)
    .where(obligationFilter)
    .limit(1);
  if (obligation) return true;
  const settlementFilter = participantId === undefined
    ? eq(groupSettlements.groupId, groupId)
    : and(eq(groupSettlements.groupId, groupId), or(eq(groupSettlements.senderParticipantId, participantId), eq(groupSettlements.recipientParticipantId, participantId)));
  const [settlement] = await database
    .select({ id: groupSettlements.id })
    .from(groupSettlements)
    .where(settlementFilter)
    .limit(1);
  if (settlement) return true;
  const offsetFilter = participantId === undefined
    ? eq(groupOffsetSettlements.groupId, groupId)
    : and(eq(groupOffsetSettlements.groupId, groupId), or(eq(groupOffsetSettlements.initiatorParticipantId, participantId), eq(groupOffsetSettlements.counterpartyParticipantId, participantId)));
  const [offset] = await database
    .select({ id: groupOffsetSettlements.id })
    .from(groupOffsetSettlements)
    .where(offsetFilter)
    .limit(1);
  if (offset) return true;
  if (participantId === undefined) {
    const [application] = await database
      .select({ id: groupSettlementApplications.id })
      .from(groupSettlementApplications)
      .where(eq(groupSettlementApplications.groupId, groupId))
      .limit(1);
    if (application) return true;
    const [offsetApplication] = await database
      .select({ id: groupOffsetApplications.id })
      .from(groupOffsetApplications)
      .where(eq(groupOffsetApplications.groupId, groupId))
      .limit(1);
    if (offsetApplication) return true;
    const [proof] = await database
      .select({ id: groupSettlementProofs.id })
      .from(groupSettlementProofs)
      .where(eq(groupSettlementProofs.groupId, groupId))
      .limit(1);
    if (proof) return true;
    const [receipt] = await database
      .select({ id: groupExpenseReceipts.id })
      .from(groupExpenseReceipts)
      .where(eq(groupExpenseReceipts.groupId, groupId))
      .limit(1);
    if (receipt) return true;
    const [event] = await database
      .select({ id: groupExpenseLifecycleEvents.id })
      .from(groupExpenseLifecycleEvents)
      .where(eq(groupExpenseLifecycleEvents.groupId, groupId))
      .limit(1);
    if (event) return true;
  }
  return false;
}

async function participantHasFinancialHistory(database: Database, groupId: string, participantId: string) {
  return hasFinancialHistory(database, groupId, participantId);
}

export async function updateExternalParticipant(database: Database, groupId: string, userId: string, participantId: string, input: { displayName: string; label?: string | null }) {
  assertGroupId(groupId);
  const access = await requireGroupAccess(database, groupId, userId);
  access.requireManageParticipants();
  await assertGroupActiveForOperationalMutation(database, groupId);
  const participant = await getParticipant(database, groupId, participantId);
  if (participant.userId) throw new GroupError("registered_participant");
  const [updated] = await database.update(groupParticipants).set({ ...cleanParticipantInput(input), updatedAt: new Date() }).where(and(eq(groupParticipants.groupId, groupId), eq(groupParticipants.id, participantId))).returning();
  if (!updated) throw new GroupError("participant_not_found");
  return updated;
}

export async function deleteExternalParticipant(database: Database, groupId: string, userId: string, participantId: string) {
  assertGroupId(groupId);
  const result = await database.transaction(async (transaction) => {
    const transactionalDatabase = transaction as Database;
    const access = await requireGroupAccess(transactionalDatabase, groupId, userId);
    access.requireManageParticipants();
    await assertGroupActiveForOperationalMutation(transactionalDatabase, groupId);
    const now = new Date();
    const [participant] = await transaction.select().from(groupParticipants).where(and(eq(groupParticipants.groupId, groupId), eq(groupParticipants.id, participantId))).limit(1).for("update");
    if (!participant) throw new GroupError("participant_not_found");
    if (participant.userId) throw new GroupError("registered_participant");
    if (await participantHasFinancialHistory(transactionalDatabase, groupId, participantId)) throw new GroupError("financial_history");
    const revoked = await revokePendingParticipantLinks(transactionalDatabase, groupId, participantId, now);
    const deleted = await transaction.delete(groupParticipants).where(and(eq(groupParticipants.groupId, groupId), eq(groupParticipants.id, participantId), isNull(groupParticipants.userId))).returning({ id: groupParticipants.id });
    return { deleted: deleted.length > 0, targetUserIds: revoked.map(({ targetUserId }) => targetUserId) };
  });
  for (const targetUserId of result.targetUserIds) publishNotificationStateChange(targetUserId, "resolved");
  return result.deleted;
}

export async function updateGroupMemberRole(database: Database, groupId: string, actorUserId: string, targetUserId: string, role: Exclude<GroupRole, "owner">) {
  assertGroupId(groupId);
  const access = await requireGroupAccess(database, groupId, actorUserId);
  access.requireManageRoles();
  await assertGroupActiveForOperationalMutation(database, groupId);
  if (!isGroupRole(role) || actorUserId === targetUserId) throw new GroupError("owner_required");
  const [target] = await database.select({ role: groupMemberships.role }).from(groupMemberships).where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, targetUserId))).limit(1);
  if (!target || target.role === "owner") throw new GroupError("owner_required");
  const [updated] = await database.update(groupMemberships).set({ role }).where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, targetUserId))).returning();
  return updated;
}

type RemovableGroupTarget = {
  role: string;
  participantId: string;
  userId: string;
  participantGroupId: string;
  participantUserId: string | null;
};

function assertRemovableTarget(
  access: GroupAccess,
  groupId: string,
  actorUserId: string,
  targetUserId: string,
  target: RemovableGroupTarget | null,
) {
  const removable = target !== null
    && isGroupRole(target.role)
    && Boolean(target.participantId)
    && target.participantGroupId === groupId
    && target.participantUserId === targetUserId
    && target.role !== "owner"
    && targetUserId !== actorUserId
    && (target.role !== "admin" || access.isOwner)
    && (access.isOwner || access.canManageParticipants);
  if (!removable) throw new GroupError("forbidden");
}

export async function removeGroupMember(database: Database, groupId: string, actorUserId: string, targetUserId: string) {
  assertGroupId(groupId);
  const result = await database.transaction(async (transaction) => {
    const transactionalDatabase = transaction as Database;
    const access = await requireGroupAccess(transactionalDatabase, groupId, actorUserId);
    await assertGroupActiveForOperationalMutation(transactionalDatabase, groupId);    const [participant] = await transaction
      .select({ id: groupParticipants.id, participantGroupId: groupParticipants.groupId, participantUserId: groupParticipants.userId })
      .from(groupParticipants)
      .where(and(eq(groupParticipants.groupId, groupId), eq(groupParticipants.userId, targetUserId)))
      .limit(1)
      .for("update");
    const [membership] = participant ? await transaction
      .select({ role: groupMemberships.role, participantId: groupMemberships.participantId, userId: groupMemberships.userId })
      .from(groupMemberships)
      .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, targetUserId), eq(groupMemberships.participantId, participant.id)))
      .limit(1)
      .for("update") : [];
    const target = participant && membership ? { ...membership, participantGroupId: participant.participantGroupId, participantUserId: participant.participantUserId } : null;
    assertRemovableTarget(access, groupId, actorUserId, targetUserId, target);
    if (!target) throw new GroupError("forbidden");

    const hasFinancialHistory = await participantHasFinancialHistory(transactionalDatabase, groupId, target.participantId);
    const [chatHistory] = !hasFinancialHistory
      ? await transaction
        .select({ id: chatMessages.id })
        .from(chatMessages)
        .where(and(eq(chatMessages.groupId, groupId), eq(chatMessages.senderParticipantId, target.participantId)))
        .limit(1)
      : [];
    let revokedTargetUserIds: string[] = [];
    if (!hasFinancialHistory && !chatHistory) {
      const revoked = await revokePendingParticipantLinks(transactionalDatabase, groupId, target.participantId, new Date());
      revokedTargetUserIds = revoked.map(({ targetUserId: recipientUserId }) => recipientUserId);
    }
    const deletedMembership = await transaction.delete(groupMemberships).where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, targetUserId), eq(groupMemberships.participantId, target.participantId))).returning({ userId: groupMemberships.userId });
    if (deletedMembership.length !== 1) throw new GroupError("forbidden");
    if (!hasFinancialHistory && !chatHistory) {
      const deletedParticipant = await transaction.delete(groupParticipants).where(and(eq(groupParticipants.groupId, groupId), eq(groupParticipants.id, target.participantId), eq(groupParticipants.userId, targetUserId))).returning({ id: groupParticipants.id });
      if (deletedParticipant.length !== 1) throw new GroupError("participant_not_found");
    }
    return revokedTargetUserIds;
  });
  for (const recipientUserId of result) publishNotificationStateChange(recipientUserId, "resolved");
  return true;
}

export async function getGroupAvatar(database: Database, groupId: string, userId: string) {
  await getGroupForMember(database, groupId, userId);
  const [avatar] = await database.select({ ...avatarSelection(), content: groupAvatars.content }).from(groupAvatars).where(eq(groupAvatars.groupId, groupId)).limit(1);
  return avatar ? { ...avatar, mediaType: "image/webp" as const } : null;
}

export async function saveGroupAvatar(database: Database, groupId: string, userId: string, avatar: { mediaType: "image/webp"; byteSize: number; sha256: string; content: Uint8Array }) {
  const access = await requireGroupAccess(database, groupId, userId);
  access.requireManageGroup();
  await assertGroupActiveForOperationalMutation(database, groupId);
  const [saved] = await database.insert(groupAvatars).values({ ...avatar, groupId, content: Buffer.from(avatar.content) }).onConflictDoUpdate({ target: groupAvatars.groupId, set: { mediaType: avatar.mediaType, byteSize: avatar.byteSize, sha256: avatar.sha256, content: Buffer.from(avatar.content), updatedAt: new Date() } }).returning(avatarSelection());
  if (!saved) throw new Error("Unable to save the group avatar");
  return { ...saved, mediaType: "image/webp" as const };
}

export async function deleteGroupAvatar(database: Database, groupId: string, userId: string) {
  const access = await requireGroupAccess(database, groupId, userId);
  access.requireManageGroup();
  await assertGroupActiveForOperationalMutation(database, groupId);
  const deleted = await database.delete(groupAvatars).where(eq(groupAvatars.groupId, groupId)).returning({ groupId: groupAvatars.groupId });
  return deleted.length > 0;
}
