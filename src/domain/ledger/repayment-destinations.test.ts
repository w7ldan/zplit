import { drizzle } from "drizzle-orm/pg-proxy";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../db/client";
import { createRepaymentDestinationRepository } from "./repayment-destinations";

const scope = "scope-a";
const destinationA = "11111111-1111-4111-8111-111111111111";
const destinationB = "22222222-2222-4222-8222-222222222222";
const input = { type: "bank_account" as const, name: "BCA", identifier: "123", accountName: null, note: null, shareOnBalanceLinks: false };

function row(id: string, sortOrder: number, ledgerScopeId = scope) {
  return { id, ledgerScopeId, type: "bank_account", name: id === destinationA ? "BCA" : "GoPay", identifier: "123", accountName: null, note: null, shareOnBalanceLinks: false, sortOrder, createdAt: new Date(), updatedAt: new Date() };
}

function mutationDatabase(rows = [row(destinationA, 0), row(destinationB, 1)]) {
  const state = rows.map((value) => ({ ...value }));
  const updates: Array<{ id: string; sortOrder: number }> = [];
  const transaction = {
    select() {
      const chain = {
        from() { return chain; },
        where() { return chain; },
        orderBy() { return chain; },
        limit() { return chain; },
        for() { return Promise.resolve(state); },
      };
      return chain;
    },
    insert() {
      return { values(value: typeof input & { ledgerScopeId: string; sortOrder: number }) { return { returning: async () => [{ ...row(destinationB, value.sortOrder, value.ledgerScopeId), ...value }] }; } };
    },
    update() {
      return { set(value: { sortOrder?: number }) { return { where() { if (value.sortOrder !== undefined) { updates.push({ id: "updated", sortOrder: value.sortOrder }); return Promise.resolve(); } return { returning: async () => [] }; } }; } };
    },
    delete() {
      return { where() { return { returning: async () => state.filter((value) => value.ledgerScopeId === scope).slice(0, 1).map(({ id }) => ({ id })) }; } };
    },
  };
  const database = {
    ...transaction,
    transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction),
  };
  return { database: database as unknown as Database, state, updates };
}

describe("repayment destination repository", () => {
  it("scope-scopes reads and applies stable sort order", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = drizzle(async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; }) as unknown as Database;
    await createRepaymentDestinationRepository(database, scope).listRepaymentDestinations();
    await createRepaymentDestinationRepository(database, scope).listSharedRepaymentDestinations();
    expect(queries).toHaveLength(2);
    for (const query of queries) expect(query.params).toContain(scope);
    expect(queries[0]?.sql).toMatch(/order by "repayment_destinations"\."sort_order" asc, "repayment_destinations"\."id" asc/i);
    expect(queries[1]?.sql).toContain('"share_on_balance_links" = $');
  });

  it("rejects foreign mutations and validates complete atomic reorder input", async () => {
    const database = mutationDatabase([row(destinationA, 0, "scope-b")]).database;
    const repository = createRepaymentDestinationRepository(database, scope);
    await expect(repository.updateRepaymentDestination(destinationA, input)).rejects.toThrow("Ledger record not found");
    await expect(repository.deleteRepaymentDestination(destinationA)).rejects.toThrow("Ledger record not found");
    const ownerDatabase = mutationDatabase().database;
    const ownerRepository = createRepaymentDestinationRepository(ownerDatabase, scope);
    await expect(ownerRepository.reorderRepaymentDestinations([destinationA, destinationA])).rejects.toThrow("duplicates");
    await expect(ownerRepository.reorderRepaymentDestinations([destinationA])).rejects.toThrow("does not match");
    await expect(ownerRepository.reorderRepaymentDestinations([destinationA, "33333333-3333-4333-8333-333333333333"])).rejects.toThrow("does not match");
  });

  it("rewrites contiguous order values in one transaction", async () => {
    const database = mutationDatabase();
    await createRepaymentDestinationRepository(database.database, scope).reorderRepaymentDestinations([destinationB, destinationA]);
    expect(database.updates).toEqual([{ id: "updated", sortOrder: 0 }, { id: "updated", sortOrder: 1 }]);
  });

  it("checks the workspace lifecycle inside the reorder transaction", async () => {
    const guard = vi.fn(async () => { throw new Error("archived"); });
    const repository = createRepaymentDestinationRepository(mutationDatabase().database, scope, guard);
    await expect(repository.reorderRepaymentDestinations([destinationB, destinationA])).rejects.toMatchObject({ code: "PERSISTENCE_ERROR" });
    expect(guard).toHaveBeenCalledOnce();
  });
});
