import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { groupMemberships, groupParticipants, groups } from "@/db/schema";
import { assertPlainDto } from "@/test/assert-plain-dto";
import { createExternalParticipant, createGroup, deleteExternalParticipant, deleteGroup, getGroupForMember, GroupError, removeGroupMember, requireGroupAccess, updateExternalParticipant } from "./groups";

vi.mock("server-only", () => ({}));

function chain(result: unknown) {
  const query = {} as Record<string, unknown> & { then: Promise<unknown>["then"] };
  for (const method of ["from", "innerJoin", "leftJoin", "where", "limit", "orderBy", "for", "set", "values", "onConflictDoUpdate"]) query[method] = vi.fn(() => query);
  query.returning = vi.fn(async () => result);
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return query;
}

function insertBuilder(table: unknown, calls: Array<{ table: unknown; values: unknown }>, result: unknown[]) {
  const query = chain(result);
  query.values = vi.fn((values: unknown) => { calls.push({ table, values }); return query; });
  return query;
}

const groupId = "11111111-1111-4111-8111-111111111111";
const otherGroupId = "22222222-2222-4222-8222-222222222222";
const participantId = "33333333-3333-4333-8333-333333333333";

function removalDatabase(actorRole: string, target: Record<string, unknown> | null = { role: "member", participantId, participantGroupId: groupId, participantUserId: "user-b" }, membershipDelete: unknown[] = [{ userId: "user-b" }], participantDelete: unknown[] = [{ id: participantId }], hasFinancialHistory = false) {
  const selects = [[{ role: actorRole }], target && target.participantGroupId === groupId ? [{ id: target.participantId, participantGroupId: target.participantGroupId, participantUserId: target.participantUserId }] : [], target ? [{ role: target.role, participantId: target.participantId, userId: target.participantUserId }] : [], hasFinancialHistory ? [{ id: "expense-a" }] : [], [], []];
  const deletedTables: unknown[] = [];
  const transaction = {
    select: vi.fn(() => chain(selects.shift() ?? [])),
    update: vi.fn(() => chain([])),
    delete: vi.fn((table: unknown) => {
      deletedTables.push(table);
      return chain(table === groupMemberships ? membershipDelete : participantDelete);
    }),
  };
  let committed = false;
  const database = {
    transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => {
      const result = await callback(transaction);
      committed = true;
      return result;
    }),
  } as unknown as Database;
  return { database, deletedTables, wasCommitted: () => committed };
}

