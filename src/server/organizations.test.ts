import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { ledgerScopes, organizationMemberships, organizationParticipants, organizations } from "@/db/schema";
import type { OrganizationRole } from "@/domain/organization-permissions";
import { assertPlainDto } from "@/test/assert-plain-dto";

vi.mock("server-only", () => ({}));
const notificationMocks = vi.hoisted(() => ({ publishNotificationStateChange: vi.fn() }));
vi.mock("@/server/notifications", () => notificationMocks);

import {
  archiveOrganization,
  assertOrganizationActiveForOperationalMutation,
  createOrganization,
  deleteOrganization,
  deleteOrganizationAvatar,
  getOrganizationForMember,
  hasOrganizationFinancialHistory,
  listOrganizationOverviewSummaries,
  OrganizationError,
  requireOrganizationAccess,
  requireOrganizationLedgerAccess,
  restoreOrganization,
  saveOrganizationAvatar,
  updateOrganization,
} from "./organizations";

function insertBuilder(table: unknown, calls: Array<{ table: unknown; values?: unknown }>, result: unknown[]) {
  const builder = {
    values(values: unknown) { calls.push({ table, values }); return builder; },
    onConflictDoNothing() { return builder; },
    returning: vi.fn(async () => result),
  };
  return builder;
}

