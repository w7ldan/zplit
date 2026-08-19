import { drizzle } from "drizzle-orm/pg-proxy";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client";
import { debtorShareReceipts, expenseReceipts, expenseShares, expenses, outings, repaymentAllocations, repayments, trips } from "../db/schema";
import {
  createLedgerRepository,
  deletionImpactRevision,
  ExpenseDeletionInvariantError,
  LedgerDeletionConfirmationRequiredError,
  LedgerNotFoundError,
  LedgerRepositoryError,
  OutingDeletionInvariantError,
  RepaymentAllocationAmountInvariantError,
  RepaymentAllocationShareInvariantError,
  RepaymentDeletionInvariantError,
} from "./ledger-repository";
import { LedgerIntegrityError } from "./ledger-summary";

const owner = "user-a";

function emptyTransactionalDatabase() {
  function noRows() {
    const result = Promise.resolve([]) as Promise<never[]> & { for: () => Promise<never[]> };
    result.for = async () => [];
    return result;
  }
  const transaction = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => noRows(),
        }),
      }),
    }),
  };
  return {
    transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction),
  } as unknown as Database;
}

function repaymentAllocationDatabase(overrides: Partial<{
  visible: boolean;
  repayment: { id: string; friendId: string; amount: number } | null;
  share: { id: string; expenseId: string; friendId: string; amountOwed: number } | null;
  allocation: { repaymentId: string; expenseShareId: string; amount: number } | null;
  repaymentOthers: Array<{ amount: number }>;
  shareOthers: Array<{ amount: number }>;
}> = {}) {
  const state = {
    visible: true,
    repayment: { id: "repayment-a", friendId: "friend-a", amount: 100 },
    share: { id: "share-a", expenseId: "expense-a", friendId: "friend-a", amountOwed: 100 },
    allocation: { repaymentId: "repayment-a", expenseShareId: "share-a", amount: 40 },
    repaymentOthers: [] as Array<{ amount: number }>,
    shareOthers: [] as Array<{ amount: number }>,
    ...overrides,
  };
  let allocationQuery = 0;
  const transaction = {
    select() {
      let table: unknown;
      const chain = {
        from(nextTable: unknown) { table = nextTable; return chain; },
        where() { return chain; },
        limit() { return chain; },
        orderBy() { return chain; },
        for() {
          if (!state.visible) return Promise.resolve([]);
          if (table === repayments) return Promise.resolve(state.repayment ? [state.repayment] : []);
          if (table === expenseShares) return Promise.resolve(state.share ? [state.share] : []);
          if (table === repaymentAllocations) {
            if (allocationQuery++ === 0) return Promise.resolve(state.allocation ? [state.allocation] : []);
            return Promise.resolve(allocationQuery === 2 ? state.repaymentOthers : state.shareOthers);
          }
          return Promise.resolve([]);
        },
      };
      return chain;
    },
    delete() {
      return { where: () => ({ returning: async () => {
        if (!state.allocation) return [];
        const deleted = state.allocation;
        state.allocation = null;
        return [deleted];
      } }) };
    },
    insert() {
      return { values: (value: typeof state.allocation & { ownerUserId: string }) => ({ returning: async () => {
        state.allocation = { repaymentId: value.repaymentId, expenseShareId: value.expenseShareId, amount: value.amount };
        return [state.allocation];
      } }) };
    },
  };
  return {
    state,
    database: { transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => { allocationQuery = 0; return callback(transaction); } } as unknown as Database,
  };
}

function deletionDatabase(withDependents: boolean) {
  let deleteCalls = 0;
  const transaction = {
    select() {
      let table: unknown;
      const chain = {
        from(nextTable: unknown) { table = nextTable; return chain; },
        where() { return chain; },
        limit() { return chain; },
        orderBy() { return chain; },
        for() {
          if (table === expenses) return Promise.resolve([{ id: "expense-a" }]);
          if (table === expenseReceipts || table === debtorShareReceipts) return Promise.resolve([]);
          if (table === expenseShares) return Promise.resolve(withDependents ? [{ id: "share-a", friendId: "friend-a" }] : []);
          if (table === repaymentAllocations) return Promise.resolve(withDependents ? [{ repaymentId: "repayment-a", expenseShareId: "share-a" }] : []);
          return Promise.resolve([]);
        },
      };
      return chain;
    },
    delete() {
      return { where: () => ({ returning: async () => { deleteCalls += 1; return [{ id: "expense-a" }]; } }) };
    },
  };
  return {
    database: { transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction) } as unknown as Database,
    deleteCalls: () => deleteCalls,
  };
}

function previousSplitDatabase(fixture: {
  outingId?: string;
  candidateId?: string;
  friends?: Array<{ id: string; name: string; archivedAt: Date | null; baseAmount: number }>;
  charges?: Array<{ id: string; name: string; percentageBasisPoints: number; scope: "all" | "selected"; targetFriendId: string | null }>;
}) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const database = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    const normalized = sql.toLowerCase();
    if (normalized.startsWith('select "outing_id"') || normalized.startsWith('select "expenses"."outing_id"')) return { rows: [[fixture.outingId ?? "outing-a"]] };
    if (normalized.includes('"base_amount"')) return { rows: (fixture.friends ?? []).map((friend) => [friend.id, friend.name, friend.archivedAt, friend.baseAmount]) };
    if (normalized.includes('"percentage_basis_points"')) return { rows: (fixture.charges ?? []).map((charge) => [charge.id, charge.name, charge.percentageBasisPoints, charge.scope, charge.targetFriendId]) };
    if (normalized.includes('from "expenses"') && normalized.includes('inner join "outings"') && normalized.includes("exists")) return fixture.candidateId ? { rows: [[fixture.candidateId]] } : { rows: [] };
    return { rows: (fixture.charges ?? []).map((charge) => [charge.id, charge.name, charge.percentageBasisPoints, charge.scope, charge.targetFriendId]) };
  });
  return { database: database as unknown as Database, queries };
}

