import "server-only";

import { and, asc, count, eq, isNull, or, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { groupAvatars, groupExpenseShares, groupExpenses, groupJoinRequests, groupMemberships, groupObligations, groupParticipants, groups, users } from "@/db/schema";
import { groupAccessForRole, isGroupRole, type GroupRole } from "@/domain/group-permissions";
import { normalizeUuid } from "@/domain/record-retrieval";
import { publishNotificationStateChange } from "@/server/notifications";

export type { GroupRole } from "@/domain/group-permissions";
export type GroupAvatarMetadata = { mediaType: "image/webp"; byteSize: number; sha256: string };
export type GroupSummary = {
  id: string;
  name: string;
  description: string | null;
  role: GroupRole;
  participantCount: number;
  avatar: GroupAvatarMetadata | null;
};
export type GroupDetail = GroupSummary & {
  memberCount: number;
  externalParticipantCount: number;
  isOwner: boolean;
  canManageGroup: boolean;
  canManageParticipants: boolean;
  canManageRoles: boolean;
  canDelete: boolean;
};
export type GroupParticipant = {
  id: string;
  userId: string | null;
  displayName: string;
  label: string | null;
  role: GroupRole | null;
  isExternal: boolean;
  isFormer: boolean;
};

export class GroupError extends Error {
  constructor(readonly code: "not_found" | "invalid_id" | "invalid_input" | "not_member" | "forbidden" | "participant_not_found" | "registered_participant" | "owner_required" | "financial_history") {
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

export async function listGroups(database: Database, userId: string): Promise<GroupSummary[]> {
  const rows = await database
    .select({
      id: groups.id,
      name: groups.name,
      description: groups.description,
      role: groupMemberships.role,
      participantCount: sql<number>`(select count(*) from group_participants participants where participants.group_id = ${groups.id})`.mapWith(Number),
      avatar: avatarSelection(),
    })
    .from(groupMemberships)
    .innerJoin(groups, eq(groups.id, groupMemberships.groupId))
    .leftJoin(groupAvatars, eq(groupAvatars.groupId, groups.id))
    .where(eq(groupMemberships.userId, userId))
    .orderBy(asc(groups.name), asc(groups.id));
  return rows.map((row) => ({ ...row, role: row.role as GroupRole, participantCount: Number(row.participantCount), avatar: mapAvatar(row.avatar) }));
}

export async function getGroupForMember(database: Database, groupId: string, userId: string): Promise<GroupDetail> {
  const access = await requireGroupAccess(database, groupId, userId);
  const [row] = await database
    .select({ id: groups.id, name: groups.name, description: groups.description, role: groupMemberships.role, avatar: avatarSelection() })
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
    participantCount: Number(participantCounts?.participantCount ?? 0),
    memberCount: Number(memberCounts?.memberCount ?? 0),
    externalParticipantCount: Number(participantCounts?.externalParticipantCount ?? 0),
    avatar: mapAvatar(row.avatar),
    ...access,
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
  const [group] = await database.update(groups).set({ ...cleanInput(input), updatedAt: new Date() }).where(eq(groups.id, groupId)).returning();
  if (!group) throw new GroupError("not_found");
  return group;
}

export async function deleteGroup(database: Database, groupId: string, userId: string) {
  assertGroupId(groupId);
  const access = await requireGroupAccess(database, groupId, userId);
  access.requireDelete();
  const deleted = await database.delete(groups).where(eq(groups.id, groupId)).returning({ id: groups.id });
  return deleted.length > 0;
}

export async function createExternalParticipant(database: Database, groupId: string, userId: string, input: { displayName: string; label?: string | null }) {
  assertGroupId(groupId);
  const access = await requireGroupAccess(database, groupId, userId);
  access.requireManageParticipants();
  const [participant] = await database.insert(groupParticipants).values({ groupId, ...cleanParticipantInput(input) }).returning();
  if (!participant) throw new Error("External participant was not created");
  return participant;
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

async function participantHasFinancialHistory(database: Database, groupId: string, participantId: string) {
  const [expense] = await database
    .select({ id: groupExpenses.id })
    .from(groupExpenses)
    .where(and(eq(groupExpenses.groupId, groupId), or(eq(groupExpenses.creatorParticipantId, participantId), eq(groupExpenses.payerParticipantId, participantId))))
    .limit(1);
  if (expense) return true;
  const [share] = await database.select({ id: groupExpenseShares.id }).from(groupExpenseShares).where(and(eq(groupExpenseShares.groupId, groupId), eq(groupExpenseShares.participantId, participantId))).limit(1);
  if (share) return true;
  const [obligation] = await database
    .select({ id: groupObligations.id })
    .from(groupObligations)
    .where(and(eq(groupObligations.groupId, groupId), or(eq(groupObligations.debtorParticipantId, participantId), eq(groupObligations.creditorParticipantId, participantId))))
    .limit(1);
  return Boolean(obligation);
}

export async function updateExternalParticipant(database: Database, groupId: string, userId: string, participantId: string, input: { displayName: string; label?: string | null }) {
  assertGroupId(groupId);
  const access = await requireGroupAccess(database, groupId, userId);
  access.requireManageParticipants();
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
  if (!isGroupRole(role) || actorUserId === targetUserId) throw new GroupError("owner_required");
  const [target] = await database.select({ role: groupMemberships.role }).from(groupMemberships).where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, targetUserId))).limit(1);
  if (!target || target.role === "owner") throw new GroupError("owner_required");
  const [updated] = await database.update(groupMemberships).set({ role }).where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, targetUserId))).returning();
  return updated;
}

