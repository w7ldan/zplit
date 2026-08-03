import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  expenseShares,
  expenses,
  friends,
  outings,
  repaymentAllocations,
  repayments,
} from "../db/schema";
import { buildLedgerSummary, LedgerIntegrityError } from "./ledger-summary";

export type LedgerErrorCode =
  | "INVALID_INPUT"
  | "INVALID_OWNER"
  | "NOT_FOUND"
  | "SHARE_TOTAL_EXCEEDED"
  | "REPAYMENT_AMOUNT_TOO_LOW"
  | "REPAYMENT_FRIEND_LOCKED"
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

export class ExpenseShareInvariantError extends LedgerRepositoryError {
  constructor() {
    super("SHARE_TOTAL_EXCEEDED", "Assigned shares cannot exceed the expense amount.");
    this.name = "ExpenseShareInvariantError";
  }
}

export class RepaymentAmountInvariantError extends LedgerRepositoryError {
  constructor() {
    super("REPAYMENT_AMOUNT_TOO_LOW", "Repayment amount cannot be lower than its allocated amount.");
    this.name = "RepaymentAmountInvariantError";
  }
}

export class RepaymentFriendInvariantError extends LedgerRepositoryError {
  constructor() {
    super("REPAYMENT_FRIEND_LOCKED", "The friend cannot be changed after this repayment has allocations.");
    this.name = "RepaymentFriendInvariantError";
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
export type ExpenseShareInput = {
  friendId: string;
  amountOwed: number;
};
export type RepaymentMutationInput = {
  friendId: string;
  amount: number;
  paidAt: Date;
  paymentMethod: string | null;
  notes: string | null;
};
export type CreateRepaymentInput = RepaymentMutationInput;
export type UpdateRepaymentInput = RepaymentMutationInput;
export type CreateRepaymentAllocationInput = WithoutOwner<typeof repaymentAllocations.$inferInsert>;

type RepaymentRecord = {
  id: string;
  ownerUserId: string;
  friendId: string;
  amount: number;
  paidAt: Date;
  paymentMethod: string | null;
  notes: string | null;
  createdAt: Date;
  friendName: string;
  friendArchivedAt: Date | null;
};

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

function assertRepaymentId(repaymentId: string) {
  if (typeof repaymentId !== "string" || !repaymentId.trim()) {
    throw new LedgerRepositoryError("INVALID_INPUT", "A repayment ID is required");
  }
}

function assertRepaymentInput(input: unknown): asserts input is RepaymentMutationInput {
  assertInput(input);
  const keys = Object.keys(input);
  if (keys.length !== 5 || keys.some((key) => !["friendId", "amount", "paidAt", "paymentMethod", "notes"].includes(key))) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Repayment fields are invalid");
  }
  if (
    typeof input.friendId !== "string" ||
    !input.friendId.trim() ||
    typeof input.amount !== "number" ||
    !Number.isSafeInteger(input.amount) ||
    input.amount <= 0 ||
    !(input.paidAt instanceof Date) ||
    Number.isNaN(input.paidAt.getTime()) ||
    (input.paymentMethod !== null && typeof input.paymentMethod !== "string") ||
    (input.notes !== null && typeof input.notes !== "string")
  ) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Repayment fields are invalid");
  }
}

function assertExpenseSharesInput(shares: unknown): asserts shares is ExpenseShareInput[] {
  if (!Array.isArray(shares)) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Expense shares are invalid");
  }
  const seen = new Set<string>();
  for (const share of shares) {
    if (
      share === null ||
      typeof share !== "object" ||
      Array.isArray(share) ||
      Object.keys(share).some((key) => !["friendId", "amountOwed"].includes(key)) ||
      typeof (share as ExpenseShareInput).friendId !== "string" ||
      !(share as ExpenseShareInput).friendId.trim() ||
      typeof (share as ExpenseShareInput).amountOwed !== "number" ||
      !Number.isInteger((share as ExpenseShareInput).amountOwed) ||
      (share as ExpenseShareInput).amountOwed <= 0 ||
      (share as ExpenseShareInput).amountOwed > 2_147_483_647
    ) {
      throw new LedgerRepositoryError("INVALID_INPUT", "Expense shares are invalid");
    }
    const friendId = (share as ExpenseShareInput).friendId.trim().toLowerCase();
    if (seen.has(friendId)) throw new LedgerRepositoryError("INVALID_INPUT", "Each friend can have only one share per expense.");
    seen.add(friendId);
  }
}