function queryBuilder(result: unknown) {
  type Query = Record<string, ReturnType<typeof vi.fn>> & { then: Promise<unknown>["then"] };
  const chain = {} as Query;
  for (const method of ["from", "innerJoin", "leftJoin", "where", "limit", "orderBy", "for", "set", "values", "onConflictDoUpdate"]) chain[method] = vi.fn(() => chain);
  chain.returning = vi.fn(async () => result);
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function databaseForMembership(membership: { role: string; customCapabilities?: unknown } | undefined, mutationResult: unknown[] = []) {
  const selects = [membership ? [membership] : [], [{ id: organizationId, archivedAt: null }]];
  const database = {
    select: vi.fn(() => queryBuilder(selects.shift() ?? [])),
    update: vi.fn(() => queryBuilder(mutationResult)),
    delete: vi.fn(() => queryBuilder(mutationResult)),
    insert: vi.fn(() => queryBuilder(mutationResult)),
    transaction: vi.fn(async (callback: (transaction: unknown) => unknown) => callback(database)),
  };
  return database as unknown as Database & { update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn> };
}

const organizationId = "11111111-1111-4111-8111-111111111111";
const organization = { id: organizationId, name: "Studio", description: null };
const avatar = { mediaType: "image/webp" as const, byteSize: 1, sha256: "a".repeat(64), content: Buffer.from([1]) };

const updateRoles: readonly [OrganizationRole, readonly string[], boolean][] = [
  ["owner", [], true],
  ["admin", [], true],
  ["treasurer", [], false],
  ["member", [], false],
  ["custom", ["organization.update"], true],
  ["custom", [], false],
];

describe("organizations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("derives overview ledger visibility from each Organization membership", async () => {
    const database = {
      select: vi.fn(() => queryBuilder([
        { id: organizationId, name: "Studio", description: null, role: "member", memberCount: 2, avatar: null, customCapabilities: [], ledgerScopeId: "scope-a" },
        { id: "22222222-2222-4222-8222-222222222222", name: "Private", description: null, role: "custom", memberCount: 1, avatar: null, customCapabilities: ["organization.view"], ledgerScopeId: "scope-b" },
      ])),
    } as unknown as Database;

    const overviews = await listOrganizationOverviewSummaries(database, "user-a");

    expect(overviews).toEqual([
      expect.objectContaining({ id: organizationId, canViewLedger: true, ledgerScopeId: "scope-a" }),
      expect.objectContaining({ id: "22222222-2222-4222-8222-222222222222", canViewLedger: false, ledgerScopeId: "scope-b" }),
    ]);
    assertPlainDto(overviews);
  });

  it("creates the organization and Owner membership in one transaction", async () => {
    const calls: Array<{ table: unknown; values?: unknown }> = [];
    const organization = { id: organizationId, name: "Studio", description: null };
    const transaction = {
      insert: vi.fn((table: unknown) => insertBuilder(table, calls, table === organizations ? [organization] : table === ledgerScopes ? [{ id: "scope-organization" }] : table === organizationParticipants ? [{ id: "participant-owner" }] : [{ organizationId: organization.id, userId: "user-a", participantId: "participant-owner", role: "owner" }])),
    };
    const database = { transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)) } as unknown as Database;

    await expect(createOrganization(database, "user-a", { name: " Studio " })).resolves.toEqual(organization);
    expect(database.transaction).toHaveBeenCalledOnce();
    expect(calls).toEqual([
      { table: organizations, values: { name: "Studio", description: null } },
      { table: ledgerScopes, values: { kind: "organization", organizationId: organization.id } },
      { table: organizationParticipants, values: { organizationId: organization.id, userId: "user-a", createdByUserId: "user-a" } },
      { table: organizationMemberships, values: { organizationId: organization.id, userId: "user-a", participantId: "participant-owner", role: "owner" } },
    ]);
  });

  it("does not leave a partial organization when scope creation fails", async () => {
    const calls: Array<{ table: unknown; values?: unknown }> = [];
    const transaction = {
      insert: vi.fn((table: unknown) => insertBuilder(table, calls, table === organizations ? [organization] : [])),
    };
    const database = { transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)) } as unknown as Database;
    await expect(createOrganization(database, "user-a", { name: "Studio" })).rejects.toMatchObject({ code: "scope_creation_failed" });
    expect(calls.map(({ table }) => table)).toEqual([organizations, ledgerScopes]);
  });

  it.each(updateRoles)("applies organization.update by capability for %s", async (role, customCapabilities, allowed) => {
    const database = databaseForMembership({ role, customCapabilities }, [organization]);
    const result = updateOrganization(database, organizationId, "user-a", { name: "Studio" });
    if (allowed) await expect(result).resolves.toEqual(organization);
    else await expect(result).rejects.toMatchObject({ code: "forbidden" });
    expect(database.update).toHaveBeenCalledTimes(allowed ? 1 : 0);
  });

  it.each(updateRoles)("applies organization.update to avatar saves for %s", async (role, customCapabilities, allowed) => {
    const database = databaseForMembership({ role, customCapabilities }, [avatar]);
    const result = saveOrganizationAvatar(database, organizationId, "user-a", avatar);
    if (allowed) await expect(result).resolves.toMatchObject({ sha256: avatar.sha256 });
    else await expect(result).rejects.toMatchObject({ code: "forbidden" });
    expect(database.insert).toHaveBeenCalledTimes(allowed ? 1 : 0);
  });

  it.each(updateRoles)("applies organization.update to avatar removal for %s", async (role, customCapabilities, allowed) => {
    const database = databaseForMembership({ role, customCapabilities }, [{ organizationId }]);
    const result = deleteOrganizationAvatar(database, organizationId, "user-a");
    if (allowed) await expect(result).resolves.toBe(true);
    else await expect(result).rejects.toMatchObject({ code: "forbidden" });
    expect(database.delete).toHaveBeenCalledTimes(allowed ? 1 : 0);
  });

  it.each([
    ["owner", [], true],
    ["admin", [], false],
    ["treasurer", [], false],
    ["member", [], false],
    ["custom", ["organization.delete"], false],
  ] as const)("allows organization.delete only for Owner (%s)", async (role, customCapabilities, allowed) => {
    const database = databaseForMembership({ role, customCapabilities }, [{ id: organizationId }]);
    const result = deleteOrganization(database, organizationId, "user-a");
    if (allowed) await expect(result).resolves.toBe(true);
    else await expect(result).rejects.toMatchObject({ code: "forbidden" });
    expect(database.delete).toHaveBeenCalledTimes(allowed ? 1 : 0);
  });

  it("requires membership and keeps access scoped to the requested Organization", async () => {
    const memberships = [[{ role: "owner", customCapabilities: [] }], [{ role: "member", customCapabilities: [] }]];
    const database = { select: vi.fn(() => queryBuilder(memberships.shift() ?? [])) } as unknown as Database;
    const organizationA = await requireOrganizationAccess(database, organizationId, "user-a");
    const organizationB = await requireOrganizationAccess(database, "22222222-2222-4222-8222-222222222222", "user-a");

    expect(() => assertPlainDto(organizationA)).toThrow();
    expect(organizationA.can("organization.delete")).toBe(true);
    expect(organizationB.can("organization.delete")).toBe(false);
    expect(organizationB.can("expenses.create")).toBe(false);
  });

  it("does not leak Custom grants between Organizations", async () => {
    const memberships = [[{ role: "custom", customCapabilities: ["expenses.create"] }], [{ role: "custom", customCapabilities: [] }]];
    const database = { select: vi.fn(() => queryBuilder(memberships.shift() ?? [])) } as unknown as Database;
    const organizationA = await requireOrganizationAccess(database, organizationId, "user-a");
    const organizationB = await requireOrganizationAccess(database, "22222222-2222-4222-8222-222222222222", "user-a");

    expect(organizationA.can("expenses.create")).toBe(true);
    expect(organizationB.can("expenses.create")).toBe(false);
  });

  it.each([
    ["owner", undefined, true],
    ["admin", undefined, true],
    ["treasurer", undefined, true],
    ["member", undefined, false],
    ["custom", ["expenses.create"], true],
    ["custom", [], false],
  ] as const)("gates Organization ledger mutations by capability for %s", async (role, customCapabilities, allowed) => {
    const database = { select: vi.fn()
      .mockImplementationOnce(() => queryBuilder([{ role, customCapabilities }]))
      .mockImplementationOnce(() => queryBuilder([{ id: "scope-a" }])) } as unknown as Database;
    const result = requireOrganizationLedgerAccess(database, organizationId, "user-a", "expenses.create");
    if (allowed) {
      const access = await result;
      expect(access.ledgerScopeId).toBe("scope-a");
    } else {
      await expect(result).rejects.toMatchObject({ code: "forbidden" });
      expect(database.select).toHaveBeenCalledOnce();
    }
  });

  it("binds each Organization ledger access to its own scope", async () => {
    const database = { select: vi.fn()
      .mockImplementationOnce(() => queryBuilder([{ role: "owner", customCapabilities: [] }]))
      .mockImplementationOnce(() => queryBuilder([{ id: "scope-a" }]))
      .mockImplementationOnce(() => queryBuilder([{ role: "owner", customCapabilities: [] }]))
      .mockImplementationOnce(() => queryBuilder([{ id: "scope-b" }])) } as unknown as Database;
    const accessA = await requireOrganizationLedgerAccess(database, organizationId, "user-a", "ledger.view");
    const accessB = await requireOrganizationLedgerAccess(database, "22222222-2222-4222-8222-222222222222", "user-a", "ledger.view");
    expect(accessA.ledgerScopeId).toBe("scope-a");
    expect(accessB.ledgerScopeId).toBe("scope-b");
  });

  it("fails closed for invalid IDs, non-members, and unknown roles", async () => {
    const database = { select: vi.fn(() => queryBuilder([])) } as unknown as Database;
    await expect(requireOrganizationAccess(database, "not-an-id", "user-a")).rejects.toMatchObject({ code: "invalid_id" });
    await expect(requireOrganizationAccess(database, organizationId, "user-a")).rejects.toMatchObject({ code: "not_member" });

    const unknownRoleDatabase = { select: vi.fn(() => queryBuilder([{ role: "unknown", customCapabilities: ["organization.delete"] }])) } as unknown as Database;
    await expect(requireOrganizationAccess(unknownRoleDatabase, organizationId, "user-a")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("returns only server-derived affordance permissions for detail pages", async () => {
    const database = databaseForMembership({ role: "admin", customCapabilities: ["organization.delete"] });
    const selects = (database.select as ReturnType<typeof vi.fn>);
    selects.mockImplementationOnce(() => queryBuilder([{ role: "admin", customCapabilities: ["organization.delete"] }]))
      .mockImplementationOnce(() => queryBuilder([{ ...organization, role: "admin", avatar: null }]))
      .mockImplementationOnce(() => queryBuilder([{ memberCount: 1 }]));
    const detail = await getOrganizationForMember(database, organizationId, "user-a");
    assertPlainDto(detail);
    expect(detail).toMatchObject({ canUpdate: true, canDelete: false });
  });

  it("rejects blank organization names", async () => {
    await expect(createOrganization({} as Database, "user-a", { name: "  " })).rejects.toMatchObject({ code: "invalid_input" });
    expect(new OrganizationError("invalid_id")).toBeInstanceOf(Error);
  });

  it("detects expenses and repayments as Organization financial history", async () => {
    const withExpense = {
      select: vi.fn()
        .mockImplementationOnce(() => queryBuilder([{ id: "scope-a" }]))
        .mockImplementationOnce(() => queryBuilder([{ id: "expense-a" }])),
    } as unknown as Database;
    await expect(hasOrganizationFinancialHistory(withExpense, organizationId)).resolves.toBe(true);

    const withRepayment = {
      select: vi.fn()
        .mockImplementationOnce(() => queryBuilder([{ id: "scope-a" }]))
        .mockImplementationOnce(() => queryBuilder([]))
        .mockImplementationOnce(() => queryBuilder([{ id: "repayment-a" }])),
    } as unknown as Database;
    await expect(hasOrganizationFinancialHistory(withRepayment, organizationId)).resolves.toBe(true);

    const empty = {
      select: vi.fn()
        .mockImplementationOnce(() => queryBuilder([{ id: "scope-a" }]))
        .mockImplementationOnce(() => queryBuilder([]))
        .mockImplementationOnce(() => queryBuilder([])),
    } as unknown as Database;
    await expect(hasOrganizationFinancialHistory(empty, organizationId)).resolves.toBe(false);
  });

  it("refuses permanent deletion when Organization financial history exists", async () => {
    const transaction = {
      select: vi.fn()
        .mockImplementationOnce(() => queryBuilder([{ role: "owner", customCapabilities: [] }]))
        .mockImplementationOnce(() => queryBuilder([{ id: organizationId, archivedAt: null }]))
        .mockImplementationOnce(() => queryBuilder([{ id: "scope-a" }]))
        .mockImplementationOnce(() => queryBuilder([{ id: "expense-a" }])),
    };
    const database = {
      transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as Database;

    await expect(deleteOrganization(database, organizationId, "user-a")).rejects.toMatchObject({ code: "ledger_not_empty" });
    expect(database.transaction).toHaveBeenCalledOnce();
  });

  it("archives an Organization with financial history while preserving its identity", async () => {
    const transaction = {
      select: vi.fn()
        .mockImplementationOnce(() => queryBuilder([{ role: "owner", customCapabilities: [] }]))
        .mockImplementationOnce(() => queryBuilder([{ id: organizationId, archivedAt: null }])),
      update: vi.fn()
        .mockImplementationOnce(() => queryBuilder([{ id: organizationId, archivedAt: new Date("2026-01-01T00:00:00.000Z") }]))
        .mockImplementationOnce(() => queryBuilder([{ targetUserId: "user-b" }, { targetUserId: "user-b" }])),
    };
    const database = {
      select: vi.fn(() => queryBuilder([{ role: "owner", customCapabilities: [] }])),
      transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as Database;

    const archived = await archiveOrganization(database, organizationId, "user-a");
    expect(archived.id).toBe(organizationId);
    expect(archived.archivedAt).not.toBeNull();
    expect(transaction.update).toHaveBeenCalledTimes(2);
    expect(notificationMocks.publishNotificationStateChange).toHaveBeenCalledWith("user-b", "resolved");
    expect(notificationMocks.publishNotificationStateChange).toHaveBeenCalledTimes(1);
  });

  it("restores an archived Organization to the active lifecycle", async () => {
    const transaction = {
      select: vi.fn()
        .mockImplementationOnce(() => queryBuilder([{ role: "owner", customCapabilities: [] }]))
        .mockImplementationOnce(() => queryBuilder([{ id: organizationId, archivedAt: new Date("2026-01-01T00:00:00.000Z") }])),
      update: vi.fn(() => queryBuilder([{ id: organizationId, archivedAt: null }])),
    };
    const database = {
      select: vi.fn(() => queryBuilder([{ role: "owner", customCapabilities: [] }])),
      transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as Database;

    const restored = await restoreOrganization(database, organizationId, "user-a");
    expect(restored.id).toBe(organizationId);
    expect(restored.archivedAt).toBeNull();
  });

  it("blocks new operational mutations in archived Organizations", async () => {
    const archived = { select: vi.fn(() => queryBuilder([{ id: organizationId, archivedAt: new Date("2026-01-01T00:00:00.000Z") }])) } as unknown as Database;
    await expect(assertOrganizationActiveForOperationalMutation(archived, organizationId)).rejects.toMatchObject({ code: "archived" });

    const active = { select: vi.fn(() => queryBuilder([{ id: organizationId, archivedAt: null }])) } as unknown as Database;
    await expect(assertOrganizationActiveForOperationalMutation(active, organizationId)).resolves.toBeUndefined();
  });
});
