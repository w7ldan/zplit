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

  it("applies the same eligibility to Groups and supports username filtering", async () => {
    const db = database([
      [
        { ...connectedFriend, archivedAt: null },
        { userId: "user-b", displayName: "Bob", username: "bob", archivedAt: null },
        { userId: "participant", displayName: "Former", username: "former", archivedAt: null },
      ],
      [
        { userAId: "user-friend", userBId: ownerUserId, status: "connected" },
        { userAId: ownerUserId, userBId: "user-b", status: "connected" },
      ],
      [{ userId: "participant" }],
      [{ userId: "pending" }],
    ]);

    await expect(
      listRegisteredFriendCandidates(db, ownerUserId, { kind: "group", id: "group-a" }, "@ali"),
    ).resolves.toEqual([connectedFriend]);
  });
});
