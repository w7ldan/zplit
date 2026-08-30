import "server-only";

import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { Database } from "@/db/client";
import { getDatabase } from "@/db/client";
import { organizationInvitations, organizationMemberships, organizations, notifications, users } from "@/db/schema";
import type { OrganizationInvitationSummary, OrganizationMember } from "@/domain/organization-contracts";
import {
  canGrantOrganizationInvitationRole,
  isOrganizationInvitationRole,
  type OrganizationInvitationRole,
  type OrganizationRole,
} from "@/domain/organization-permissions";
import { isOrganizationInvitationExpired, organizationInvitationExpiresAt, type OrganizationInvitationStatus } from "@/domain/organization-invitations";
import { normalizeUuid } from "@/domain/record-retrieval";
import { parseUsername } from "@/domain/username";
import { NOTIFICATION_TYPES, type NotificationMetadata } from "@/domain/notifications";
import { requireSession } from "@/auth/require-session";
import { OrganizationError, requireOrganizationAccess } from "@/server/organizations";
import { createNotificationInDatabase, publishNotificationStateChange } from "@/server/notifications";
import { searchUsernameDirectoryInDatabase } from "@/server/user-directory";

export class OrganizationInvitationError extends Error {
  constructor(readonly code: "invalid_id" | "forbidden" | "invalid_role" | "invalid_target" | "self" | "already_member" | "duplicate" | "not_found" | "resolved" | "expired" | "stale_authority" | "conflict") {
    super(code);
    this.name = "OrganizationInvitationError";
  }
}

export type OrganizationInvitationState = {
  id: string;
  organizationId: string;
  status: OrganizationInvitationStatus;
  role: OrganizationInvitationRole;
  expiresAt: Date;
};

function databaseCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function assertUserId(userId: string) {
  if (typeof userId !== "string" || !userId.trim()) throw new TypeError("An organization invitation user id is required");
}

function assertOrganizationId(organizationId: string) {
  if (!normalizeUuid(organizationId)) throw new OrganizationInvitationError("invalid_id");
}

function assertInvitationId(invitationId: string) {
  if (!normalizeUuid(invitationId)) throw new OrganizationInvitationError("not_found");
}

function parseInvitationUsername(value: unknown) {
  const parsed = parseUsername(value);
  if (!parsed.ok) throw new OrganizationInvitationError("invalid_target");
  return parsed.value;
}

function parseInvitationTargetId(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new OrganizationInvitationError("invalid_target");
  return value.trim();
}

async function resolveInvitationTarget(database: Database, input: { targetUserId?: unknown; username?: unknown }) {
  const targetCondition = input.targetUserId !== undefined
    ? eq(users.id, parseInvitationTargetId(input.targetUserId))
    : eq(users.username, parseInvitationUsername(input.username));
  const [target] = await database
    .select({ id: users.id, name: users.name, username: users.username })
    .from(users)
    .where(targetCondition)
    .limit(1)
    .for("update");
  return target?.username ? target : null;
}

async function resolveInvitationNotification(database: Database, targetUserId: string, invitationId: string, now: Date) {
  await database
    .update(notifications)
    .set({ readAt: now })
    .where(and(
      eq(notifications.recipientUserId, targetUserId),
      eq(notifications.type, NOTIFICATION_TYPES.organizationInvitation),
      eq(notifications.dedupeKey, `organization-invitation:${invitationId}`),
      isNull(notifications.readAt),
    ));
}

async function transitionPendingInvitation(database: Database, invitationId: string, status: Exclude<OrganizationInvitationStatus, "pending">, now: Date, targetUserId: string) {
  const values = status === "accepted"
    ? { status, acceptedAt: now, updatedAt: now }
    : status === "declined"
      ? { status, declinedAt: now, updatedAt: now }
      : status === "revoked"
        ? { status, revokedAt: now, updatedAt: now }
        : { status, expiredAt: now, updatedAt: now };
  const [updated] = await database
    .update(organizationInvitations)
    .set(values)
    .where(and(eq(organizationInvitations.id, invitationId), eq(organizationInvitations.status, "pending")))
    .returning();
  if (updated) await resolveInvitationNotification(database, targetUserId, invitationId, now);
  return updated;
}

