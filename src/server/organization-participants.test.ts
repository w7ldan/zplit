import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { organizationParticipants } from "@/db/schema";

const mocks = vi.hoisted(() => ({
  getPersonalLedgerScopeId: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  assertOrganizationActiveForOperationalMutation: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/ledger-scopes", () => ({ getPersonalLedgerScopeId: mocks.getPersonalLedgerScopeId }));
vi.mock("@/server/organizations", () => ({ requireOrganizationAccess: mocks.requireOrganizationAccess, assertOrganizationActiveForOperationalMutation: mocks.assertOrganizationActiveForOperationalMutation }));

import {
  addPersonalFriendAsOrganizationParticipant,
  createLocalOrganizationParticipant,
  listOrganizationParticipants,
  OrganizationParticipantError,
} from "./organization-participants";

function queryBuilder(result: unknown) {
  type Query = Record<string, ReturnType<typeof vi.fn>> & { then: Promise<unknown>["then"] };
  const query = {} as Query;
  for (const method of ["from", "innerJoin", "leftJoin", "where", "limit", "orderBy", "for", "onConflictDoNothing"]) query[method] = vi.fn(() => query);
  query.returning = vi.fn(async () => result);
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return query;
}

function database(selectResults: unknown[][], insertResults: unknown[][] = []) {
  const selects = [...selectResults];
  const inserts = [...insertResults];
  const calls: Array<{ table: unknown; values: unknown }> = [];
  const db = {
    select: vi.fn(() => queryBuilder(selects.shift() ?? [])),
    insert: vi.fn((table: unknown) => {
      const query = queryBuilder(inserts.shift() ?? []);
      query.values = vi.fn((values: unknown) => {
        calls.push({ table, values });
        return query;
      });
      return query;
    }),
    transaction: vi.fn(async (callback: (transaction: unknown) => unknown) => callback(db)),
  };
  return { db: db as unknown as Database, calls };
}

const organizationId = "11111111-1111-4111-8111-111111111111";
const personalFriendId = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPersonalLedgerScopeId.mockResolvedValue("scope-owner");
  mocks.requireOrganizationAccess.mockResolvedValue({ require: vi.fn() });
  mocks.assertOrganizationActiveForOperationalMutation.mockResolvedValue(undefined);
});

describe("Organization participants", () => {
  it("projects a local Personal Friend without reusing its ID or granting access", async () => {
    const participant = { id: "33333333-3333-4333-8333-333333333333", organizationId, userId: null, sourcePersonalFriendId: personalFriendId, displayName: "Alex", label: null };
    const { db, calls } = database([
      [{ organizationId }],
      [{ id: personalFriendId, name: "Alex", linkedUserId: null, archivedAt: null }],
      [],
    ], [[participant]]);

    await expect(addPersonalFriendAsOrganizationParticipant(db, organizationId, "user-owner", personalFriendId)).resolves.toEqual(participant);
    expect(calls).toEqual([{ table: organizationParticipants, values: { organizationId, sourcePersonalFriendId: personalFriendId, displayName: "Alex", createdByUserId: "user-owner" } }]);
    expect(participant.id).not.toBe(personalFriendId);
  });

  it("rejects a foreign, archived, or already registered Personal Friend", async () => {
    const foreign = database([[{ organizationId }], []]);
    await expect(addPersonalFriendAsOrganizationParticipant(foreign.db, organizationId, "user-owner", personalFriendId)).rejects.toMatchObject({ code: "not_found" });

    const registered = database([[{ organizationId }], [{ id: personalFriendId, name: "Alex", linkedUserId: "user-alex", archivedAt: null }]]);
    await expect(addPersonalFriendAsOrganizationParticipant(registered.db, organizationId, "user-owner", personalFriendId)).rejects.toMatchObject({ code: "registered_personal_friend" });

    expect(new OrganizationParticipantError("conflict")).toBeInstanceOf(Error);
  });

  it("allows duplicate display names for direct local members", async () => {
    const first = { id: "33333333-3333-4333-8333-333333333333", displayName: "Alex" };
    const second = { id: "44444444-4444-4444-8444-444444444444", displayName: "Alex" };
    const { db, calls } = database([[{ organizationId }], [{ organizationId }]], [[first], [second]]);
    await expect(createLocalOrganizationParticipant(db, organizationId, "user-owner", { displayName: "Alex" })).resolves.toEqual(first);
    await expect(createLocalOrganizationParticipant(db, organizationId, "user-owner", { displayName: "Alex" })).resolves.toEqual(second);
    expect(calls.map(({ values }) => values)).toEqual([
      { organizationId, displayName: "Alex", label: null, createdByUserId: "user-owner" },
      { organizationId, displayName: "Alex", label: null, createdByUserId: "user-owner" },
    ]);
  });

  it("returns local and registered identities with membership access kept separate", async () => {
    const { db } = database([
      [
        { id: "participant-a", userId: "user-a", participantDisplayName: null, label: null, userDisplayName: "Alice", username: "alice", role: "admin" },
        { id: "participant-b", userId: null, participantDisplayName: "Alex", label: "Office", userDisplayName: null, username: null, role: null },
      ],
    ]);
    await expect(listOrganizationParticipants(db, organizationId, "user-owner")).resolves.toEqual([
      { id: "participant-a", userId: "user-a", displayName: "Alice", username: "alice", label: null, role: "admin", isLocal: false },
      { id: "participant-b", userId: null, displayName: "Alex", username: null, label: "Office", role: null, isLocal: true },
    ]);
  });
});
