import "server-only";

import { and, asc, count, eq, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { organizationAvatars, organizationMemberships, organizations } from "@/db/schema";
import { normalizeUuid } from "@/domain/record-retrieval";

export type OrganizationRole = "owner" | "admin" | "treasurer" | "member" | "custom";
export type OrganizationAvatarMetadata = { mediaType: "image/webp"; byteSize: number; sha256: string };
export type OrganizationSummary = {
  id: string;
  name: string;
  description: string | null;
  role: OrganizationRole;
  memberCount: number;
  avatar: OrganizationAvatarMetadata | null;
};

export class OrganizationError extends Error {
  constructor(readonly code: "not_found" | "invalid_id" | "invalid_input" | "not_member" | "not_owner") {
    super(code);
    this.name = "OrganizationError";
  }
}

function assertOrganizationId(organizationId: string) {
  if (!normalizeUuid(organizationId)) throw new OrganizationError("invalid_id");
}

function cleanInput(input: { name: string; description?: string | null }) {
  const name = input.name.trim();
  const description = input.description?.trim() || null;
  if (!name || name.length > 160 || (description && description.length > 1000)) throw new OrganizationError("invalid_input");
  return { name, description };
}

function avatarSelection() {
  return {
    mediaType: organizationAvatars.mediaType,
    byteSize: organizationAvatars.byteSize,
    sha256: organizationAvatars.sha256,
  };
}

function mapAvatar(avatar: { mediaType: string; byteSize: number; sha256: string } | null | undefined): OrganizationAvatarMetadata | null {
  return avatar ? { mediaType: "image/webp", byteSize: avatar.byteSize, sha256: avatar.sha256 } : null;
}

async function memberRole(database: Database, organizationId: string, userId: string) {
  const [membership] = await database
    .select({ role: organizationMemberships.role })
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, userId)))
    .limit(1);
  return membership?.role as OrganizationRole | undefined;
}

export async function listOrganizations(database: Database, userId: string): Promise<OrganizationSummary[]> {
  const rows = await database
    .select({
      id: organizations.id,
      name: organizations.name,
      description: organizations.description,
      role: organizationMemberships.role,
      memberCount: sql<number>`(select count(*) from organization_memberships members where members.organization_id = ${organizations.id})`.mapWith(Number),
      avatar: avatarSelection(),
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .leftJoin(organizationAvatars, eq(organizationAvatars.organizationId, organizations.id))
    .where(eq(organizationMemberships.userId, userId))
    .orderBy(asc(organizations.name), asc(organizations.id));
  return rows.map((row) => ({ ...row, role: row.role as OrganizationRole, avatar: mapAvatar(row.avatar) }));
}

export async function getOrganizationForMember(database: Database, organizationId: string, userId: string): Promise<OrganizationSummary> {
  assertOrganizationId(organizationId);
  const [row] = await database
    .select({
      id: organizations.id,
      name: organizations.name,
      description: organizations.description,
      role: organizationMemberships.role,
      avatar: avatarSelection(),
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .leftJoin(organizationAvatars, eq(organizationAvatars.organizationId, organizations.id))
    .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, userId)))
    .limit(1);
  if (!row) throw new OrganizationError("not_member");
  const [{ memberCount }] = await database
    .select({ memberCount: count() })
    .from(organizationMemberships)
    .where(eq(organizationMemberships.organizationId, organizationId));
  return { ...row, role: row.role as OrganizationRole, memberCount: Number(memberCount), avatar: mapAvatar(row.avatar) };
}

export async function createOrganization(
  database: Database,
  userId: string,
  input: { name: string; description?: string | null; avatar?: { mediaType: "image/webp"; byteSize: number; sha256: string; content: Uint8Array } },
) {
  const values = cleanInput(input);
  return database.transaction(async (transaction) => {
    const [organization] = await transaction.insert(organizations).values(values).returning();
    if (!organization) throw new Error("Organization was not created");
    await transaction.insert(organizationMemberships).values({ organizationId: organization.id, userId, role: "owner" });
    if (input.avatar) {
      await transaction.insert(organizationAvatars).values({ ...input.avatar, organizationId: organization.id, content: Buffer.from(input.avatar.content) });
    }
    return organization;
  });
}

async function requireOwner(database: Database, organizationId: string, userId: string) {
  const role = await memberRole(database, organizationId, userId);
  if (!role) throw new OrganizationError("not_member");
  if (role !== "owner") throw new OrganizationError("not_owner");
}

export async function updateOrganization(database: Database, organizationId: string, userId: string, input: { name: string; description?: string | null }) {
  assertOrganizationId(organizationId);
  await requireOwner(database, organizationId, userId);
  const [organization] = await database
    .update(organizations)
    .set({ ...cleanInput(input), updatedAt: new Date() })
    .where(eq(organizations.id, organizationId))
    .returning();
  if (!organization) throw new OrganizationError("not_found");
  return organization;
}

export async function deleteOrganization(database: Database, organizationId: string, userId: string) {
  assertOrganizationId(organizationId);
  await requireOwner(database, organizationId, userId);
  const deleted = await database.delete(organizations).where(eq(organizations.id, organizationId)).returning({ id: organizations.id });
  return deleted.length > 0;
}

export async function getOrganizationAvatar(database: Database, organizationId: string, userId: string) {
  await getOrganizationForMember(database, organizationId, userId);
  const [avatar] = await database.select({ ...avatarSelection(), content: organizationAvatars.content }).from(organizationAvatars).where(eq(organizationAvatars.organizationId, organizationId)).limit(1);
  return avatar ? { ...avatar, mediaType: "image/webp" as const } : null;
}

export async function saveOrganizationAvatar(database: Database, organizationId: string, userId: string, avatar: { mediaType: "image/webp"; byteSize: number; sha256: string; content: Uint8Array }) {
  assertOrganizationId(organizationId);
  await requireOwner(database, organizationId, userId);
  const [saved] = await database
    .insert(organizationAvatars)
    .values({ ...avatar, organizationId, content: Buffer.from(avatar.content) })
    .onConflictDoUpdate({
      target: organizationAvatars.organizationId,
      set: { mediaType: avatar.mediaType, byteSize: avatar.byteSize, sha256: avatar.sha256, content: Buffer.from(avatar.content), updatedAt: new Date() },
    })
    .returning(avatarSelection());
  if (!saved) throw new Error("Unable to save the organization avatar");
  return { ...saved, mediaType: "image/webp" as const };
}

export async function deleteOrganizationAvatar(database: Database, organizationId: string, userId: string) {
  assertOrganizationId(organizationId);
  await requireOwner(database, organizationId, userId);
  const deleted = await database.delete(organizationAvatars).where(eq(organizationAvatars.organizationId, organizationId)).returning({ organizationId: organizationAvatars.organizationId });
  return deleted.length > 0;
}
