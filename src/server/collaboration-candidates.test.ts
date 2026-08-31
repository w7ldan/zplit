import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";

const mocks = vi.hoisted(() => ({ getPersonalLedgerScopeId: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/ledger-scopes", () => ({ getPersonalLedgerScopeId: mocks.getPersonalLedgerScopeId }));

import { listPersonalFriendCandidates, listRegisteredFriendCandidates } from "./collaboration-candidates";

function queryBuilder(result: unknown) {
  type Query = Record<string, ReturnType<typeof vi.fn>> & { then: Promise<unknown>["then"] };
  const query = {} as Query;
  for (const method of ["from", "innerJoin", "leftJoin", "where", "orderBy"]) query[method] = vi.fn(() => query);
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return query;
}

function database(selectResults: unknown[][]) {
  const results = [...selectResults];
  return {
    select: vi.fn(() => queryBuilder(results.shift() ?? [])),
  } as unknown as Database;
}

const ownerUserId = "user-owner";
const connectedFriend = {
  personalFriendId: "friend-connected",
  userId: "user-friend",
  friendDisplayName: "Alice",
  linkedDisplayName: "Alice",
  username: "alice",
  archivedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPersonalLedgerScopeId.mockResolvedValue("scope-owner");
});

describe("registered Personal Friend collaboration candidates", () => {
  it("keeps only active linked friends eligible for an Organization", async () => {
    const db = database([
      [
        { ...connectedFriend, archivedAt: null },
        { userId: ownerUserId, displayName: "Owner", username: "owner", archivedAt: null },
        { userId: "external", displayName: "External", username: null, archivedAt: null },
        { userId: "archived", displayName: "Archived", username: "archived", archivedAt: new Date() },
        { userId: "disconnected", displayName: "Disconnected", username: "disconnected", archivedAt: null },
        { userId: "member", displayName: "Member", username: "member", archivedAt: null },
        { userId: "pending", displayName: "Pending", username: "pending", archivedAt: null },
      ],
      [
        { userAId: ownerUserId, userBId: "user-friend", status: "connected" },
        { userAId: ownerUserId, userBId: "disconnected", status: "disconnected" },
      ],
      [{ userId: "member" }],
      [{ userId: "pending" }],
    ]);

    await expect(
      listRegisteredFriendCandidates(db, ownerUserId, { kind: "organization", id: "organization-a" }),
    ).resolves.toEqual([{ userId: "user-friend", displayName: "Alice", username: "alice" }]);
  });

  it("excludes current members and live requests but includes former participants", async () => {
    const currentMember = {
      personalFriendId: "friend-current",
      userId: "current-member",
      friendDisplayName: "Current",
      linkedDisplayName: "Current",
      username: "current",
      archivedAt: null,
    };
    const formerParticipant = {
      personalFriendId: "friend-former",
      userId: "former-participant",
      friendDisplayName: "Former",
      linkedDisplayName: "Former",
      username: "former",
      archivedAt: null,
    };
    const pendingFriend = {
      personalFriendId: "friend-pending",
      userId: "pending-friend",
      friendDisplayName: "Pending",
      linkedDisplayName: "Pending",
      username: "pending",
      archivedAt: null,
    };
    const db = database([
      [
        { ...currentMember, archivedAt: null },
        { ...formerParticipant, archivedAt: null },
        { ...pendingFriend, archivedAt: null },
      ],
      [
        { userAId: ownerUserId, userBId: currentMember.userId, status: "connected" },
        { userAId: ownerUserId, userBId: formerParticipant.userId, status: "connected" },
        { userAId: ownerUserId, userBId: pendingFriend.userId, status: "connected" },
      ],
      [{ userId: currentMember.userId }],
      [{ userId: pendingFriend.userId }],
    ]);

    await expect(
      listRegisteredFriendCandidates(db, ownerUserId, { kind: "group", id: "group-a" }),
    ).resolves.toEqual([{ userId: "former-participant", displayName: "Former", username: "former" }]);
  });

  it("supports username filtering for Group candidates", async () => {
    const db = database([
      [connectedFriend],
      [{ userAId: ownerUserId, userBId: connectedFriend.userId, status: "connected" }],
      [],
      [],
    ]);

    await expect(
      listRegisteredFriendCandidates(db, ownerUserId, { kind: "group", id: "group-a" }, "@ali"),
    ).resolves.toEqual([{ userId: "user-friend", displayName: "Alice", username: "alice" }]);
  });

  it("matches local Personal Friends by display name", async () => {
    const localFriend = {
      personalFriendId: "friend-local",
      userId: null,
      friendDisplayName: "Kayla Local",
      linkedDisplayName: null,
      username: null,
      archivedAt: null,
    };
    const db = database([
      [localFriend],
      [],
      [],
      [],
      [],
    ]);

    await expect(
      listPersonalFriendCandidates(db, ownerUserId, { kind: "group", id: "group-a" }, "kayla"),
    ).resolves.toEqual([{
      personalFriendId: "friend-local",
      kind: "local",
      userId: null,
      displayName: "Kayla Local",
      username: null,
      label: null,
    }]);
  });

  it("returns active local and registered Friends for collaboration surfaces", async () => {
    const localFriend = {
      personalFriendId: "friend-local",
      userId: null,
      friendDisplayName: "Alex",
      linkedDisplayName: null,
      username: null,
      archivedAt: null,
    };
    const registeredFriend = { ...connectedFriend };
    const db = database([
      [localFriend, registeredFriend],
      [{ userAId: ownerUserId, userBId: registeredFriend.userId, status: "connected" }],
      [],
      [],
      [],
    ]);

    await expect(
      listPersonalFriendCandidates(db, ownerUserId, { kind: "organization_expense_contact", id: "organization-a" }),
    ).resolves.toEqual([
      {
        personalFriendId: "friend-local",
        kind: "local",
        userId: null,
        displayName: "Alex",
        username: null,
        label: null,
      },
      {
        personalFriendId: "friend-connected",
        kind: "registered",
        userId: "user-friend",
        displayName: "Alice",
        username: "alice",
        label: null,
      },
    ]);
  });

  it("hides active Organization contact projections so the empty state is accurate", async () => {
    const localFriend = {
      personalFriendId: "friend-local",
      userId: null,
      friendDisplayName: "Alex",
      linkedDisplayName: null,
      username: null,
      archivedAt: null,
    };
    const registeredFriend = { ...connectedFriend };
    const db = database([
      [localFriend, registeredFriend],
      [{ userAId: ownerUserId, userBId: registeredFriend.userId, status: "connected" }],
      [
        { sourcePersonalFriendId: localFriend.personalFriendId, userId: null },
        { sourcePersonalFriendId: null, userId: registeredFriend.userId },
      ],
    ]);

    await expect(
      listPersonalFriendCandidates(db, ownerUserId, { kind: "organization_expense_contact", id: "organization-a" }),
    ).resolves.toEqual([]);
  });

  it("offers local Personal Friends as Organization members", async () => {
    const localFriend = {
      personalFriendId: "friend-local",
      userId: null,
      friendDisplayName: "Alex",
      linkedDisplayName: null,
      username: null,
      archivedAt: null,
    };
    const db = database([
      [localFriend, connectedFriend],
      [{ userAId: ownerUserId, userBId: connectedFriend.userId, status: "connected" }],
      [],
      [],
    ]);

    await expect(
      listPersonalFriendCandidates(db, ownerUserId, { kind: "organization", id: "organization-a" }),
    ).resolves.toEqual([
      {
        personalFriendId: "friend-local",
        kind: "local",
        userId: null,
        displayName: "Alex",
        username: null,
        label: null,
      },
      {
        personalFriendId: connectedFriend.personalFriendId,
        kind: "registered",
        userId: connectedFriend.userId,
        displayName: "Alice",
        username: "alice",
        label: null,
      },
    ]);
  });

  it("excludes an already-projected local Friend from Group candidates without merging duplicate names", async () => {
    const alex = {
      personalFriendId: "friend-alex",
      userId: null,
      friendDisplayName: "Alex",
      linkedDisplayName: null,
      username: null,
      archivedAt: null,
    };
    const otherAlex = {
      personalFriendId: "friend-other-alex",
      userId: null,
      friendDisplayName: "Alex",
      linkedDisplayName: null,
      username: null,
      archivedAt: null,
    };
    const db = database([
      [alex, otherAlex],
      [],
      [],
      [],
      [{ personalFriendId: alex.personalFriendId }],
    ]);

    await expect(
      listPersonalFriendCandidates(db, ownerUserId, { kind: "group", id: "group-a" }),
    ).resolves.toEqual([
      {
        personalFriendId: "friend-other-alex",
        kind: "local",
        userId: null,
        displayName: "Alex",
        username: null,
        label: null,
      },
    ]);
  });
});
