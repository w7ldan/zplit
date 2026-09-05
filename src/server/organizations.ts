import "server-only";

import { databaseCode } from "@/server/database-error-code";

import { and, asc, count, eq, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  expenses,
  friends,
  ledgerScopes,
  organizationAvatars,
  organizationInvitations,
  organizationMemberships,
  organizationParticipants,
  organizations,
  repayments,
} from "@/db/schema";
import type { OrganizationAvatarMetadata, OrganizationCapabilities, OrganizationDetail, OrganizationSummary } from "@/domain/organization-contracts";
import {
  isOrganizationRole,
  getOrganizationInvitationRoles,
  resolveOrganizationCapabilities,
  type OrganizationCapability,
  type OrganizationRole,
} from "@/domain/organization-permissions";
import { normalizeUuid } from "@/domain/record-retrieval";
import { createOrganizationLedgerScope, getPersonalLedgerScopeId } from "@/server/ledger-scopes";
import { createLedgerRepository } from "@/domain/ledger-repository";
import { publishNotificationStateChange } from "@/server/notifications";

export type { OrganizationRole } from "@/domain/organization-permissions";
export class OrganizationError extends Error {
  constructor(readonly code: "not_found" | "invalid_id" | "invalid_input" | "not_member" | "forbidden" | "archived" | "ledger_not_empty") {
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

export type OrganizationAccess = {
  role: OrganizationRole;
  archivedAt: Date | null;
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
    canManageMembers: access.can("members.manage"),
    canViewLedger: access.can("ledger.view"),
    canManageFriends: access.can("friends.manage"),
    canViewChat: access.can("chat.view"),
    canManageRepaymentDestinations: access.can("repayment_destinations.manage"),
    canExport: access.can("exports.create"),
    invitationRoles: getOrganizationInvitationRoles(access.can),
  };
}

export async function requireOrganizationAccess(database: Database, organizationId: string, userId: string): Promise<OrganizationAccess> {
  assertOrganizationId(organizationId);
  const [membership] = await database
    .select({ role: organizationMemberships.role, customCapabilities: organizationMemberships.customCapabilities, archivedAt: organizations.archivedAt })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, userId)))
    .limit(1);
  if (!membership) throw new OrganizationError("not_member");
  if (!isOrganizationRole(membership.role)) throw new OrganizationError("forbidden");
  const capabilities = resolveOrganizationCapabilities(membership.role, membership.customCapabilities);
  return {
    role: membership.role,
    archivedAt: membership.archivedAt ?? null,
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
  return {
    ...access,
    organizationId,
    ledgerScopeId: scope.id,
    ledger: createLedgerRepository(database, scope.id, {
      mutationGuard: (transaction) => lockActiveOrganizationForOperationalMutation(transaction, organizationId).then(() => undefined),
    }),
  };
}

async function requireLockedOrganizationLedgerAccess(database: Database, organizationId: string, userId: string) {
  const [membership] = await database
    .select({ userId: organizationMemberships.userId })
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, userId)))
    .limit(1)
    .for("update");
  if (!membership) throw new OrganizationError("not_member");
  return requireOrganizationLedgerAccess(database, organizationId, userId, "friends.manage");
}

export type OrganizationListScope = "active" | "archived" | "all";

async function lockOrganizationLifecycle(database: Database, organizationId: string) {
  const [row] = await database
    .select({ id: organizations.id, archivedAt: organizations.archivedAt })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1)
    .for("update");
  if (!row) throw new OrganizationError("not_found");
  return row;
}

export async function lockActiveOrganizationForOperationalMutation(database: Database, organizationId: string) {
  const row = await lockOrganizationLifecycle(database, organizationId);
  if (row.archivedAt) throw new OrganizationError("archived");
  return row;
}

export async function assertOrganizationActiveForOperationalMutation(database: Database, organizationId: string) {
  const [row] = await database
    .select({ id: organizations.id, archivedAt: organizations.archivedAt })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!row) throw new OrganizationError("not_found");
  if (row.archivedAt) throw new OrganizationError("archived");
}

