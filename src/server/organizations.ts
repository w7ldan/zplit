import "server-only";

import { and, asc, count, eq, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { ledgerScopes, organizationAvatars, organizationMemberships, organizations } from "@/db/schema";
import type { OrganizationAvatarMetadata, OrganizationCapabilities, OrganizationDetail, OrganizationSummary } from "@/domain/organization-contracts";
import {
  isOrganizationRole,
  getOrganizationInvitationRoles,
  resolveOrganizationCapabilities,
  type OrganizationCapability,
  type OrganizationRole,
} from "@/domain/organization-permissions";
import { normalizeUuid } from "@/domain/record-retrieval";
import { createOrganizationLedgerScope } from "@/server/ledger-scopes";
import { createLedgerRepository } from "@/domain/ledger-repository";

export type { OrganizationRole } from "@/domain/organization-permissions";
export class OrganizationError extends Error {
  constructor(readonly code: "not_found" | "invalid_id" | "invalid_input" | "not_member" | "forbidden" | "ledger_not_empty") {
    super(code);
    this.name = "OrganizationError";
  }
}

function assertOrganizationId(organizationId: string) {
  if (!normalizeUuid(organizationId)) throw new OrganizationError("invalid_id");
}

function databaseCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
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

export type OrganizationAccess = {
  role: OrganizationRole;
  can(capability: OrganizationCapability): boolean;
  require(capability: OrganizationCapability): void;
};

export type OrganizationLedgerAccess = OrganizationAccess & {
  organizationId: string;
  ledgerScopeId: string;
  ledger: ReturnType<typeof createLedgerRepository>;
};

function toOrganizationCapabilities(access: OrganizationAccess): OrganizationCapabilities {
  return {
    canUpdate: access.can("organization.update"),
    canDelete: access.can("organization.delete"),
    canViewMembers: access.can("members.view"),
    canViewLedger: access.can("ledger.view"),
    canViewChat: access.can("chat.view"),
    canManageRepaymentDestinations: access.can("repayment_destinations.manage"),
    canExport: access.can("exports.create"),
    invitationRoles: getOrganizationInvitationRoles(access.can),
  };
}

export async function requireOrganizationAccess(database: Database, organizationId: string, userId: string): Promise<OrganizationAccess> {
  assertOrganizationId(organizationId);
  const [membership] = await database
    .select({ role: organizationMemberships.role, customCapabilities: organizationMemberships.customCapabilities })
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, userId)))
    .limit(1);
  if (!membership) throw new OrganizationError("not_member");
  if (!isOrganizationRole(membership.role)) throw new OrganizationError("forbidden");
  const capabilities = resolveOrganizationCapabilities(membership.role, membership.customCapabilities);
  return {
    role: membership.role,
    can: (capability) => capabilities.has(capability),
    require: (capability) => {
      if (!capabilities.has(capability)) throw new OrganizationError("forbidden");
    },
  };
}

export async function requireOrganizationLedgerAccess(
  database: Database,
  organizationId: string,
  userId: string,
  capability: OrganizationCapability,
): Promise<OrganizationLedgerAccess> {
  const access = await requireOrganizationAccess(database, organizationId, userId);
  access.require(capability);
  const [scope] = await database
    .select({ id: ledgerScopes.id })
    .from(ledgerScopes)
    .where(and(eq(ledgerScopes.kind, "organization"), eq(ledgerScopes.organizationId, organizationId)))
    .limit(1);
  if (!scope) throw new OrganizationError("not_found");
  return { ...access, organizationId, ledgerScopeId: scope.id, ledger: createLedgerRepository(database, scope.id) };
}

type OrganizationListRow = {
  id: string;
  name: string;
  description: string | null;
  role: string;
  memberCount: number;
  avatar: { mediaType: string; byteSize: number; sha256: string } | null;
  customCapabilities: unknown;
  ledgerScopeId: string | null;
};

async function listOrganizationRows(database: Database, userId: string, limit?: number): Promise<OrganizationListRow[]> {
  const query = database
    .select({
      id: organizations.id,
      name: organizations.name,
      description: organizations.description,
      role: organizationMemberships.role,
      memberCount: sql<number>`(
        select count(*)
        from organization_memberships members
        where members.organization_id = ${organizations.id}
      )`.mapWith(Number),
      avatar: avatarSelection(),
      customCapabilities: organizationMemberships.customCapabilities,
      ledgerScopeId: ledgerScopes.id,
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .leftJoin(organizationAvatars, eq(organizationAvatars.organizationId, organizations.id))
    .leftJoin(ledgerScopes, eq(ledgerScopes.organizationId, organizations.id))
    .where(eq(organizationMemberships.userId, userId))
    .orderBy(asc(organizations.name), asc(organizations.id));
  return await (limit === undefined ? query : query.limit(limit));
}

export async function listOrganizations(database: Database, userId: string): Promise<OrganizationSummary[]> {
  const rows = await listOrganizationRows(database, userId);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    role: row.role as OrganizationRole,
    memberCount: Number(row.memberCount),
    avatar: mapAvatar(row.avatar),
  }));
}

