import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";

const mocks = vi.hoisted(() => ({
  createNotificationInDatabase: vi.fn(),
  publishNotificationStateChange: vi.fn(),
  requireGroupAccess: vi.fn(),
  lockActiveGroupForOperationalMutation: vi.fn(),
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
  searchUsernameDirectoryInDatabase: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/notifications", () => ({ createNotificationInDatabase: mocks.createNotificationInDatabase, publishNotificationStateChange: mocks.publishNotificationStateChange }));
vi.mock("@/server/groups", () => ({ GroupError: class GroupError extends Error {}, requireGroupAccess: mocks.requireGroupAccess, lockActiveGroupForOperationalMutation: mocks.lockActiveGroupForOperationalMutation }));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/user-directory", () => ({ searchUsernameDirectoryInDatabase: mocks.searchUsernameDirectoryInDatabase }));

import {
  acceptGroupJoinRequest,
  createGroupInvitation,
  createGroupParticipantLinkRequest,
  declineGroupJoinRequest,
  getGroupJoinRequestStatuses,
  GroupJoinRequestError,
  revokeGroupJoinRequest,
  searchGroupJoinUsers,
} from "./group-join-requests";

const groupId = "11111111-1111-4111-8111-111111111111";
const participantId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const targetUserId = "target-user";
const requesterUserId = "requester-user";
const createdAt = new Date("2026-08-25T00:00:00.000Z");

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: requestId,
    groupId,
    kind: "member_invitation",
    participantId: null,
    participantDisplayNameSnapshot: null,
    participantLabelSnapshot: null,
    targetUserId,
    requesterUserId,
    status: "pending",
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    createdAt,
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
  const query = {} as Query;
  for (const method of ["from", "innerJoin", "leftJoin", "where", "limit", "orderBy", "for", "set", "values", "onConflictDoNothing"]) query[method] = vi.fn(() => query);
  query.returning = vi.fn(async () => result);
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return query;
}

function database(selectResults: unknown[][], insertResults: unknown[][] = [], updateResults: unknown[][] = []) {
  const selects = [...selectResults];
  const inserts = [...insertResults];
  const updates = [...updateResults];
  const calls: { table: unknown; values: unknown }[] = [];
  const updateCalls: unknown[] = [];
  const db = {
    select: vi.fn(() => queryBuilder(selects.shift() ?? [])),
    insert: vi.fn((table: unknown) => {
      const query = queryBuilder(inserts.shift() ?? []);
      query.values = vi.fn((values: unknown) => { calls.push({ table, values }); return query; });
      return query;
    }),
    update: vi.fn(() => {
      const query = queryBuilder(updates.shift() ?? []);
      query.set = vi.fn((values: unknown) => { updateCalls.push(values); return query; });
      return query;
    }),
    delete: vi.fn(() => queryBuilder([])),
    transaction: vi.fn(),
  };
  db.transaction.mockImplementation(async (callback: (transaction: typeof db) => unknown) => callback(db));
  return { db: db as unknown as Database, calls, updateCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createNotificationInDatabase.mockResolvedValue({ id: "notification" });
  mocks.requireGroupAccess.mockResolvedValue({ requireManageParticipants: vi.fn() });
  mocks.lockActiveGroupForOperationalMutation.mockResolvedValue(undefined);
});

describe("Group join requests", () => {
  it.each(["owner", "admin"]) ("allows %s to create a username invitation", async (role) => {
    mocks.requireGroupAccess.mockResolvedValue({ role, requireManageParticipants: vi.fn() });
    const created = request();
    const { db } = database([
      [{ id: targetUserId, name: "Alice", username: "alice" }],
      [],
      [],
      [],
      [{ id: groupId, name: "Trip" }],
      [{ name: "Owner", username: "owner" }],
    ], [[created]]);
    await expect(createGroupInvitation(db, groupId, requesterUserId, "@ALICE")).resolves.toEqual(created);
    expect(mocks.createNotificationInDatabase).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      recipientUserId: targetUserId,
      type: "group.invitation",
      dedupeKey: `group-join-request:${requestId}`,
      metadata: expect.objectContaining({ requestId, groupId, groupName: "Trip" }),
    }));
    expect(mocks.publishNotificationStateChange).toHaveBeenCalledWith(targetUserId, "created");
  });

  it("accepts a selected canonical target user id", async () => {
    const created = request();
    const { db } = database([
      [{ id: targetUserId, name: "Alice", username: "alice" }],
      [],
      [],
      [],
      [{ id: groupId, name: "Trip" }],
      [{ name: "Owner", username: "owner" }],
    ], [[created]]);

    await expect(
      createGroupInvitation(db, groupId, requesterUserId, { targetUserId }),
    ).resolves.toEqual(created);
  });

  it("refuses new invitations for archived Groups", async () => {
    const { db } = database([
      [{ id: targetUserId, name: "Alice", username: "alice" }],
      [],
      [],
      [],
      [{ id: groupId, name: "Trip", archivedAt: new Date("2026-01-01T00:00:00.000Z") }],
      [{ name: "Owner", username: "owner" }],
    ]);
    await expect(createGroupInvitation(db, groupId, requesterUserId, "alice")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rejects a Member, email-shaped lookup, existing representation, and duplicate pending request", async () => {
    mocks.requireGroupAccess.mockResolvedValue({ requireManageParticipants: vi.fn(() => { throw new GroupJoinRequestError("forbidden"); }) });
    const memberDb = database([]);
    await expect(createGroupInvitation(memberDb.db, groupId, requesterUserId, "alice")).rejects.toMatchObject({ code: "forbidden" });

    mocks.requireGroupAccess.mockResolvedValue({ requireManageParticipants: vi.fn() });
    const emailDb = database([[{ id: targetUserId, name: "Alice", username: "alice" }]]);
    await expect(createGroupInvitation(emailDb.db, groupId, requesterUserId, "alice@example.com")).rejects.toMatchObject({ code: "invalid_target" });

    const representedDb = database([[{ id: targetUserId, name: "Alice", username: "alice" }], [], [{ userId: targetUserId }]]);
    await expect(createGroupInvitation(representedDb.db, groupId, requesterUserId, "alice")).rejects.toMatchObject({ code: "already_member" });

    const duplicateDb = database([[{ id: targetUserId, name: "Alice", username: "alice" }], [request()], [], []]);
    await expect(createGroupInvitation(duplicateDb.db, groupId, requesterUserId, "alice")).rejects.toMatchObject({ code: "duplicate" });
  });

  it("creates an external link request only for an unlinked participant in the same Group", async () => {
    const created = request({ kind: "participant_link", participantId, targetUserId });
    const { db, calls } = database([
      [{ id: targetUserId, name: "Alice", username: "alice" }],
      [{ id: participantId, displayName: "Alice", label: "Fasilkom", userId: null }],
      [],
      [],
      [],
      [],
      [{ id: participantId, displayName: "Alice", label: "Fasilkom", userId: null }],
      [{ id: groupId, name: "Trip" }],
      [{ name: "Owner", username: "owner" }],
    ], [[created]]);
    await expect(createGroupParticipantLinkRequest(db, groupId, participantId, requesterUserId, "alice")).resolves.toEqual(created);
    expect(mocks.createNotificationInDatabase).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: "group.participant.link.request",
      metadata: expect.objectContaining({ participantDisplayName: "Alice", participantLabel: "Fasilkom" }),
    }));
    expect(calls[0]?.values).toMatchObject({ participantDisplayNameSnapshot: "Alice", participantLabelSnapshot: "Fasilkom" });
  });

  it("expires a stale participant conflict before creating a new link", async () => {
    const stale = request({ kind: "participant_link", participantId, expiresAt: new Date("2020-01-01T00:00:00.000Z") });
    const expired = request({ kind: "participant_link", participantId, status: "expired", expiredAt: new Date(), updatedAt: new Date() });
    const created = request({ kind: "participant_link", participantId });
    const { db, calls } = database([
      [{ id: targetUserId, name: "Alice", username: "alice" }],
      [{ id: participantId, displayName: "Taxi", label: null, userId: null }],
      [],
      [stale],
      [],
      [],
      [{ id: participantId, displayName: "Taxi", label: null, userId: null }],
      [{ id: groupId, name: "Trip" }],
      [{ name: "Owner", username: "owner" }],
    ], [[created]], [[expired], []]);

    await expect(createGroupParticipantLinkRequest(db, groupId, participantId, requesterUserId, "alice")).resolves.toMatchObject({ id: requestId });
    expect(calls[0]?.values).toMatchObject({ participantId, participantDisplayNameSnapshot: "Taxi" });
  });

  it("keeps a non-expired participant conflict blocking a new link", async () => {
    const { db } = database([
      [{ id: targetUserId, name: "Alice", username: "alice" }],
      [{ id: participantId, displayName: "Taxi", label: null, userId: null }],
      [],
      [request({ kind: "participant_link", participantId })],
    ]);

    await expect(createGroupParticipantLinkRequest(db, groupId, participantId, requesterUserId, "alice")).rejects.toMatchObject({ code: "duplicate" });
  });

  it("uses the bounded username directory while excluding existing Group identities", async () => {
    mocks.searchUsernameDirectoryInDatabase.mockResolvedValue([{ id: "user-c", username: "carol", displayName: "Carol" }]);
    const { db } = database([[{ userId: "user-b" }], [{ userId: "user-pending" }]]);
    await expect(searchGroupJoinUsers(db, groupId, requesterUserId, "@CAR")).resolves.toEqual([{ id: "user-c", username: "carol", displayName: "Carol" }]);
    expect(mocks.searchUsernameDirectoryInDatabase).toHaveBeenCalledWith(db, "@CAR", { excludeUserIds: [requesterUserId, "user-b", "user-pending"] });
  });

  it("accepts a normal invitation with exactly one Member participant and membership", async () => {
    const pending = request();
    const accepted = request({ status: "accepted", acceptedAt: new Date(), updatedAt: new Date() });
    const { db, calls } = database([
      [pending],
      [{ userId: requesterUserId }],
      [],
      [],
    ], [[{ id: participantId }], [{ groupId, userId: targetUserId, participantId, role: "member" }]], [[accepted], []]);
    await expect(acceptGroupJoinRequest(db, targetUserId, requestId)).resolves.toMatchObject({ status: "accepted" });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.values).toMatchObject({ groupId, userId: targetUserId, displayName: null });
    expect(calls[1]?.values).toMatchObject({ groupId, userId: targetUserId, participantId, role: "member" });
    expect(mocks.publishNotificationStateChange).toHaveBeenCalledWith(targetUserId, "resolved");
    expect(mocks.createNotificationInDatabase).toHaveBeenCalledWith(db, expect.objectContaining({
      recipientUserId: requesterUserId,
      type: "group.invitation.outcome",
      metadata: { requestId, groupId, status: "accepted" },
      dedupeKey: `group-join-request-outcome:${requestId}:accepted`,
    }));
  });

  it("reuses a Group participant projected from a Personal Friend after that Friend links", async () => {
    const pending = request();
    const accepted = request({ status: "accepted", acceptedAt: new Date(), updatedAt: new Date() });
    const { db, calls, updateCalls } = database([
      [pending],
      [{ userId: requesterUserId }],
      [],
      [],
      [{ id: participantId }],
    ], [[{ groupId, userId: targetUserId, participantId, role: "member" }]], [[{ id: participantId }], [accepted], []]);

    await expect(acceptGroupJoinRequest(db, targetUserId, requestId)).resolves.toMatchObject({ status: "accepted" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.values).toMatchObject({ groupId, userId: targetUserId, participantId });
    expect(updateCalls[0]).toEqual(expect.objectContaining({ userId: targetUserId, displayName: null }));
    expect(calls[0]?.values).not.toHaveProperty("id", participantId);
  });

  it("uses the existing registered participant when a source projection conflicts", async () => {
    const pending = request();
    const accepted = request({ status: "accepted", acceptedAt: new Date(), updatedAt: new Date() });
    const registeredParticipantId = "44444444-4444-4444-8444-444444444444";
    const { db, calls } = database([
      [pending],
      [{ userId: requesterUserId }],
      [],
      [{ id: registeredParticipantId }],
    ], [[{ groupId, userId: targetUserId, participantId: registeredParticipantId, role: "member" }]], [[accepted], []]);

    await expect(acceptGroupJoinRequest(db, targetUserId, requestId)).resolves.toMatchObject({ status: "accepted" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.values).toMatchObject({ participantId: registeredParticipantId });
  });

  it("rejoins a former registered participant without replacing its identity", async () => {
    const pending = request();
    const accepted = request({ status: "accepted", acceptedAt: new Date(), updatedAt: new Date() });
    const { db, calls } = database([
      [pending],
      [{ userId: requesterUserId }],
      [],
      [{ id: participantId }],
    ], [[{ groupId, userId: targetUserId, participantId, role: "member" }]], [[accepted], []]);
    await expect(acceptGroupJoinRequest(db, targetUserId, requestId)).resolves.toMatchObject({ status: "accepted" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.values).toMatchObject({ groupId, userId: targetUserId, participantId });
  });

  it("accepts a participant link without changing the participant primary key", async () => {
    const pending = request({ kind: "participant_link", participantId });
    const accepted = request({ kind: "participant_link", participantId, status: "accepted", acceptedAt: new Date(), updatedAt: new Date() });
    const { db, calls, updateCalls } = database([
      [pending],
      [{ userId: requesterUserId }],
      [{ id: participantId, groupId, userId: null, displayName: "Alice", label: "Fasilkom" }],
      [],
      [],
    ], [[{ groupId, userId: targetUserId, participantId, role: "member" }]], [[{ id: participantId }], [accepted], []]);
    await expect(acceptGroupJoinRequest(db, targetUserId, requestId)).resolves.toMatchObject({ status: "accepted" });
    expect(updateCalls[0]).toEqual(expect.objectContaining({ userId: targetUserId, displayName: null, updatedAt: expect.any(Date) }));
    expect(calls[0]?.values).toMatchObject({ groupId, userId: targetUserId, participantId, role: "member" });
  });

  it("fails closed for wrong target, stale authority, expiry, removed participant, and existing membership", async () => {
    const wrongTarget = database([[]]);
    await expect(acceptGroupJoinRequest(wrongTarget.db, "other-user", requestId)).rejects.toMatchObject({ code: "not_found" });

    const stale = database([[request()], []], [], [[request({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() })], []]);
    await expect(acceptGroupJoinRequest(stale.db, targetUserId, requestId)).rejects.toMatchObject({ code: "stale_authority" });
    expect(stale.db.insert).not.toHaveBeenCalled();

    const expired = database([[request({ expiresAt: new Date("2020-01-01T00:00:00.000Z") })]], [], [[request({ status: "expired", expiredAt: new Date(), updatedAt: new Date() })], []]);
    await expect(acceptGroupJoinRequest(expired.db, targetUserId, requestId)).rejects.toMatchObject({ code: "expired" });

    const removed = database([[request({ kind: "participant_link", participantId })], [{ userId: requesterUserId }], []], [], [[request({ kind: "participant_link", participantId, status: "revoked", revokedAt: new Date(), updatedAt: new Date() })], []]);
    await expect(acceptGroupJoinRequest(removed.db, targetUserId, requestId)).rejects.toMatchObject({ code: "participant_not_found" });

    const alreadyMember = database([[request()], [{ userId: requesterUserId }], [{ userId: targetUserId }]], [], [[request({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() })], []]);
    await expect(acceptGroupJoinRequest(alreadyMember.db, targetUserId, requestId)).rejects.toMatchObject({ code: "already_member" });
  });

  it("declines and revokes only pending requests, leaving link participants untouched", async () => {
    const declined = request({ status: "declined", declinedAt: new Date(), updatedAt: new Date() });
    const declineDb = database([[request()]], [], [[declined], []]);
    await expect(declineGroupJoinRequest(declineDb.db, targetUserId, requestId)).resolves.toMatchObject({ status: "declined" });
    expect(declineDb.db.insert).not.toHaveBeenCalled();
    expect(mocks.createNotificationInDatabase).toHaveBeenCalledWith(declineDb.db, expect.objectContaining({
      recipientUserId: requesterUserId,
      type: "group.invitation.outcome",
      metadata: { requestId, groupId, status: "declined" },
      dedupeKey: `group-join-request-outcome:${requestId}:declined`,
    }));

    const revoked = request({ kind: "participant_link", participantId, status: "revoked", revokedAt: new Date(), updatedAt: new Date() });
    const revokeDb = database([[request({ kind: "participant_link", participantId })]], [], [[revoked], []]);
    await expect(revokeGroupJoinRequest(revokeDb.db, groupId, requesterUserId, requestId)).resolves.toMatchObject({ status: "revoked" });
    expect(revokeDb.db.insert).not.toHaveBeenCalled();
  });

  it("resolves Inbox state by request ID and expires stale pending rows", async () => {
    const first = request({ status: "declined", declinedAt: new Date("2026-08-26T00:00:00.000Z") });
    const secondId = "44444444-4444-4444-8444-444444444444";
    const second = request({ id: secondId });
    const { db } = database([[first, second]]);
    await expect(getGroupJoinRequestStatuses(db, targetUserId, [requestId, secondId])).resolves.toEqual(new Map([
      [requestId, expect.objectContaining({ id: requestId, status: "declined" })],
      [secondId, expect.objectContaining({ id: secondId, status: "pending" })],
    ]));

    const expired = request({ expiresAt: new Date("2020-01-01T00:00:00.000Z") });
    const expiredState = request({ status: "expired", expiredAt: new Date(), updatedAt: new Date() });
    const expiredDb = database([[expired]], [], [[expiredState], []]);
    await expect(getGroupJoinRequestStatuses(expiredDb.db, targetUserId, [requestId])).resolves.toMatchObject(new Map([[requestId, expect.objectContaining({ status: "expired" })]]));
    expect(mocks.publishNotificationStateChange).toHaveBeenCalledWith(targetUserId, "resolved");
  });
});
