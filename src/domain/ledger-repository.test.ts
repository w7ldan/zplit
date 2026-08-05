import { drizzle } from "drizzle-orm/pg-proxy";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client";
import { debtorShareReceipts, expenseReceipts, expenseShares, expenses, repaymentAllocations, repayments } from "../db/schema";
import {
  createLedgerRepository,
  deletionImpactRevision,
  ExpenseDeletionInvariantError,
  LedgerDeletionConfirmationRequiredError,
  LedgerNotFoundError,
  LedgerRepositoryError,
  OutingDeletionInvariantError,
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

  it("removes the single-row allocation API", () => {
    const repository = createLedgerRepository({} as Database, owner);
    expect("createRepaymentAllocation" in repository).toBe(false);
    expect("replaceRepaymentAllocations" in repository).toBe(true);
    expect("getRepaymentAllocationPlan" in repository).toBe(true);
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
  });

  it("maps absent and foreign expenses to the same not-found error", async () => {
    const database = drizzle(async () => ({ rows: [] }));
    const repository = createLedgerRepository(database as unknown as Database, owner);
    const absent = await repository.getExpense("absent").catch((error) => error);
    const foreign = await repository.getExpense("foreign").catch((error) => error);

    expect(absent).toMatchObject({ code: "NOT_FOUND", message: "Ledger record not found" });
    expect(foreign).toMatchObject({ code: "NOT_FOUND", message: "Ledger record not found" });
  });

  it("builds the summary from five owner-scoped queries", async () => {
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
    expect(queries).toHaveLength(5);
    for (const query of queries) {
      expect(query.sql).toContain("owner_user_id");
      expect(query.params).toContain(owner);
    }
    expect(queries.map(({ sql }) => sql).join(" ")).toContain('"friends"');
    expect(queries.map(({ sql }) => sql).join(" ")).toContain('"expenses"');
    expect(queries.map(({ sql }) => sql).join(" ")).toContain('"expense_shares"');
    expect(queries.map(({ sql }) => sql).join(" ")).toContain('"repayments"');
    expect(queries.map(({ sql }) => sql).join(" ")).toContain('"repayment_allocations"');
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

  it("preserves the typed integrity error from summary building", async () => {
    const database = drizzle(async (sql) => {
      if (sql.includes('"friends"')) return { rows: [] };
      if (sql.includes('"expenses"')) return { rows: [{ id: "expense", amount: 1 }] };
      if (sql.includes('"expense_shares"')) return { rows: [{ id: "share", expenseId: "expense", friendId: "missing", amountOwed: 1 }] };
      return { rows: [] };
    });

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
