import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/client";
import { formatSafeError, readDatabaseConfig } from "./migrate.js";

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
if (!require.cache[serverOnlyPath]) require.cache[serverOnlyPath] = { exports: {} } as never;
const { createGroup, deleteGroup, archiveGroup, restoreGroup, listGroups, updateGroup, createExternalParticipant, hasFinancialHistory } = await import("../src/server/groups");
const { createGroupExpense } = await import("../src/server/group-accounting");
const { createGroupSettlement, confirmGroupSettlement } = await import("../src/server/group-settlements");
const { sendChatMessage } = await import("../src/server/chat");
const { createGroupInvitation, acceptGroupJoinRequest } = await import("../src/server/group-join-requests");
const { createOrganization, deleteOrganization, archiveOrganization, restoreOrganization, listOrganizations, updateOrganization, hasOrganizationFinancialHistory } = await import("../src/server/organizations");
const { requireOrganizationLedgerAccess } = await import("../src/server/organizations");
const { createLocalOrganizationParticipant } = await import("../src/server/organization-participants");
const { createOrganizationInvitation, acceptOrganizationInvitation } = await import("../src/server/organization-invitations");
const { assertOrganizationLedgerWritableFromForm } = await import("../src/server/organization-ledger");

function errorCode(error: unknown) {
  return error instanceof Error && "code" in error ? (error as { code?: unknown }).code : undefined;
}

async function expectCode(action: () => Promise<unknown>, code: string, message: string) {
  try {
    await action();
  } catch (error) {
    assert(errorCode(error) === code, `${message}: expected ${code}, got ${error instanceof Error ? `${error.message} ${String(errorCode(error) ?? "")}` : "unknown"}`);
    return;
  }
  throw new Error(`${message}: expected ${code}`);
}

async function addGroupMember(pool: Pool, groupId: string, userId: string) {
  const participantId = randomUUID();
  await pool.query("INSERT INTO group_participants (id, group_id, user_id) VALUES ($1, $2, $3)", [participantId, groupId, userId]);
  await pool.query("INSERT INTO group_memberships (group_id, user_id, participant_id, role) VALUES ($1, $2, $3, 'member')", [groupId, userId, participantId]);
  return participantId;
}

async function participantFor(pool: Pool, groupId: string, userId: string) {
  const result = await pool.query<{ participant_id: string }>("SELECT participant_id FROM group_memberships WHERE group_id = $1 AND user_id = $2", [groupId, userId]);
  return result.rows[0]!.participant_id;
}

async function orgScope(pool: Pool, organizationId: string) {
  const result = await pool.query<{ id: string }>("SELECT id FROM ledger_scopes WHERE kind = 'organization' AND organization_id = $1", [organizationId]);
  return result.rows[0]!.id;
}