describe("ledger repository", () => {
  it("generates deterministic revisions from the complete normalized impact", () => {
    const impact = {
      recordType: "outing" as const,
      expenseCount: 2,
      expenseTotal: 30_000,
      receiptCount: 1,
      shareCount: 2,
      allocationCount: 1,
      affectedRepaymentCount: 2,
      affectedRepaymentIds: [" REPAYMENT-B ", "repayment-a"],
      affectedFriendIds: ["FRIEND-B", "friend-a"],
    };
    const sameImpact = { ...impact, affectedRepaymentIds: ["repayment-a", "repayment-b"], affectedFriendIds: ["friend-a", "friend-b"] };
    expect(deletionImpactRevision(impact)).toMatch(/^[0-9a-f]{64}$/);
    expect(deletionImpactRevision(impact)).toBe(deletionImpactRevision(sameImpact));
    expect(deletionImpactRevision({ ...impact, allocationCount: 2 })).not.toBe(deletionImpactRevision(impact));
    expect(deletionImpactRevision({ ...impact, expenseTotal: 30_001 })).not.toBe(deletionImpactRevision(impact));
    expect(deletionImpactRevision({ ...impact, affectedRepaymentIds: ["repayment-b", "repayment-c"] })).not.toBe(deletionImpactRevision(impact));
    expect(() => deletionImpactRevision({ ...impact, expenseTotal: -1 })).toThrow(LedgerIntegrityError);
  });

  it.each([
    { recordType: "expense" as const, receiptCount: 0, shareCount: 0, allocationCount: 0, affectedRepaymentCount: 0, affectedRepaymentIds: [], affectedFriendIds: [] },
    { recordType: "repayment" as const, allocationCount: 0, friendId: "friend-a" },
  ])("accepts valid $recordType impact revisions", (impact) => {
    expect(deletionImpactRevision(impact)).toHaveLength(64);
  });

  it("rejects malformed revisions before opening a transaction", async () => {
    const transaction = vi.fn();
    const repository = createLedgerRepository({ transaction } as unknown as Database, owner);
    await expect(repository.deleteExpense("expense-a", { cascadeDependents: true, expectedImpactRevision: "A".repeat(64) })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(repository.deleteExpense("expense-a", { cascadeDependents: true, expectedImpactRevision: "a".repeat(63) })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("requires and compares the locked current impact before deletion", async () => {
    const impact = { recordType: "expense" as const, receiptCount: 0, shareCount: 1, allocationCount: 1, affectedRepaymentCount: 1, affectedRepaymentIds: ["repayment-a"], affectedFriendIds: ["friend-a"] };
    const matching = deletionDatabase(true);
    await expect(createLedgerRepository(matching.database, owner).deleteExpense("expense-a", { cascadeDependents: true, expectedImpactRevision: deletionImpactRevision(impact) })).resolves.toEqual({ friendIds: ["friend-a"], repaymentIds: ["repayment-a"] });
    expect(matching.deleteCalls()).toBe(1);

    const stale = deletionDatabase(true);
    const error = await createLedgerRepository(stale.database, owner).deleteExpense("expense-a", { cascadeDependents: true, expectedImpactRevision: "f".repeat(64) }).catch((value) => value);
    expect(error).toBeInstanceOf(LedgerDeletionConfirmationRequiredError);
    expect(error).toMatchObject({ reason: "impact_changed", impact });
    expect(stale.deleteCalls()).toBe(0);
  });

  it("rejects an obsolete cascade confirmation with the current empty impact", async () => {
    const currentImpact = { recordType: "expense" as const, receiptCount: 0, shareCount: 0, allocationCount: 0, affectedRepaymentCount: 0, affectedRepaymentIds: [], affectedFriendIds: [] };
    const database = deletionDatabase(false);
    const error = await createLedgerRepository(database.database, owner).deleteExpense("expense-a", { cascadeDependents: true, expectedImpactRevision: deletionImpactRevision(currentImpact) }).catch((value) => value);
    expect(error).toMatchObject({ reason: "cascade_confirmation_obsolete", impact: currentImpact });
    expect(database.deleteCalls()).toBe(0);
  });
  it("rejects a blank owner immediately", () => {
    expect(() => createLedgerRepository({} as Database, "  ")).toThrowError(LedgerRepositoryError);
    try {
      createLedgerRepository({} as Database, "");
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_OWNER" });
    }
  });

  it("does not accept ownership in input objects", async () => {
    const repository = createLedgerRepository({} as Database, owner);
    await expect(
      repository.createFriend({ name: "Friend", ownerUserId: "user-b" } as never),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      repository.createFriend({ name: "Friend", owner_user_id: "user-b" } as never),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      repository.updateFriend("friend-a", { name: "Friend", phoneNumber: null, notes: null, ownerUserId: "user-b" } as never),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      repository.createOuting({ title: "Outing", occurredAt: new Date(), notes: null, ownerUserId: "user-b" } as never),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      repository.updateOuting("outing-a", { title: "Outing", occurredAt: new Date(), notes: null, owner_user_id: "user-b" } as never),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      repository.createExpense({ description: "Expense", amount: 100, outingId: "outing-a", ownerUserId: "user-b" } as never),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      repository.updateExpense("expense-a", { description: "Expense", amount: 100, outingId: "outing-a", owner_user_id: "user-b" } as never),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("puts the bound owner in read predicates", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    });
    const repository = createLedgerRepository(database as unknown as Database, owner);

    await repository.listFriends();

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('"friends"."owner_user_id" = $1');
    expect(queries[0].params).toContain(owner);
  });

  it("bounds owner-scoped selector searches and keeps selected records searchable", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    });
    const selectedId = "11111111-1111-4111-8111-111111111111";
    const repository = createLedgerRepository(database as unknown as Database, owner);

    await repository.searchOutings({ q: "100%_\\", selectedId });
    await repository.searchFriends({ q: "100%_\\", selectedId });

    expect(queries).toHaveLength(2);
    const [outingQuery, friendQuery] = queries.map((query) => ({ ...query, sql: query.sql.replace(/\s+/g, " ").trim().toLowerCase() }));
    expect(outingQuery.sql).toContain('select "id", "title"');
    expect(friendQuery.sql).toContain('select "id", "name"');
    for (const query of [outingQuery, friendQuery]) {
      expect(query.sql).toContain("owner_user_id");
      expect(query.sql).toMatch(/limit \$\d+/);
      expect(query.params).toContain(owner);
      expect(query.params).toContain(selectedId);
      expect(query.params.some((value) => typeof value === "string" && value.includes("\\%") && value.includes("\\_"))).toBe(true);
    }
    expect(outingQuery.sql).toContain("order by");
    expect(friendQuery.sql).toContain("case when \"friends\".\"archived_at\" is null then 0 else 1 end");
  });

  it("orders empty friend selectors by latest owner-created share or repayment activity", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; });
    await createLedgerRepository(database as unknown as Database, owner).searchFriends();
    const query = queries[0]!.sql.replace(/\s+/g, " ").trim().toLowerCase();
    expect(query).toContain("greatest");
    expect(query).toContain('"expense_shares"."created_at"');
    expect(query).toContain('"repayments"."created_at"');
    expect(query).toContain("desc nulls last");
    expect(queries[0]!.params.filter((value) => value === owner)).toHaveLength(3);
  });

  it("returns bounded, deduplicated recent outings before normal empty-query results", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return sql.toLowerCase().includes('from "expenses"')
        ? { rows: [["out-a", "Dinner"], ["out-a", "Dinner"], ["out-b", "Coffee"]] }
        : { rows: [["out-b", "Coffee"], ["out-c", "Walk"]] };
    });
    await expect(createLedgerRepository(database as unknown as Database, owner).searchOutings()).resolves.toEqual([
      { id: "out-a", title: "Dinner", recent: true },
      { id: "out-b", title: "Coffee", recent: true },
      { id: "out-c", title: "Walk" },
    ]);
    expect(queries).toHaveLength(2);
    expect(queries[0]!.sql.toLowerCase()).toMatch(/limit \$\d+/);
    expect(queries[0]!.params).toContain(owner);
  });

  it("searches all five record types in one bounded owner-scoped query", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [
        { record_kind: "friend", record_id: "friend-a", title_source: "Ari", detail_source: null, context_source: null, amount: null, occurred_at: null },
        { record_kind: "trip", record_id: "trip-a", title_source: "Bali", detail_source: "2026-08-01", context_source: null, amount: null, occurred_at: null },
        { record_kind: "outing", record_id: "outing-a", title_source: "Dinner", detail_source: null, context_source: "Bali", amount: null, occurred_at: new Date("2026-08-02T00:00:00.000Z") },
        { record_kind: "expense", record_id: "expense-a", title_source: "Nasi", detail_source: "Dinner", context_source: null, amount: 42500, occurred_at: null },
        { record_kind: "repayment", record_id: "repayment-a", title_source: "Ari", detail_source: null, context_source: null, amount: 42500, occurred_at: new Date("2026-08-03T00:00:00.000Z") },
      ] };
    });
    const repository = createLedgerRepository(database as unknown as Database, owner);

    await expect(repository.searchGlobalRecords("Rp 42.500")).resolves.toMatchObject([
      { kind: "friend", id: "friend-a", title: "Ari" },
      { kind: "trip", id: "trip-a", detail: "2026-08-01" },
      { kind: "outing", id: "outing-a", context: "Bali", date: "2026-08-02T00:00:00.000Z" },
      { kind: "expense", id: "expense-a", amount: 42500, detail: "Dinner" },
      { kind: "repayment", id: "repayment-a", amount: 42500, date: "2026-08-03T00:00:00.000Z" },
    ]);
    await expect(repository.searchGlobalRecords(" ")).resolves.toEqual([]);

    expect(queries).toHaveLength(1);
    const query = queries[0]!.sql.replace(/\s+/g, " ").trim().toLowerCase();
    for (const table of ["friends", "trips", "outings", "expenses", "repayments"]) expect(query).toContain(`from ${table}`);
    expect(query).toContain("union all");
    expect(query).toContain("limit 5");
    expect(query).toContain("limit 20");
    expect(query).toContain("e.amount =");
    expect(query).toContain("r.amount =");
    expect(queries[0]!.params.filter((value) => value === owner).length).toBeGreaterThanOrEqual(5);
    expect(queries[0]!.params).toContain(42500);
  });

  it("bounds Trip selector search and preserves a selected owner record", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => { queries.push({ sql, params }); return sql.toLowerCase().includes("select count(*)") ? { rows: [[41]] } : { rows: [] }; });
    const selectedId = "11111111-1111-4111-8111-111111111111";
    await createLedgerRepository(database as unknown as Database, owner).searchTrips({ q: "100%_\\", selectedId });
    expect(queries).toHaveLength(1);
    expect(queries[0].sql.toLowerCase()).toContain("from \"trips\"");
    expect(queries[0].sql.toLowerCase()).toMatch(/limit \$\d+/);
    expect(queries[0].params).toContain(owner);
    expect(queries[0].params).toContain(selectedId);
    expect(queries[0].params.some((value) => typeof value === "string" && value.includes("\\%") && value.includes("\\_"))).toBe(true);
  });

  it("keeps Trip page aggregates bounded to the selected page", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => { queries.push({ sql, params }); return sql.toLowerCase().includes("select count(*)") ? { rows: [[41]] } : { rows: [] }; });
    await createLedgerRepository(database as unknown as Database, owner).listTripRecords({ q: "Bali", page: 2 });
    expect(queries).toHaveLength(2);
    expect(queries[0].sql.toLowerCase()).toContain("count(*)");
    expect(queries[1].sql.toLowerCase()).toContain("trip_page");
    expect(queries[1].sql.toLowerCase()).toContain("trip_totals");
    expect(queries[1].sql.toLowerCase()).toContain("limit");
    expect(queries[1].sql.toLowerCase()).toContain("offset");
    expect(queries[1].params).toContain(20);
    expect(queries[1].params).toContain(owner);
  });

  it("returns one owner-scoped Trip aggregate", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => { queries.push({ sql, params }); return { rows: [["trip-a", 2, 3, 84000]] }; });
    await expect(createLedgerRepository(database as unknown as Database, owner).getTripSummary("11111111-1111-4111-8111-111111111111")).resolves.toEqual({ outingCount: 2, expenseCount: 3, expenseTotal: 84000 });
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('"trips"."owner_user_id" = $');
    expect(queries[0].sql).toContain('"outings"."trip_id"');
  });

  it("detaches linked outings before deleting only the Trip", async () => {
    const updates: unknown[] = [];
    const deletes: unknown[] = [];
    let table: unknown;
    const chain = {
      from(nextTable: unknown) { table = nextTable; return chain; },
      where() { return chain; },
      limit() { return chain; },
      for() { return table === trips ? Promise.resolve([{ id: "trip-a" }]) : Promise.resolve([]); },
    };
    const transaction = {
      select() { return chain; },
      update(nextTable: unknown) { return { set: (values: unknown) => { updates.push({ nextTable, values }); return { where: () => ({ returning: async () => [{ id: "outing-a" }] }) }; } }; },
      delete(nextTable: unknown) { deletes.push(nextTable); return { where: () => ({ returning: async () => [{ id: "trip-a" }] }) }; },
    };
    const database = { transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction) } as unknown as Database;
    await expect(createLedgerRepository(database, owner).deleteTrip("11111111-1111-4111-8111-111111111111")).resolves.toEqual({ detachedOutingCount: 1 });
    expect(updates[0]).toMatchObject({ nextTable: outings, values: { tripId: null } });
    expect(deletes).toEqual([trips]);
  });

  it("bounds expense friend suggestions to active friends", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    });
    await createLedgerRepository(database as unknown as Database, owner).searchFriends({ activeOnly: true });

    const query = queries[0]!.sql.replace(/\s+/g, " ").trim().toLowerCase();
    expect(query).toContain('"friends"."archived_at" is null');
    expect(query).toMatch(/limit \$\d+/);
    expect(queries[0]!.params).toContain(owner);
  });

  it("owner-scopes get, archived list, update, archive, and restore predicates", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    });
    const repository = createLedgerRepository(database as unknown as Database, owner);

    await expect(repository.getFriend("friend-a")).rejects.toBeInstanceOf(LedgerNotFoundError);
    await expect(repository.listFriends({ archived: true })).resolves.toEqual([]);
    await expect(repository.updateFriend("friend-a", { name: "Friend", phoneNumber: null, notes: null })).rejects.toBeInstanceOf(LedgerNotFoundError);
    await expect(repository.setFriendArchived("friend-a", true)).rejects.toBeInstanceOf(LedgerNotFoundError);
    await expect(repository.setFriendArchived("friend-a", false)).rejects.toBeInstanceOf(LedgerNotFoundError);

    expect(queries).toHaveLength(5);
    for (const query of queries) {
      expect(query.sql).toContain('"friends"."owner_user_id" = $');
      expect(query.params).toContain(owner);
    }
    expect(queries[1].sql).toContain('"friends"."archived_at" is not null');
    expect(queries[2].sql).toContain('"friends"."id" = $');
    expect(queries[3].sql).toContain('"friends"."id" = $');
    expect(queries[4].sql).toContain('"friends"."id" = $');
  });

  it("returns a versioned archive receipt and reverses that exact state", async () => {
    const archivedAt = new Date("2026-08-07T00:00:00.000Z");
    const updatedAt = new Date("2026-08-07T00:00:01.000Z");
    const archivedFriend = { id: "friend-a", ownerUserId: owner, name: "Friend", phoneNumber: null, notes: null, archivedAt, createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt };
    const restoredFriend = { ...archivedFriend, archivedAt: null, updatedAt: new Date("2026-08-07T00:00:02.000Z") };
    const updates: unknown[] = [];
    const database = {
      update: () => ({
        set: (values: unknown) => {
          updates.push(values);
          return { where: () => ({ returning: async () => [updates.length === 1 ? { ...archivedFriend, ...(values as object) } : restoredFriend] }) };
        },
      }),
    } as unknown as Database;
    const repository = createLedgerRepository(database, owner);

    const archived = await repository.archiveFriend("friend-a");
    expect(archived.reversalReceipt).toEqual({ version: 1, friendId: "friend-a", archivedAt: archived.friend.archivedAt!.toISOString(), updatedAt: archived.friend.updatedAt.toISOString() });
    await expect(repository.undoFriendArchive(archived.reversalReceipt)).resolves.toEqual(restoredFriend);
    expect(updates[0]).toMatchObject({ archivedAt: archived.friend.archivedAt, updatedAt: archived.friend.updatedAt });
    expect(updates[1]).toMatchObject({ archivedAt: null });
  });

  it("rejects a stale reversal atomically when either archived version changed", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    });
    const receipt = { version: 1 as const, friendId: "friend-a", archivedAt: "2026-08-07T00:00:00.000Z", updatedAt: "2026-08-07T00:00:01.000Z" };

    await expect(createLedgerRepository(database as unknown as Database, owner).undoFriendArchive(receipt)).rejects.toBeInstanceOf(LedgerNotFoundError);
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('"friends"."owner_user_id" = $');
    expect(queries[0].sql).toContain('"friends"."archived_at" = $');
    expect(queries[0].sql).toContain('"friends"."updated_at" = $');
    expect(queries[0].params).toContain(owner);
  });

  it("lists open expense shares with one owner-scoped fixed query", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    });
    const repository = createLedgerRepository(database as unknown as Database, owner);

    await expect(repository.listOpenExpenseSharesByFriend()).resolves.toEqual({});
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('"expense_shares"."owner_user_id" = $');
    expect(queries[0].params).toContain(owner);
  });

  it("does not expose a hard-delete operation and treats foreign IDs as absent", async () => {
    const repository = createLedgerRepository({} as Database, owner);
    expect("deleteFriend" in repository).toBe(false);

    const database = drizzle(async () => ({ rows: [] }));
    const ownerRepository = createLedgerRepository(database as unknown as Database, owner);
    const absent = await ownerRepository.getFriend("absent").catch((error) => error);
    const foreign = await ownerRepository.getFriend("foreign").catch((error) => error);
    expect(absent).toBeInstanceOf(LedgerNotFoundError);
    expect(foreign).toBeInstanceOf(LedgerNotFoundError);
    expect(absent).toMatchObject({ code: "NOT_FOUND", message: "Ledger record not found" });
    expect(foreign).toMatchObject({ code: "NOT_FOUND", message: "Ledger record not found" });
  });

  it("exposes the transactional single-row allocation removal and undo API", () => {
    const repository = createLedgerRepository({} as Database, owner);
    expect("removeRepaymentAllocation" in repository).toBe(true);
    expect("undoRepaymentAllocation" in repository).toBe(true);
    expect("replaceRepaymentAllocations" in repository).toBe(true);
    expect("getRepaymentAllocationPlan" in repository).toBe(true);
  });

  it("deletes immediately and restores the exact allocation snapshot", async () => {
    const database = repaymentAllocationDatabase();
    const repository = createLedgerRepository(database.database, owner);

    const removed = await repository.removeRepaymentAllocation("repayment-a", "share-a");
    expect(database.state.allocation).toBeNull();
    expect(removed.reversalReceipt).toEqual({
      version: 1,
      reversalId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
      allocationId: "repayment-a:share-a",
      repaymentId: "repayment-a",
      expenseShareId: "share-a",
      friendId: "friend-a",
      amount: 40,
    });

    await expect(repository.undoRepaymentAllocation(removed.reversalReceipt)).resolves.toEqual({ expenseId: "expense-a", friendId: "friend-a", repaymentId: "repayment-a" });
    expect(database.state.allocation).toEqual({ repaymentId: "repayment-a", expenseShareId: "share-a", amount: 40 });

    const removedAgain = await repository.removeRepaymentAllocation("repayment-a", "share-a");
    expect(removedAgain.reversalReceipt.reversalId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(removedAgain.reversalReceipt.reversalId).not.toBe(removed.reversalReceipt.reversalId);
  });

  it("rejects malformed allocation reversal IDs", async () => {
    const receipt = { version: 1 as const, reversalId: "not-a-uuid", allocationId: "repayment-a:share-a", repaymentId: "repayment-a", expenseShareId: "share-a", friendId: "friend-a", amount: 40 };
    await expect(createLedgerRepository(repaymentAllocationDatabase({ allocation: null }).database, owner).undoRepaymentAllocation(receipt)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("enforces owner isolation and rejects duplicate Undo", async () => {
    const receipt = { version: 1 as const, reversalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", allocationId: "repayment-a:share-a", repaymentId: "repayment-a", expenseShareId: "share-a", friendId: "friend-a", amount: 40 };
    const foreign = repaymentAllocationDatabase({ visible: false });
    const foreignRepository = createLedgerRepository(foreign.database, owner);
    await expect(foreignRepository.removeRepaymentAllocation("repayment-a", "share-a")).rejects.toBeInstanceOf(LedgerNotFoundError);
    await expect(foreignRepository.undoRepaymentAllocation(receipt)).rejects.toBeInstanceOf(LedgerNotFoundError);

    const database = repaymentAllocationDatabase({ allocation: null });
    const repository = createLedgerRepository(database.database, owner);
    await repository.undoRepaymentAllocation(receipt);
    await expect(repository.undoRepaymentAllocation(receipt)).rejects.toBeInstanceOf(LedgerNotFoundError);
  });

  it.each([
    ["repayment capacity", { repayment: { id: "repayment-a", friendId: "friend-a", amount: 100 }, repaymentOthers: [{ amount: 70 }] }, RepaymentAllocationAmountInvariantError],
    ["share capacity", { share: { id: "share-a", expenseId: "expense-a", friendId: "friend-a", amountOwed: 100 }, shareOthers: [{ amount: 70 }] }, RepaymentAllocationShareInvariantError],
  ])("rejects Undo when it conflicts with the %s", async (_label, overrides, ErrorType) => {
    const receipt = { version: 1 as const, reversalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", allocationId: "repayment-a:share-a", repaymentId: "repayment-a", expenseShareId: "share-a", friendId: "friend-a", amount: 40 };
    const database = repaymentAllocationDatabase({ allocation: null, ...overrides });
    await expect(createLedgerRepository(database.database, owner).undoRepaymentAllocation(receipt)).rejects.toBeInstanceOf(ErrorType);
    expect(database.state.allocation).toBeNull();
  });

  it.each([
    ["mismatched friend", { share: { id: "share-a", expenseId: "expense-a", friendId: "friend-b", amountOwed: 100 } }],
    ["deleted repayment", { repayment: null }],
    ["deleted share", { share: null }],
  ])("rejects Undo safely after a %s", async (_label, overrides) => {
    const receipt = { version: 1 as const, reversalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", allocationId: "repayment-a:share-a", repaymentId: "repayment-a", expenseShareId: "share-a", friendId: "friend-a", amount: 40 };
    const database = repaymentAllocationDatabase({ allocation: null, ...overrides });
    await expect(createLedgerRepository(database.database, owner).undoRepaymentAllocation(receipt)).rejects.toBeInstanceOf(LedgerNotFoundError);
    expect(database.state.allocation).toBeNull();
  });

  it("maps absent and cross-owner references to one generic not-found error", async () => {
    const repository = createLedgerRepository(emptyTransactionalDatabase(), owner);
    const actions = [
      () => repository.createExpense({ description: "Expense", amount: 100, outingId: "other-outing" }),
      () => repository.replaceExpenseShares("other-expense", []),
      () => repository.createRepayment({ friendId: "other-friend", amount: 50, paidAt: new Date(), paymentMethod: null, notes: null }),
      () => repository.replaceRepaymentAllocations("other-repayment", []),
    ];

    for (const action of actions) {
      const absent = await action().catch((error) => error);
      const crossOwner = await action().catch((error) => error);
      expect(absent).toBeInstanceOf(LedgerNotFoundError);
      expect(crossOwner).toBeInstanceOf(LedgerNotFoundError);
      expect(absent).toMatchObject({ code: "NOT_FOUND", message: "Ledger record not found" });
      expect(crossOwner).toMatchObject({ code: "NOT_FOUND", message: "Ledger record not found" });
    }
  });

  it("owner-scopes outing get, list, create, and update predicates", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    });
    const repository = createLedgerRepository(database as unknown as Database, owner);
    const input = { title: "Outing", occurredAt: new Date("2026-01-02T00:00:00.000Z"), notes: null };

    await expect(repository.getOuting("outing-a")).rejects.toBeInstanceOf(LedgerNotFoundError);
    await expect(repository.listOutings()).resolves.toEqual([]);
    await expect(repository.createOuting(input)).rejects.toMatchObject({ code: "PERSISTENCE_ERROR" });
    await expect(repository.updateOuting("outing-a", input)).rejects.toBeInstanceOf(LedgerNotFoundError);

    expect(queries).toHaveLength(4);
    for (const query of queries.slice(0, 2).concat(queries.slice(3))) {
      expect(query.sql).toContain('"outings"."owner_user_id" = $');
      expect(query.params).toContain(owner);
    }
    expect(queries[2].sql).toContain('"owner_user_id"');
    expect(queries[2].params).toContain(owner);
    expect(queries[1].sql).toContain('order by "outings"."occurred_at" desc');
  });

  it("keeps absent and foreign outings indistinguishable and exposes no delete", async () => {
    const database = drizzle(async () => ({ rows: [] }));
    const repository = createLedgerRepository(database as unknown as Database, owner);
    expect("deleteOuting" in repository).toBe(true);
    const absent = await repository.getOuting("absent").catch((error) => error);
    const foreign = await repository.getOuting("foreign").catch((error) => error);
    expect(absent).toMatchObject({ code: "NOT_FOUND", message: "Ledger record not found" });
    expect(foreign).toMatchObject({ code: "NOT_FOUND", message: "Ledger record not found" });
  });

  it("owner-scopes expense get and list queries, including the outing join", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    });
    const repository = createLedgerRepository(database as unknown as Database, owner);

    await expect(repository.getExpense("expense-a")).rejects.toBeInstanceOf(LedgerNotFoundError);
    await expect(repository.listExpenses()).resolves.toEqual([]);

    expect(queries).toHaveLength(2);
    for (const query of queries) {
      expect(query.sql).toContain('"expenses"."owner_user_id" = $');
      expect(query.sql).toContain('"outings"."owner_user_id" = $');
      expect(query.sql).toContain("inner join");
      expect(query.params).toContain(owner);
    }
    expect(queries[1].sql).toContain('order by "outings"."occurred_at" desc, "expenses"."created_at" desc');
  });

  it("bounds recent activity in one owner-scoped query with the default and explicit limits", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    });
    const repository = createLedgerRepository(database as unknown as Database, owner);

    await expect(repository.listRecentActivity()).resolves.toEqual([]);
    await expect(repository.listRecentActivity({ limit: 3 })).resolves.toEqual([]);

    expect(queries).toHaveLength(2);
    for (const [query, limit] of queries.map((query, index) => [query, index === 0 ? 6 : 3] as const)) {
      const sql = query.sql.replace(/\s+/g, " ").trim().toLowerCase();
      expect(query.params.filter((value) => value === limit)).toHaveLength(3);
      expect(sql.match(/\blimit \$\d+/g)).toHaveLength(3);
      expect(sql).toContain("union all");
      expect(query.params).toContain(owner);

      const repaymentCandidates = sql.indexOf("repayment_candidates as materialized");
      const boundedActivity = sql.indexOf("bounded_activity as materialized");
      const finalActivity = sql.indexOf("final_activity as materialized");
      const allocationTotals = sql.indexOf("repayment_totals as");
      expect(repaymentCandidates).toBeGreaterThan(0);
      expect(boundedActivity).toBeGreaterThan(repaymentCandidates);
      expect(finalActivity).toBeGreaterThan(boundedActivity);
      expect(allocationTotals).toBeGreaterThan(finalActivity);

      const expenseBranch = sql.slice(sql.indexOf("expense_candidates as materialized"), repaymentCandidates);
      const repaymentBranch = sql.slice(repaymentCandidates, boundedActivity);
      expect(expenseBranch).toContain("from expenses e");
      expect(expenseBranch).toContain("inner join outings o");
      expect(expenseBranch).toContain("where e.owner_user_id = $");
      expect(expenseBranch).toContain("and o.owner_user_id = $");
      expect(expenseBranch).toContain("order by o.occurred_at desc, e.created_at desc, e.id asc limit");
      expect(repaymentBranch).toContain("from repayments r");
      expect(repaymentBranch).toContain("inner join friends f");
      expect(repaymentBranch).toContain("where r.owner_user_id = $");
      expect(repaymentBranch).toContain("and f.owner_user_id = $");
      expect(repaymentBranch).toContain("order by r.paid_at desc, r.created_at desc, r.id asc limit");

      expect(sql.slice(0, finalActivity)).not.toContain("repayment_allocations");
      expect(sql.slice(allocationTotals)).toContain("from repayment_allocations ra inner join final_activity activity");
      expect(sql.slice(allocationTotals)).toContain("activity.event_kind = 'repayment'");
      expect(sql).toContain("order by activity.effective_at desc, case when activity.event_kind = 'expense' then 0 else 1 end asc, activity.created_at desc, activity.record_id asc limit");
      expect(sql).toContain("from final_activity activity left join repayment_totals rt");
    }
  });

  it("rejects invalid recent activity limits before database execution", async () => {
    let executions = 0;
    const database = drizzle(async () => {
      executions += 1;
      return { rows: [] };
    });
    const repository = createLedgerRepository(database as unknown as Database, owner);

    for (const limit of [0, -1, 21, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(repository.listRecentActivity({ limit })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(executions).toBe(0);
  });

  it("maps the exact recent activity contract from Date and timestamp-string rows", async () => {
    const database = drizzle(async () => ({ rows: [
      {
        event_kind: "Expense",
        record_id: "expense-a",
        title_source: "Dinner",
        detail_source: "Jakarta",
        amount: "8000",
        effective_at: "2026-01-02T10:30:00.000Z",
        created_at: "2026-01-02T10:31:00.000Z",
        allocated_amount: "0",
      },
      {
        event_kind: "Repayment",
        record_id: "repayment-a",
        title_source: "Ari",
        detail_source: "Money received",
        amount: 5000,
        effective_at: new Date("2026-01-03T10:30:00.000Z"),
        created_at: new Date("2026-01-03T10:31:00.000Z"),
        allocated_amount: 2000,
      },
      {
        event_kind: "Repayment",
        record_id: "repayment-b",
        title_source: "Bima",
        detail_source: "Money received",
        amount: 7000,
        effective_at: new Date("2026-01-01T10:30:00.000Z"),
        created_at: new Date("2026-01-01T10:31:00.000Z"),
        allocated_amount: "7000",
      },
    ] }));

    await expect(createLedgerRepository(database as unknown as Database, owner).listRecentActivity()).resolves.toEqual([
      {
        kind: "Expense",
        id: "expense-a",
        title: "Dinner",
        detail: "Jakarta",
        amount: 8000,
        date: new Date("2026-01-02T10:30:00.000Z"),
      },
      {
        kind: "Repayment",
        id: "repayment-a",
        title: "Ari",
        detail: "Money received · unallocated remains open",
        amount: 5000,
        date: new Date("2026-01-03T10:30:00.000Z"),
      },
      {
        kind: "Repayment",
        id: "repayment-b",
        title: "Bima",
        detail: "Money received",
        amount: 7000,
        date: new Date("2026-01-01T10:30:00.000Z"),
      },
    ]);
  });

  it("preserves PostgreSQL row order without sorting in application code", async () => {
    const database = drizzle(async () => ({ rows: [
      {
        event_kind: "Repayment", record_id: "repayment-first", title_source: "Ari", detail_source: "Money received", amount: 100,
        effective_at: new Date("2026-01-01T00:00:00Z"), created_at: new Date("2026-01-01T00:00:00Z"), allocated_amount: 0,
      },
      {
        event_kind: "Expense", record_id: "expense-second", title_source: "Dinner", detail_source: "Jakarta", amount: 200,
        effective_at: new Date("2026-01-03T00:00:00Z"), created_at: new Date("2026-01-03T00:00:00Z"), allocated_amount: 0,
      },
    ] }));

    const activity = await createLedgerRepository(database as unknown as Database, owner).listRecentActivity();
    expect(activity.map((item) => item.id)).toEqual(["repayment-first", "expense-second"]);
  });

  it.each([
    ["unsafe amount", { amount: "9007199254740992", allocated_amount: 0 }],
    ["over-allocation", { amount: 100, allocated_amount: 101 }],
    ["unknown event kind", { amount: 100, allocated_amount: 0, event_kind: "Other" }],
  ])("rejects %s recent activity rows with ledger integrity errors", async (_label, overrides) => {
    const row: Record<string, unknown> = {
      event_kind: "Repayment",
      record_id: "repayment-a",
      title_source: "Ari",
      detail_source: "Money received",
      amount: 100,
      effective_at: new Date("2026-01-01T00:00:00Z"),
      created_at: new Date("2026-01-01T00:00:00Z"),
      allocated_amount: 0,
    };
    Object.assign(row, overrides);
    const database = drizzle(async () => ({ rows: [row] }));

    await expect(createLedgerRepository(database as unknown as Database, owner).listRecentActivity()).rejects.toBeInstanceOf(LedgerIntegrityError);
  });

  it("selects the latest reusable sibling, excludes the current expense, and stays in the outing", async () => {
    const fixture = previousSplitDatabase({
      candidateId: "expense-latest-reusable",
      friends: [{ id: "friend-a", name: "Ada", archivedAt: null, baseAmount: 40000 }],
    });

    await expect(createLedgerRepository(fixture.database, owner).getPreviousExpenseSplit("expense-current")).resolves.toEqual({
      friends: [{ friendId: "friend-a", friendName: "Ada", friendArchivedAt: null, baseAmount: 40000 }],
      charges: [],
    });

    const candidateQuery = fixture.queries[1]!;
    expect(candidateQuery.sql).toContain('"expenses"."outing_id"');
    expect(candidateQuery.sql).toContain('"expenses"."id" <>');
    expect(candidateQuery.sql.toLowerCase()).toContain("order by \"expenses\".\"created_at\" desc");
    expect(candidateQuery.params).toEqual(expect.arrayContaining([owner, "outing-a", "expense-current"]));
  });

  it("does not return a sibling from another outing or owner", async () => {
    const fixture = previousSplitDatabase({});
    const result = await createLedgerRepository(fixture.database, owner).getPreviousExpenseSplit("expense-current");

    expect(result).toBeNull();
    expect(fixture.queries).toHaveLength(2);
    expect(fixture.queries.every((query) => query.params.includes(owner))).toBe(true);
    expect(fixture.queries[1]!.sql).toContain('"outings"."owner_user_id"');
    expect(fixture.queries[1]!.sql).toContain('"expenses"."owner_user_id"');
  });

  it("skips a newest archived-only sibling and selects the older reusable sibling", async () => {
    const fixture = previousSplitDatabase({
      candidateId: "expense-older-reusable",
      friends: [{ id: "friend-active", name: "Active", archivedAt: null, baseAmount: 25000 }],
    });
    const result = await createLedgerRepository(fixture.database, owner).getPreviousExpenseSplit("expense-current");

    expect(result?.friends).toEqual([{ friendId: "friend-active", friendName: "Active", friendArchivedAt: null, baseAmount: 25000 }]);
    expect(fixture.queries[1]!.sql.toLowerCase()).toContain("reusable_friends");
    expect(fixture.queries[1]!.sql.toLowerCase()).toContain("reusable_friends.archived_at is null");
  });

  it("returns no candidate when every prior sibling is unusable", async () => {
    const fixture = previousSplitDatabase({});

    await expect(createLedgerRepository(fixture.database, owner).getPreviousExpenseSplit("expense-current")).resolves.toBeNull();
    expect(fixture.queries).toHaveLength(2);
    expect(fixture.queries[1]!.sql.toLowerCase()).toContain("exists");
    expect(fixture.queries[1]!.sql.toLowerCase()).toContain("archived_at is null");
  });

  it("returns reusable base amounts and reconstructs all and selected charge targets", async () => {
    const fixture = previousSplitDatabase({
      candidateId: "expense-reusable",
      friends: [
        { id: "friend-active", name: "Active", archivedAt: null, baseAmount: 25000 },
        { id: "friend-archived", name: "Archived", archivedAt: new Date("2026-01-01T00:00:00.000Z"), baseAmount: 15000 },
      ],
      charges: [
        { id: "charge-all", name: "Tax", percentageBasisPoints: 500, scope: "all", targetFriendId: null },
        { id: "charge-selected", name: "Tip", percentageBasisPoints: 1000, scope: "selected", targetFriendId: "friend-active" },
        { id: "charge-selected", name: "Tip", percentageBasisPoints: 1000, scope: "selected", targetFriendId: "friend-archived" },
      ],
    });

    await expect(createLedgerRepository(fixture.database, owner).getPreviousExpenseSplit("expense-current")).resolves.toEqual({
      friends: [
        { friendId: "friend-active", friendName: "Active", friendArchivedAt: null, baseAmount: 25000 },
        { friendId: "friend-archived", friendName: "Archived", friendArchivedAt: new Date("2026-01-01T00:00:00.000Z"), baseAmount: 15000 },
      ],
      charges: [
        { name: "Tax", percentageBasisPoints: 500, scope: "all", friendIds: [] },
        { name: "Tip", percentageBasisPoints: 1000, scope: "selected", friendIds: ["friend-active", "friend-archived"] },
      ],
    });
  });

  it("keeps expense, outing, share, friend, charge, and target reads owner-scoped", async () => {
    const fixture = previousSplitDatabase({
      candidateId: "expense-owner-a",
      friends: [{ id: "friend-owner-a", name: "Owner A", archivedAt: null, baseAmount: 10000 }],
      charges: [{ id: "charge-owner-a", name: "Tax", percentageBasisPoints: 500, scope: "all", targetFriendId: null }],
    });
    const result = await createLedgerRepository(fixture.database, owner).getPreviousExpenseSplit("expense-current");

    expect(result?.friends.map((friend) => friend.friendId)).toEqual(["friend-owner-a"]);
    expect(result?.charges).toEqual([{ name: "Tax", percentageBasisPoints: 500, scope: "all", friendIds: [] }]);
    for (const query of fixture.queries) {
      expect(query.params).toContain(owner);
      expect(query.sql).toContain("owner_user_id");
    }
  });

  it("keeps paginated record retrieval in owner-scoped SQL", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    });
    const repository = createLedgerRepository(database as unknown as Database, owner);

    await repository.listFriendRecords({ q: "100%_\\", page: 9 });
    await repository.listOutingRecords({ q: "Dinner", month: "2026-04", page: 9 });
    await repository.listExpenseRecords({ q: "Dinner", outingId: "550e8400-e29b-41d4-a716-446655440000", month: "2026-04", assignment: "assigned", page: 9 });
    await repository.listRepaymentRecords({ q: "Bank", friendId: "550e8400-e29b-41d4-a716-446655440000", month: "2026-04", allocation: "needs", page: 9 });

    expect(queries).toHaveLength(8);
    for (let index = 0; index < queries.length; index += 2) {
      expect(queries[index].sql).toContain("count(*)");
      expect(queries[index + 1].sql).toContain("limit");
      expect(queries[index].params).toContain(owner);
      expect(queries[index + 1].params).toContain(owner);
    }
    expect(queries[0].sql).toContain('"friends"."owner_user_id"');
    expect(queries[1].sql).toContain('order by "friends"."name" asc, "friends"."id" asc');
    expect(queries[3].sql).toContain('order by "outings"."occurred_at" desc, "outings"."created_at" desc');
    expect(queries[5].sql).toContain('order by "outings"."occurred_at" desc, "expenses"."created_at" desc');
    expect(queries[7].sql).toContain('order by "repayments"."paid_at" desc, "repayments"."created_at" desc');
    expect(queries[5].sql).toContain("exists (select 1 from \"expense_shares\"");
    expect(queries[7].sql).toContain('"repayment_allocations"');
    expect(queries[3].sql.toLowerCase().indexOf("limit")).toBeLessThan(queries[3].sql.toLowerCase().lastIndexOf("left join"));
    expect(queries[5].sql.toLowerCase().indexOf("limit")).toBeLessThan(queries[5].sql.toLowerCase().lastIndexOf('inner join "outings"'));
    expect(queries[7].sql.toLowerCase().indexOf("limit")).toBeLessThan(queries[7].sql.toLowerCase().lastIndexOf('inner join "friends"'));
  });

  it("combines exact amount predicates with text search in both count and page queries", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; });
    const repository = createLedgerRepository(database as unknown as Database, owner);

    await expect(repository.listExpenseRecords({ q: "Rp 42.500", page: 2 })).resolves.toMatchObject({ totalItems: 0, page: 1 });
    await expect(repository.listRepaymentRecords({ q: "42.500", page: 2 })).resolves.toMatchObject({ totalItems: 0, page: 1 });

    expect(queries).toHaveLength(4);
    for (const query of queries) {
      const sql = query.sql.replace(/\s+/g, " ").trim().toLowerCase();
      expect(sql).toContain(" or ");
      expect(sql).toContain(" = $");
      expect(query.params).toContain(42500);
      expect(query.params).toContain(owner);
    }
    expect(queries[0]!.sql).toContain('"expenses"."amount" = $');
    expect(queries[2]!.sql).toContain('"repayments"."amount" = $');

    queries.length = 0;
    await expect(repository.listExpenseRecords({ q: "42.50" })).resolves.toMatchObject({ totalItems: 0 });
    expect(queries.every((query) => !query.params.includes(42500))).toBe(true);
    expect(queries.every((query) => !query.sql.includes('"expenses"."amount" = $'))).toBe(true);
  });

  it("lists one owner's friend shares with batched allocation totals and clamped pages", async () => {
    const friendId = "550e8400-e29b-41d4-a716-446655440000";
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.toLowerCase().includes("select count(*)")) return { rows: [[41]] };
      return { rows: [
        ["share-open", "expense-open", "Open dinner", "Later outing", new Date("2026-04-02T00:00:00.000Z"), 5000, 2000],
        ["share-settled", "expense-settled", "Settled lunch", "Earlier outing", new Date("2026-04-01T00:00:00.000Z"), 7000, 7000],
      ] };
    });

    const result = await createLedgerRepository(database as unknown as Database, owner).listFriendExpenseShareRecords(friendId, { page: 9 });

    expect(result).toMatchObject({ page: 3, pageSize: 20, totalItems: 41, totalPages: 3 });
    expect(result.items).toEqual([
      expect.objectContaining({ expenseId: "expense-open", appliedAmount: 2000, remainingAmount: 3000, settled: false }),
      expect.objectContaining({ expenseId: "expense-settled", appliedAmount: 7000, remainingAmount: 0, settled: true }),
    ]);
    expect(queries).toHaveLength(2);
    for (const query of queries) {
      expect(query.params).toContain(owner);
      expect(query.params).toContain(friendId);
    }
    expect(queries[1].sql).toContain('"repayment_allocations"');
    expect(queries[1].sql).toContain('"expense_shares"."friend_id"');
    expect(queries[1].sql.toLowerCase()).toContain("case when");
    expect(queries[1].sql.toLowerCase()).toContain('order by');
    expect(queries[1].sql.toLowerCase()).toContain('"outings"."occurred_at" desc');
    expect(queries[1].sql.toLowerCase()).toContain("limit");
    expect(queries[1].sql.toLowerCase()).toContain("offset");
  });

  it("uses the fixed record page size and offset after counting multiple pages", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return sql.toLowerCase().includes("select count(*)") ? { rows: [[41]] } : { rows: [] };
    });
    const repository = createLedgerRepository(database as unknown as Database, owner);

    await repository.listFriendRecords({ page: 2 });
    await repository.listOutingRecords({ page: 2 });
    await repository.listExpenseRecords({ page: 2 });
    await repository.listRepaymentRecords({ page: 2 });

    for (const query of queries.filter((_query, index) => index % 2 === 1)) {
      expect(query.sql.toLowerCase()).toContain("limit");
      expect(query.sql.toLowerCase()).toContain("offset");
      expect(query.params).toContain(20);
    }
  });

  it("uses the normalized browser offset for outing, expense, and repayment month bounds", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    });
    const repository = createLedgerRepository(database as unknown as Database, owner);

    await repository.listOutingRecords({ month: "2026-07", timezoneOffsetMinutes: "-420" });
    await repository.listExpenseRecords({ month: "2026-07", timezoneOffsetMinutes: "-420" });
    await repository.listRepaymentRecords({ month: "2026-07", timezoneOffsetMinutes: "-420" });

    expect(queries).toHaveLength(6);
    for (const query of queries) {
      expect(query.params).toContain("2026-06-30T17:00:00.000Z");
      expect(query.params).toContain("2026-07-31T17:00:00.000Z");
    }
    await expect(repository.listOutingRecords({ month: "2026-07", timezoneOffsetMinutes: "841" })).resolves.toMatchObject({ totalItems: 0 });
  });

  it("maps absent and foreign expenses to the same not-found error", async () => {
    const database = drizzle(async () => ({ rows: [] }));
    const repository = createLedgerRepository(database as unknown as Database, owner);
    const absent = await repository.getExpense("absent").catch((error) => error);
    const foreign = await repository.getExpense("foreign").catch((error) => error);

    expect(absent).toMatchObject({ code: "NOT_FOUND", message: "Ledger record not found" });
    expect(foreign).toMatchObject({ code: "NOT_FOUND", message: "Ledger record not found" });
  });

  it("builds the summary from one owner-scoped aggregate query", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    });
    const summary = await createLedgerRepository(database as unknown as Database, owner).getLedgerSummary();

    expect(summary).toEqual({
      totalExpenseAmount: 0,
      totalAssignedAmount: 0,
      totalRepaidAmount: 0,
      totalReceivedAmount: 0,
      totalUnallocatedRepaymentAmount: 0,
      totalOutstandingAmount: 0,
      ownerPortionAmount: 0,
      friendBalances: [],
    });
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain("WITH expense_totals");
    expect(queries[0].sql).toContain("friend_balances");
    expect(queries[0].sql).toContain("repayment_allocations");
    expect(queries[0].params).toContain(owner);
  });

  it("bounds overview balances and reports the full assigned-friend count", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [{
        total_expense_amount: "100",
        total_assigned_amount: "80",
        total_repaid_amount: "20",
        total_received_amount: "25",
        owner_portion_amount: "20",
        total_assigned_friend_count: "9",
        invalid_cross_friend_allocations: "0",
        invalid_repayment_allocations: "0",
        invalid_share_allocations: "0",
        invalid_owner_portions: "0",
        friend_balances: Array.from({ length: 8 }, (_, index) => ({ friendId: `friend-${index}`, name: `Friend ${index}`, archived: false, assignedAmount: "10", repaidAmount: "0" })),
      }] };
    });

    const overview = await createLedgerRepository(database as unknown as Database, owner).getLedgerOverviewSummary();

    expect(overview.totalAssignedFriendCount).toBe(9);
    expect(overview.friendBalances).toHaveLength(8);
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain("LIMIT");
    expect(queries[0].params).toContain(owner);
  });

  it("scopes balance aggregation to the requested friends", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [{
        total_expense_amount: "0",
        total_assigned_amount: "0",
        total_repaid_amount: "0",
        total_received_amount: "0",
        owner_portion_amount: "0",
        total_assigned_friend_count: "0",
        invalid_cross_friend_allocations: "0",
        invalid_repayment_allocations: "0",
        invalid_share_allocations: "0",
        invalid_owner_portions: "0",
        friend_balances: [{ friendId: "friend-a", name: "Ada", archived: false, assignedAmount: "80", repaidAmount: "20" }],
      }] };
    });

    await expect(createLedgerRepository(database as unknown as Database, owner).getFriendBalances(["friend-a", "friend-b"])).resolves.toMatchObject([{ friendId: "friend-a", outstandingAmount: 60 }]);
    expect(queries[0].sql).toContain("IN");
    expect(queries[0].params).toContain(owner);
    expect(queries[0].params).toContain("friend-a");
    expect(queries[0].params).toContain("friend-b");
  });

  it("filters open expense shares to one selected friend", async () => {
    const selectedId = "11111111-1111-4111-8111-111111111111";
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    });

    await expect(createLedgerRepository(database as unknown as Database, owner).listOpenExpenseSharesByFriend(selectedId)).resolves.toEqual({});

    expect(queries).toHaveLength(1);
    const shareQuery = queries[0]!;
    expect(shareQuery.params).toContain(selectedId);
    expect(shareQuery.sql).toContain('"expense_shares"."friend_id" = $');
  });

  it("builds the export snapshot from five owner-scoped queries without private fields", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    });
    const snapshot = await createLedgerRepository(database as unknown as Database, owner).getLedgerExportSnapshot();

    expect(snapshot).toEqual({ friends: [], expenses: [], expenseShares: [], repayments: [], repaymentAllocations: [] });
    expect(queries).toHaveLength(5);
    for (const query of queries) {
      expect(query.sql).toContain("owner_user_id");
      expect(query.params).toContain(owner);
      expect(query.sql).not.toMatch(/phone_number|notes|token_hash|owner_user_id\"\s+as/i);
    }
    expect(queries[1].sql).toContain('"outings"."owner_user_id"');
    expect(queries[1].sql).toContain("inner join");
    expect(queries.map(({ sql }) => sql).join(" ")).toMatch(/friends|expenses|expense_shares|repayments|repayment_allocations/);
  });

  it("builds a debtor statement in three owner-scoped queries without private fields", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      if (queries.length === 1) {
        return { rows: [["friend-a", "Ada"]] };
      }
      return { rows: [] };
    });
    const statement = await createLedgerRepository(database as unknown as Database, owner).getFriendDebtorStatement("friend-a", new Date("2026-08-04T00:00:00.000Z"));

    expect(statement).toMatchObject({ friendName: "Ada", assignedAmount: 0, repaidAmount: 0, outstandingAmount: 0, items: [] });
    expect(queries).toHaveLength(3);
    for (const query of queries) {
      expect(query.params).toContain(owner);
      expect(query.sql).not.toMatch(/phone_number|notes|payment_method/);
    }
    expect(queries[1].sql).toContain('"expenses"."owner_user_id"');
    expect(queries[1].sql).toContain('"outings"."owner_user_id"');
    expect(queries[2].sql).toContain('"repayments"."owner_user_id"');
    expect(queries[2].sql).toContain('"repayment_allocations"."owner_user_id"');
    expect(queries[2].sql).toContain('"expense_shares"."owner_user_id"');
  });

  it("pages the public debtor statement in SQL and clamps both page parameters", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return queries.length === 1
        ? { rows: [["friend-a", "Ada", "300", "120", "25", "23", "0", "0"]] }
        : { rows: [] };
    });
    const statement = await createLedgerRepository(database as unknown as Database, owner).getPublicFriendDebtorStatement(
      "friend-a",
      new Date("2026-08-04T00:00:00.000Z"),
      "link-a",
      { expensePage: "999", repaymentPage: "invalid" },
    );

    expect(statement).toMatchObject({ assignedAmount: 300, repaidAmount: 120, outstandingAmount: 180 });
    expect(statement.expensePage).toMatchObject({ page: 3, pageSize: 10, totalItems: 25, totalPages: 3, items: [] });
    expect(statement.repaymentPage).toMatchObject({ page: 1, pageSize: 10, totalItems: 23, totalPages: 3, items: [] });
    expect(queries).toHaveLength(3);
    expect(queries[1]?.sql).toMatch(/limit.*offset/i);
    expect(queries[2]?.sql).toMatch(/limit/i);
    expect(queries[2]?.sql).toContain('"repayments"."payment_method"');
    for (const query of queries) {
      expect(query.params).toContain(owner);
      expect(query.sql).not.toMatch(/phone_number|notes|token_hash/);
    }
  });

  it("preserves the typed integrity error from aggregate summary rows", async () => {
    const database = drizzle(async () => ({ rows: [{
      total_expense_amount: "1",
      total_assigned_amount: "1",
      total_repaid_amount: "1",
      total_received_amount: "1",
      owner_portion_amount: "0",
      total_assigned_friend_count: "1",
      invalid_cross_friend_allocations: "1",
      invalid_repayment_allocations: "0",
      invalid_share_allocations: "0",
      invalid_owner_portions: "0",
      friend_balances: [],
    }] }));

    await expect(createLedgerRepository(database as unknown as Database, owner).getLedgerSummary()).rejects.toBeInstanceOf(LedgerIntegrityError);
  });

  it("owner-scopes repayment get and list queries and exposes no delete", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    });
    const repository = createLedgerRepository(database as unknown as Database, owner);

    await expect(repository.getRepayment("repayment-a")).rejects.toBeInstanceOf(LedgerNotFoundError);
    await expect(repository.listRepayments()).resolves.toEqual([]);
    expect("deleteRepayment" in repository).toBe(true);
    expect(queries).toHaveLength(3);
    for (const query of queries) {
      expect(query.sql).toContain("owner_user_id");
      expect(query.params).toContain(owner);
    }
    expect(queries[0].sql).toContain("inner join");
    expect(queries[1].sql).toContain("inner join");
    expect(queries[1].sql).toContain('order by "repayments"."paid_at" desc');
    expect(queries[2].sql).toContain('"repayment_allocations"');
  });

  it("owner-scopes allocation plans before loading share details", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    });

    await expect(createLedgerRepository(database as unknown as Database, owner).getRepaymentAllocationPlan("repayment-a")).rejects.toBeInstanceOf(LedgerNotFoundError);
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('"repayments"."owner_user_id"');
    expect(queries[0].sql).toContain('"friends"."owner_user_id"');
    expect(queries[0].params).toContain(owner);
  });

  it("loads unified history with one owner-scoped query and no private fields", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [
        {
          event_type: "expense",
          record_id: "expense-a",
          effective_at: new Date("2026-08-04T00:00:00.000Z"),
          description: "Dinner",
          outing_title: "Saturday",
          friend_id: null,
          friend_name: null,
          total_amount: 10000,
          shares: [{ id: "share-a", friendId: "friend-a", amountOwed: 4000, allocatedAmount: 0 }],
          allocations: [],
        },
        {
          event_type: "repayment",
          record_id: "repayment-a",
          effective_at: new Date("2026-08-03T00:00:00.000Z"),
          description: null,
          outing_title: null,
          friend_id: "friend-a",
          friend_name: "Ari",
          total_amount: 2000,
          shares: [],
          allocations: [],
        },
      ] };
    });
    const history = await createLedgerRepository(database as unknown as Database, owner).listLedgerHistory({ limit: 1 });

    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({ type: "expense", totalAmount: 10000, assignedAmount: 4000, ownerPortionAmount: 6000 });
    expect(history.nextCursor).toBeTruthy();
    expect(queries).toHaveLength(1);
    expect(queries[0].params).toContain(owner);
    expect(queries[0].sql).toContain("owner_user_id");
    expect(queries[0].sql).not.toMatch(/phone_number|payment_method|notes|token/i);
  });

  it("locks allocations before rejecting an amount below allocation or a friend change", async () => {
    function query<T>(rows: T[]) {
      const result = Promise.resolve(rows) as Promise<T[]> & { for: () => Promise<T[]> };
      result.for = async () => rows;
      return result;
    }
    function lockingDatabase() {
      const transaction = {
        select(selection?: unknown) {
          const state: { table?: unknown; selection?: unknown } = { selection };
          const chain = {
            from(table: unknown) { state.table = table; return chain; },
            where() { return chain; },
            limit() { return query(state.table === repayments ? [{ id: "repayment-a", friendId: "friend-a", amount: 100 }] : [{ amount: 60 }]); },
            for() { return query(state.table === repayments ? [{ id: "repayment-a", friendId: "friend-a", amount: 100 }] : [{ amount: 60 }]); },
          };
          return chain;
        },
      };
      return { transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction) } as unknown as Database;
    }
    const repository = createLedgerRepository(lockingDatabase(), owner);
    const base = { friendId: "friend-a", amount: 100, paidAt: new Date(), paymentMethod: null, notes: null };

    await expect(repository.updateRepayment("repayment-a", { ...base, amount: 59 })).rejects.toMatchObject({
      code: "REPAYMENT_AMOUNT_TOO_LOW",
      message: "Repayment amount cannot be lower than its allocated amount.",
    });
    await expect(repository.updateRepayment("repayment-a", { ...base, friendId: "friend-b" })).rejects.toMatchObject({
      code: "REPAYMENT_FRIEND_LOCKED",
      message: "The friend cannot be changed after this repayment has allocations.",
    });
  });

  it("locks deletion targets and dependents in stable order", async () => {
    const lockLog: string[] = [];
    const outingTable = (await import("../db/schema")).outings;
    const expenseTable = (await import("../db/schema")).expenses;
    const shareTable = (await import("../db/schema")).expenseShares;
    const allocationTable = (await import("../db/schema")).repaymentAllocations;
    const repaymentTable = (await import("../db/schema")).repayments;
    const transaction = {
      select(selection?: unknown) {
        const state: { table?: unknown; selection?: unknown } = { selection };
        const chain = {
          from(table: unknown) { state.table = table; return chain; },
          where() { return chain; },
          limit() { return chain; },
          orderBy() { return chain; },
          for(lock: string) { lockLog.push(`${state.table === outingTable ? "outing" : state.table === expenseTable ? "expense" : state.table === shareTable ? "share" : state.table === allocationTable ? "allocation" : state.table === repaymentTable ? "repayment" : "other"}:${lock}`); return Promise.resolve([]); },
        };
        return chain;
      },
      delete(table: unknown) {
        return { where: () => ({ returning: () => Promise.resolve([{ id: table === outingTable ? "outing-a" : table === expenseTable ? "expense-a" : "repayment-a" }]) }) };
      },
    };
    const database = { transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction) } as unknown as Database;
    const repository = createLedgerRepository(database, owner);

    await expect(repository.deleteOuting("outing-a", { cascadeDependents: false })).rejects.toBeInstanceOf(LedgerNotFoundError);
    expect(lockLog).toEqual(["outing:update"]);
    lockLog.length = 0;
    await expect(repository.deleteExpense("expense-a", { cascadeDependents: false })).rejects.toBeInstanceOf(LedgerNotFoundError);
    expect(lockLog).toEqual(["expense:update"]);
    lockLog.length = 0;
    await expect(repository.deleteRepayment("repayment-a", { cascadeDependents: false })).rejects.toBeInstanceOf(LedgerNotFoundError);
    expect(lockLog).toEqual(["repayment:update"]);

    const dependent = {
      select(selection?: unknown) {
        const state: { table?: unknown } = {};
        const chain = {
          from(table: unknown) { state.table = table; return chain; }, where() { return chain; }, limit() { return chain; }, orderBy() { return chain; },
          for(lock: string) {
            lockLog.push(`${state.table === outingTable ? "outing" : state.table === expenseTable ? "expense" : state.table === shareTable ? "share" : state.table === allocationTable ? "allocation" : state.table === repaymentTable ? "repayment" : "other"}:${lock}`);
            if (state.table === outingTable) return Promise.resolve([{ id: "outing-a" }]);
            if (state.table === expenseTable) return Promise.resolve([{ id: "expense-a", amount: 100 }]);
            if (state.table === shareTable) return Promise.resolve([{ id: "share-b", friendId: "friend-a" }, { id: "share-a", friendId: "friend-a" }]);
            if (state.table === allocationTable) return Promise.resolve([{ repaymentId: "repayment-a", expenseShareId: "share-a" }]);
            if (state.table === repaymentTable) return Promise.resolve([{ id: "repayment-a", friendId: "friend-a" }]);
            return Promise.resolve([]);
          },
        };
        void selection;
        return chain;
      },
    };
    const dependentDb = { transaction: async (callback: (tx: typeof dependent) => Promise<unknown>) => callback(dependent) } as unknown as Database;
    const dependentRepository = createLedgerRepository(dependentDb, owner);
    await expect(dependentRepository.deleteOuting("outing-a", { cascadeDependents: false })).rejects.toBeInstanceOf(OutingDeletionInvariantError);
    await expect(dependentRepository.deleteExpense("expense-a", { cascadeDependents: false })).rejects.toBeInstanceOf(ExpenseDeletionInvariantError);
    await expect(dependentRepository.deleteRepayment("repayment-a", { cascadeDependents: false })).rejects.toBeInstanceOf(RepaymentDeletionInvariantError);
    expect(lockLog).toContain("share:update");
    expect(lockLog).toContain("allocation:update");
  });

  it("keeps parent deletion atomic when the final delete fails", async () => {
    let deleteCalls = 0;
    let rolledBack = false;
    const transaction = {
      select() {
        let selectedTable: unknown;
        const chain = {
          from(table: unknown) { selectedTable = table; return chain; },
          where() { return chain; },
          limit() { return chain; },
          orderBy() { return chain; },
          for() { return Promise.resolve(selectedTable === expenses ? [{ id: "expense-a" }] : []); },
        };
        return chain;
      },
      delete() {
        deleteCalls += 1;
        return { where: () => ({ returning: () => Promise.resolve([]) }) };
      },
    };
    const database = {
      transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => {
        try {
          return await callback(transaction);
        } catch (error) {
          rolledBack = true;
          throw error;
        }
      },
    } as unknown as Database;

    await expect(createLedgerRepository(database, owner).deleteExpense("expense-a", { cascadeDependents: true })).rejects.toBeInstanceOf(LedgerNotFoundError);
    expect(deleteCalls).toBe(1);
    expect(rolledBack).toBe(true);
  });

  it("treats missing and cross-owner delete targets identically", async () => {
    const database = {
      transaction: async (callback: (tx: { select: () => { from: () => { where: () => { limit: () => { for: () => Promise<never[]> } } } } }) => Promise<unknown>) => callback({ select: () => ({ from: () => ({ where: () => ({ limit: () => ({ for: async () => [] }) }) }) }) }),
    } as unknown as Database;
    const repository = createLedgerRepository(database, owner);
    for (const method of [repository.deleteOuting, repository.deleteExpense, repository.deleteRepayment]) {
      const missing = await method("missing").catch((error) => error);
      const foreign = await method("foreign").catch((error) => error);
      expect(missing).toMatchObject({ code: "NOT_FOUND", message: "Ledger record not found" });
      expect(foreign).toMatchObject({ code: "NOT_FOUND", message: "Ledger record not found" });
    }
  });
});