describe("groups", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates the Group, registered participant, and Owner membership atomically", async () => {
    const calls: Array<{ table: unknown; values: unknown }> = [];
    const group = { id: groupId, name: "Trip", description: null, createdByUserId: "user-a" };
    const participant = { id: "33333333-3333-4333-8333-333333333333" };
    const transaction = { insert: vi.fn((table: unknown) => insertBuilder(table, calls, table === groups ? [group] : table === groupParticipants ? [participant] : [{ groupId, userId: "user-a", participantId: participant.id, role: "owner" }])) };
    const database = { transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)) } as unknown as Database;

    await expect(createGroup(database, "user-a", { name: " Trip " })).resolves.toEqual(group);
    expect(database.transaction).toHaveBeenCalledOnce();
    expect(calls.map(({ table }) => table)).toEqual([groups, groupParticipants, groupMemberships]);
    expect(calls[1]?.values).toMatchObject({ groupId, userId: "user-a" });
    expect(calls[2]?.values).toMatchObject({ groupId, userId: "user-a", participantId: participant.id, role: "owner" });
  });

  it("fails closed for guessed IDs and derives only the membership role", async () => {
    const database = { select: vi.fn(() => chain([])) } as unknown as Database;
    await expect(requireGroupAccess(database, groupId, "outsider")).rejects.toMatchObject({ code: "not_member" });
    await expect(requireGroupAccess(database, otherGroupId, "user-a")).rejects.toMatchObject({ code: "not_member" });
  });

  it.each([
    ["owner", true, true, true],
    ["admin", false, true, false],
    ["member", false, false, false],
  ] as const)("enforces the %s management boundary", async (role, isOwner, canManageParticipants, canDelete) => {
    const database = { select: vi.fn(() => chain([{ role }])) } as unknown as Database;
    const access = await requireGroupAccess(database, groupId, "user-a");
    expect(access).toMatchObject({ role, isOwner, canManageParticipants, canDelete });
    expect(access.requireManageGroup).toEqual(expect.any(Function));
    expect(() => assertPlainDto(access)).toThrow();
  });

  it("returns a serializable GroupDetail", async () => {
    const database = {
      select: vi.fn()
        .mockImplementationOnce(() => chain([{ role: "admin" }]))
        .mockImplementationOnce(() => chain([{ id: groupId, name: "Trip", description: null, role: "admin", avatar: null }]))
        .mockImplementationOnce(() => chain([{ participantCount: 2, memberCount: 1, externalParticipantCount: 1 }]))
        .mockImplementationOnce(() => chain([{ memberCount: 1 }])),
    } as unknown as Database;

    const group = await getGroupForMember(database, groupId, "user-a");

    assertPlainDto(group);
    expect(group).toMatchObject({ id: groupId, role: "admin", isOwner: false, canManageGroup: true, canManageParticipants: true, canManageRoles: false, canDelete: false });
    expect(group).not.toHaveProperty("requireManageGroup");
    expect(group).not.toHaveProperty("requireManageParticipants");
    expect(group).not.toHaveProperty("requireManageRoles");
    expect(group).not.toHaveProperty("requireDelete");
  });

  it("allows duplicate external names while preserving local labels", async () => {
    const calls: Array<{ table: unknown; values: unknown }> = [];
    const database = {
      select: vi.fn(() => chain([{ role: "admin" }])),
      insert: vi.fn(() => insertBuilder(groupParticipants, calls, [{ id: "p" }])),
    } as unknown as Database;
    await createExternalParticipant(database, groupId, "admin-a", { displayName: "Alice", label: "Fasilkom" });
    await createExternalParticipant(database, groupId, "admin-a", { displayName: "Alice", label: "SMA" });
    expect(calls.map(({ values }) => values)).toEqual([
      { groupId, displayName: "Alice", label: "Fasilkom" },
      { groupId, displayName: "Alice", label: "SMA" },
    ]);
  });

  it("refuses to delete a Group with financial history before touching its records", async () => {
    const transaction = {
      select: vi.fn()
        .mockImplementationOnce(() => chain([{ role: "owner" }]))
        .mockImplementationOnce(() => chain([{ id: "expense-a" }])),
      delete: vi.fn(() => chain([])),
    };
    const database = { transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)) } as unknown as Database;

    await expect(deleteGroup(database, groupId, "user-a")).rejects.toMatchObject({ code: "financial_history" });
    expect(transaction.delete).not.toHaveBeenCalled();
  });

  it("deletes an empty Group in one transaction", async () => {
    const transaction = {
      select: vi.fn()
        .mockImplementationOnce(() => chain([{ role: "owner" }]))
        .mockImplementationOnce(() => chain([]))
        .mockImplementationOnce(() => chain([]))
        .mockImplementationOnce(() => chain([])),
      delete: vi.fn(() => chain([{ id: groupId }])),
    };
    const database = { transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)) } as unknown as Database;

    await expect(deleteGroup(database, groupId, "user-a")).resolves.toBe(true);
    expect(transaction.delete).toHaveBeenCalledWith(groups);
  });

  it("cannot update a participant from another Group or edit a registered identity", async () => {
    const isolated = { select: vi.fn().mockImplementationOnce(() => chain([{ role: "admin" }])).mockImplementationOnce(() => chain([])) } as unknown as Database;
    await expect(updateExternalParticipant(isolated, groupId, "admin-a", "foreign-participant", { displayName: "Alice" })).rejects.toMatchObject({ code: "participant_not_found" });

    const registered = { select: vi.fn().mockImplementationOnce(() => chain([{ role: "admin" }])).mockImplementationOnce(() => chain([{ userId: "user-b" }])) } as unknown as Database;
    await expect(updateExternalParticipant(registered, groupId, "admin-a", "registered-participant", { displayName: "Alice" })).rejects.toMatchObject({ code: "registered_participant" });
    expect(new GroupError("forbidden")).toBeInstanceOf(Error);
  });

  it("removes a registered member and its participant atomically", async () => {
    const { database, deletedTables, wasCommitted } = removalDatabase("owner");

    await expect(removeGroupMember(database, groupId, "user-a", "user-b")).resolves.toBe(true);
    expect(deletedTables).toEqual([groupMemberships, groupParticipants]);
    expect(wasCommitted()).toBe(true);
  });

  it("removes membership but retains a registered participant with financial history", async () => {
    const { database, deletedTables } = removalDatabase("owner", { role: "member", participantId, participantGroupId: groupId, participantUserId: "user-b" }, [{ userId: "user-b" }], [{ id: participantId }], true);
    await expect(removeGroupMember(database, groupId, "user-a", "user-b")).resolves.toBe(true);
    expect(deletedTables).toEqual([groupMemberships]);
  });

  it("revokes pending participant links before removing an external participant", async () => {
    const transaction = {
      select: vi.fn()
        .mockImplementationOnce(() => chain([{ role: "owner" }]))
        .mockImplementationOnce(() => chain([{ id: participantId, userId: null }]))
        .mockImplementation(() => chain([])),
      update: vi.fn(() => chain([{ targetUserId: "user-b" }])),
      delete: vi.fn(() => chain([{ id: participantId }])),
    };
    const database = { transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)) } as unknown as Database;

    await expect(deleteExternalParticipant(database, groupId, "user-a", participantId)).resolves.toBe(true);
    expect(transaction.update).toHaveBeenCalledOnce();
    expect(transaction.delete).toHaveBeenCalledWith(groupParticipants);
  });

  it("retains an external participant with financial history", async () => {
    const transaction = {
      select: vi.fn()
        .mockImplementationOnce(() => chain([{ role: "owner" }]))
        .mockImplementationOnce(() => chain([{ id: participantId, userId: null }]))
        .mockImplementationOnce(() => chain([{ id: "expense-a" }]))
        .mockImplementation(() => chain([])),
      update: vi.fn(() => chain([])),
      delete: vi.fn(() => chain([{ id: participantId }])),
    };
    const database = { transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)) } as unknown as Database;

    await expect(deleteExternalParticipant(database, groupId, "user-a", participantId)).rejects.toMatchObject({ code: "financial_history" });
    expect(transaction.update).not.toHaveBeenCalled();
    expect(transaction.delete).not.toHaveBeenCalled();
  });

  it("protects the Owner from removal", async () => {
    const { database, deletedTables, wasCommitted } = removalDatabase("owner", { role: "owner", participantId, participantGroupId: groupId, participantUserId: "user-a" });

    await expect(removeGroupMember(database, groupId, "user-a", "user-a")).rejects.toMatchObject({ code: "forbidden" });
    expect(deletedTables).toEqual([]);
    expect(wasCommitted()).toBe(false);
  });

  it.each([
    ["owner", "admin", true],
    ["owner", "member", true],
    ["admin", "member", true],
    ["admin", "admin", false],
    ["admin", "owner", false],
    ["member", "member", false],
  ] as const)("preserves %s removing %s boundary", async (actorRole, targetRole, allowed) => {
    const { database, deletedTables } = removalDatabase(actorRole, { role: targetRole, participantId, participantGroupId: groupId, participantUserId: "user-b" });
    const result = removeGroupMember(database, groupId, "user-a", "user-b");

    if (allowed) {
      await expect(result).resolves.toBe(true);
      expect(deletedTables).toEqual([groupMemberships, groupParticipants]);
    } else {
      await expect(result).rejects.toMatchObject({ code: "forbidden" });
      expect(deletedTables).toEqual([]);
    }
  });

  it("does not cross Group boundaries when the participant relationship is inconsistent", async () => {
    const { database, deletedTables, wasCommitted } = removalDatabase("owner", { role: "member", participantId, participantGroupId: otherGroupId, participantUserId: "user-b" });

    await expect(removeGroupMember(database, groupId, "user-a", "user-b")).rejects.toMatchObject({ code: "forbidden" });
    expect(deletedTables).toEqual([]);
    expect(wasCommitted()).toBe(false);
  });

  it("fails without committing when the participant cannot be deleted", async () => {
    const { database, deletedTables, wasCommitted } = removalDatabase("owner", undefined, [{ userId: "user-b" }], []);

    await expect(removeGroupMember(database, groupId, "user-a", "user-b")).rejects.toMatchObject({ code: "participant_not_found" });
    expect(deletedTables).toEqual([groupMemberships, groupParticipants]);
    expect(wasCommitted()).toBe(false);
  });
});
