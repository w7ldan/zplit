import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { formatSafeError, readDatabaseConfig } from "./migrate.js";

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
if (!require.cache[serverOnlyPath]) require.cache[serverOnlyPath] = { exports: {} } as never;
const { acceptGroupJoinRequest, createGroupInvitation, createGroupParticipantLinkRequest, declineGroupJoinRequest, getGroupJoinRequestStatuses, revokeGroupJoinRequest } = await import("../src/server/group-join-requests");
const { createExternalParticipant, createGroup, deleteExternalParticipant, removeGroupMember } = await import("../src/server/groups");

function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function count(pool: Pool, statement: string, values: unknown[]) {
  const result = await pool.query<{ count: string }>(statement, values);
  return Number(result.rows[0]?.count ?? 0);
}

async function installMembershipFailure(pool: Pool, groupId: string, targetUserId: string) {
  await pool.query("DROP TRIGGER IF EXISTS zplit_smoke_fail_group_membership_trigger ON group_memberships");
  await pool.query("DROP FUNCTION IF EXISTS zplit_smoke_fail_group_membership()");
  await pool.query(`CREATE FUNCTION zplit_smoke_fail_group_membership() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.group_id = ${sqlLiteral(groupId)}::uuid AND NEW.user_id = ${sqlLiteral(targetUserId)} THEN
    RAISE EXCEPTION 'forced Group membership failure';
  END IF;
  RETURN NEW;
END;
$function$`);
  await pool.query("CREATE TRIGGER zplit_smoke_fail_group_membership_trigger BEFORE INSERT ON group_memberships FOR EACH ROW EXECUTE FUNCTION zplit_smoke_fail_group_membership()");
}

async function removeMembershipFailure(pool: Pool) {
  await pool.query("DROP TRIGGER IF EXISTS zplit_smoke_fail_group_membership_trigger ON group_memberships");
  await pool.query("DROP FUNCTION IF EXISTS zplit_smoke_fail_group_membership()");
}