export async function hasOrganizationFinancialHistory(database: Database, organizationId: string) {
  const [scope] = await database
    .select({ id: ledgerScopes.id })
    .from(ledgerScopes)
    .where(and(eq(ledgerScopes.kind, "organization"), eq(ledgerScopes.organizationId, organizationId)))
    .limit(1);
  if (!scope) return false;
  const [expense] = await database
    .select({ id: expenses.id })
    .from(expenses)
    .where(eq(expenses.ledgerScopeId, scope.id))
    .limit(1);
  if (expense) return true;
  const [repayment] = await database
    .select({ id: repayments.id })
    .from(repayments)
    .where(eq(repayments.ledgerScopeId, scope.id))
    .limit(1);
  return Boolean(repayment);
}

export async function addPersonalFriendAsOrganizationExpenseContact(
  database: Database,
  organizationId: string,
  actorUserId: string,
  personalFriendId: string,
) {
  assertOrganizationId(organizationId);
  if (!normalizeUuid(personalFriendId)) throw new OrganizationError("not_found");
  return database.transaction(async (transaction) => {
    const transactionalDatabase = transaction as Database;
    const access = await requireLockedOrganizationLedgerAccess(transactionalDatabase, organizationId, actorUserId);
    await lockActiveOrganizationForOperationalMutation(transactionalDatabase, organizationId);
    const personalScopeId = await getPersonalLedgerScopeId(transactionalDatabase, actorUserId);
    const [source] = await transaction
      .select({
        id: friends.id,
        name: friends.name,
        linkedUserId: friends.linkedUserId,
        archivedAt: friends.archivedAt,
      })
      .from(friends)
      .where(and(eq(friends.ledgerScopeId, personalScopeId), eq(friends.id, personalFriendId)))
      .limit(1)
      .for("update");
    if (!source || source.archivedAt) throw new OrganizationError("not_found");

    const [sourceContact] = await transaction
      .select()
      .from(friends)
      .where(and(eq(friends.ledgerScopeId, access.ledgerScopeId), eq(friends.sourcePersonalFriendId, source.id)))
      .limit(1)
      .for("update");
    const [linkedContact] = source.linkedUserId
      ? await transaction
        .select()
        .from(friends)
        .where(and(
          eq(friends.ledgerScopeId, access.ledgerScopeId),
          eq(friends.linkedUserId, source.linkedUserId),
        ))
        .limit(1)
        .for("update")
      : [];
    const existing = linkedContact ?? sourceContact;
    if (existing) {
      const shouldLink = Boolean(source.linkedUserId && existing.linkedUserId !== source.linkedUserId);
      if (!shouldLink && existing.archivedAt === null) return existing;
      const [updated] = await transaction
        .update(friends)
        .set({
          ...(shouldLink ? { linkedUserId: source.linkedUserId } : {}),
          archivedAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(friends.ledgerScopeId, access.ledgerScopeId), eq(friends.id, existing.id)))
        .returning();
      if (!updated) throw new OrganizationError("not_found");
      return updated;
    }

    const [contact] = await transaction
      .insert(friends)
      .values({
        ledgerScopeId: access.ledgerScopeId,
        name: source.name,
        sourcePersonalFriendId: source.id,
        ...(source.linkedUserId ? { linkedUserId: source.linkedUserId } : {}),
      })
      .onConflictDoNothing()
      .returning();
    if (contact) return contact;
    const [existingContact] = await transaction
      .select()
      .from(friends)
      .where(and(
        eq(friends.ledgerScopeId, access.ledgerScopeId),
        source.linkedUserId
          ? eq(friends.linkedUserId, source.linkedUserId)
          : eq(friends.sourcePersonalFriendId, source.id),
      ))
      .limit(1)
      .for("update");
    if (!existingContact) throw new OrganizationError("not_found");
    return existingContact;
  });
}

type OrganizationListRow = {
  id: string;
  name: string;
  description: string | null;
  role: string;
  memberCount: number;
  avatar: { mediaType: string; byteSize: number; sha256: string } | null;
  archivedAt: Date | null;
  customCapabilities: unknown;
  ledgerScopeId: string | null;
};