function stateFromInvitation(invitation: typeof organizationInvitations.$inferSelect): OrganizationInvitationState {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    status: invitation.status as OrganizationInvitationStatus,
    role: invitation.role as OrganizationInvitationRole,
    expiresAt: invitation.expiresAt,
  };
}

export async function searchOrganizationInvitationUsers(database: Database, organizationId: string, inviterUserId: string, query: unknown) {
  assertOrganizationId(organizationId);
  assertUserId(inviterUserId);
  const access = await requireOrganizationAccess(database, organizationId, inviterUserId);
  access.require("members.invite");
  const [members, pending] = await Promise.all([
    database
      .select({ userId: organizationMemberships.userId })
      .from(organizationMemberships)
      .where(eq(organizationMemberships.organizationId, organizationId)),
    database
      .select({ userId: organizationInvitations.targetUserId })
      .from(organizationInvitations)
      .where(and(
        eq(organizationInvitations.organizationId, organizationId),
        eq(organizationInvitations.status, "pending"),
        gt(organizationInvitations.expiresAt, new Date()),
      )),
  ]);
  return searchUsernameDirectoryInDatabase(database, query, {
    excludeUserIds: [inviterUserId, ...members.map(({ userId }) => userId), ...pending.map(({ userId }) => userId)],
  });
}

export async function listOrganizationMembers(database: Database, organizationId: string, viewerUserId: string): Promise<OrganizationMember[]> {
  assertOrganizationId(organizationId);
  assertUserId(viewerUserId);
  const access = await requireOrganizationAccess(database, organizationId, viewerUserId);
  access.require("members.view");
  const rows = await database
    .select({
      id: users.id,
      displayName: users.name,
      username: users.username,
      role: organizationMemberships.role,
    })
    .from(organizationMemberships)
    .innerJoin(users, eq(users.id, organizationMemberships.userId))
    .where(eq(organizationMemberships.organizationId, organizationId))
    .orderBy(asc(users.name), asc(users.id));
  return rows.map((row) => ({ ...row, role: row.role as OrganizationRole }));
}

export async function listPendingOrganizationInvitations(database: Database, organizationId: string, viewerUserId: string): Promise<OrganizationInvitationSummary[]> {
  assertOrganizationId(organizationId);
  assertUserId(viewerUserId);
  const result = await database.transaction(async (transaction) => {
    const access = await requireOrganizationAccess(transaction as Database, organizationId, viewerUserId);
    access.require("members.invite");
    const rows = await transaction
      .select({
        id: organizationInvitations.id,
        targetUserId: organizationInvitations.targetUserId,
        displayName: users.name,
        username: users.username,
        role: organizationInvitations.role,
        expiresAt: organizationInvitations.expiresAt,
      })
      .from(organizationInvitations)
      .innerJoin(users, eq(users.id, organizationInvitations.targetUserId))
      .where(and(eq(organizationInvitations.organizationId, organizationId), eq(organizationInvitations.status, "pending")))
      .orderBy(asc(organizationInvitations.expiresAt), asc(organizationInvitations.id));
    const pending: OrganizationInvitationSummary[] = [];
    const expiredUserIds: string[] = [];
    const now = new Date();
    for (const row of rows) {
      if (isOrganizationInvitationExpired(row.expiresAt, now)) {
        const expired = await transitionPendingInvitation(transaction as Database, row.id, "expired", now, row.targetUserId);
        if (expired) expiredUserIds.push(row.targetUserId);
        continue;
      }
      if (row.username) pending.push({ ...row, username: row.username, role: row.role as OrganizationInvitationRole, expiresAt: row.expiresAt.toISOString() });
    }
    return { pending, expiredUserIds };
  });
  for (const userId of result.expiredUserIds) publishNotificationStateChange(userId, "resolved");
  return result.pending;
}