async function waitForBlockedQuery(pool: Pool, fragment: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE $1",
      [`%${fragment}%`],
    );
    if (Number(result.rows[0]?.count ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for a PostgreSQL lock on ${fragment}`);
}

async function holdRow(pool: Pool, statement: string, values: unknown[]) {
  const client = await pool.connect();
  await client.query("BEGIN");
  await client.query(statement, values);
  return async () => {
    await client.query("COMMIT");
    client.release();
  };
}

async function capture(action: () => Promise<unknown>) {
  try {
    return { value: await action() };
  } catch (error) {
    return { error };
  }
}

async function runInvitationAcceptanceRaces(context: ArchiveSmokeContext) {
  await runGroupInvitationAcceptanceRaces(context);
  await runOrganizationInvitationAcceptanceRaces(context);
  await runInvitationCreationRaces(context);
}

async function runGroupInvitationAcceptanceRaces({ pool, database, owner, invitee, groupIds }: ArchiveSmokeContext) {
  const groupAcceptanceFirst = await createGroup(database, owner.id, { name: "Group acceptance-first invitation race" });
  groupIds.push(groupAcceptanceFirst.id);
  const groupAcceptanceFirstInvitation = await createGroupInvitation(database, groupAcceptanceFirst.id, owner.id, { targetUserId: invitee.id });
  const releaseGroupRequest = await holdRow(pool, "SELECT id FROM group_join_requests WHERE id = $1 FOR UPDATE", [groupAcceptanceFirstInvitation.id]);
  const groupAcceptance = capture(() => acceptGroupJoinRequest(database, invitee.id, groupAcceptanceFirstInvitation.id));
  await waitForBlockedQuery(pool, "group_join_requests");
  const groupAcceptanceArchive = archiveGroup(database, groupAcceptanceFirst.id, owner.id);
  await releaseGroupRequest();
  const [groupAcceptanceResult] = await Promise.all([groupAcceptance, groupAcceptanceArchive]);
  assert(!groupAcceptanceResult.error, "Group acceptance-first race failed");
  const groupAcceptanceState = await pool.query<{ archived_at: Date | null; invitation_status: string; memberships: string; participants: string }>(
    "SELECT groups.archived_at, (SELECT status FROM group_join_requests WHERE id = $2) AS invitation_status, (SELECT count(*)::text FROM group_memberships WHERE group_id = $1 AND user_id = $3) AS memberships, (SELECT count(*)::text FROM group_participants WHERE group_id = $1 AND user_id = $3) AS participants FROM groups WHERE groups.id = $1",
    [groupAcceptanceFirst.id, groupAcceptanceFirstInvitation.id, invitee.id],
  );
  assert(groupAcceptanceState.rows[0]?.archived_at !== null && groupAcceptanceState.rows[0]?.invitation_status === "accepted" && groupAcceptanceState.rows[0]?.memberships === "1" && groupAcceptanceState.rows[0]?.participants === "1", "Group acceptance-first race did not preserve the accepted membership before archive");

  const groupArchiveFirst = await createGroup(database, owner.id, { name: "Group archive-first invitation race" });
  groupIds.push(groupArchiveFirst.id);
  const groupArchiveFirstInvitation = await createGroupInvitation(database, groupArchiveFirst.id, owner.id, { targetUserId: invitee.id });
  const releaseArchivedGroupRequest = await holdRow(pool, "SELECT id FROM group_join_requests WHERE id = $1 FOR UPDATE", [groupArchiveFirstInvitation.id]);
  const groupArchive = archiveGroup(database, groupArchiveFirst.id, owner.id);
  await waitForBlockedQuery(pool, "group_join_requests");
  const groupArchiveAcceptance = capture(() => acceptGroupJoinRequest(database, invitee.id, groupArchiveFirstInvitation.id));
  await waitForBlockedQuery(pool, "groups");
  await releaseArchivedGroupRequest();
  const [groupArchiveResult, groupArchiveAcceptanceResult] = await Promise.all([groupArchive, groupArchiveAcceptance]);
  assert(groupArchiveResult.id === groupArchiveFirst.id && errorCode(groupArchiveAcceptanceResult.error) === "resolved", "Group archive-first acceptance did not fail with the existing resolved contract");
  const groupArchiveState = await pool.query<{ archived_at: Date | null; invitation_status: string; memberships: string; participants: string }>(
    "SELECT groups.archived_at, (SELECT status FROM group_join_requests WHERE id = $2) AS invitation_status, (SELECT count(*)::text FROM group_memberships WHERE group_id = $1 AND user_id = $3) AS memberships, (SELECT count(*)::text FROM group_participants WHERE group_id = $1 AND user_id = $3) AS participants FROM groups WHERE groups.id = $1",
    [groupArchiveFirst.id, groupArchiveFirstInvitation.id, invitee.id],
  );
  assert(groupArchiveState.rows[0]?.archived_at !== null && groupArchiveState.rows[0]?.invitation_status === "revoked" && groupArchiveState.rows[0]?.memberships === "0" && groupArchiveState.rows[0]?.participants === "0", "Group archive-first acceptance activated a membership or participant");

}

async function runOrganizationInvitationAcceptanceRaces({ pool, database, owner, invitee, organizationIds }: ArchiveSmokeContext) {
  const organizationAcceptanceFirst = await createOrganization(database, owner.id, { name: "Organization acceptance-first invitation race" });
  organizationIds.push(organizationAcceptanceFirst.id);
  const organizationAcceptanceFirstInvitation = await createOrganizationInvitation(database, organizationAcceptanceFirst.id, owner.id, { targetUserId: invitee.id, role: "member" });
  const releaseOrganizationInvitation = await holdRow(pool, "SELECT id FROM organization_invitations WHERE id = $1 FOR UPDATE", [organizationAcceptanceFirstInvitation.id]);
  const organizationAcceptance = capture(() => acceptOrganizationInvitation(database, invitee.id, organizationAcceptanceFirstInvitation.id));
  await waitForBlockedQuery(pool, "organization_invitations");
  const organizationAcceptanceArchive = archiveOrganization(database, organizationAcceptanceFirst.id, owner.id);
  await releaseOrganizationInvitation();
  const [organizationAcceptanceResult] = await Promise.all([organizationAcceptance, organizationAcceptanceArchive]);
  assert(!organizationAcceptanceResult.error, "Organization acceptance-first race failed");
  const organizationAcceptanceState = await pool.query<{ archived_at: Date | null; invitation_status: string; memberships: string; participants: string }>(
    "SELECT organizations.archived_at, (SELECT status FROM organization_invitations WHERE id = $2) AS invitation_status, (SELECT count(*)::text FROM organization_memberships WHERE organization_id = $1 AND user_id = $3) AS memberships, (SELECT count(*)::text FROM organization_participants WHERE organization_id = $1 AND user_id = $3) AS participants FROM organizations WHERE organizations.id = $1",
    [organizationAcceptanceFirst.id, organizationAcceptanceFirstInvitation.id, invitee.id],
  );
  assert(organizationAcceptanceState.rows[0]?.archived_at !== null && organizationAcceptanceState.rows[0]?.invitation_status === "accepted" && organizationAcceptanceState.rows[0]?.memberships === "1" && organizationAcceptanceState.rows[0]?.participants === "1", "Organization acceptance-first race did not preserve the accepted membership before archive");

  const organizationArchiveFirst = await createOrganization(database, owner.id, { name: "Organization archive-first invitation race" });
  organizationIds.push(organizationArchiveFirst.id);
  const organizationArchiveFirstInvitation = await createOrganizationInvitation(database, organizationArchiveFirst.id, owner.id, { targetUserId: invitee.id, role: "member" });
  const releaseArchivedOrganizationInvitation = await holdRow(pool, "SELECT id FROM organization_invitations WHERE id = $1 FOR UPDATE", [organizationArchiveFirstInvitation.id]);
  const organizationArchive = archiveOrganization(database, organizationArchiveFirst.id, owner.id);
  await waitForBlockedQuery(pool, "organization_invitations");
  const organizationArchiveAcceptance = capture(() => acceptOrganizationInvitation(database, invitee.id, organizationArchiveFirstInvitation.id));
  await waitForBlockedQuery(pool, "organizations");
  await releaseArchivedOrganizationInvitation();
  const [organizationArchiveResult, organizationArchiveAcceptanceResult] = await Promise.all([organizationArchive, organizationArchiveAcceptance]);
  assert(organizationArchiveResult.id === organizationArchiveFirst.id && errorCode(organizationArchiveAcceptanceResult.error) === "resolved", "Organization archive-first acceptance did not fail with the existing resolved contract");
  const organizationArchiveState = await pool.query<{ archived_at: Date | null; invitation_status: string; memberships: string; participants: string }>(
    "SELECT organizations.archived_at, (SELECT status FROM organization_invitations WHERE id = $2) AS invitation_status, (SELECT count(*)::text FROM organization_memberships WHERE organization_id = $1 AND user_id = $3) AS memberships, (SELECT count(*)::text FROM organization_participants WHERE organization_id = $1 AND user_id = $3) AS participants FROM organizations WHERE organizations.id = $1",
    [organizationArchiveFirst.id, organizationArchiveFirstInvitation.id, invitee.id],
  );
  assert(organizationArchiveState.rows[0]?.archived_at !== null && organizationArchiveState.rows[0]?.invitation_status === "revoked" && organizationArchiveState.rows[0]?.memberships === "0" && organizationArchiveState.rows[0]?.participants === "0", "Organization archive-first acceptance activated a membership or participant");
}

async function runInvitationCreationRaces(context: ArchiveSmokeContext) {
  await runGroupInvitationCreationRaces(context);
  await runOrganizationInvitationCreationRaces(context);
  await runOrganizationParticipantCreationRaces(context);
}

async function runGroupInvitationCreationRaces({ pool, database, owner, member, invitee, groupIds }: ArchiveSmokeContext) {
  const groupCreateFirst = await createGroup(database, owner.id, { name: "Group create-first invitation race" });
  groupIds.push(groupCreateFirst.id);
  const releaseGroupTarget = await holdRow(pool, "SELECT id FROM users WHERE id = $1 FOR UPDATE", [invitee.id]);
  const groupCreate = capture(() => createGroupInvitation(database, groupCreateFirst.id, owner.id, { targetUserId: invitee.id }));
  await waitForBlockedQuery(pool, "users");
  const groupCreateArchive = archiveGroup(database, groupCreateFirst.id, owner.id);
  await releaseGroupTarget();
  const [groupCreateResult] = await Promise.all([groupCreate, groupCreateArchive]);
  assert(!groupCreateResult.error, "Group create-first invitation race failed");
  const groupCreateState = await pool.query<{ archived_at: Date | null; invitations: string; pending: string }>(
    "SELECT groups.archived_at, (SELECT count(*)::text FROM group_join_requests WHERE group_id = $1) AS invitations, (SELECT count(*)::text FROM group_join_requests WHERE group_id = $1 AND status = 'pending') AS pending FROM groups WHERE id = $1",
    [groupCreateFirst.id],
  );
  assert(groupCreateState.rows[0]?.archived_at !== null && groupCreateState.rows[0]?.invitations === "1" && groupCreateState.rows[0]?.pending === "0", "Group create-first invitation was not archived atomically");

  const groupCreateArchiveFirst = await createGroup(database, owner.id, { name: "Group archive-first creation race" });
  groupIds.push(groupCreateArchiveFirst.id);
  const groupExistingInvitation = await createGroupInvitation(database, groupCreateArchiveFirst.id, owner.id, { targetUserId: member.id });
  const releaseGroupExistingRequest = await holdRow(pool, "SELECT id FROM group_join_requests WHERE id = $1 FOR UPDATE", [groupExistingInvitation.id]);
  const groupCreateArchiveFirstArchive = archiveGroup(database, groupCreateArchiveFirst.id, owner.id);
  await waitForBlockedQuery(pool, "group_join_requests");
  const groupArchiveFirstCreate = capture(() => createGroupInvitation(database, groupCreateArchiveFirst.id, owner.id, { targetUserId: invitee.id }));
  await waitForBlockedQuery(pool, "groups");
  await releaseGroupExistingRequest();
  const [groupCreateArchiveFirstResult, groupCreateArchiveFirstCreateResult] = await Promise.all([groupCreateArchiveFirstArchive, groupArchiveFirstCreate]);
  assert(groupCreateArchiveFirstResult.id === groupCreateArchiveFirst.id && errorCode(groupCreateArchiveFirstCreateResult.error) === "forbidden", "Group archive-first creation was not rejected as archived");
  const groupCreateArchiveFirstState = await pool.query<{ archived_at: Date | null; invitations: string; invitee_invitations: string }>(
    "SELECT groups.archived_at, (SELECT count(*)::text FROM group_join_requests WHERE group_id = $1) AS invitations, (SELECT count(*)::text FROM group_join_requests WHERE group_id = $1 AND target_user_id = $2) AS invitee_invitations FROM groups WHERE id = $1",
    [groupCreateArchiveFirst.id, invitee.id],
  );
  assert(groupCreateArchiveFirstState.rows[0]?.archived_at !== null && groupCreateArchiveFirstState.rows[0]?.invitations === "1" && groupCreateArchiveFirstState.rows[0]?.invitee_invitations === "0", "Group archive-first creation left a request behind");

}

async function runOrganizationInvitationCreationRaces({ pool, database, owner, member, invitee, organizationIds }: ArchiveSmokeContext) {
  const organizationCreateFirst = await createOrganization(database, owner.id, { name: "Organization create-first invitation race" });
  organizationIds.push(organizationCreateFirst.id);
  const releaseOrganizationTarget = await holdRow(pool, "SELECT id FROM users WHERE id = $1 FOR UPDATE", [invitee.id]);
  const organizationCreate = capture(() => createOrganizationInvitation(database, organizationCreateFirst.id, owner.id, { targetUserId: invitee.id, role: "member" }));
  await waitForBlockedQuery(pool, "users");
  const organizationCreateArchive = archiveOrganization(database, organizationCreateFirst.id, owner.id);
  await releaseOrganizationTarget();
  const [organizationCreateResult] = await Promise.all([organizationCreate, organizationCreateArchive]);
  assert(!organizationCreateResult.error, "Organization create-first invitation race failed");
  const organizationCreateState = await pool.query<{ archived_at: Date | null; invitations: string; pending: string }>(
    "SELECT organizations.archived_at, (SELECT count(*)::text FROM organization_invitations WHERE organization_id = $1) AS invitations, (SELECT count(*)::text FROM organization_invitations WHERE organization_id = $1 AND status = 'pending') AS pending FROM organizations WHERE id = $1",
    [organizationCreateFirst.id],
  );
  assert(organizationCreateState.rows[0]?.archived_at !== null && organizationCreateState.rows[0]?.invitations === "1" && organizationCreateState.rows[0]?.pending === "0", "Organization create-first invitation was not archived atomically");

  const organizationCreateArchiveFirst = await createOrganization(database, owner.id, { name: "Organization archive-first creation race" });
  organizationIds.push(organizationCreateArchiveFirst.id);
  const organizationExistingInvitation = await createOrganizationInvitation(database, organizationCreateArchiveFirst.id, owner.id, { targetUserId: member.id, role: "member" });
  const releaseOrganizationExistingInvitation = await holdRow(pool, "SELECT id FROM organization_invitations WHERE id = $1 FOR UPDATE", [organizationExistingInvitation.id]);
  const organizationCreateArchiveFirstArchive = archiveOrganization(database, organizationCreateArchiveFirst.id, owner.id);
  await waitForBlockedQuery(pool, "organization_invitations");
  const organizationArchiveFirstCreate = capture(() => createOrganizationInvitation(database, organizationCreateArchiveFirst.id, owner.id, { targetUserId: invitee.id, role: "member" }));
  await waitForBlockedQuery(pool, "organizations");
  await releaseOrganizationExistingInvitation();
  const [organizationCreateArchiveFirstResult, organizationCreateArchiveFirstCreateResult] = await Promise.all([organizationCreateArchiveFirstArchive, organizationArchiveFirstCreate]);
  assert(organizationCreateArchiveFirstResult.id === organizationCreateArchiveFirst.id && errorCode(organizationCreateArchiveFirstCreateResult.error) === "forbidden", "Organization archive-first creation was not rejected as archived");
  const organizationCreateArchiveFirstState = await pool.query<{ archived_at: Date | null; invitations: string; invitee_invitations: string }>(
    "SELECT organizations.archived_at, (SELECT count(*)::text FROM organization_invitations WHERE organization_id = $1) AS invitations, (SELECT count(*)::text FROM organization_invitations WHERE organization_id = $1 AND target_user_id = $2) AS invitee_invitations FROM organizations WHERE id = $1",
    [organizationCreateArchiveFirst.id, invitee.id],
  );
  assert(organizationCreateArchiveFirstState.rows[0]?.archived_at !== null && organizationCreateArchiveFirstState.rows[0]?.invitations === "1" && organizationCreateArchiveFirstState.rows[0]?.invitee_invitations === "0", "Organization archive-first creation left an invitation behind");
}

async function runOrganizationParticipantCreationRaces({ pool, database, owner, member, organizationIds }: ArchiveSmokeContext) {
  const participantCreateFirst = await createOrganization(database, owner.id, { name: "Organization participant-first lifecycle race" });
  organizationIds.push(participantCreateFirst.id);
  const releaseOwnerMembership = await holdRow(pool, "SELECT organization_id FROM organization_memberships WHERE organization_id = $1 AND user_id = $2 FOR UPDATE", [participantCreateFirst.id, owner.id]);
  const participantCreate = capture(() => createLocalOrganizationParticipant(database, participantCreateFirst.id, owner.id, { displayName: "Local race participant" }));
  await waitForBlockedQuery(pool, "organization_memberships");
  const participantCreateArchive = archiveOrganization(database, participantCreateFirst.id, owner.id);
  await releaseOwnerMembership();
  const [participantCreateResult] = await Promise.all([participantCreate, participantCreateArchive]);
  assert(!participantCreateResult.error, "Organization local participant create-first race failed");
  const participantCreateState = await pool.query<{ archived_at: Date | null; participants: string }>(
    "SELECT organizations.archived_at, (SELECT count(*)::text FROM organization_participants WHERE organization_id = $1 AND display_name = 'Local race participant') AS participants FROM organizations WHERE id = $1",
    [participantCreateFirst.id],
  );
  assert(participantCreateState.rows[0]?.archived_at !== null && participantCreateState.rows[0]?.participants === "1", "Organization local participant create-first race was not serialized before archive");

  const participantArchiveFirst = await createOrganization(database, owner.id, { name: "Organization participant archive-first race" });
  organizationIds.push(participantArchiveFirst.id);
  const participantArchiveFirstInvitation = await createOrganizationInvitation(database, participantArchiveFirst.id, owner.id, { targetUserId: member.id, role: "member" });
  const releaseParticipantInvitation = await holdRow(pool, "SELECT id FROM organization_invitations WHERE id = $1 FOR UPDATE", [participantArchiveFirstInvitation.id]);
  const participantArchive = archiveOrganization(database, participantArchiveFirst.id, owner.id);
  await waitForBlockedQuery(pool, "organization_invitations");
  const participantArchiveCreate = capture(() => createLocalOrganizationParticipant(database, participantArchiveFirst.id, owner.id, { displayName: "Should not be created" }));
  await waitForBlockedQuery(pool, "organizations");
  await releaseParticipantInvitation();
  const [participantArchiveResult, participantArchiveCreateResult] = await Promise.all([participantArchive, participantArchiveCreate]);
  assert(participantArchiveResult.id === participantArchiveFirst.id && errorCode(participantArchiveCreateResult.error) === "archived", "Organization archive-first local participant creation was not rejected as archived");
  const participantArchiveState = await pool.query<{ archived_at: Date | null; participants: string }>(
    "SELECT organizations.archived_at, (SELECT count(*)::text FROM organization_participants WHERE organization_id = $1 AND display_name = 'Should not be created') AS participants FROM organizations WHERE id = $1",
    [participantArchiveFirst.id],
  );
  assert(participantArchiveState.rows[0]?.archived_at !== null && participantArchiveState.rows[0]?.participants === "0", "Organization archive-first local participant creation left a participant behind");
}

async function runLifecycleRaces({ pool, database, owner, invitee, groupIds, organizationIds }: ArchiveSmokeContext) {
  const mutationFirstGroup = await createGroup(database, owner.id, { name: "Mutation-first race" });
  groupIds.push(mutationFirstGroup.id);
  const mutationFirstParticipantId = await participantFor(pool, mutationFirstGroup.id, owner.id);
  const releaseParticipant = await holdRow(pool, "SELECT id FROM group_participants WHERE id = $1 FOR UPDATE", [mutationFirstParticipantId]);
  const mutationFirstExpense = createGroupExpense(database, mutationFirstGroup.id, owner.id, {
    description: "Serialized expense",
    occurredAt: new Date("2026-08-28T00:00:00.000Z"),
    totalAmount: 10,
    payerParticipantId: mutationFirstParticipantId,
    shares: [{ participantId: mutationFirstParticipantId, amount: 10 }],
  });
  await waitForBlockedQuery(pool, "group_participants");
  const mutationFirstArchive = archiveGroup(database, mutationFirstGroup.id, owner.id);
  await releaseParticipant();
  await mutationFirstExpense;
  await mutationFirstArchive;
  const mutationFirstState = await pool.query<{ archived_at: Date | null; expenses: string }>(
    "SELECT groups.archived_at, (SELECT count(*)::text FROM group_expenses WHERE group_id = groups.id) AS expenses FROM groups WHERE groups.id = $1",
    [mutationFirstGroup.id],
  );
  assert(mutationFirstState.rows[0]?.archived_at !== null && mutationFirstState.rows[0]?.expenses === "1", "Group mutation did not serialize before archive");

  const archiveFirstGroup = await createGroup(database, owner.id, { name: "Archive-first race" });
  groupIds.push(archiveFirstGroup.id);
  const archiveFirstParticipantId = await participantFor(pool, archiveFirstGroup.id, owner.id);
  const pending = await createGroupInvitation(database, archiveFirstGroup.id, owner.id, { targetUserId: invitee.id });
  const releaseRequest = await holdRow(pool, "SELECT id FROM group_join_requests WHERE id = $1 FOR UPDATE", [pending.id]);
  const archiveFirstArchive = archiveGroup(database, archiveFirstGroup.id, owner.id);
  await waitForBlockedQuery(pool, "group_join_requests");
  const archiveFirstExpense = createGroupExpense(database, archiveFirstGroup.id, owner.id, {
    description: "Rejected after archive",
    occurredAt: new Date("2026-08-28T00:00:00.000Z"),
    totalAmount: 10,
    payerParticipantId: archiveFirstParticipantId,
    shares: [{ participantId: archiveFirstParticipantId, amount: 10 }],
  }).then(() => undefined, (error) => error);
  await releaseRequest();
  await archiveFirstArchive;
  const archiveFirstError = await archiveFirstExpense;
  assert(errorCode(archiveFirstError) === "archived", "Group mutation bypassed an archive that won the lifecycle lock");
  const archiveFirstCount = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM group_expenses WHERE group_id = $1", [archiveFirstGroup.id]);
  assert(archiveFirstCount.rows[0]?.count === "0", "Archive-first Group race left post-archive activity");

  const mutationFirstOrganization = await createOrganization(database, owner.id, { name: "Organization mutation-first race" });
  organizationIds.push(mutationFirstOrganization.id);
  const mutationFirstScope = await orgScope(pool, mutationFirstOrganization.id);
  const destinationIds = [randomUUID(), randomUUID()];
  await pool.query(
    "INSERT INTO repayment_destinations (id, ledger_scope_id, type, name, identifier, sort_order) VALUES ($1, $3, 'bank_account', 'A', '1', 0), ($2, $3, 'bank_account', 'B', '2', 1)",
    [...destinationIds, mutationFirstScope],
  );
  const mutationFirstLedger = (await requireOrganizationLedgerAccess(database, mutationFirstOrganization.id, owner.id, "repayment_destinations.manage")).ledger;
  const releaseDestination = await holdRow(pool, "SELECT id FROM repayment_destinations WHERE id = $1 FOR UPDATE", [destinationIds[0]]);
  const reorderBeforeArchive = mutationFirstLedger.reorderRepaymentDestinations([destinationIds[1]!, destinationIds[0]!]);
  await waitForBlockedQuery(pool, "repayment_destinations");
  const organizationArchive = archiveOrganization(database, mutationFirstOrganization.id, owner.id);
  await releaseDestination();
  await reorderBeforeArchive;
  await organizationArchive;
  await restoreOrganization(database, mutationFirstOrganization.id, owner.id);
  await mutationFirstLedger.reorderRepaymentDestinations([destinationIds[0]!, destinationIds[1]!]);

  const archiveFirstOrganization = await createOrganization(database, owner.id, { name: "Organization archive-first race" });
  organizationIds.push(archiveFirstOrganization.id);
  const archiveFirstScope = await orgScope(pool, archiveFirstOrganization.id);
  const archiveFirstDestinationIds = [randomUUID(), randomUUID()];
  await pool.query(
    "INSERT INTO repayment_destinations (id, ledger_scope_id, type, name, identifier, sort_order) VALUES ($1, $3, 'bank_account', 'A', '1', 0), ($2, $3, 'bank_account', 'B', '2', 1)",
    [...archiveFirstDestinationIds, archiveFirstScope],
  );
  const organizationInvitation = await createOrganizationInvitation(database, archiveFirstOrganization.id, owner.id, { targetUserId: invitee.id, role: "member" });
  const releaseInvitation = await holdRow(pool, "SELECT id FROM organization_invitations WHERE id = $1 FOR UPDATE", [organizationInvitation.id]);
  const archiveFirstOrganizationArchive = archiveOrganization(database, archiveFirstOrganization.id, owner.id);
  await waitForBlockedQuery(pool, "organization_invitations");
  const archiveFirstReorder = (await requireOrganizationLedgerAccess(database, archiveFirstOrganization.id, owner.id, "repayment_destinations.manage")).ledger
    .reorderRepaymentDestinations([archiveFirstDestinationIds[1]!, archiveFirstDestinationIds[0]!])
    .then(() => undefined, (error) => error);
  await releaseInvitation();
  await archiveFirstOrganizationArchive;
  const archiveFirstReorderError = await archiveFirstReorder;
  assert(archiveFirstReorderError instanceof Error, "Organization reorder unexpectedly succeeded after archive");
}

type ArchiveSmokeContext = {
  pool: Pool;
  database: Database;
  owner: { id: string; username: string };
  member: { id: string; username: string };
  invitee: { id: string; username: string };
  groupIds: string[];
  organizationIds: string[];
};

async function runGroupArchiveSmoke({ pool, database, owner, member, invitee, groupIds }: ArchiveSmokeContext) {    // GROUP A: financially-empty Group permanently deletes, including chat rows.
    const emptyGroup = await createGroup(database, owner.id, { name: "Empty group" });
    groupIds.push(emptyGroup.id);
    await sendChatMessage(database, { scope: { type: "group", id: emptyGroup.id }, userId: owner.id, body: "hello" });
    assert(await deleteGroup(database, emptyGroup.id, owner.id) === true, "empty Group did not delete");
    const emptyGroupRows = await pool.query("SELECT count(*)::text AS count FROM groups WHERE id = $1", [emptyGroup.id]);
    assert(Number(emptyGroupRows.rows[0]?.count ?? 1) === 0, "empty Group row survived deletion");
    const emptyGroupLeftovers = await pool.query(
      "SELECT (SELECT count(*) FROM group_participants WHERE group_id = $1) + (SELECT count(*) FROM group_memberships WHERE group_id = $1) + (SELECT count(*) FROM chat_threads WHERE group_id = $1) + (SELECT count(*) FROM chat_messages WHERE group_id = $1) + (SELECT count(*) FROM group_join_requests WHERE group_id = $1) AS count",
      [emptyGroup.id],
    );
    assert(Number(emptyGroupLeftovers.rows[0]?.count ?? 1) === 0, "empty Group left non-financial descendants behind");

    // GROUP B: financial history blocks deletion, archive preserves every identity.
    const group = await createGroup(database, owner.id, { name: "History group" });
    groupIds.push(group.id);
    const ownerPid = await participantFor(pool, group.id, owner.id);
    const memberPid = await addGroupMember(pool, group.id, member.id);
    await createGroupExpense(database, group.id, owner.id, {
      description: "Dinner",
      occurredAt: new Date("2026-08-27T22:00:00.000Z"),
      totalAmount: 100,
      payerParticipantId: ownerPid,
      shares: [{ participantId: memberPid, amount: 100 }],
    });
    assert(await hasFinancialHistory(database, group.id) === true, "Group financial history was not detected");
    await expectCode(() => deleteGroup(database, group.id, owner.id), "financial_history", "Group with history deleted");
    const settlement = await createGroupSettlement(database, group.id, member.id, {
      senderParticipantId: memberPid,
      recipientParticipantId: ownerPid,
      amount: 40,
      paymentMethod: "Cash",
    });
    const invitation = await createGroupInvitation(database, group.id, owner.id, { targetUserId: invitee.id });
    const archived = await archiveGroup(database, group.id, owner.id);
    assert(archived.id === group.id, "archive changed the Group id");
    const preserved = await pool.query<{ participants: string; expenses: string; obligations: string; settlements: string }>(
      "SELECT (SELECT count(*)::text FROM group_participants WHERE group_id = $1) AS participants, (SELECT count(*)::text FROM group_expenses WHERE group_id = $1) AS expenses, (SELECT count(*)::text FROM group_obligations WHERE group_id = $1) AS obligations, (SELECT count(*)::text FROM group_settlements WHERE group_id = $1) AS settlements",
      [group.id],
    );
    assert(preserved.rows[0]?.participants === "2" && preserved.rows[0]?.expenses === "1" && preserved.rows[0]?.obligations === "1" && preserved.rows[0]?.settlements === "1", "archive altered Group financial facts");
    const memberPidAfter = await participantFor(pool, group.id, member.id);
    assert(memberPidAfter === memberPid, "archive changed participant identities");
    const inviteState = await pool.query<{ status: string }>("SELECT status FROM group_join_requests WHERE id = $1", [invitation.id]);
    assert(inviteState.rows[0]?.status === "revoked", "archive left a pending Group invitation activatable");
    await acceptGroupJoinRequest(database, invitee.id, invitation.id);
    const inviteeMembership = await pool.query("SELECT count(*)::text AS count FROM group_memberships WHERE group_id = $1 AND user_id = $2", [group.id, invitee.id]);
    assert(Number(inviteeMembership.rows[0]?.count ?? 1) === 0, "archived Group invitation activated a membership");
    await expectCode(() => createGroupInvitation(database, group.id, owner.id, { targetUserId: invitee.id }), "forbidden", "archived Group accepted a new invitation");
    await expectCode(() => deleteGroup(database, group.id, owner.id), "financial_history", "archived Group with history deleted");
    const activeGroups = await listGroups(database, owner.id);
    assert(!activeGroups.some((row) => row.id === group.id), "archived Group remained in the active list");
    const archivedGroups = await listGroups(database, owner.id, undefined, "archived");
    assert(archivedGroups.some((row) => row.id === group.id && row.archivedAt !== null), "archived Group missing from the archived list");
    await expectCode(() => createGroupExpense(database, group.id, owner.id, {
      description: "Late expense",
      occurredAt: new Date("2026-08-28T00:00:00.000Z"),
      totalAmount: 10,
      payerParticipantId: ownerPid,
      shares: [{ participantId: memberPid, amount: 10 }],
    }), "archived", "archived Group accepted a new expense");
    await expectCode(() => createExternalParticipant(database, group.id, owner.id, { displayName: "Latecomer" }), "archived", "archived Group accepted a new participant");
    await expectCode(() => updateGroup(database, group.id, owner.id, { name: "Renamed" }), "archived", "archived Group accepted a settings edit");
    await expectCode(() => sendChatMessage(database, { scope: { type: "group", id: group.id }, userId: owner.id, body: "late" }), "archived", "archived Group chat accepted a message");
    const confirmed = await confirmGroupSettlement(database, group.id, settlement.id, owner.id);
    assert(confirmed.state === "confirmed", "archived Group could not complete a pre-existing settlement");

    // Concurrent archive attempts serialize to the same archived lifecycle.
    const [firstArchive, secondArchive] = await Promise.all([archiveGroup(database, group.id, owner.id), archiveGroup(database, group.id, owner.id)]);
    assert(firstArchive.id === group.id && secondArchive.id === group.id, "concurrent archives diverged");

    // GROUP C: restore resumes the active lifecycle with identical identities.
    const restored = await restoreGroup(database, group.id, owner.id);
    assert(restored.id === group.id, "restore changed the Group id");
    assert((await listGroups(database, owner.id)).some((row) => row.id === group.id && row.archivedAt === null), "restored Group missing from the active list");
    assert(!(await listGroups(database, owner.id, undefined, "archived")).some((row) => row.id === group.id), "restored Group lingered in the archived list");
    assert((await participantFor(pool, group.id, member.id)) === memberPid, "restore changed participant identities");

}

async function runOrganizationArchiveSmoke({ pool, database, owner, invitee, organizationIds }: ArchiveSmokeContext) {
    // ORGANIZATION A: financially-unused Organization permanently deletes.
    const emptyOrg = await createOrganization(database, owner.id, { name: "Empty org" });
    organizationIds.push(emptyOrg.id);
    await sendChatMessage(database, { scope: { type: "organization", id: emptyOrg.id }, userId: owner.id, body: "hello" });
    assert(await deleteOrganization(database, emptyOrg.id, owner.id) === true, "empty Organization did not delete");
    const emptyOrgRows = await pool.query("SELECT count(*)::text AS count FROM organizations WHERE id = $1", [emptyOrg.id]);
    assert(Number(emptyOrgRows.rows[0]?.count ?? 1) === 0, "empty Organization row survived deletion");

    // ORGANIZATION B: ledger history blocks deletion, archive preserves the ledger scope.
    const org = await createOrganization(database, owner.id, { name: "History org" });
    organizationIds.push(org.id);
    const scopeId = await orgScope(pool, org.id);
    const friendId = randomUUID();
    const outingId = randomUUID();
    const expenseId = randomUUID();
    await pool.query("INSERT INTO friends (id, ledger_scope_id, name) VALUES ($1, $2, 'Friend')", [friendId, scopeId]);
    await pool.query("INSERT INTO outings (id, ledger_scope_id, title, occurred_at) VALUES ($1, $2, 'Trip', '2026-08-04T00:00:00Z')", [outingId, scopeId]);
    await pool.query("INSERT INTO expenses (id, ledger_scope_id, outing_id, description, amount) VALUES ($1, $2, $3, 'Dinner', 50000)", [expenseId, scopeId, outingId]);
    await pool.query("INSERT INTO expense_shares (id, ledger_scope_id, expense_id, friend_id, base_amount, amount_owed) VALUES ($1, $2, $3, $4, 50000, 50000)", [randomUUID(), scopeId, expenseId, friendId]);
    assert(await hasOrganizationFinancialHistory(database, org.id) === true, "Organization financial history was not detected");
    await expectCode(() => deleteOrganization(database, org.id, owner.id), "ledger_not_empty", "Organization with history deleted");
    const orgInvitation = await createOrganizationInvitation(database, org.id, owner.id, { targetUserId: invitee.id, role: "member" });
    const archivedOrg = await archiveOrganization(database, org.id, owner.id);
    assert(archivedOrg.id === org.id, "archive changed the Organization id");
    assert((await orgScope(pool, org.id)) === scopeId, "archive detached the Organization ledger scope");
    const orgExpenseRows = await pool.query("SELECT count(*)::text AS count FROM expenses WHERE ledger_scope_id = $1", [scopeId]);
    assert(Number(orgExpenseRows.rows[0]?.count ?? 0) === 1, "archive altered Organization ledger facts");
    const orgInviteState = await pool.query<{ status: string }>("SELECT status FROM organization_invitations WHERE id = $1", [orgInvitation.id]);
    assert(orgInviteState.rows[0]?.status === "revoked", "archive left a pending Organization invitation activatable");
    const orgAccept = await acceptOrganizationInvitation(database, invitee.id, orgInvitation.id);
    assert(orgAccept.changed === false, "archived Organization invitation changed state");
    const orgInviteeMembership = await pool.query("SELECT count(*)::text AS count FROM organization_memberships WHERE organization_id = $1 AND user_id = $2", [org.id, invitee.id]);
    assert(Number(orgInviteeMembership.rows[0]?.count ?? 1) === 0, "archived Organization invitation activated a membership");
    await expectCode(() => createOrganizationInvitation(database, org.id, owner.id, { targetUserId: invitee.id, role: "member" }), "forbidden", "archived Organization accepted a new invitation");
    await expectCode(() => deleteOrganization(database, org.id, owner.id), "ledger_not_empty", "archived Organization with history deleted");
    const activeOrgs = await listOrganizations(database, owner.id);
    assert(!activeOrgs.some((row) => row.id === org.id), "archived Organization remained in the active list");
    const archivedOrgs = await listOrganizations(database, owner.id, "archived");
    assert(archivedOrgs.some((row) => row.id === org.id && row.archivedAt !== null), "archived Organization missing from the archived list");
    await expectCode(() => createLocalOrganizationParticipant(database, org.id, owner.id, { displayName: "Latecomer" }), "archived", "archived Organization accepted a new member");
    await expectCode(() => updateOrganization(database, org.id, owner.id, { name: "Renamed" }), "archived", "archived Organization accepted a settings edit");
    await expectCode(() => sendChatMessage(database, { scope: { type: "organization", id: org.id }, userId: owner.id, body: "late" }), "archived", "archived Organization chat accepted a message");
    const writableForm = new FormData();
    writableForm.set("organizationId", org.id);
    await expectCode(() => assertOrganizationLedgerWritableFromForm(writableForm), "archived", "archived Organization accepted new ledger activity");
    const repaymentAccess = await requireOrganizationLedgerAccess(database, org.id, owner.id, "repayments.create");
    const repayment = await repaymentAccess.ledger.createRepayment({ friendId, amount: 10000, paidAt: new Date("2026-08-05T00:00:00.000Z"), paymentMethod: "Cash", notes: null });
    assert(repayment.friendId === friendId, "archived Organization could not record a historical repayment");

    // ORGANIZATION C: restore resumes the active lifecycle with identical identities.
    const restoredOrg = await restoreOrganization(database, org.id, owner.id);
    assert(restoredOrg.id === org.id, "restore changed the Organization id");
    assert((await listOrganizations(database, owner.id)).some((row) => row.id === org.id && row.archivedAt === null), "restored Organization missing from the active list");
    assert((await orgScope(pool, org.id)) === scopeId, "restore changed the Organization ledger scope");
}

async function cleanupArchiveSmoke({ pool, groupIds, organizationIds }: ArchiveSmokeContext, userIds: string[]) {
    await pool.query("DELETE FROM group_settlement_applications WHERE group_id = ANY($1::uuid[])", [groupIds]).catch(() => undefined);
    await pool.query("DELETE FROM group_offset_applications WHERE group_id = ANY($1::uuid[])", [groupIds]).catch(() => undefined);
    await pool.query("DELETE FROM group_settlements WHERE group_id = ANY($1::uuid[])", [groupIds]).catch(() => undefined);
    await pool.query("DELETE FROM group_offset_settlements WHERE group_id = ANY($1::uuid[])", [groupIds]).catch(() => undefined);
    await pool.query("DELETE FROM group_obligations WHERE group_id = ANY($1::uuid[])", [groupIds]).catch(() => undefined);
    await pool.query("DELETE FROM group_expense_shares WHERE group_id = ANY($1::uuid[])", [groupIds]).catch(() => undefined);
    await pool.query("DELETE FROM group_expenses WHERE group_id = ANY($1::uuid[])", [groupIds]).catch(() => undefined);
    await pool.query("DELETE FROM group_settlement_proofs WHERE group_id = ANY($1::uuid[])", [groupIds]).catch(() => undefined);
    await pool.query("DELETE FROM group_expense_receipts WHERE group_id = ANY($1::uuid[])", [groupIds]).catch(() => undefined);
    await pool.query("DELETE FROM group_expense_lifecycle_events WHERE group_id = ANY($1::uuid[])", [groupIds]).catch(() => undefined);
    await pool.query("DELETE FROM group_join_requests WHERE group_id = ANY($1::uuid[])", [groupIds]).catch(() => undefined);
    await pool.query("DELETE FROM chat_messages WHERE group_id = ANY($1::uuid[]) OR thread_id IN (SELECT id FROM chat_threads WHERE group_id = ANY($1::uuid[]))", [groupIds]).catch(() => undefined);
    await pool.query("DELETE FROM chat_threads WHERE group_id = ANY($1::uuid[])", [groupIds]).catch(() => undefined);
    await pool.query("DELETE FROM group_memberships WHERE group_id = ANY($1::uuid[])", [groupIds]).catch(() => undefined);
    await pool.query("DELETE FROM group_participants WHERE group_id = ANY($1::uuid[])", [groupIds]).catch(() => undefined);
    await pool.query("DELETE FROM group_avatars WHERE group_id = ANY($1::uuid[])", [groupIds]).catch(() => undefined);
    await pool.query("DELETE FROM groups WHERE id = ANY($1::uuid[])", [groupIds]).catch(() => undefined);
    const scopes = (await pool.query<{ id: string }>("SELECT id FROM ledger_scopes WHERE kind = 'organization' AND organization_id = ANY($1::uuid[])", [organizationIds]).catch(() => ({ rows: [] as Array<{ id: string }> }))).rows.map((row) => row.id);
    if (scopes.length > 0) {
      await pool.query("DELETE FROM repayment_allocations WHERE ledger_scope_id = ANY($1::uuid[])", [scopes]).catch(() => undefined);
      await pool.query("DELETE FROM repayment_proofs WHERE ledger_scope_id = ANY($1::uuid[])", [scopes]).catch(() => undefined);
      await pool.query("DELETE FROM repayments WHERE ledger_scope_id = ANY($1::uuid[])", [scopes]).catch(() => undefined);
      await pool.query("DELETE FROM expense_shares WHERE ledger_scope_id = ANY($1::uuid[])", [scopes]).catch(() => undefined);
      await pool.query("DELETE FROM expense_receipts WHERE ledger_scope_id = ANY($1::uuid[])", [scopes]).catch(() => undefined);
      await pool.query("DELETE FROM expenses WHERE ledger_scope_id = ANY($1::uuid[])", [scopes]).catch(() => undefined);
      await pool.query("DELETE FROM outings WHERE ledger_scope_id = ANY($1::uuid[])", [scopes]).catch(() => undefined);
      await pool.query("DELETE FROM friends WHERE ledger_scope_id = ANY($1::uuid[])", [scopes]).catch(() => undefined);
      await pool.query("DELETE FROM repayment_destinations WHERE ledger_scope_id = ANY($1::uuid[])", [scopes]).catch(() => undefined);
      await pool.query("DELETE FROM ledger_scopes WHERE id = ANY($1::uuid[])", [scopes]).catch(() => undefined);
    }
    await pool.query("DELETE FROM organization_invitations WHERE organization_id = ANY($1::uuid[])", [organizationIds]).catch(() => undefined);
    await pool.query("DELETE FROM chat_messages WHERE organization_id = ANY($1::uuid[]) OR thread_id IN (SELECT id FROM chat_threads WHERE organization_id = ANY($1::uuid[]))", [organizationIds]).catch(() => undefined);
    await pool.query("DELETE FROM chat_threads WHERE organization_id = ANY($1::uuid[])", [organizationIds]).catch(() => undefined);
    await pool.query("DELETE FROM organization_memberships WHERE organization_id = ANY($1::uuid[])", [organizationIds]).catch(() => undefined);
    await pool.query("DELETE FROM organization_participants WHERE organization_id = ANY($1::uuid[])", [organizationIds]).catch(() => undefined);
    await pool.query("DELETE FROM organization_avatars WHERE organization_id = ANY($1::uuid[])", [organizationIds]).catch(() => undefined);
    await pool.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [organizationIds]).catch(() => undefined);
    await pool.query("DELETE FROM notifications WHERE recipient_user_id = ANY($1)", [userIds]).catch(() => undefined);
    await pool.query("DELETE FROM users WHERE id = ANY($1)", [userIds]).catch(() => undefined);
}

export async function runWorkspaceArchiveSmoke() {
  const config = readDatabaseConfig("zplit_test");
  const pool = new Pool({ ...config, max: 8, connectionTimeoutMillis: 5_000 });
  const database = drizzle(pool, { schema });
  const tag = randomUUID().replaceAll("-", "").slice(0, 6);
  const owner = { id: randomUUID(), username: `warch_owner_${tag}` };
  const member = { id: randomUUID(), username: `warch_member_${tag}` };
  const invitee = { id: randomUUID(), username: `warch_invitee_${tag}` };
  const context: ArchiveSmokeContext = { pool, database, owner, member, invitee, groupIds: [], organizationIds: [] };
  const userIds = [owner.id, member.id, invitee.id];

  try {
    const archivedColumns = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'archived_at' AND table_name IN ('groups', 'organizations')",
    );
    assert(Number(archivedColumns.rows[0]?.count ?? 0) === 2, "archive migration (groups/organizations.archived_at) is not applied");

    for (const user of [owner, member, invitee]) {
      await pool.query("INSERT INTO users (id, name, email, username, email_verified) VALUES ($1, $2, $3, $4, true)", [user.id, user.username, `${user.id}@example.com`, user.username]);
    }

    await runGroupArchiveSmoke(context);
    await runOrganizationArchiveSmoke(context);
    await runInvitationAcceptanceRaces(context);
    await runLifecycleRaces(context);
    console.log("workspace archive smoke passed");
  } catch (error) {
    console.error(`workspace archive smoke failed: ${formatSafeError(error)}`);
    process.exitCode = 1;
  } finally {
    await cleanupArchiveSmoke(context, userIds);
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith("workspace-archive-smoke.ts")) await runWorkspaceArchiveSmoke();
