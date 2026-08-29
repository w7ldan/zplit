import { aliasedTable, and, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client";
import { groupMemberships, organizationMemberships, userAvatars } from "../db/schema";
import { GroupError, requireGroupAccess } from "./groups";
import { OrganizationError, requireOrganizationAccess } from "./organizations";
import { getUserAvatar, type UserAvatarContent, type UserAvatarMetadata } from "./user-avatars";

export type UserAvatarVisibilityScope =
  | { type: "organization"; id: string }
  | { type: "group"; id: string };

export function canReadUserAvatar(viewerUserId: string, subjectUserId: string) {
  return Boolean(viewerUserId.trim()) && Boolean(subjectUserId.trim()) && viewerUserId === subjectUserId;
}

async function sharedOrganizationId(database: Database, viewerUserId: string, subjectUserId: string) {
  const viewerMemberships = aliasedTable(organizationMemberships, "avatar_viewer_organization_memberships");
  const subjectMemberships = aliasedTable(organizationMemberships, "avatar_subject_organization_memberships");
  const [shared] = await database
    .select({ organizationId: viewerMemberships.organizationId })
    .from(viewerMemberships)
    .innerJoin(subjectMemberships, eq(subjectMemberships.organizationId, viewerMemberships.organizationId))
    .where(and(eq(viewerMemberships.userId, viewerUserId), eq(subjectMemberships.userId, subjectUserId)))
    .limit(1);
  return shared?.organizationId ?? null;
}

async function sharedGroupId(database: Database, viewerUserId: string, subjectUserId: string) {
  const viewerMemberships = aliasedTable(groupMemberships, "avatar_viewer_group_memberships");
  const subjectMemberships = aliasedTable(groupMemberships, "avatar_subject_group_memberships");
  const [shared] = await database
    .select({ groupId: viewerMemberships.groupId })
    .from(viewerMemberships)
    .innerJoin(subjectMemberships, eq(subjectMemberships.groupId, viewerMemberships.groupId))
    .where(and(eq(viewerMemberships.userId, viewerUserId), eq(subjectMemberships.userId, subjectUserId)))
    .limit(1);
  return shared?.groupId ?? null;
}

async function requireUserAvatarVisibilityScope(database: Database, viewerUserId: string, scope: UserAvatarVisibilityScope) {
  if (scope.type === "organization") {
    const access = await requireOrganizationAccess(database, scope.id, viewerUserId);
    access.require("organization.view");
    return;
  }
  await requireGroupAccess(database, scope.id, viewerUserId);
}

async function canReadSharedContext(database: Database, viewerUserId: string, scope: UserAvatarVisibilityScope) {
  try {
    await requireUserAvatarVisibilityScope(database, viewerUserId, scope);
    return true;
  } catch (error) {
    if (error instanceof OrganizationError || error instanceof GroupError) return false;
    throw error;
  }
}

export async function canReadUserAvatarForViewer(database: Database, viewerUserId: string, subjectUserId: string) {
  if (canReadUserAvatar(viewerUserId, subjectUserId)) return true;
  if (!viewerUserId.trim() || !subjectUserId.trim()) return false;
  const [organizationId, groupId] = await Promise.all([
    sharedOrganizationId(database, viewerUserId, subjectUserId),
    sharedGroupId(database, viewerUserId, subjectUserId),
  ]);
  if (organizationId && await canReadSharedContext(database, viewerUserId, { type: "organization", id: organizationId })) return true;
  return groupId ? canReadSharedContext(database, viewerUserId, { type: "group", id: groupId }) : false;
}

function avatarMetadataMap(rows: Array<{ userId: string; sha256: string }>) {
  return new Map<string, Pick<UserAvatarMetadata, "sha256">>(rows.map((row) => [row.userId, { sha256: row.sha256 }]));
}

export async function getUserAvatarMetadataForViewer(
  database: Database,
  viewerUserId: string,
  subjectUserIds: string[],
  scope: UserAvatarVisibilityScope,
) {
  const userIds = [...new Set(subjectUserIds.filter((userId) => userId.trim()))];
  if (userIds.length === 0) return new Map<string, Pick<UserAvatarMetadata, "sha256">>();
  if (scope.type === "organization") {
    await requireUserAvatarVisibilityScope(database, viewerUserId, scope);
    const rows = await database
      .select({ userId: organizationMemberships.userId, sha256: userAvatars.sha256 })
      .from(organizationMemberships)
      .innerJoin(userAvatars, eq(userAvatars.userId, organizationMemberships.userId))
      .where(and(eq(organizationMemberships.organizationId, scope.id), inArray(organizationMemberships.userId, userIds)));
    return avatarMetadataMap(rows);
  }
  await requireUserAvatarVisibilityScope(database, viewerUserId, scope);
  const rows = await database
    .select({ userId: groupMemberships.userId, sha256: userAvatars.sha256 })
    .from(groupMemberships)
    .innerJoin(userAvatars, eq(userAvatars.userId, groupMemberships.userId))
    .where(and(eq(groupMemberships.groupId, scope.id), inArray(groupMemberships.userId, userIds)));
  return avatarMetadataMap(rows);
}

export async function getUserAvatarForViewer(database: Database, viewerUserId: string, subjectUserId: string): Promise<UserAvatarContent | null> {
  if (!(await canReadUserAvatarForViewer(database, viewerUserId, subjectUserId))) return null;
  return getUserAvatar(database, subjectUserId);
}
