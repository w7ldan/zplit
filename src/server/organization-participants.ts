import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database } from "@/db/client";
import { friends, organizationMemberships, organizationParticipants, users } from "@/db/schema";
import type { OrganizationMember } from "@/domain/organization-contracts";
import { isOrganizationRole, type OrganizationRole } from "@/domain/organization-permissions";
import { normalizeUuid } from "@/domain/record-retrieval";
import { getPersonalLedgerScopeId } from "@/server/ledger-scopes";
import { requireOrganizationAccess } from "@/server/organizations";

export class OrganizationParticipantError extends Error {
  constructor(readonly code: "invalid_id" | "invalid_input" | "not_found" | "forbidden" | "registered_personal_friend" | "conflict") {
    super(code);
    this.name = "OrganizationParticipantError";
  }
}

function assertOrganizationId(organizationId: string) {
  if (!normalizeUuid(organizationId)) throw new OrganizationParticipantError("invalid_id");
}

function cleanInput(input: { displayName: string; label?: string | null }) {
  const displayName = input.displayName.trim();
  const label = input.label?.trim() || null;
  if (!displayName || displayName.length > 160 || (label && label.length > 120)) {
    throw new OrganizationParticipantError("invalid_input");
  }
  return { displayName, label };
}

async function requireMemberManagement(database: Database, organizationId: string, actorUserId: string) {
  const [membership] = await database
    .select({ organizationId: organizationMemberships.organizationId })
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, actorUserId)))
    .limit(1)
    .for("update");
  if (!membership) throw new OrganizationParticipantError("forbidden");
  const access = await requireOrganizationAccess(database, organizationId, actorUserId);
  access.require("members.manage");
}

export async function listOrganizationParticipants(database: Database, organizationId: string, viewerUserId: string): Promise<OrganizationMember[]> {
  assertOrganizationId(organizationId);
  const access = await requireOrganizationAccess(database, organizationId, viewerUserId);
  access.require("members.view");
  const rows = await database
    .select({
      id: organizationParticipants.id,
      userId: organizationParticipants.userId,
      participantDisplayName: organizationParticipants.displayName,
      label: organizationParticipants.label,
      userDisplayName: users.name,
      username: users.username,
      role: organizationMemberships.role,
    })
    .from(organizationParticipants)
    .leftJoin(users, eq(users.id, organizationParticipants.userId))
    .leftJoin(
      organizationMemberships,
      and(
        eq(organizationMemberships.organizationId, organizationParticipants.organizationId),
        eq(organizationMemberships.participantId, organizationParticipants.id),
      ),
    )
    .where(eq(organizationParticipants.organizationId, organizationId))
    .orderBy(asc(users.name), asc(organizationParticipants.displayName), asc(organizationParticipants.id));
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    displayName: row.userDisplayName ?? row.participantDisplayName ?? "Member",
    username: row.username,
    label: row.label,
    role: isOrganizationRole(row.role) ? row.role as OrganizationRole : null,
    isLocal: row.userId === null,
  }));
}

export async function addPersonalFriendAsOrganizationParticipant(
  database: Database,
  organizationId: string,
  actorUserId: string,
  personalFriendId: string,
) {
  assertOrganizationId(organizationId);
  if (!normalizeUuid(personalFriendId)) throw new OrganizationParticipantError("not_found");
  return database.transaction(async (transaction) => {
    const transactionalDatabase = transaction as Database;
    await requireMemberManagement(transactionalDatabase, organizationId, actorUserId);
    const personalScopeId = await getPersonalLedgerScopeId(transactionalDatabase, actorUserId);
    const [source] = await transaction
      .select({ id: friends.id, name: friends.name, linkedUserId: friends.linkedUserId, archivedAt: friends.archivedAt })
      .from(friends)
      .where(and(eq(friends.ledgerScopeId, personalScopeId), eq(friends.id, personalFriendId)))
      .limit(1)
      .for("update");
    if (!source || source.archivedAt) throw new OrganizationParticipantError("not_found");
    if (source.linkedUserId) throw new OrganizationParticipantError("registered_personal_friend");

    const [existing] = await transaction
      .select()
      .from(organizationParticipants)
      .where(and(
        eq(organizationParticipants.organizationId, organizationId),
        eq(organizationParticipants.sourcePersonalFriendId, source.id),
      ))
      .limit(1)
      .for("update");
    if (existing) return existing;

    const [participant] = await transaction
      .insert(organizationParticipants)
      .values({
        organizationId,
        sourcePersonalFriendId: source.id,
        displayName: source.name,
        createdByUserId: actorUserId,
      })
      .onConflictDoNothing()
      .returning();
    if (participant) return participant;
    const [created] = await transaction
      .select()
      .from(organizationParticipants)
      .where(and(
        eq(organizationParticipants.organizationId, organizationId),
        eq(organizationParticipants.sourcePersonalFriendId, source.id),
      ))
      .limit(1)
      .for("update");
    if (!created) throw new OrganizationParticipantError("conflict");
    return created;
  });
}

export async function createLocalOrganizationParticipant(
  database: Database,
  organizationId: string,
  actorUserId: string,
  input: { displayName: string; label?: string | null },
) {
  assertOrganizationId(organizationId);
  const values = cleanInput(input);
  return database.transaction(async (transaction) => {
    const transactionalDatabase = transaction as Database;
    await requireMemberManagement(transactionalDatabase, organizationId, actorUserId);
    const [participant] = await transaction
      .insert(organizationParticipants)
      .values({ organizationId, ...values, createdByUserId: actorUserId })
      .returning();
    if (!participant) throw new OrganizationParticipantError("conflict");
    return participant;
  });
}

export async function findOrganizationParticipantForUser(database: Database, organizationId: string, userId: string) {
  const [participant] = await database
    .select()
    .from(organizationParticipants)
    .where(and(eq(organizationParticipants.organizationId, organizationId), eq(organizationParticipants.userId, userId)))
    .limit(1)
    .for("update");
  return participant;
}

export async function findOrganizationParticipantFromLinkedFriend(database: Database, organizationId: string, userId: string) {
  const [participant] = await database
    .select({ id: organizationParticipants.id, userId: organizationParticipants.userId, displayName: organizationParticipants.displayName })
    .from(organizationParticipants)
    .innerJoin(friends, eq(friends.id, organizationParticipants.sourcePersonalFriendId))
    .where(and(
      eq(organizationParticipants.organizationId, organizationId),
      isNull(organizationParticipants.userId),
      eq(friends.linkedUserId, userId),
    ))
    .limit(1)
    .for("update");
  return participant;
}

export function organizationParticipantErrorMessage(error: unknown) {
  if (!(error instanceof OrganizationParticipantError)) return "Unable to add this member.";
  return {
    invalid_id: "This organization is unavailable.",
    invalid_input: "Enter a valid member name.",
    not_found: "This Personal Friend is no longer available.",
    forbidden: "You do not have permission to manage Organization members.",
    registered_personal_friend: "Registered Personal Friends use Invite.",
    conflict: "This member could not be added.",
  }[error.code];
}
