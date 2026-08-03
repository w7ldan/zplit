import { drizzle } from "drizzle-orm/pg-proxy";
import { describe, expect, it } from "vitest";
import type { Database } from "../db/client";
import {
  createLedgerRepository,
  LedgerNotFoundError,
  LedgerRepositoryError,
} from "./ledger-repository";

const owner = "user-a";

function emptyTransactionalDatabase() {
  const transaction = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
  };
  return {
    transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction),
  } as unknown as Database;
}

describe("ledger repository", () => {
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

  it("maps absent and cross-owner references to one generic not-found error", async () => {
    const repository = createLedgerRepository(emptyTransactionalDatabase(), owner);
    const actions = [
      () => repository.createExpense({ description: "Expense", amount: 100, occurredAt: new Date(), outingId: "other-outing" }),
      () => repository.createExpenseShare({ expenseId: "other-expense", friendId: "other-friend", amountOwed: 50 }),
      () => repository.createRepayment({ friendId: "other-friend", amount: 50, paidAt: new Date() }),
      () => repository.createRepaymentAllocation({ repaymentId: "other-repayment", expenseShareId: "other-share", amount: 50 }),
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
});
