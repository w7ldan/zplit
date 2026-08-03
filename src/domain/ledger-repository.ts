import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
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
export type OutingMutationInput = {
  title: string;
  occurredAt: Date;
  notes: string | null;
};
export type CreateOutingInput = OutingMutationInput;
export type UpdateOutingInput = OutingMutationInput;
export type ExpenseMutationInput = {
  description: string;
  amount: number;
  outingId: string;
};
export type CreateExpenseInput = ExpenseMutationInput;
export type UpdateExpenseInput = ExpenseMutationInput;
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

function assertOutingInput(input: unknown): asserts input is OutingMutationInput {
  assertInput(input);
  const keys = Object.keys(input);
  if (keys.some((key) => !["title", "occurredAt", "notes"].includes(key))) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Outing fields are invalid");
  }
  if (
    typeof input.title !== "string" ||
    !(input.occurredAt instanceof Date) ||
    Number.isNaN(input.occurredAt.getTime()) ||
    (input.notes !== null && typeof input.notes !== "string")
  ) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Outing fields are invalid");
  }
}

function assertOutingId(outingId: string) {
  if (typeof outingId !== "string" || !outingId.trim()) {
    throw new LedgerRepositoryError("INVALID_INPUT", "An outing ID is required");
  }
}

function assertExpenseInput(input: unknown): asserts input is ExpenseMutationInput {
  assertInput(input);
  const keys = Object.keys(input);
  if (keys.length !== 3 || keys.some((key) => !["description", "amount", "outingId"].includes(key))) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Expense fields are invalid");
  }
  if (
    typeof input.description !== "string" ||
    !input.description.trim() ||
    input.description.length > 200 ||
    typeof input.amount !== "number" ||
    !Number.isInteger(input.amount) ||
    input.amount <= 0 ||
    input.amount > 2_147_483_647 ||
    typeof input.outingId !== "string" ||
    !input.outingId.trim()
  ) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Expense fields are invalid");
  }
}

function assertExpenseId(expenseId: string) {
  if (typeof expenseId !== "string" || !expenseId.trim()) {
    throw new LedgerRepositoryError("INVALID_INPUT", "An expense ID is required");
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
    assertOutingInput(input);
    try {
      const [outing] = await database.insert(outings).values({ ...input, ownerUserId: owner }).returning();
      if (!outing) return persistenceError(new Error("outing insert returned no row"));
      return outing;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getOuting(outingId: string) {
    assertOutingId(outingId);
    try {
      const [outing] = await database
        .select()
        .from(outings)
        .where(and(eq(outings.ownerUserId, owner), eq(outings.id, outingId)))
        .limit(1);
      if (!outing) return notFound();
      return outing;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listOutings() {
    try {
      return await database.select().from(outings).where(eq(outings.ownerUserId, owner)).orderBy(desc(outings.occurredAt), asc(outings.id));
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function updateOuting(outingId: string, input: UpdateOutingInput) {
    assertOutingId(outingId);
    assertOutingInput(input);
    try {
      const [outing] = await database
        .update(outings)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(outings.ownerUserId, owner), eq(outings.id, outingId)))
        .returning();
      if (!outing) return notFound();
      return outing;
    } catch (error) {
      return persistenceError(error);
    }
  }

  function expenseSelection() {
    return {
      id: expenses.id,
      ownerUserId: expenses.ownerUserId,
      outingId: expenses.outingId,
      description: expenses.description,
      amount: expenses.amount,
      createdAt: expenses.createdAt,
      updatedAt: expenses.updatedAt,
      outingTitle: outings.title,
      outingOccurredAt: outings.occurredAt,
    };
  }

  async function assertOwnedOuting(transaction: Parameters<Parameters<Database["transaction"]>[0]>[0], outingId: string) {
    const [outing] = await transaction
      .select({ id: outings.id })
      .from(outings)
      .where(and(eq(outings.ownerUserId, owner), eq(outings.id, outingId)))
      .limit(1);
    if (!outing) return notFound();
  }

  async function createExpense(input: CreateExpenseInput) {
    assertExpenseInput(input);
    try {
      return await database.transaction(async (transaction) => {
        await assertOwnedOuting(transaction, input.outingId);
        const [expense] = await transaction.insert(expenses).values({ ...input, ownerUserId: owner }).returning();
        if (!expense) return persistenceError(new Error("expense insert returned no row"));
        const [created] = await transaction
          .select(expenseSelection())
          .from(expenses)
          .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expense.id)))
          .limit(1);
        if (!created) return persistenceError(new Error("expense insert lookup returned no row"));
        return created;
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getExpense(expenseId: string) {
    assertExpenseId(expenseId);
    try {
      const [expense] = await database
        .select(expenseSelection())
        .from(expenses)
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
        .limit(1);
      if (!expense) return notFound();
      return expense;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listExpenses() {
    try {
      return await database
        .select(expenseSelection())
        .from(expenses)
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .where(eq(expenses.ownerUserId, owner))
        .orderBy(desc(outings.occurredAt), desc(expenses.createdAt), asc(expenses.id));
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function updateExpense(expenseId: string, input: UpdateExpenseInput) {
    assertExpenseId(expenseId);
    assertExpenseInput(input);
    try {
      return await database.transaction(async (transaction) => {
        await assertOwnedOuting(transaction, input.outingId);
        const [expense] = await transaction
          .update(expenses)
          .set({ ...input, updatedAt: new Date() })
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
          .returning();
        if (!expense) return notFound();
        const [updated] = await transaction
          .select(expenseSelection())
          .from(expenses)
          .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
          .limit(1);
        if (!updated) return persistenceError(new Error("expense update returned no row"));
        return updated;
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
    getOuting,
    listOutings,
    updateOuting,
    createExpense,
    getExpense,
    listExpenses,
    updateExpense,
    createExpenseShare,
    createRepayment,
    createRepaymentAllocation,
  };
}
