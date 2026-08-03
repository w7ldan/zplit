import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  expenseShares,
  expenses,
  friends,
  outings,
  repaymentAllocations,
  repayments,
} from "../db/schema";

export type LedgerErrorCode =
  | "INVALID_INPUT"
  | "INVALID_OWNER"
  | "NOT_FOUND"
  | "PERSISTENCE_ERROR";

export class LedgerRepositoryError extends Error {
  constructor(
    readonly code: LedgerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LedgerRepositoryError";
  }
}

export class LedgerNotFoundError extends LedgerRepositoryError {
  constructor() {
    super("NOT_FOUND", "Ledger record not found");
    this.name = "LedgerNotFoundError";
  }
}

type WithoutOwner<T> = Omit<T, "ownerUserId"> & {
  ownerUserId?: never;
  owner_user_id?: never;
};

export type FriendMutationInput = {
  name: string;
  phoneNumber: string | null;
  notes: string | null;
};

export type CreateFriendInput = FriendMutationInput;
export type UpdateFriendInput = FriendMutationInput;
export type CreateOutingInput = WithoutOwner<typeof outings.$inferInsert>;
export type CreateExpenseInput = WithoutOwner<typeof expenses.$inferInsert>;
export type CreateExpenseShareInput = WithoutOwner<typeof expenseShares.$inferInsert>;
export type CreateRepaymentInput = WithoutOwner<typeof repayments.$inferInsert>;
export type CreateRepaymentAllocationInput = WithoutOwner<typeof repaymentAllocations.$inferInsert>;

function assertInput(input: unknown): asserts input is Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Ledger input is invalid");
  }
  if (Object.prototype.hasOwnProperty.call(input, "ownerUserId") || Object.prototype.hasOwnProperty.call(input, "owner_user_id")) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Ledger ownership is server managed");
  }
}

function assertFriendInput(input: unknown): asserts input is FriendMutationInput {
  assertInput(input);
  const keys = Object.keys(input);
  if (keys.some((key) => !["name", "phoneNumber", "notes"].includes(key))) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Friend fields are invalid");
  }
}

function assertFriendId(friendId: string) {
  if (typeof friendId !== "string" || !friendId.trim()) {
    throw new LedgerRepositoryError("INVALID_INPUT", "A friend ID is required");
  }
}

function notFound(): never {
  throw new LedgerNotFoundError();
}

function persistenceError(error: unknown): never {
  if (error instanceof LedgerRepositoryError) throw error;
  throw new LedgerRepositoryError("PERSISTENCE_ERROR", "Ledger operation failed");
}

export function createLedgerRepository(database: Database, ownerUserId: string) {
  const owner = ownerUserId.trim();
  if (!owner) throw new LedgerRepositoryError("INVALID_OWNER", "A ledger owner is required");

  async function createFriend(input: CreateFriendInput) {
    assertFriendInput(input);
    try {
      const [friend] = await database.insert(friends).values({ ...input, ownerUserId: owner }).returning();
      if (!friend) return persistenceError(new Error("friend insert returned no row"));
      return friend;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getFriend(friendId: string) {
    assertFriendId(friendId);
    try {
      const [friend] = await database
        .select()
        .from(friends)
        .where(and(eq(friends.ownerUserId, owner), eq(friends.id, friendId)))
        .limit(1);
      if (!friend) return notFound();
      return friend;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listFriends({ archived = false }: { archived?: boolean } = {}) {
    try {
      return await database
        .select()
        .from(friends)
        .where(and(eq(friends.ownerUserId, owner), archived ? isNotNull(friends.archivedAt) : isNull(friends.archivedAt)))
        .orderBy(asc(friends.name), asc(friends.id));
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function updateFriend(friendId: string, input: UpdateFriendInput) {
    assertFriendId(friendId);
    assertFriendInput(input);
    try {
      const [friend] = await database
        .update(friends)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(friends.ownerUserId, owner), eq(friends.id, friendId)))
        .returning();
      if (!friend) return notFound();
      return friend;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function setFriendArchived(friendId: string, archived: boolean) {
    assertFriendId(friendId);
    try {
      const [friend] = await database
        .update(friends)
        .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
        .where(and(eq(friends.ownerUserId, owner), eq(friends.id, friendId)))
        .returning();
      if (!friend) return notFound();
      return friend;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function createOuting(input: CreateOutingInput) {
    assertInput(input);
    try {
      const [outing] = await database.insert(outings).values({ ...input, ownerUserId: owner }).returning();
      if (!outing) return persistenceError(new Error("outing insert returned no row"));
      return outing;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function createExpense(input: CreateExpenseInput) {
    assertInput(input);
    try {
      return await database.transaction(async (transaction) => {
        if (input.outingId) {
          const [outing] = await transaction
            .select({ id: outings.id })
            .from(outings)
            .where(and(eq(outings.ownerUserId, owner), eq(outings.id, input.outingId)))
            .limit(1);
          if (!outing) return notFound();
        }
        const [expense] = await transaction.insert(expenses).values({ ...input, ownerUserId: owner }).returning();
        if (!expense) return persistenceError(new Error("expense insert returned no row"));
        return expense;
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function createExpenseShare(input: CreateExpenseShareInput) {
    assertInput(input);
    try {
      return await database.transaction(async (transaction) => {
        const [expense] = await transaction
          .select({ id: expenses.id })
          .from(expenses)
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, input.expenseId)))
          .limit(1);
        const [friend] = await transaction
          .select({ id: friends.id })
          .from(friends)
          .where(and(eq(friends.ownerUserId, owner), eq(friends.id, input.friendId)))
          .limit(1);
        if (!expense || !friend) return notFound();
        const [share] = await transaction.insert(expenseShares).values({ ...input, ownerUserId: owner }).returning();
        if (!share) return persistenceError(new Error("expense share insert returned no row"));
        return share;
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function createRepayment(input: CreateRepaymentInput) {
    assertInput(input);
    try {
      return await database.transaction(async (transaction) => {
        const [friend] = await transaction
          .select({ id: friends.id })
          .from(friends)
          .where(and(eq(friends.ownerUserId, owner), eq(friends.id, input.friendId)))
          .limit(1);
        if (!friend) return notFound();
        const [repayment] = await transaction.insert(repayments).values({ ...input, ownerUserId: owner }).returning();
        if (!repayment) return persistenceError(new Error("repayment insert returned no row"));
        return repayment;
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function createRepaymentAllocation(input: CreateRepaymentAllocationInput) {
    assertInput(input);
    try {
      return await database.transaction(async (transaction) => {
        const [repayment] = await transaction
          .select({ id: repayments.id })
          .from(repayments)
          .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, input.repaymentId)))
          .limit(1);
        const [share] = await transaction
          .select({ id: expenseShares.id })
          .from(expenseShares)
          .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.id, input.expenseShareId)))
          .limit(1);
        if (!repayment || !share) return notFound();
        const [allocation] = await transaction
          .insert(repaymentAllocations)
          .values({ ...input, ownerUserId: owner })
          .returning();
        if (!allocation) return persistenceError(new Error("repayment allocation insert returned no row"));
        return allocation;
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  return {
    createFriend,
    getFriend,
    listFriends,
    updateFriend,
    setFriendArchived,
    createOuting,
    createExpense,
    createExpenseShare,
    createRepayment,
    createRepaymentAllocation,
  };
}