function notFound(): never {
  throw new LedgerNotFoundError();
}

function persistenceError(error: unknown): never {
  if (error instanceof LedgerRepositoryError || error instanceof LedgerIntegrityError) throw error;
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

  async function getLedgerSummary() {
    try {
      const [friendRows, expenseRows, shareRows, repaymentRows, allocationRows] = await Promise.all([
        database
          .select({ id: friends.id, name: friends.name, archivedAt: friends.archivedAt })
          .from(friends)
          .where(eq(friends.ownerUserId, owner)),
        database
          .select({ id: expenses.id, amount: expenses.amount })
          .from(expenses)
          .where(eq(expenses.ownerUserId, owner)),
        database
          .select({ id: expenseShares.id, expenseId: expenseShares.expenseId, friendId: expenseShares.friendId, amountOwed: expenseShares.amountOwed })
          .from(expenseShares)
          .where(eq(expenseShares.ownerUserId, owner)),
        database
          .select({ id: repayments.id, friendId: repayments.friendId, amount: repayments.amount })
          .from(repayments)
          .where(eq(repayments.ownerUserId, owner)),
        database
          .select({ repaymentId: repaymentAllocations.repaymentId, expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
          .from(repaymentAllocations)
          .where(eq(repaymentAllocations.ownerUserId, owner)),
      ]);

      return buildLedgerSummary({
        friends: friendRows,
        expenses: expenseRows,
        expenseShares: shareRows,
        repayments: repaymentRows,
        repaymentAllocations: allocationRows,
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function updateExpense(expenseId: string, input: UpdateExpenseInput) {
    assertExpenseId(expenseId);
    assertExpenseInput(input);
    try {
      return await database.transaction(async (transaction) => {
        const [currentExpense] = await transaction
          .select({ id: expenses.id, amount: expenses.amount })
          .from(expenses)
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
          .limit(1)
          .for("update");
        if (!currentExpense) return notFound();

        const currentShares = await transaction
          .select({ amountOwed: expenseShares.amountOwed })
          .from(expenseShares)
          .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.expenseId, expenseId)));
        const assignedTotal = currentShares.reduce((total, share) => total + share.amountOwed, 0);
        if (input.amount < assignedTotal) throw new ExpenseShareInvariantError();

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

  function shareSelection() {
    return {
      id: expenseShares.id,
      friendId: friends.id,
      friendName: friends.name,
      friendArchivedAt: friends.archivedAt,
      amountOwed: expenseShares.amountOwed,
    };
  }

  async function listExpenseSharesFor(transaction: Pick<Database, "select">, expenseId: string) {
    return transaction
      .select(shareSelection())
      .from(expenseShares)
      .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, expenseShares.friendId)))
      .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.expenseId, expenseId)))
      .orderBy(asc(friends.name), asc(expenseShares.id));
  }

  async function listExpenseShares(expenseId: string) {
    assertExpenseId(expenseId);
    try {
      const [expense] = await database
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
        .limit(1);
      if (!expense) return notFound();
      return await listExpenseSharesFor(database, expenseId);
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function replaceExpenseShares(expenseId: string, shares: ExpenseShareInput[]) {
    assertExpenseId(expenseId);
    assertExpenseSharesInput(shares);
    try {
      return await database.transaction(async (transaction) => {
        const [expense] = await transaction
          .select({ id: expenses.id, amount: expenses.amount })
          .from(expenses)
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
          .limit(1)
          .for("update");
        if (!expense) return notFound();

        const currentShares = await transaction
          .select({ id: expenseShares.id, friendId: expenseShares.friendId, amountOwed: expenseShares.amountOwed })
          .from(expenseShares)
          .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.expenseId, expenseId)));
        const currentByFriend = new Map(currentShares.map((share) => [share.friendId, share]));
        const requested = shares.map((share) => ({ ...share, friendId: share.friendId.trim().toLowerCase() }));

        const friendIds = requested.map((share) => share.friendId);
        const ownedFriends = friendIds.length
          ? await transaction
              .select({ id: friends.id, archivedAt: friends.archivedAt })
              .from(friends)
              .where(and(eq(friends.ownerUserId, owner), inArray(friends.id, friendIds)))
          : [];
        if (ownedFriends.length !== new Set(friendIds).size) return notFound();
        for (const friend of ownedFriends) {
          if (friend.archivedAt !== null && !currentByFriend.has(friend.id)) {
            throw new LedgerRepositoryError("INVALID_INPUT", "Archived friends cannot be newly assigned.");
          }
        }
        const total = requested.reduce((sum, share) => sum + share.amountOwed, 0);
        if (total > expense.amount) throw new ExpenseShareInvariantError();

        const requestedByFriend = new Map(requested.map((share) => [share.friendId, share.amountOwed]));
        for (const current of currentShares) {
          const amountOwed = requestedByFriend.get(current.friendId);
          if (amountOwed === undefined) continue;
          if (amountOwed !== current.amountOwed) {
            await transaction
              .update(expenseShares)
              .set({ amountOwed })
              .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.id, current.id)));
          }
        }

        const newShares = requested.filter((share) => !currentByFriend.has(share.friendId));
        if (newShares.length > 0) {
          await transaction.insert(expenseShares).values(
            newShares.map((share) => ({ ownerUserId: owner, expenseId, friendId: share.friendId, amountOwed: share.amountOwed })),
          );
        }

        const omittedIds = currentShares.filter((share) => !requestedByFriend.has(share.friendId)).map((share) => share.id);
        if (omittedIds.length > 0) {
          await transaction
            .delete(expenseShares)
            .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.expenseId, expenseId), inArray(expenseShares.id, omittedIds)));
        }

        return await listExpenseSharesFor(transaction, expenseId);
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  function repaymentSelection() {
    return {
      id: repayments.id,
      ownerUserId: repayments.ownerUserId,
      friendId: repayments.friendId,
      amount: repayments.amount,
      paidAt: repayments.paidAt,
      paymentMethod: repayments.paymentMethod,
      notes: repayments.notes,
      createdAt: repayments.createdAt,
      friendName: friends.name,
      friendArchivedAt: friends.archivedAt,
    };
  }

  async function withRepaymentTotals(
    transaction: Pick<Database, "select">,
    rows: RepaymentRecord[],
    repaymentId?: string,
  ) {
    const allocations = await transaction
      .select({ repaymentId: repaymentAllocations.repaymentId, amount: repaymentAllocations.amount })
      .from(repaymentAllocations)
      .where(
        repaymentId
          ? and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.repaymentId, repaymentId))
          : eq(repaymentAllocations.ownerUserId, owner),
      );
    const allocatedByRepayment = new Map<string, number>();
    for (const allocation of allocations) {
      if (!Number.isSafeInteger(allocation.amount) || allocation.amount < 0) {
        throw new LedgerIntegrityError(`Allocated amount for repayment ${allocation.repaymentId} is invalid.`);
      }
      const total = (allocatedByRepayment.get(allocation.repaymentId) ?? 0) + allocation.amount;
      if (!Number.isSafeInteger(total)) throw new LedgerIntegrityError(`Allocated amount for repayment ${allocation.repaymentId} is unsafe.`);
      allocatedByRepayment.set(allocation.repaymentId, total);
    }
    return rows.map((repayment) => {
      if (!Number.isSafeInteger(repayment.amount) || repayment.amount < 0) {
        throw new LedgerIntegrityError(`Repayment ${repayment.id} amount is invalid.`);
      }
      const allocatedAmount = allocatedByRepayment.get(repayment.id) ?? 0;
      if (allocatedAmount > repayment.amount) throw new LedgerIntegrityError(`Allocations exceed repayment ${repayment.id}.`);
      return {
        ...repayment,
        allocatedAmount,
        unallocatedAmount: repayment.amount - allocatedAmount,
      };
    });
  }

  async function assertOwnedFriend(transaction: Pick<Database, "select">, friendId: string) {
    const [friend] = await transaction
      .select({ id: friends.id })
      .from(friends)
      .where(and(eq(friends.ownerUserId, owner), eq(friends.id, friendId)))
      .limit(1);
    if (!friend) return notFound();
  }

  async function createRepayment(input: CreateRepaymentInput) {
    assertRepaymentInput(input);
    const requested = { ...input, friendId: input.friendId.trim().toLowerCase() };
    try {
      return await database.transaction(async (transaction) => {
        await assertOwnedFriend(transaction, requested.friendId);
        const [repayment] = await transaction.insert(repayments).values({ ...requested, ownerUserId: owner }).returning();
        if (!repayment) return persistenceError(new Error("repayment insert returned no row"));
        return repayment;
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getRepayment(repaymentId: string) {
    assertRepaymentId(repaymentId);
    try {
      const [repayment] = await database
        .select(repaymentSelection())
        .from(repayments)
        .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, repayments.friendId)))
        .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
        .limit(1);
      if (!repayment) return notFound();
      return (await withRepaymentTotals(database, [repayment], repaymentId))[0]!;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listRepayments() {
    try {
      const rows = await database
        .select(repaymentSelection())
        .from(repayments)
        .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, repayments.friendId)))
        .where(eq(repayments.ownerUserId, owner))
        .orderBy(desc(repayments.paidAt), desc(repayments.createdAt), asc(repayments.id));
      return await withRepaymentTotals(database, rows);
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function updateRepayment(repaymentId: string, input: UpdateRepaymentInput) {
    assertRepaymentId(repaymentId);
    assertRepaymentInput(input);
    const requested = { ...input, friendId: input.friendId.trim().toLowerCase() };
    try {
      return await database.transaction(async (transaction) => {
        const [current] = await transaction
          .select({ id: repayments.id, friendId: repayments.friendId, amount: repayments.amount })
          .from(repayments)
          .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
          .limit(1)
          .for("update");
        if (!current) return notFound();

        const allocations = await transaction
          .select({ amount: repaymentAllocations.amount })
          .from(repaymentAllocations)
          .where(and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.repaymentId, repaymentId)))
          .for("update");
        if (!Number.isSafeInteger(current.amount) || current.amount < 0) throw new LedgerIntegrityError(`Repayment ${repaymentId} amount is invalid.`);
        let allocatedAmount = 0;
        for (const allocation of allocations) {
          if (!Number.isSafeInteger(allocation.amount) || allocation.amount < 0) {
            throw new LedgerIntegrityError(`Allocated amount for repayment ${repaymentId} is invalid.`);
          }
          allocatedAmount += allocation.amount;
          if (!Number.isSafeInteger(allocatedAmount)) throw new LedgerIntegrityError(`Allocated amount for repayment ${repaymentId} is unsafe.`);
        }
        if (allocatedAmount > current.amount) throw new LedgerIntegrityError(`Allocations exceed repayment ${repaymentId}.`);
        if (requested.amount < allocatedAmount) throw new RepaymentAmountInvariantError();
        if (allocations.length > 0 && requested.friendId !== current.friendId) throw new RepaymentFriendInvariantError();

        await assertOwnedFriend(transaction, requested.friendId);
        const [repayment] = await transaction
          .update(repayments)
          .set(requested)
          .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
          .returning();
        if (!repayment) return notFound();

        const [updated] = await transaction
          .select(repaymentSelection())
          .from(repayments)
          .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, repayments.friendId)))
          .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
          .limit(1);
        if (!updated) return persistenceError(new Error("repayment update lookup returned no row"));
        return (await withRepaymentTotals(transaction, [updated], repaymentId))[0]!;
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
    getLedgerSummary,
    updateExpense,
    listExpenseShares,
    replaceExpenseShares,
    createRepayment,
    getRepayment,
    listRepayments,
    updateRepayment,
    createRepaymentAllocation,
  };
}