export async function runGroupJoinRequestSmoke() {
  const config = readDatabaseConfig("zplit_test");
  const pool = new Pool({ ...config, max: 8, connectionTimeoutMillis: 5_000 });
  const database = drizzle(pool, { schema });
  const users = Array.from({ length: 6 }, (_, index) => {
    const id = randomUUID();
    return { id, name: ["Smoke Owner", "Smoke Alice", "Smoke Bob", "Smoke Carol", "Smoke Dana", "Smoke Eve"][index], username: `smoke_${id.replaceAll("-", "").slice(0, 8)}` };
  });
  const [owner, alice, bob, carol, dana, eve] = users;
  const groupIds: string[] = [];

  try {
    for (const user of users) {
      await pool.query("INSERT INTO users (id, name, email, username, email_verified) VALUES ($1, $2, $3, $4, true)", [user.id, user.name, `${user.id}@example.com`, user.username]);
    }

    const doubleInvitationGroup = await createGroup(database, owner.id, { name: "Smoke double invitation" });
    groupIds.push(doubleInvitationGroup.id);
    const invitation = await createGroupInvitation(database, doubleInvitationGroup.id, owner.id, alice.username);
    const invitationAccepts = await Promise.allSettled([
      acceptGroupJoinRequest(database, alice.id, invitation.id),
      acceptGroupJoinRequest(database, alice.id, invitation.id),
    ]);
    assert(invitationAccepts.every((result) => result.status === "fulfilled"), "double invitation acceptance did not observe one terminal request");
    assert(await count(pool, "SELECT count(*)::text AS count FROM group_participants WHERE group_id = $1 AND user_id = $2", [doubleInvitationGroup.id, alice.id]) === 1, "double invitation created duplicate registered participants");
    assert(await count(pool, "SELECT count(*)::text AS count FROM group_memberships WHERE group_id = $1 AND user_id = $2", [doubleInvitationGroup.id, alice.id]) === 1, "double invitation created duplicate memberships");
    assert(await count(pool, "SELECT count(*)::text AS count FROM group_join_requests WHERE id = $1 AND status = 'accepted'", [invitation.id]) === 1, "double invitation did not leave one accepted request");

    const doubleLinkGroup = await createGroup(database, owner.id, { name: "Smoke double link" });
    groupIds.push(doubleLinkGroup.id);
    const doubleLinkParticipant = await createExternalParticipant(database, doubleLinkGroup.id, owner.id, { displayName: "Double Link", label: "Smoke" });
    const link = await createGroupParticipantLinkRequest(database, doubleLinkGroup.id, doubleLinkParticipant.id, owner.id, bob.username);
    const linkAccepts = await Promise.allSettled([
      acceptGroupJoinRequest(database, bob.id, link.id),
      acceptGroupJoinRequest(database, bob.id, link.id),
    ]);
    assert(linkAccepts.every((result) => result.status === "fulfilled"), "double participant-link acceptance did not observe one terminal request");
    assert(await count(pool, "SELECT count(*)::text AS count FROM group_participants WHERE group_id = $1 AND user_id = $2", [doubleLinkGroup.id, bob.id]) === 1, "double participant link created duplicate registered participants");
    assert(await count(pool, "SELECT count(*)::text AS count FROM group_memberships WHERE group_id = $1 AND user_id = $2", [doubleLinkGroup.id, bob.id]) === 1, "double participant link created duplicate memberships");
    assert(await count(pool, "SELECT count(*)::text AS count FROM group_join_requests WHERE id = $1 AND status = 'accepted'", [link.id]) === 1, "double participant link did not leave one accepted request");

    const competitionGroup = await createGroup(database, owner.id, { name: "Smoke invitation versus link" });
    groupIds.push(competitionGroup.id);
    const competitionParticipant = await createExternalParticipant(database, competitionGroup.id, owner.id, { displayName: "Competition", label: null });
    const competingRequests = await Promise.allSettled([
      createGroupInvitation(database, competitionGroup.id, owner.id, alice.username),
      createGroupParticipantLinkRequest(database, competitionGroup.id, competitionParticipant.id, owner.id, alice.username),
    ]);
    assert(competingRequests.filter((result) => result.status === "fulfilled").length === 1, "invitation versus link did not have one creation winner");
    assert(competingRequests.filter((result) => result.status === "rejected").length === 1, "invitation versus link allowed both requests");
    const winningRequest = competingRequests.find((result): result is PromiseFulfilledResult<typeof invitation> => result.status === "fulfilled")?.value;
    assert(winningRequest, "invitation versus link produced no request");
    await acceptGroupJoinRequest(database, alice.id, winningRequest.id);
    assert(await count(pool, "SELECT count(*)::text AS count FROM group_participants WHERE group_id = $1 AND user_id = $2", [competitionGroup.id, alice.id]) === 1, "invitation versus link created duplicate registered identities");
    assert(await count(pool, "SELECT count(*)::text AS count FROM group_memberships WHERE group_id = $1 AND user_id = $2", [competitionGroup.id, alice.id]) === 1, "invitation versus link created duplicate memberships");

    const rollbackGroup = await createGroup(database, owner.id, { name: "Smoke link rollback" });
    groupIds.push(rollbackGroup.id);
    const rollbackParticipant = await createExternalParticipant(database, rollbackGroup.id, owner.id, { displayName: "Rollback", label: null });
    const rollbackRequest = await createGroupParticipantLinkRequest(database, rollbackGroup.id, rollbackParticipant.id, owner.id, bob.username);
    await installMembershipFailure(pool, rollbackGroup.id, bob.id);
    try {
      await acceptGroupJoinRequest(database, bob.id, rollbackRequest.id);
      throw new Error("forced link membership failure was not raised");
    } catch (error) {
      const errorMessage = error instanceof Error ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}` : "unknown error";
      assert(errorMessage.includes("forced Group membership failure"), `unexpected forced link failure result: ${errorMessage}`);
    } finally {
      await removeMembershipFailure(pool);
    }
    const rollbackParticipantResult = await pool.query<{ user_id: string | null }>("SELECT user_id FROM group_participants WHERE group_id = $1 AND id = $2", [rollbackGroup.id, rollbackParticipant.id]);
    assert(rollbackParticipantResult.rows[0]?.user_id === null, "failed link acceptance left a registered participant");
    assert(await count(pool, "SELECT count(*)::text AS count FROM group_memberships WHERE group_id = $1 AND user_id = $2", [rollbackGroup.id, bob.id]) === 0, "failed link acceptance left a membership");
    assert(await count(pool, "SELECT count(*)::text AS count FROM group_join_requests WHERE id = $1 AND status = 'pending'", [rollbackRequest.id]) === 1, "failed link acceptance changed request state");

    const historyGroup = await createGroup(database, owner.id, { name: "Smoke request history" });
    groupIds.push(historyGroup.id);
    const acceptedParticipant = await createExternalParticipant(database, historyGroup.id, owner.id, { displayName: "Accepted Taxi", label: "Driver" });
    const acceptedRequest = await createGroupParticipantLinkRequest(database, historyGroup.id, acceptedParticipant.id, owner.id, alice.username);
    await acceptGroupJoinRequest(database, alice.id, acceptedRequest.id);
    await removeGroupMember(database, historyGroup.id, owner.id, alice.id);
    const acceptedHistory = await pool.query<{ status: string; participant_id: string | null; participant_display_name_snapshot: string }>("SELECT status, participant_id, participant_display_name_snapshot FROM group_join_requests WHERE id = $1", [acceptedRequest.id]);
    assert(acceptedHistory.rows[0]?.status === "accepted" && acceptedHistory.rows[0]?.participant_id === null && acceptedHistory.rows[0]?.participant_display_name_snapshot === "Accepted Taxi", "accepted link history was not retained after member removal");
    assert(await count(pool, "SELECT count(*)::text AS count FROM group_memberships WHERE group_id = $1 AND user_id = $2", [historyGroup.id, alice.id]) === 0, "member removal left membership state");
    assert(await count(pool, "SELECT count(*)::text AS count FROM group_participants WHERE group_id = $1 AND id = $2", [historyGroup.id, acceptedParticipant.id]) === 0, "member removal left registered participant state");
    const acceptedNotification = await pool.query<{ participant_display_name: string }>("SELECT metadata ->> 'participantDisplayName' AS participant_display_name FROM notifications WHERE recipient_user_id = $1 AND type = 'group.participant.link.request' AND metadata ->> 'requestId' = $2", [alice.id, acceptedRequest.id]);
    assert(acceptedNotification.rows[0]?.participant_display_name === "Accepted Taxi", "historical notification lost request-time participant context");

    const declinedParticipant = await createExternalParticipant(database, historyGroup.id, owner.id, { displayName: "Declined Taxi", label: null });
    const declinedRequest = await createGroupParticipantLinkRequest(database, historyGroup.id, declinedParticipant.id, owner.id, bob.username);
    await declineGroupJoinRequest(database, bob.id, declinedRequest.id);
    const revokedParticipant = await createExternalParticipant(database, historyGroup.id, owner.id, { displayName: "Revoked Taxi", label: null });
    const revokedRequest = await createGroupParticipantLinkRequest(database, historyGroup.id, revokedParticipant.id, owner.id, carol.username);
    await revokeGroupJoinRequest(database, historyGroup.id, owner.id, revokedRequest.id);
    const expiredParticipant = await createExternalParticipant(database, historyGroup.id, owner.id, { displayName: "Expired Taxi", label: null });
    const expiredRequest = await createGroupParticipantLinkRequest(database, historyGroup.id, expiredParticipant.id, owner.id, dana.username);
    await pool.query("UPDATE group_join_requests SET created_at = $1, expires_at = $2 WHERE id = $3", [new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), new Date(Date.now() - 24 * 60 * 60 * 1000), expiredRequest.id]);
    const expiredState = await getGroupJoinRequestStatuses(database, dana.id, [expiredRequest.id]);
    assert(expiredState.get(expiredRequest.id)?.status === "expired", "expired history was not terminalized");
    const pendingParticipant = await createExternalParticipant(database, historyGroup.id, owner.id, { displayName: "Pending Taxi", label: null });
    const pendingRequest = await createGroupParticipantLinkRequest(database, historyGroup.id, pendingParticipant.id, owner.id, eve.username);
    await deleteExternalParticipant(database, historyGroup.id, owner.id, declinedParticipant.id);
    await deleteExternalParticipant(database, historyGroup.id, owner.id, revokedParticipant.id);
    await deleteExternalParticipant(database, historyGroup.id, owner.id, expiredParticipant.id);
    await deleteExternalParticipant(database, historyGroup.id, owner.id, pendingParticipant.id);
    const terminalHistory = await pool.query<{ id: string; status: string; participant_id: string | null; participant_display_name_snapshot: string }>("SELECT id, status, participant_id, participant_display_name_snapshot FROM group_join_requests WHERE id = ANY($1::uuid[]) ORDER BY id", [[declinedRequest.id, revokedRequest.id, expiredRequest.id, pendingRequest.id]]);
    assert(terminalHistory.rowCount === 4 && terminalHistory.rows.every((row) => row.participant_id === null), "external participant deletion did not preserve terminal request history");
    assert(new Map(terminalHistory.rows.map((row) => [row.participant_display_name_snapshot, row.status])).get("Declined Taxi") === "declined", "declined request history changed");
    assert(new Map(terminalHistory.rows.map((row) => [row.participant_display_name_snapshot, row.status])).get("Revoked Taxi") === "revoked", "revoked request history changed");
    assert(new Map(terminalHistory.rows.map((row) => [row.participant_display_name_snapshot, row.status])).get("Expired Taxi") === "expired", "expired request history changed");
    assert(new Map(terminalHistory.rows.map((row) => [row.participant_display_name_snapshot, row.status])).get("Pending Taxi") === "revoked", "pending request was still actionable during participant deletion");

    const expiryGroup = await createGroup(database, owner.id, { name: "Smoke participant expiry" });
    groupIds.push(expiryGroup.id);
    const expiryParticipant = await createExternalParticipant(database, expiryGroup.id, owner.id, { displayName: "Relinkable", label: "Old" });
    const oldLink = await createGroupParticipantLinkRequest(database, expiryGroup.id, expiryParticipant.id, owner.id, alice.username);
    const oldTargetInvitation = await createGroupInvitation(database, expiryGroup.id, owner.id, bob.username);
    const oldCreatedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const oldExpiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await pool.query("UPDATE group_join_requests SET created_at = $1, expires_at = $2 WHERE id = ANY($3::uuid[])", [oldCreatedAt, oldExpiresAt, [oldLink.id, oldTargetInvitation.id]]);
    const newLink = await createGroupParticipantLinkRequest(database, expiryGroup.id, expiryParticipant.id, owner.id, bob.username);
    const expiryRows = await pool.query<{ id: string; status: string; participant_id: string | null }>("SELECT id, status, participant_id FROM group_join_requests WHERE id = ANY($1::uuid[]) ORDER BY created_at, id", [[oldLink.id, oldTargetInvitation.id, newLink.id]]);
    assert(expiryRows.rows.filter((row) => row.status === "expired").length === 2 && expiryRows.rows.some((row) => row.id === newLink.id && row.status === "pending" && row.participant_id === expiryParticipant.id), "expired target or participant conflict blocked relinking");

    await removeMembershipFailure(pool);
    console.log("Group join request PostgreSQL smoke passed");
  } catch (error) {
    console.error(`Group join request PostgreSQL smoke failed: ${formatSafeError(error, config.password)}`);
    process.exitCode = 1;
  } finally {
    try {
      await removeMembershipFailure(pool);
      if (groupIds.length) await pool.query("DELETE FROM groups WHERE id = ANY($1::uuid[])", [groupIds]);
      await pool.query("DELETE FROM users WHERE id = ANY($1::text[])", [users.map((user) => user.id)]);
    } finally {
      await pool.end();
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void runGroupJoinRequestSmoke();