export async function createOrganizationInvitation(database: Database, organizationId: string, inviterUserId: string, input: { targetUserId?: unknown; username?: unknown; role: unknown }) {
  assertOrganizationId(organizationId);
  assertUserId(inviterUserId);
  const requestedRole = input.role === undefined ? "member" : input.role;
  if (!isOrganizationInvitationRole(requestedRole)) throw new OrganizationInvitationError("invalid_role");
  const role = requestedRole;
  const created = await database.transaction(async (transaction) => {
    const access = await requireOrganizationAccess(transaction as Database, organizationId, inviterUserId);
    if (!canGrantOrganizationInvitationRole(role, access.can)) throw new OrganizationInvitationError("forbidden");
    const target = await resolveInvitationTarget(transaction as Database, input);
    if (!target) throw new OrganizationInvitationError("invalid_target");
    if (target.id === inviterUserId) throw new OrganizationInvitationError("self");

    const [member] = await transaction
      .select({ userId: organizationMemberships.userId })
      .from(organizationMemberships)
      .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, target.id)))
      .limit(1)
      .for("update");
    if (member) throw new OrganizationInvitationError("already_member");

    const now = new Date();
    const [pending] = await transaction
      .select()
      .from(organizationInvitations)
      .where(and(eq(organizationInvitations.organizationId, organizationId), eq(organizationInvitations.targetUserId, target.id), eq(organizationInvitations.status, "pending")))
      .limit(1)
      .for("update");
    if (pending) {
      if (isOrganizationInvitationExpired(pending.expiresAt, now)) {
        await transitionPendingInvitation(transaction as Database, pending.id, "expired", now, target.id);
      } else {
        throw new OrganizationInvitationError("duplicate");
      }
    }

    const [organization] = await transaction.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    const [inviter] = await transaction.select({ name: users.name }).from(users).where(eq(users.id, inviterUserId)).limit(1);
    if (!organization || !inviter) throw new OrganizationInvitationError("not_found");
    const expiresAt = organizationInvitationExpiresAt(now);
    const [invitation] = await transaction
      .insert(organizationInvitations)
      .values({ organizationId, targetUserId: target.id, invitedByUserId: inviterUserId, role, status: "pending", createdAt: now, expiresAt, updatedAt: now })
      .returning();
    if (!invitation) throw new Error("Organization invitation was not created");
    const metadata: NotificationMetadata["organization.invitation"] = {
      invitationId: invitation.id,
      organizationId,
      organizationName: organization.name,
      inviterDisplayName: inviter.name,
      role,
      expiresAt: invitation.expiresAt.toISOString(),
    };
    await createNotificationInDatabase(transaction as Database, {
      recipientUserId: target.id,
      type: NOTIFICATION_TYPES.organizationInvitation,
      metadata,
      dedupeKey: `organization-invitation:${invitation.id}`,
    });
    return { invitation, targetUserId: target.id };
  }).catch((error) => {
    if (databaseCode(error) === "23505") throw new OrganizationInvitationError("duplicate");
    throw error;
  });
  publishNotificationStateChange(created.targetUserId, "created");
  return created.invitation;
}