async function listOrganizationRows(database: Database, userId: string, limit?: number, scope: OrganizationListScope = "active"): Promise<OrganizationListRow[]> {
  const archivedFilter = scope === "active"
    ? sql`${organizations.archivedAt} IS NULL`
    : scope === "archived"
      ? sql`${organizations.archivedAt} IS NOT NULL`
      : undefined;
  const query = database
    .select({
      id: organizations.id,
      name: organizations.name,
      description: organizations.description,
      role: organizationMemberships.role,
      memberCount: sql<number>`(
        select count(*)
        from organization_participants participants
        where participants.organization_id = ${organizations.id}
      )`.mapWith(Number),
      avatar: avatarSelection(),
      archivedAt: organizations.archivedAt,
      customCapabilities: organizationMemberships.customCapabilities,
      ledgerScopeId: ledgerScopes.id,
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .leftJoin(organizationAvatars, eq(organizationAvatars.organizationId, organizations.id))
    .leftJoin(ledgerScopes, eq(ledgerScopes.organizationId, organizations.id))
    .where(archivedFilter ? and(eq(organizationMemberships.userId, userId), archivedFilter) : eq(organizationMemberships.userId, userId))
    .orderBy(asc(organizations.name), asc(organizations.id));
  return await (limit === undefined ? query : query.limit(limit));
}

export async function listOrganizations(database: Database, userId: string, scope: OrganizationListScope = "active"): Promise<OrganizationSummary[]> {
  const rows = await listOrganizationRows(database, userId, undefined, scope);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    role: row.role as OrganizationRole,
    memberCount: Number(row.memberCount),
    avatar: mapAvatar(row.avatar),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
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
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
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
      archivedAt: organizations.archivedAt,
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .leftJoin(organizationAvatars, eq(organizationAvatars.organizationId, organizations.id))
    .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, userId)))
    .limit(1);
  if (!row) throw new OrganizationError("not_member");
  const [{ memberCount }] = await database
    .select({ memberCount: count() })
    .from(organizationParticipants)
    .where(eq(organizationParticipants.organizationId, organizationId));
  return {
    ...row,
    role: row.role as OrganizationRole,
    memberCount: Number(memberCount),
    avatar: mapAvatar(row.avatar),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
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
    const [participant] = await transaction
      .insert(organizationParticipants)
      .values({ organizationId: organization.id, userId, createdByUserId: userId })
      .returning({ id: organizationParticipants.id });
    if (!participant) throw new Error("Organization participant was not created");
    await transaction.insert(organizationMemberships).values({ organizationId: organization.id, userId, participantId: participant.id, role: "owner" });
    if (input.avatar) {
      await transaction.insert(organizationAvatars).values({ ...input.avatar, organizationId: organization.id, content: Buffer.from(input.avatar.content) });
    }
    return organization;
  });
}

export async function updateOrganization(database: Database, organizationId: string, userId: string, input: { name: string; description?: string | null }) {
  return database.transaction(async (transaction) => {
    const transactionalDatabase = transaction as Database;
    const access = await requireOrganizationAccess(transactionalDatabase, organizationId, userId);
    access.require("organization.update");
    await lockActiveOrganizationForOperationalMutation(transactionalDatabase, organizationId);
    const [organization] = await transaction
      .update(organizations)
      .set({ ...cleanInput(input), updatedAt: new Date() })
      .where(eq(organizations.id, organizationId))
      .returning();
    if (!organization) throw new OrganizationError("not_found");
    return organization;
  });
}

export async function deleteOrganization(database: Database, organizationId: string, userId: string) {
  try {
    return await database.transaction(async (transaction) => {
      const transactionalDatabase = transaction as Database;
      const access = await requireOrganizationAccess(transactionalDatabase, organizationId, userId);
      access.require("organization.delete");
      await lockOrganizationLifecycle(transactionalDatabase, organizationId);
      if (await hasOrganizationFinancialHistory(transactionalDatabase, organizationId)) throw new OrganizationError("ledger_not_empty");
      const [scope] = await transaction
        .select({ id: ledgerScopes.id })
        .from(ledgerScopes)
        .where(and(eq(ledgerScopes.kind, "organization"), eq(ledgerScopes.organizationId, organizationId)))
        .limit(1);
      if (scope) {
        await transaction.delete(ledgerScopes).where(eq(ledgerScopes.id, scope.id));
      }
      const deleted = await transaction.delete(organizations).where(eq(organizations.id, organizationId)).returning({ id: organizations.id });
      if (deleted.length === 0) throw new OrganizationError("not_found");
      return true;
    });
  } catch (error) {
    if (error instanceof OrganizationError) throw error;
    if (databaseCode(error, true) === "23503" && await hasOrganizationFinancialHistory(database, organizationId)) {
      throw new OrganizationError("ledger_not_empty");
    }
    throw error;
  }
}

