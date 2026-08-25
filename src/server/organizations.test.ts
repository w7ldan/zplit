import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { organizationMemberships, organizations } from "@/db/schema";
import type { OrganizationRole } from "@/domain/organization-permissions";

vi.mock("server-only", () => ({}));

import {
  createOrganization,
  deleteOrganization,
  deleteOrganizationAvatar,
  getOrganizationForMember,
  OrganizationError,
  requireOrganizationAccess,
  saveOrganizationAvatar,
  updateOrganization,
} from "./organizations";

function insertBuilder(table: unknown, calls: Array<{ table: unknown; values?: unknown }>, result: unknown[]) {
  const builder = {
    values(values: unknown) { calls.push({ table, values }); return builder; },
    returning: vi.fn(async () => result),
  };
  return builder;
}

function queryBuilder(result: unknown) {
  type Query = Record<string, ReturnType<typeof vi.fn>> & { then: Promise<unknown>["then"] };
  const chain = {} as Query;
  for (const method of ["from", "innerJoin", "leftJoin", "where", "limit", "orderBy", "set", "values", "onConflictDoUpdate"]) chain[method] = vi.fn(() => chain);
  chain.returning = vi.fn(async () => result);
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function databaseForMembership(membership: { role: string; customCapabilities?: unknown } | undefined, mutationResult: unknown[] = []) {
  const selects = [membership ? [membership] : []];
  return {
    select: vi.fn(() => queryBuilder(selects.shift() ?? [])),
    update: vi.fn(() => queryBuilder(mutationResult)),
    delete: vi.fn(() => queryBuilder(mutationResult)),
    insert: vi.fn(() => queryBuilder(mutationResult)),
  } as unknown as Database & { update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn> };
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

  it("creates the organization and Owner membership in one transaction", async () => {
    const calls: Array<{ table: unknown; values?: unknown }> = [];
    const organization = { id: organizationId, name: "Studio", description: null };
    const transaction = {
      insert: vi.fn((table: unknown) => insertBuilder(table, calls, table === organizations ? [organization] : [{ organizationId: organization.id, userId: "user-a", role: "owner" }])),
    };
    const database = { transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)) } as unknown as Database;

    await expect(createOrganization(database, "user-a", { name: " Studio " })).resolves.toEqual(organization);
    expect(database.transaction).toHaveBeenCalledOnce();
    expect(calls).toEqual([
      { table: organizations, values: { name: "Studio", description: null } },
      { table: organizationMemberships, values: { organizationId: organization.id, userId: "user-a", role: "owner" } },
    ]);
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
    await expect(getOrganizationForMember(database, organizationId, "user-a")).resolves.toMatchObject({ canUpdate: true, canDelete: false });
  });

  it("rejects blank organization names", async () => {
    await expect(createOrganization({} as Database, "user-a", { name: "  " })).rejects.toMatchObject({ code: "invalid_input" });
    expect(new OrganizationError("invalid_id")).toBeInstanceOf(Error);
  });
});