export async function removeGroupMember(database: Database, groupId: string, actorUserId: string, targetUserId: string) {
  assertGroupId(groupId);
  const result = await database.transaction(async (transaction) => {
    const transactionalDatabase = transaction as Database;
    const access = await requireGroupAccess(transactionalDatabase, groupId, actorUserId);
    const [target] = await transaction
      .select({ role: groupMemberships.role, participantId: groupMemberships.participantId, participantGroupId: groupParticipants.groupId, participantUserId: groupParticipants.userId })
      .from(groupMemberships)
      .innerJoin(groupParticipants, and(eq(groupParticipants.groupId, groupMemberships.groupId), eq(groupParticipants.id, groupMemberships.participantId), eq(groupParticipants.userId, groupMemberships.userId)))
      .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, targetUserId)))
      .limit(1);
    if (!target || !isGroupRole(target.role) || !target.participantId || target.participantGroupId !== groupId || target.participantUserId !== targetUserId || target.role === "owner" || targetUserId === actorUserId || (target.role === "admin" && !access.isOwner) || (!access.isOwner && !access.canManageParticipants)) throw new GroupError("forbidden");

    const hasFinancialHistory = await participantHasFinancialHistory(transactionalDatabase, groupId, target.participantId);
    let revokedTargetUserIds: string[] = [];
    if (!hasFinancialHistory) {
      const revoked = await revokePendingParticipantLinks(transactionalDatabase, groupId, target.participantId, new Date());
      revokedTargetUserIds = revoked.map(({ targetUserId: recipientUserId }) => recipientUserId);
    }
    const deletedMembership = await transaction.delete(groupMemberships).where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, targetUserId))).returning({ userId: groupMemberships.userId });
    if (deletedMembership.length !== 1) throw new GroupError("forbidden");
    if (!hasFinancialHistory) {
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
  const [saved] = await database.insert(groupAvatars).values({ ...avatar, groupId, content: Buffer.from(avatar.content) }).onConflictDoUpdate({ target: groupAvatars.groupId, set: { mediaType: avatar.mediaType, byteSize: avatar.byteSize, sha256: avatar.sha256, content: Buffer.from(avatar.content), updatedAt: new Date() } }).returning(avatarSelection());
  if (!saved) throw new Error("Unable to save the group avatar");
  return { ...saved, mediaType: "image/webp" as const };
}

export async function deleteGroupAvatar(database: Database, groupId: string, userId: string) {
  const access = await requireGroupAccess(database, groupId, userId);
  access.requireManageGroup();
  const deleted = await database.delete(groupAvatars).where(eq(groupAvatars.groupId, groupId)).returning({ groupId: groupAvatars.groupId });
  return deleted.length > 0;
}