export async function getOrganizationInvitationStatuses(database: Database, targetUserId: string, invitationIds: string[]): Promise<Map<string, OrganizationInvitationState>> {
  assertUserId(targetUserId);
  const ids = [...new Set(invitationIds.map(normalizeUuid).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const result = await database.transaction(async (transaction) => {
    const rows = await transaction
      .select()
      .from(organizationInvitations)
      .where(and(eq(organizationInvitations.targetUserId, targetUserId), inArray(organizationInvitations.id, ids)))
      .for("update");
    const states = new Map<string, OrganizationInvitationState>();
    const expiredUserIds: string[] = [];
    const now = new Date();
    for (const row of rows) {
      let current = row;
      if (row.status === "pending" && isOrganizationInvitationExpired(row.expiresAt, now)) {
        current = await transitionPendingInvitation(transaction as Database, row.id, "expired", now, targetUserId) ?? row;
        if (current.status === "expired") expiredUserIds.push(targetUserId);
      }
      states.set(current.id, stateFromInvitation(current));
    }
    return { states, expiredUserIds };
  });
  for (const userId of result.expiredUserIds) publishNotificationStateChange(userId, "resolved");
  return result.states;
}

export async function getCurrentUserOrganizationInvitationStatuses(invitationIds: string[]) {
  const session = await requireSession();
  return getOrganizationInvitationStatuses(getDatabase(), session.user.id, invitationIds);
}

async function acceptOrDecline(database: Database, targetUserId: string, invitationId: string, response: "accept" | "decline") {
  assertUserId(targetUserId);
  assertInvitationId(invitationId);
  const result = await database.transaction(async (transaction) => {
    const [invitation] = await transaction
      .select()
      .from(organizationInvitations)
      .where(and(eq(organizationInvitations.id, invitationId), eq(organizationInvitations.targetUserId, targetUserId)))
      .limit(1)
      .for("update");
    if (!invitation) throw new OrganizationInvitationError("not_found");
    if (invitation.status !== "pending") return { organizationId: invitation.organizationId, targetUserId, recipientUserId: invitation.invitedByUserId, changed: false, error: undefined, status: invitation.status };
    const now = new Date();
    if (isOrganizationInvitationExpired(invitation.expiresAt, now)) {
      const expired = await transitionPendingInvitation(transaction as Database, invitation.id, "expired", now, targetUserId);
      return { organizationId: invitation.organizationId, targetUserId, recipientUserId: invitation.invitedByUserId, changed: Boolean(expired), error: "expired" as const, status: "expired" as const };
    }
    if (response === "decline") {
      const declined = await transitionPendingInvitation(transaction as Database, invitation.id, "declined", now, targetUserId);
      if (!declined) throw new OrganizationInvitationError("resolved");
      await createNotificationInDatabase(transaction as Database, {
        recipientUserId: invitation.invitedByUserId,
        type: NOTIFICATION_TYPES.organizationInvitationOutcome,
        metadata: { invitationId: invitation.id, organizationId: invitation.organizationId, status: "declined" },
        dedupeKey: `organization-invitation-outcome:${invitation.id}:declined`,
      });
      return { organizationId: invitation.organizationId, targetUserId, recipientUserId: invitation.invitedByUserId, changed: true, error: undefined, status: "declined" as const };
    }

    const [organization] = await transaction.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, invitation.organizationId)).limit(1).for("update");
    if (!organization) throw new OrganizationInvitationError("not_found");
    let inviterAccess;
    try {
      inviterAccess = await requireOrganizationAccess(transaction as Database, invitation.organizationId, invitation.invitedByUserId);
    } catch (error) {
      if (!(error instanceof OrganizationError)) throw error;
      const revoked = await transitionPendingInvitation(transaction as Database, invitation.id, "revoked", now, targetUserId);
      return { organizationId: invitation.organizationId, targetUserId, recipientUserId: invitation.invitedByUserId, changed: Boolean(revoked), error: "stale_authority" as const, status: "revoked" as const };
    }
    if (!canGrantOrganizationInvitationRole(invitation.role, inviterAccess.can)) {
      const revoked = await transitionPendingInvitation(transaction as Database, invitation.id, "revoked", now, targetUserId);
      return { organizationId: invitation.organizationId, targetUserId, changed: Boolean(revoked), error: "stale_authority" as const, status: "revoked" as const };
    }
    const [existing] = await transaction
      .select({ userId: organizationMemberships.userId })
      .from(organizationMemberships)
      .where(and(eq(organizationMemberships.organizationId, invitation.organizationId), eq(organizationMemberships.userId, targetUserId)))
      .limit(1)
      .for("update");
    if (existing) {
      const revoked = await transitionPendingInvitation(transaction as Database, invitation.id, "revoked", now, targetUserId);
      return { organizationId: invitation.organizationId, targetUserId, recipientUserId: invitation.invitedByUserId, changed: Boolean(revoked), error: "already_member" as const, status: "revoked" as const };
    }
    const [membership] = await transaction
      .insert(organizationMemberships)
      .values({ organizationId: invitation.organizationId, userId: targetUserId, role: invitation.role, customCapabilities: [], joinedAt: now })
      .onConflictDoNothing({ target: [organizationMemberships.organizationId, organizationMemberships.userId] })
      .returning();
    if (!membership) {
      const revoked = await transitionPendingInvitation(transaction as Database, invitation.id, "revoked", now, targetUserId);
      return { organizationId: invitation.organizationId, targetUserId, recipientUserId: invitation.invitedByUserId, changed: Boolean(revoked), error: "already_member" as const, status: "revoked" as const };
    }
    const accepted = await transitionPendingInvitation(transaction as Database, invitation.id, "accepted", now, targetUserId);
    if (!accepted) throw new OrganizationInvitationError("conflict");
    await createNotificationInDatabase(transaction as Database, {
      recipientUserId: invitation.invitedByUserId,
      type: NOTIFICATION_TYPES.organizationInvitationOutcome,
      metadata: { invitationId: invitation.id, organizationId: invitation.organizationId, status: "accepted" },
      dedupeKey: `organization-invitation-outcome:${invitation.id}:accepted`,
    });
    return { organizationId: invitation.organizationId, targetUserId, recipientUserId: invitation.invitedByUserId, changed: true, error: undefined, status: "accepted" as const };
  });
  if (result.changed) publishNotificationStateChange(result.targetUserId, "resolved");
  if (result.changed && (result.status === "accepted" || result.status === "declined")) publishNotificationStateChange(result.recipientUserId, "created");
  if (result.error) throw new OrganizationInvitationError(result.error);
  return result;
}