export async function archiveOrganization(database: Database, organizationId: string, userId: string) {
  const result = await database.transaction(async (transaction) => {
    const transactionalDatabase = transaction as Database;
    const access = await requireOrganizationAccess(transactionalDatabase, organizationId, userId);
    access.require("organization.delete");
    const row = await lockOrganizationLifecycle(transactionalDatabase, organizationId);
    if (row.archivedAt) return { archived: row, targetUserIds: [] as string[] };
    const now = new Date();
    const [archived] = await transaction
      .update(organizations)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(organizations.id, organizationId))
      .returning();
    if (!archived) throw new OrganizationError("not_found");
    const revoked = await transaction
      .update(organizationInvitations)
      .set({ status: "revoked", revokedAt: now, updatedAt: now })
      .where(and(eq(organizationInvitations.organizationId, organizationId), eq(organizationInvitations.status, "pending")))
      .returning({ targetUserId: organizationInvitations.targetUserId });
    return { archived, targetUserIds: revoked.map(({ targetUserId }) => targetUserId) };
  });
  for (const targetUserId of new Set(result.targetUserIds)) publishNotificationStateChange(targetUserId, "resolved");
  return result.archived;
}

export async function restoreOrganization(database: Database, organizationId: string, userId: string) {
  return database.transaction(async (transaction) => {
    const transactionalDatabase = transaction as Database;
    const access = await requireOrganizationAccess(transactionalDatabase, organizationId, userId);
    access.require("organization.delete");
    const row = await lockOrganizationLifecycle(transactionalDatabase, organizationId);
    if (!row.archivedAt) return row;
    const [restored] = await transaction
      .update(organizations)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(eq(organizations.id, organizationId))
      .returning();
    if (!restored) throw new OrganizationError("not_found");
    return restored;
  });
}

export async function getOrganizationAvatar(database: Database, organizationId: string, userId: string) {
  await getOrganizationForMember(database, organizationId, userId);
  const [avatar] = await database.select({ ...avatarSelection(), content: organizationAvatars.content }).from(organizationAvatars).where(eq(organizationAvatars.organizationId, organizationId)).limit(1);
  return avatar ? { ...avatar, mediaType: "image/webp" as const } : null;
}

export async function saveOrganizationAvatar(database: Database, organizationId: string, userId: string, avatar: { mediaType: "image/webp"; byteSize: number; sha256: string; content: Uint8Array }) {
  return database.transaction(async (transaction) => {
    const transactionalDatabase = transaction as Database;
    const access = await requireOrganizationAccess(transactionalDatabase, organizationId, userId);
    access.require("organization.update");
    await lockActiveOrganizationForOperationalMutation(transactionalDatabase, organizationId);
    const [saved] = await transaction
      .insert(organizationAvatars)
      .values({ ...avatar, organizationId, content: Buffer.from(avatar.content) })
      .onConflictDoUpdate({
        target: organizationAvatars.organizationId,
        set: { mediaType: avatar.mediaType, byteSize: avatar.byteSize, sha256: avatar.sha256, content: Buffer.from(avatar.content), updatedAt: new Date() },
      })
      .returning(avatarSelection());
    if (!saved) throw new Error("Unable to save the organization avatar");
    return { ...saved, mediaType: "image/webp" as const };
  });
}

export async function deleteOrganizationAvatar(database: Database, organizationId: string, userId: string) {
  return database.transaction(async (transaction) => {
    const transactionalDatabase = transaction as Database;
    const access = await requireOrganizationAccess(transactionalDatabase, organizationId, userId);
    access.require("organization.update");
    await lockActiveOrganizationForOperationalMutation(transactionalDatabase, organizationId);
    const deleted = await transaction.delete(organizationAvatars).where(eq(organizationAvatars.organizationId, organizationId)).returning({ organizationId: organizationAvatars.organizationId });
    return deleted.length > 0;
  });
}
