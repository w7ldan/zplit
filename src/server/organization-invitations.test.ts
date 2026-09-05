import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";

const mocks = vi.hoisted(() => ({
  createNotificationInDatabase: vi.fn(),
  publishNotificationStateChange: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/notifications", () => ({ createNotificationInDatabase: mocks.createNotificationInDatabase, publishNotificationStateChange: mocks.publishNotificationStateChange }));

import {
  acceptOrganizationInvitation,
  createOrganizationInvitation,
  declineOrganizationInvitation,
  revokeOrganizationInvitation,
  searchOrganizationInvitationUsers,
} from "./organization-invitations";

const organizationId = "11111111-1111-4111-8111-111111111111";
const invitationId = "22222222-2222-4222-8222-222222222222";
const targetUserId = "target-user";
const inviterUserId = "inviter-user";
const createdAt = new Date("2026-08-25T00:00:00.000Z");

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: invitationId,
    organizationId,
    targetUserId,
    invitedByUserId: inviterUserId,
    role: "member",
    status: "pending",
    createdAt,
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    updatedAt: createdAt,
    acceptedAt: null,
    declinedAt: null,
    revokedAt: null,
    expiredAt: null,
    participantId: null,
    ...overrides,
  };
}

function queryBuilder(result: unknown) {
  type Query = Record<string, ReturnType<typeof vi.fn>> & { then: Promise<unknown>["then"] };
  const chain = {} as Query;
  for (const method of ["from", "innerJoin", "leftJoin", "where", "limit", "orderBy", "for", "set", "values", "onConflictDoNothing"]) chain[method] = vi.fn(() => chain);
  chain.returning = vi.fn(async () => result);
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function database(selectResults: unknown[][], insertResults: unknown[][] = [], updateResults: unknown[][] = []) {
  const selects = [...selectResults];
  const inserts = [...insertResults];
  const updates = [...updateResults];
  const db = {
    select: vi.fn(() => queryBuilder(selects.shift() ?? [])),
    insert: vi.fn(() => queryBuilder(inserts.shift() ?? [])),
    update: vi.fn(() => queryBuilder(updates.shift() ?? [])),
    transaction: vi.fn(async (callback: (transaction: Database) => unknown) => callback(db as unknown as Database)),
  };
  return db as unknown as Database & { insert: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn> };
}

function access(role: string, customCapabilities: string[] = []) {
  return { role, customCapabilities };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createNotificationInDatabase.mockResolvedValue({ id: "notification-a" });
});

describe("Organization invitation policy and creation", () => {
  it.each([
    ["owner", "admin", true],
    ["owner", "treasurer", true],
    ["owner", "member", true],
    ["admin", "admin", true],
    ["admin", "treasurer", true],
    ["admin", "member", true],
    ["treasurer", "member", false],
    ["member", "member", false],
    ["custom", "member", true],
    ["custom", "admin", false],
  ] as const)("enforces %s inviting %s", async (inviterRole, invitedRole, allowed) => {
    const db = database([
      [access(inviterRole, inviterRole === "custom" ? ["members.invite"] : [])],
      [{ id: targetUserId, name: "Target", username: "target" }],
      [],
      [],
      [{ name: "Team" }],
      [{ name: "Inviter" }],
    ], [[invitation({ role: invitedRole })]]);
    const result = createOrganizationInvitation(db, organizationId, inviterUserId, { username: "@TARGET", role: invitedRole });
    if (allowed) await expect(result).resolves.toMatchObject({ role: invitedRole, targetUserId });
    else await expect(result).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rejects elevated roles for a Custom actor unless the complete preset is granted", async () => {
    const db = database([[access("custom", ["members.invite", "roles.manage", "organization.view", "members.view"])]
    ]);
    await expect(createOrganizationInvitation(db, organizationId, inviterUserId, { username: "target", role: "treasurer" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("resolves the exact normalized username and creates one notification in the transaction", async () => {
    const db = database([
      [access("owner")],
      [{ id: targetUserId, name: "Target", username: "target" }],
      [],
      [],
      [{ name: "Team" }],
      [{ name: "Inviter" }],
    ], [[invitation({ role: "treasurer" })]]);
    await expect(createOrganizationInvitation(db, organizationId, inviterUserId, { username: " @TARGET ", role: "treasurer" })).resolves.toMatchObject({ role: "treasurer" });
    expect(mocks.createNotificationInDatabase).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      recipientUserId: targetUserId,
      type: "organization.invitation",
      dedupeKey: `organization-invitation:${invitationId}`,
      metadata: expect.objectContaining({ organizationId, role: "treasurer" }),
    }));
    expect(mocks.publishNotificationStateChange).toHaveBeenCalledWith(targetUserId, "created");
  });

  it("accepts a selected canonical target user id", async () => {
    const db = database([
      [access("owner")],
      [{ id: targetUserId, name: "Target", username: "target" }],
      [],
      [],
      [{ name: "Team" }],
      [{ name: "Inviter" }],
    ], [[invitation()]]);

    await expect(
      createOrganizationInvitation(db, organizationId, inviterUserId, { targetUserId, role: "member" }),
    ).resolves.toMatchObject({ targetUserId });
  });

  it("refuses new invitations for archived Organizations", async () => {
    const db = database([
      [access("owner")],
      [{ id: targetUserId, name: "Target", username: "target" }],
      [],
      [],
      [{ name: "Team", archivedAt: new Date("2026-01-01T00:00:00.000Z") }],
      [{ name: "Inviter" }],
    ]);
    await expect(
      createOrganizationInvitation(db, organizationId, inviterUserId, { targetUserId, role: "member" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("searches username prefixes only, excludes the inviter and members, and preserves the exact projection", async () => {
    const db = database([[access("owner")], [{ userId: "existing-member" }], [], [{ id: targetUserId, username: "target", displayName: "Target" }]]);
    await expect(searchOrganizationInvitationUsers(db, organizationId, inviterUserId, "@TAR")).resolves.toEqual([{ id: targetUserId, username: "target", displayName: "Target" }]);
    const emailDb = database([[access("owner")], []]);
    await expect(searchOrganizationInvitationUsers(emailDb, organizationId, inviterUserId, "target@example.com")).resolves.toEqual([]);
  });

  it("keeps invitation authority scoped to the requested Organization", async () => {
    const db = database([
      [access("owner")],
      [{ id: targetUserId, name: "Target", username: "target" }],
      [],
      [],
      [{ name: "Organization A" }],
      [{ name: "Inviter" }],
      [access("member")],
    ], [[invitation()]]);
    await expect(createOrganizationInvitation(db, organizationId, inviterUserId, { username: "target", role: "member" })).resolves.toBeDefined();
    await expect(createOrganizationInvitation(db, "33333333-3333-4333-8333-333333333333", inviterUserId, { username: "target", role: "member" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("fails closed for crafted roles and email-shaped usernames", async () => {
    const invalidRoleDb = database([[access("owner")]]);
    await expect(createOrganizationInvitation(invalidRoleDb, organizationId, inviterUserId, { username: "owner", role: "owner" })).rejects.toMatchObject({ code: "invalid_role" });
    const emailDb = database([[access("owner")]]);
    await expect(createOrganizationInvitation(emailDb, organizationId, inviterUserId, { username: "email@example.com", role: "member" })).rejects.toMatchObject({ code: "invalid_target" });
  });

  it("rejects self, existing members, duplicate pending rows, and permits reinvite after expiry", async () => {
    const selfDb = database([[access("owner")], [{ id: inviterUserId, name: "Inviter", username: "inviter" }]]);
    await expect(createOrganizationInvitation(selfDb, organizationId, inviterUserId, { username: "inviter", role: "member" })).rejects.toMatchObject({ code: "self" });

    const memberDb = database([[access("owner")], [{ id: targetUserId, name: "Target", username: "target" }], [{ userId: targetUserId }]]);
    await expect(createOrganizationInvitation(memberDb, organizationId, inviterUserId, { username: "target", role: "member" })).rejects.toMatchObject({ code: "already_member" });

    const duplicateDb = database([[access("owner")], [{ id: targetUserId, name: "Target", username: "target" }], [], [invitation()]]);
    await expect(createOrganizationInvitation(duplicateDb, organizationId, inviterUserId, { username: "target", role: "member" })).rejects.toMatchObject({ code: "duplicate" });

    const expired = invitation({ expiresAt: new Date("2026-08-24T00:00:00.000Z") });
    const reinviteDb = database([[access("owner")], [{ id: targetUserId, name: "Target", username: "target" }], [], [expired], [{ name: "Team" }], [{ name: "Inviter" }]], [[invitation()]], [[expired]]);
    await expect(createOrganizationInvitation(reinviteDb, organizationId, inviterUserId, { username: "target", role: "member" })).resolves.toBeDefined();

    const participantId = "33333333-3333-4333-8333-333333333333";
    const targetDuplicateDb = database([
      [access("owner")],
      [{ id: targetUserId, name: "Target", username: "target" }],
      [{ id: participantId, userId: null, sourcePersonalFriendId: null }],
      [{ id: participantId, userId: null, sourcePersonalFriendId: null }],
      [],
      [],
      [invitation({ participantId })],
    ]);
    await expect(createOrganizationInvitation(targetDuplicateDb, organizationId, inviterUserId, { targetUserId, participantId, role: "member" })).rejects.toMatchObject({ code: "duplicate" });
  });

  it("rejects a second pending invitation for the same participant", async () => {
    const participantId = "33333333-3333-4333-8333-333333333333";
    const pending = invitation({ targetUserId: "alice", participantId });
    const db = database([
      [access("owner")],
      [{ id: "bob", name: "Bob", username: "bob" }],
      [{ id: participantId, userId: null, sourcePersonalFriendId: null }],
      [{ id: participantId, userId: null, sourcePersonalFriendId: null }],
      [pending],
    ]);

    await expect(createOrganizationInvitation(db, organizationId, inviterUserId, { targetUserId: "bob", participantId, role: "member" })).rejects.toMatchObject({ code: "duplicate" });
    expect(db.insert).not.toHaveBeenCalled();
    expect(mocks.createNotificationInDatabase).not.toHaveBeenCalled();
  });

  it("expires a participant invitation before allowing a reinvite", async () => {
    const participantId = "33333333-3333-4333-8333-333333333333";
    const expired = invitation({ targetUserId: "alice", participantId, expiresAt: new Date("2026-08-24T00:00:00.000Z") });
    const created = invitation({ targetUserId: "bob", participantId });
    const db = database([
      [access("owner")],
      [{ id: "bob", name: "Bob", username: "bob" }],
      [{ id: participantId, userId: null, sourcePersonalFriendId: null }],
      [{ id: participantId, userId: null, sourcePersonalFriendId: null }],
      [expired],
      [],
      [],
      [{ name: "Team" }],
      [{ name: "Inviter" }],
    ], [[created]], [[expired]]);

    await expect(createOrganizationInvitation(db, organizationId, inviterUserId, { targetUserId: "bob", participantId, role: "member" })).resolves.toMatchObject({ participantId });
    expect(db.insert).toHaveBeenCalledOnce();
  });

  it("allows pending invitations for different participants", async () => {
    const participantId = "33333333-3333-4333-8333-333333333333";
    const otherParticipantId = "44444444-4444-4444-8444-444444444444";
    const db = database([
      [access("owner")],
      [{ id: "bob", name: "Bob", username: "bob" }],
      [{ id: otherParticipantId, userId: null, sourcePersonalFriendId: null }],
      [{ id: otherParticipantId, userId: null, sourcePersonalFriendId: null }],
      [],
      [],
      [],
      [{ name: "Team" }],
      [{ name: "Inviter" }],
    ], [[invitation({ targetUserId: "alice", participantId })]]);

    await expect(createOrganizationInvitation(db, organizationId, inviterUserId, { targetUserId: "bob", participantId: otherParticipantId, role: "member" })).resolves.toBeDefined();
  });

  it("only allows a source-linked participant to invite its linked user", async () => {
    const participantId = "33333333-3333-4333-8333-333333333333";
    const friendId = "44444444-4444-4444-8444-444444444444";
    const participant = { id: participantId, userId: null, sourcePersonalFriendId: friendId };
    const base = [
      [access("owner")],
      [{ id: "target", name: "Target", username: "target" }],
      [participant],
      [{ linkedUserId: "target" }],
      [participant],
    ];
    const allowedDb = database([...base, [], [], [], [{ name: "Team" }], [{ name: "Inviter" }]], [[invitation({ targetUserId: "target", participantId })]]);
    await expect(createOrganizationInvitation(allowedDb, organizationId, inviterUserId, { targetUserId: "target", participantId, role: "member" })).resolves.toBeDefined();

    const rejectedDb = database([
      [access("owner")],
      [{ id: "unrelated", name: "Unrelated", username: "unrelated" }],
      [participant],
      [{ linkedUserId: "target" }],
      [participant],
    ]);
    await expect(createOrganizationInvitation(rejectedDb, organizationId, inviterUserId, { targetUserId: "unrelated", participantId, role: "member" })).rejects.toMatchObject({ code: "participant_not_found" });
    expect(rejectedDb.insert).not.toHaveBeenCalled();
    expect(mocks.createNotificationInDatabase).toHaveBeenCalledTimes(1);
  });

  it("allows an explicitly selected account for a direct local participant", async () => {
    const participantId = "33333333-3333-4333-8333-333333333333";
    const db = database([
      [access("owner")],
      [{ id: "target", name: "Target", username: "target" }],
      [{ id: participantId, userId: null, sourcePersonalFriendId: null }],
      [{ id: participantId, userId: null, sourcePersonalFriendId: null }],
      [],
      [],
      [],
      [{ name: "Team" }],
      [{ name: "Inviter" }],
    ], [[invitation({ targetUserId: "target", participantId })]]);

    await expect(createOrganizationInvitation(db, organizationId, inviterUserId, { targetUserId: "target", participantId, role: "member" })).resolves.toBeDefined();
  });

  it("rejects a participant-bound invitation to a different registered participant identity", async () => {
    const participantId = "33333333-3333-4333-8333-333333333333";
    const db = database([
      [access("owner")],
      [{ id: "unrelated", name: "Unrelated", username: "unrelated" }],
      [{ id: participantId, userId: "user-a", sourcePersonalFriendId: null }],
      [{ id: participantId, userId: "user-a", sourcePersonalFriendId: null }],
    ]);

    await expect(createOrganizationInvitation(db, organizationId, inviterUserId, { targetUserId: "unrelated", participantId, role: "member" })).rejects.toMatchObject({ code: "participant_not_found" });
  });
});

describe("Organization invitation responses", () => {
  it("accepts for the target, captures the role, defaults Custom capabilities, and resolves the notification", async () => {
    const accepted = invitation({ role: "admin", status: "accepted", acceptedAt: new Date(), updatedAt: new Date() });
    const db = database([
      [invitation({ role: "admin" })],
      [{ id: organizationId }],
      [access("owner")],
      [],
      [],
    ], [[{ id: "participant-target" }], [{ organizationId, userId: targetUserId, participantId: "participant-target", role: "admin", customCapabilities: [] }]], [[accepted], []]);
    await expect(acceptOrganizationInvitation(db, targetUserId, invitationId)).resolves.toMatchObject({ status: "accepted" });
    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(mocks.publishNotificationStateChange).toHaveBeenCalledWith(targetUserId, "resolved");
    expect(mocks.createNotificationInDatabase).toHaveBeenCalledWith(db, expect.objectContaining({
      recipientUserId: inviterUserId,
      type: "organization.invitation.outcome",
      metadata: { invitationId, organizationId, status: "accepted" },
      dedupeKey: `organization-invitation-outcome:${invitationId}:accepted`,
    }));
  });

  it("binds a direct local Organization participant during invitation acceptance", async () => {
    const participantId = "33333333-3333-4333-8333-333333333333";
    const accepted = invitation({ participantId, status: "accepted", acceptedAt: new Date(), updatedAt: new Date() });
    const db = database([
      [invitation({ participantId })],
      [{ id: organizationId }],
      [access("owner")],
      [],
      [{ id: participantId, userId: null, sourcePersonalFriendId: null }],
      [{ id: participantId, userId: null, sourcePersonalFriendId: null }],
      [],
    ], [[{ organizationId, userId: targetUserId, participantId, role: "member", customCapabilities: [] }]], [[{ id: participantId }], [accepted], []]);

    await expect(acceptOrganizationInvitation(db, targetUserId, invitationId)).resolves.toMatchObject({ status: "accepted" });
    expect(db.insert).toHaveBeenCalledOnce();
    expect(db.update).toHaveBeenCalledWith(expect.anything());
  });

  it("accepts a compatible source-linked invitation without replacing the participant", async () => {
    const participantId = "33333333-3333-4333-8333-333333333333";
    const friendId = "44444444-4444-4444-8444-444444444444";
    const accepted = invitation({ participantId, status: "accepted", acceptedAt: new Date(), updatedAt: new Date() });
    const participant = { id: participantId, userId: null, sourcePersonalFriendId: friendId };
    const db = database([
      [invitation({ participantId })],
      [{ id: organizationId }],
      [access("owner")],
      [],
      [participant],
      [{ linkedUserId: targetUserId }],
      [participant],
      [],
    ], [[{ organizationId, userId: targetUserId, participantId, role: "member", customCapabilities: [] }]], [[{ id: participantId }], [accepted], []]);

    await expect(acceptOrganizationInvitation(db, targetUserId, invitationId)).resolves.toMatchObject({ status: "accepted" });
    expect(db.insert).toHaveBeenCalledOnce();
    expect(db.insert).toHaveBeenCalledWith(expect.anything());
  });

  it("rejects acceptance when a source-linked participant is bound to another user", async () => {
    const participantId = "33333333-3333-4333-8333-333333333333";
    const friendId = "44444444-4444-4444-8444-444444444444";
    const participant = { id: participantId, userId: null, sourcePersonalFriendId: friendId };
    const db = database([
      [invitation({ participantId, targetUserId: "unrelated" })],
      [{ id: organizationId }],
      [access("owner")],
      [],
      [participant],
      [{ linkedUserId: targetUserId }],
      [participant],
    ]);

    await expect(acceptOrganizationInvitation(db, "unrelated", invitationId)).rejects.toMatchObject({ code: "participant_not_found" });
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("uses the existing registered participant on a conflict without creating another", async () => {
    const participantId = "33333333-3333-4333-8333-333333333333";
    const existingRegisteredId = "44444444-4444-4444-8444-444444444444";
    const accepted = invitation({ participantId, status: "accepted", acceptedAt: new Date(), updatedAt: new Date() });
    const db = database([
      [invitation({ participantId })],
      [{ id: organizationId }],
      [access("owner")],
      [],
      [{ id: participantId, userId: null, sourcePersonalFriendId: null }],
      [{ id: participantId, userId: null, sourcePersonalFriendId: null }],
      [{ id: existingRegisteredId }],
    ], [[{ organizationId, userId: targetUserId, participantId: existingRegisteredId, role: "member", customCapabilities: [] }]], [[accepted], []]);

    await expect(acceptOrganizationInvitation(db, targetUserId, invitationId)).resolves.toMatchObject({ status: "accepted" });
    expect(db.insert).toHaveBeenCalledOnce();
    expect(db.insert).not.toHaveBeenCalledWith(expect.objectContaining({ id: participantId }));
  });

  it("rejects acceptance after the inviter loses current authority and creates no membership", async () => {
    const revoked = invitation({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() });
    const db = database([[invitation()], [{ id: organizationId }], [access("member")]], [], [[revoked], []]);
    await expect(acceptOrganizationInvitation(db, targetUserId, invitationId)).rejects.toMatchObject({ code: "stale_authority" });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("cannot be accepted by another user or after expiry, and decline creates no membership", async () => {
    const wrongTargetDb = database([[]]);
    await expect(acceptOrganizationInvitation(wrongTargetDb, "other-user", invitationId)).rejects.toMatchObject({ code: "not_found" });

    const expired = invitation({ expiresAt: new Date("2026-08-24T00:00:00.000Z") });
    const expiredState = invitation({ status: "expired", expiredAt: new Date(), updatedAt: new Date() });
    const expiredDb = database([[expired]], [], [[expiredState], []]);
    await expect(acceptOrganizationInvitation(expiredDb, targetUserId, invitationId)).rejects.toMatchObject({ code: "expired" });
    expect(expiredDb.insert).not.toHaveBeenCalled();

    const declined = invitation({ status: "declined", declinedAt: new Date(), updatedAt: new Date() });
    const declineDb = database([[invitation()]], [], [[declined], []]);
    await expect(declineOrganizationInvitation(declineDb, targetUserId, invitationId)).resolves.toMatchObject({ status: "declined" });
    expect(declineDb.insert).not.toHaveBeenCalled();
    expect(mocks.createNotificationInDatabase).toHaveBeenCalledWith(declineDb, expect.objectContaining({
      recipientUserId: inviterUserId,
      type: "organization.invitation.outcome",
      metadata: { invitationId, organizationId, status: "declined" },
      dedupeKey: `organization-invitation-outcome:${invitationId}:declined`,
    }));
  });

  it("revokes only through current Organization members.invite access", async () => {
    const revoked = invitation({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() });
    const db = database([[access("owner")], [invitation()]], [], [[revoked], []]);
    await expect(revokeOrganizationInvitation(db, organizationId, inviterUserId, invitationId)).resolves.toMatchObject({ status: "revoked" });
    expect(mocks.publishNotificationStateChange).toHaveBeenCalledWith(targetUserId, "resolved");

    const deniedDb = database([[access("member")]]);
    await expect(revokeOrganizationInvitation(deniedDb, organizationId, inviterUserId, invitationId)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("does not transition a terminal invitation twice", async () => {
    const db = database([[invitation({ status: "accepted", acceptedAt: new Date() })]]);
    await expect(acceptOrganizationInvitation(db, targetUserId, invitationId)).resolves.toMatchObject({ status: "accepted", changed: false });
    expect(db.update).not.toHaveBeenCalled();
  });
});