export async function acceptOrganizationInvitation(database: Database, targetUserId: string, invitationId: string) {
  return acceptOrDecline(database, targetUserId, invitationId, "accept");
}

export async function declineOrganizationInvitation(database: Database, targetUserId: string, invitationId: string) {
  return acceptOrDecline(database, targetUserId, invitationId, "decline");
}

export async function revokeOrganizationInvitation(database: Database, organizationId: string, actorUserId: string, invitationId: string) {
  assertOrganizationId(organizationId);
  assertUserId(actorUserId);
  assertInvitationId(invitationId);
  const result = await database.transaction(async (transaction) => {
    const access = await requireOrganizationAccess(transaction as Database, organizationId, actorUserId);
    access.require("members.invite");
    const [invitation] = await transaction
      .select()
      .from(organizationInvitations)
      .where(and(eq(organizationInvitations.id, invitationId), eq(organizationInvitations.organizationId, organizationId)))
      .limit(1)
      .for("update");
    if (!invitation) throw new OrganizationInvitationError("not_found");
    if (invitation.status !== "pending") return { invitation, changed: false };
    const now = new Date();
    if (isOrganizationInvitationExpired(invitation.expiresAt, now)) {
      const expired = await transitionPendingInvitation(transaction as Database, invitation.id, "expired", now, invitation.targetUserId);
      return { invitation: expired ?? invitation, changed: Boolean(expired) };
    }
    const revoked = await transitionPendingInvitation(transaction as Database, invitation.id, "revoked", now, invitation.targetUserId);
    if (!revoked) throw new OrganizationInvitationError("resolved");
    return { invitation: revoked, changed: true };
  });
  if (result.changed) publishNotificationStateChange(result.invitation.targetUserId, "resolved");
  return result.invitation;
}
