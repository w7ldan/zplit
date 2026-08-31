import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { friends, organizationMemberships } from "@/db/schema";

vi.mock("server-only", () => ({}));
vi.mock("@/server/ledger-scopes", () => ({ getPersonalLedgerScopeId: vi.fn().mockResolvedValue("scope-personal") }));

import { addPersonalFriendAsOrganizationExpenseContact } from "./organizations";

function query(result: unknown) {
  const builder = {} as Record<string, unknown> & { then: Promise<unknown>["then"] };
  for (const method of ["from", "where", "limit", "for", "orderBy", "onConflictDoNothing"]) builder[method] = vi.fn(() => builder);
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  builder.returning = vi.fn(async () => result);
  return builder;
}

function insert(table: unknown, calls: Array<{ table: unknown; values: unknown }>, result: unknown) {
  const builder = query([result]);
  builder.values = vi.fn((values: unknown) => {
    calls.push({ table, values });
    return builder;
  });
  return builder;
}

const organizationId = "11111111-1111-4111-8111-111111111111";
const personalFriendId = "22222222-2222-4222-8222-222222222222";
const contactId = "33333333-3333-4333-8333-333333333333";

function database(selectResults: unknown[][], calls: Array<{ table: unknown; values: unknown }>, contact?: unknown) {
  const selections = [...selectResults];
  const transaction = {
    select: vi.fn(() => query(selections.shift() ?? [])),
    insert: vi.fn(() => insert(friends, calls, contact)),
    update: vi.fn(() => query([])),
  };
  return {
    transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    transactionState: transaction,
  } as unknown as Database & { transactionState: typeof transaction };
}

const accessSelects = [
  [{ userId: "user-owner" }],
  [{ role: "owner", customCapabilities: [] }],
  [{ id: "scope-organization" }],
];

describe("Organization Personal Friend expense contacts", () => {
  it("creates a scoped local contact from server-loaded Friend data", async () => {
    const calls: Array<{ table: unknown; values: unknown }> = [];
    const contact = { id: contactId, ledgerScopeId: "scope-organization", name: "Alex", linkedUserId: null, sourcePersonalFriendId: personalFriendId, archivedAt: null };
    const databaseForTest = database([
      ...accessSelects,
      [{ id: personalFriendId, name: "Alex", linkedUserId: null, archivedAt: null }],
      [],
    ], calls, contact);

    await expect(addPersonalFriendAsOrganizationExpenseContact(databaseForTest, organizationId, "user-owner", personalFriendId)).resolves.toEqual(contact);
    expect(calls).toEqual([{
      table: friends,
      values: { ledgerScopeId: "scope-organization", name: "Alex", sourcePersonalFriendId: personalFriendId },
    }]);
    expect(contact.id).not.toBe(personalFriendId);
    expect(calls.some(({ table }) => table === organizationMemberships)).toBe(false);
  });

  it("reuses an existing registered contact by canonical user ID", async () => {
    const calls: Array<{ table: unknown; values: unknown }> = [];
    const existing = { id: contactId, ledgerScopeId: "scope-organization", name: "Old name", linkedUserId: "user-alex", sourcePersonalFriendId: null, archivedAt: null };
    const databaseForTest = database([
      ...accessSelects,
      [{ id: personalFriendId, name: "Alex", linkedUserId: "user-alex", archivedAt: null }],
      [],
      [existing],
    ], calls, existing);

    await expect(addPersonalFriendAsOrganizationExpenseContact(databaseForTest, organizationId, "user-owner", personalFriendId)).resolves.toEqual(existing);
    expect(databaseForTest.transactionState.insert).not.toHaveBeenCalled();
  });

  it("reuses a local contact by Personal Friend provenance rather than name", async () => {
    const existing = { id: contactId, ledgerScopeId: "scope-organization", name: "Alex", linkedUserId: null, sourcePersonalFriendId: personalFriendId, archivedAt: null };
    const databaseForTest = database([
      ...accessSelects,
      [{ id: personalFriendId, name: "Alex", linkedUserId: null, archivedAt: null }],
      [existing],
    ], []);

    await expect(addPersonalFriendAsOrganizationExpenseContact(databaseForTest, organizationId, "user-owner", personalFriendId)).resolves.toEqual(existing);
    expect(databaseForTest.transactionState.insert).not.toHaveBeenCalled();
  });

  it("requires Organization contact capability and the actor's current Personal Friend", async () => {
    const forbidden = database([
      [{ userId: "user-owner" }],
      [{ role: "member", customCapabilities: [] }],
    ], []);
    await expect(addPersonalFriendAsOrganizationExpenseContact(forbidden, organizationId, "user-owner", personalFriendId)).rejects.toMatchObject({ code: "forbidden" });

    const missingSource = database([
      ...accessSelects,
      [],
    ], []);
    await expect(addPersonalFriendAsOrganizationExpenseContact(missingSource, organizationId, "user-owner", personalFriendId)).rejects.toMatchObject({ code: "not_found" });

    const foreignOrganization = database([[]], []);
    await expect(addPersonalFriendAsOrganizationExpenseContact(foreignOrganization, organizationId, "user-owner", personalFriendId)).rejects.toMatchObject({ code: "not_member" });
  });
});
