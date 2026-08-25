import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { organizationMemberships, organizations } from "@/db/schema";

vi.mock("server-only", () => ({}));

import { createOrganization, OrganizationError, updateOrganization } from "./organizations";

function insertBuilder(table: unknown, calls: Array<{ table: unknown; values?: unknown }>, result: unknown[]) {
  const builder = {
    values(values: unknown) { calls.push({ table, values }); return builder; },
    returning: vi.fn(async () => result),
  };
  return builder;
}

describe("organizations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates the organization and Owner membership in one transaction", async () => {
    const calls: Array<{ table: unknown; values?: unknown }> = [];
    const organization = { id: "11111111-1111-4111-8111-111111111111", name: "Studio", description: null };
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

  it("rejects owner-only profile changes from members", async () => {
    const chain = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => [{ role: "member" }]),
    };
    const database = { select: vi.fn(() => chain) } as unknown as Database;
    await expect(updateOrganization(database, "11111111-1111-4111-8111-111111111111", "user-a", { name: "Studio" })).rejects.toMatchObject({ code: "not_owner" });
  });

  it("rejects blank organization names", async () => {
    await expect(createOrganization({} as Database, "user-a", { name: "  " })).rejects.toMatchObject({ code: "invalid_input" });
    expect(new OrganizationError("invalid_id")).toBeInstanceOf(Error);
  });
});