export type OrganizationOverviewSummary = OrganizationSummary & {
  canViewLedger: boolean;
  ledgerScopeId: string | null;
};

export async function listOrganizationOverviewSummaries(
  database: Database,
  userId: string,
  limit = 4,
): Promise<OrganizationOverviewSummary[]> {
  const rows = await listOrganizationRows(database, userId, limit);
  return rows.flatMap((row) => {
    const role = row.role as OrganizationRole;
    const capabilities = resolveOrganizationCapabilities(role, row.customCapabilities);
    if (!capabilities.has("organization.view")) return [];
    return [{
      id: row.id,
      name: row.name,
      description: row.description,
      role,
      memberCount: Number(row.memberCount),
      avatar: mapAvatar(row.avatar),
      canViewLedger: capabilities.has("ledger.view"),
      ledgerScopeId: row.ledgerScopeId,
    }];
  });
}

export async function getOrganizationForMember(database: Database, organizationId: string, userId: string): Promise<OrganizationDetail> {
  const access = await requireOrganizationAccess(database, organizationId, userId);
  access.require("organization.view");
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
  return {
    ...row,
    role: row.role as OrganizationRole,
    memberCount: Number(memberCount),
    avatar: mapAvatar(row.avatar),
    ...toOrganizationCapabilities(access),
  };
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
    await createOrganizationLedgerScope(transaction as Database, organization.id);
    await transaction.insert(organizationMemberships).values({ organizationId: organization.id, userId, role: "owner" });
    if (input.avatar) {
      await transaction.insert(organizationAvatars).values({ ...input.avatar, organizationId: organization.id, content: Buffer.from(input.avatar.content) });
    }
    return organization;
  });
}

export async function updateOrganization(database: Database, organizationId: string, userId: string, input: { name: string; description?: string | null }) {
  const access = await requireOrganizationAccess(database, organizationId, userId);
  access.require("organization.update");
  const [organization] = await database
    .update(organizations)
    .set({ ...cleanInput(input), updatedAt: new Date() })
    .where(eq(organizations.id, organizationId))
    .returning();
  if (!organization) throw new OrganizationError("not_found");
  return organization;
}

export async function deleteOrganization(database: Database, organizationId: string, userId: string) {
  const access = await requireOrganizationAccess(database, organizationId, userId);
  access.require("organization.delete");
  return database.transaction(async (transaction) => {
    const [scope] = await transaction
      .select({ id: ledgerScopes.id })
      .from(ledgerScopes)
      .where(and(eq(ledgerScopes.kind, "organization"), eq(ledgerScopes.organizationId, organizationId)))
      .limit(1);
    if (scope) {
      try {
        await transaction.delete(ledgerScopes).where(eq(ledgerScopes.id, scope.id));
      } catch (error) {
        if (databaseCode(error) === "23503") throw new OrganizationError("ledger_not_empty");
        throw error;
      }
    }
    const deleted = await transaction.delete(organizations).where(eq(organizations.id, organizationId)).returning({ id: organizations.id });
    return deleted.length > 0;
  });
}

export async function getOrganizationAvatar(database: Database, organizationId: string, userId: string) {
  await getOrganizationForMember(database, organizationId, userId);
  const [avatar] = await database.select({ ...avatarSelection(), content: organizationAvatars.content }).from(organizationAvatars).where(eq(organizationAvatars.organizationId, organizationId)).limit(1);
  return avatar ? { ...avatar, mediaType: "image/webp" as const } : null;
}

export async function saveOrganizationAvatar(database: Database, organizationId: string, userId: string, avatar: { mediaType: "image/webp"; byteSize: number; sha256: string; content: Uint8Array }) {
  const access = await requireOrganizationAccess(database, organizationId, userId);
  access.require("organization.update");
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
  const access = await requireOrganizationAccess(database, organizationId, userId);
  access.require("organization.update");
  const deleted = await database.delete(organizationAvatars).where(eq(organizationAvatars.organizationId, organizationId)).returning({ organizationId: organizationAvatars.organizationId });
  return deleted.length > 0;
}
