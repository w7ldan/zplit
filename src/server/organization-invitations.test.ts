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
    expiresAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: createdAt,
    acceptedAt: null,
    declinedAt: null,
    revokedAt: null,
    expiredAt: null,
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
    ], [[{ organizationId, userId: targetUserId, role: "admin", customCapabilities: [] }]], [[accepted], []]);
    await expect(acceptOrganizationInvitation(db, targetUserId, invitationId)).resolves.toMatchObject({ status: "accepted" });
    expect(db.insert).toHaveBeenCalledOnce();
    expect(mocks.publishNotificationStateChange).toHaveBeenCalledWith(targetUserId, "resolved");
    expect(mocks.createNotificationInDatabase).toHaveBeenCalledWith(db, expect.objectContaining({
      recipientUserId: inviterUserId,
      type: "organization.invitation.outcome",
      metadata: { invitationId, organizationId, status: "accepted" },
      dedupeKey: `organization-invitation-outcome:${invitationId}:accepted`,
    }));
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
