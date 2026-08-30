import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";

const mocks = vi.hoisted(() => ({ getPersonalLedgerScopeId: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/ledger-scopes", () => ({ getPersonalLedgerScopeId: mocks.getPersonalLedgerScopeId }));

import { listRegisteredFriendCandidates } from "./collaboration-candidates";

function queryBuilder(result: unknown) {
  type Query = Record<string, ReturnType<typeof vi.fn>> & { then: Promise<unknown>["then"] };
  const query = {} as Query;
  for (const method of ["from", "innerJoin", "where", "orderBy"]) query[method] = vi.fn(() => query);
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
const connectedFriend = { userId: "user-friend", displayName: "Alice", username: "alice" };

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
    ).resolves.toEqual([connectedFriend]);
  });

  it("excludes current members and live requests but includes former participants", async () => {
    const currentMember = { userId: "current-member", displayName: "Current", username: "current" };
    const formerParticipant = { userId: "former-participant", displayName: "Former", username: "former" };
    const pendingFriend = { userId: "pending-friend", displayName: "Pending", username: "pending" };
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
    ).resolves.toEqual([formerParticipant]);
  });

  it("supports username filtering for Group candidates", async () => {
    const db = database([
      [{ ...connectedFriend, archivedAt: null }],
      [{ userAId: ownerUserId, userBId: connectedFriend.userId, status: "connected" }],
      [],
      [],
    ]);

    await expect(
      listRegisteredFriendCandidates(db, ownerUserId, { kind: "group", id: "group-a" }, "@ali"),
    ).resolves.toEqual([connectedFriend]);
  });
});
