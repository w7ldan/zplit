import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Database } from "../db/client";
import {
  debtorShareReceipts,
  expenseChargeTargets,
  expenseCharges,
  expenseReceipts,
  expenseShares,
  expenses,
  friends,
  outings,
  repaymentAllocations,
  repayments,
  trips,
} from "../db/schema";
import { LedgerIntegrityError } from "./ledger-summary";
import type { RepaymentAllocationInput } from "./repayment-allocation-input";
import {
  addDeletionAmount,
  assertDeleteOptions,
  assertDeletionConfirmation,
  notFound,
  persistenceError,
  safeDeletionIds,
  safeRetrievalInteger,
} from "./ledger/query-utils";
import {
  ExpenseShareAllocationInvariantError,
  ExpenseShareInvariantError,
  LedgerRepositoryError,
  RepaymentAllocationAmountInvariantError,
  RepaymentAllocationShareInvariantError,
  RepaymentAmountInvariantError,
  RepaymentFriendInvariantError,
  OutingDeletionInvariantError,
  ExpenseDeletionInvariantError,
  RepaymentDeletionInvariantError,
} from "./ledger/errors";
import type {
  CreateExpenseInput,
  CreateFriendInput,
  CreateOutingInput,
  CreateRepaymentInput,
  CreateTripInput,
  DeleteRecordOptions,
  ExpenseChargeInput,
  ExpenseDeletionImpact,
  ExpenseShareInput,
  FriendArchiveReversalReceipt,
  OpenExpenseSharesByFriend,
  OutingDeletionImpact,
  RepaymentAllocationReversalReceipt,
  RepaymentFriendContext,
  RepaymentDeletionImpact,
  UpdateExpenseInput,
  UpdateFriendInput,
  UpdateOutingInput,
  UpdateRepaymentInput,
  UpdateTripInput,
} from "./ledger/types";

export type * from "./ledger/types";
export type { LedgerErrorCode } from "./ledger/errors";
export {
  deletionImpactRevision,
  ExpenseShareAllocationInvariantError,
  ExpenseShareInvariantError,
  ExpenseDeletionInvariantError,
  LedgerDeletionConfirmationRequiredError,
  LedgerNotFoundError,
  LedgerRepositoryError,
  OutingDeletionInvariantError,
  RepaymentAllocationAmountInvariantError,
  RepaymentAllocationShareInvariantError,
  RepaymentAmountInvariantError,
  RepaymentFriendInvariantError,
  RepaymentDeletionInvariantError,
} from "./ledger/errors";
import { createFriendsReadRepository } from "./ledger/friends";
import { createTripsReadRepository } from "./ledger/trips";
import { createOutingsReadRepository } from "./ledger/outings";
import { createLedgerSearchRepository } from "./ledger/search";
import { createLedgerHistoryRepository } from "./ledger/history";
import { createLedgerStatementRepository } from "./ledger/statements";
import { createExpenseReadRepository } from "./ledger/expenses";
import { createRepaymentReadRepository } from "./ledger/repayments";
import {
  assertExpenseChargesInput,
  assertExpenseId,
  assertExpenseInput,
  assertExpenseSharesInput,
  assertFriendArchiveReversalReceipt,
  assertFriendId,
  assertFriendInput,
  assertOutingId,
  assertOutingInput,
  assertRepaymentAllocationReversalReceipt,
  assertRepaymentAllocationsInput,
  repaymentAllocationId,
  assertRepaymentId,
  assertRepaymentInput,
  assertTripId,
  assertTripInput,
  shareBaseAmount,
} from "./ledger/validation";

export function createLedgerRepository(database: Database, ownerUserId: string) {
  const owner = ownerUserId.trim();
  if (!owner) throw new LedgerRepositoryError("INVALID_OWNER", "A ledger owner is required");

  const friendsReads = createFriendsReadRepository(database, owner);
  const { getFriend, ...friendReads } = friendsReads;
  const tripsReads = createTripsReadRepository(database, owner);
  const outingsReads = createOutingsReadRepository(database, owner);
  const searchReads = createLedgerSearchRepository(database, owner);
  const historyReads = createLedgerHistoryRepository(database, owner);
  const statementsReads = createLedgerStatementRepository(database, owner);
  const { getFriendBalances, ...statementReads } = statementsReads;
  const expenseReads = createExpenseReadRepository(database, owner);
  const {
    expenseSelection,
    listExpenseChargesFor,
    listExpenseSharesFor,
    listOpenExpenseSharesByFriend,
    ...expenseReadMethods
  } = expenseReads;
  const repaymentReads = createRepaymentReadRepository(database, owner);
  const {
    allocationPlanFor,
    repaymentSelection,
    withRepaymentTotals,
    ...repaymentReadMethods
  } = repaymentReads;

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

  async function archiveFriend(friendId: string) {
    assertFriendId(friendId);
    const archivedAt = new Date();
    const updatedAt = new Date();
    try {
      const [friend] = await database
        .update(friends)
        .set({ archivedAt, updatedAt })
        .where(and(eq(friends.ownerUserId, owner), eq(friends.id, friendId), isNull(friends.archivedAt)))
        .returning();
      if (!friend) return notFound();
      return {
        friend,
        reversalReceipt: {
          version: 1 as const,
          friendId: friend.id,
          archivedAt: friend.archivedAt?.toISOString() ?? archivedAt.toISOString(),
          updatedAt: friend.updatedAt.toISOString(),
        },
      };
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function undoFriendArchive(receipt: FriendArchiveReversalReceipt) {
    assertFriendArchiveReversalReceipt(receipt);
    try {
      const [friend] = await database
        .update(friends)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(and(
          eq(friends.ownerUserId, owner),
          eq(friends.id, receipt.friendId),
          eq(friends.archivedAt, new Date(receipt.archivedAt)),
          eq(friends.updatedAt, new Date(receipt.updatedAt)),
        ))
        .returning();
      if (!friend) return notFound();
      return friend;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function createTrip(input: CreateTripInput) {
    assertTripInput(input);
    try {
      const [trip] = await database.insert(trips).values({ ...input, ownerUserId: owner }).returning();
      if (!trip) return persistenceError(new Error("trip insert returned no row"));
      return trip;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function updateTrip(tripId: string, input: UpdateTripInput) {
    assertTripId(tripId);
    assertTripInput(input);
    try {
      const [trip] = await database
        .update(trips)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(trips.ownerUserId, owner), eq(trips.id, tripId)))
        .returning();
      if (!trip) return notFound();
      return trip;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function deleteTrip(tripId: string) {
    assertTripId(tripId);
    try {
      return await database.transaction(async (transaction) => {
        const [trip] = await transaction
          .select({ id: trips.id })
          .from(trips)
          .where(and(eq(trips.ownerUserId, owner), eq(trips.id, tripId)))
          .limit(1)
          .for("update");
        if (!trip) return notFound();
        const detached = await transaction
          .update(outings)
          .set({ tripId: null, updatedAt: new Date() })
          .where(and(eq(outings.ownerUserId, owner), eq(outings.tripId, tripId)))
          .returning({ id: outings.id });
        const deleted = await transaction
          .delete(trips)
          .where(and(eq(trips.ownerUserId, owner), eq(trips.id, tripId)))
          .returning({ id: trips.id });
        if (deleted.length === 0) return notFound();
        return { detachedOutingCount: detached.length };
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function assertOwnedTrip(databaseLike: Pick<Database, "select">, tripId: string) {
    const [trip] = await databaseLike
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.ownerUserId, owner), eq(trips.id, tripId)))
      .limit(1);
    if (!trip) return notFound();
  }

  async function createOuting(input: CreateOutingInput) {
    assertOutingInput(input);
    const requested = { ...input, tripId: input.tripId ?? null };
    try {
      if (requested.tripId) await assertOwnedTrip(database, requested.tripId);
      const [outing] = await database.insert(outings).values({ ...requested, ownerUserId: owner }).returning();
      if (!outing) return persistenceError(new Error("outing insert returned no row"));
      return outing;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function updateOuting(outingId: string, input: UpdateOutingInput) {
    assertOutingId(outingId);
    assertOutingInput(input);
    const requested = { ...input, tripId: input.tripId ?? null };
    try {
      if (requested.tripId) await assertOwnedTrip(database, requested.tripId);
      const [outing] = await database
        .update(outings)
        .set({ ...requested, updatedAt: new Date() })
        .where(and(eq(outings.ownerUserId, owner), eq(outings.id, outingId)))
        .returning();
      if (!outing) return notFound();
      return outing;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getOutingDeletionImpact(outingId: string): Promise<OutingDeletionImpact> {
    assertOutingId(outingId);
    try {
      const [outing] = await database
        .select({ id: outings.id })
        .from(outings)
        .where(and(eq(outings.ownerUserId, owner), eq(outings.id, outingId)))
        .limit(1);
      if (!outing) return notFound();
      const expenseRows = await database
        .select({ id: expenses.id, amount: expenses.amount })
        .from(expenses)
        .where(and(eq(expenses.ownerUserId, owner), eq(expenses.outingId, outingId)));
      const expenseIds = safeDeletionIds(expenseRows.map((expense) => expense.id), "Outing expense ID");
      let expenseTotal = 0;
      for (const expense of expenseRows) expenseTotal = addDeletionAmount(expenseTotal, expense.amount, `Expense ${expense.id} amount`);
      const shareRows = expenseIds.length
        ? await database.select({ id: expenseShares.id, friendId: expenseShares.friendId }).from(expenseShares).where(and(eq(expenseShares.ownerUserId, owner), inArray(expenseShares.expenseId, expenseIds)))
        : [];
      const shareIds = safeDeletionIds(shareRows.map((share) => share.id), "Expense share ID");
      const [receiptRows, allocationRows] = expenseIds.length
        ? await Promise.all([
            database.select({ id: expenseReceipts.id }).from(expenseReceipts).where(and(eq(expenseReceipts.ownerUserId, owner), inArray(expenseReceipts.expenseId, expenseIds))),
            shareIds.length
              ? database.select({ repaymentId: repaymentAllocations.repaymentId }).from(repaymentAllocations).where(and(eq(repaymentAllocations.ownerUserId, owner), inArray(repaymentAllocations.expenseShareId, shareIds)))
              : Promise.resolve([]),
          ])
        : [[], []];
      const affectedRepaymentIds = safeDeletionIds(allocationRows.map((allocation) => allocation.repaymentId), "Affected repayment ID");
      return {
        recordType: "outing",
        expenseCount: safeRetrievalInteger(expenseRows.length, "Outing expense count"),
        expenseTotal,
        receiptCount: safeRetrievalInteger(receiptRows.length, "Outing receipt count"),
        shareCount: safeRetrievalInteger(shareRows.length, "Outing share count"),
        allocationCount: safeRetrievalInteger(allocationRows.length, "Outing allocation count"),
        affectedRepaymentCount: safeRetrievalInteger(affectedRepaymentIds.length, "Affected repayment count"),
        affectedRepaymentIds,
        affectedFriendIds: safeDeletionIds(shareRows.map((share) => share.friendId), "Affected friend ID"),
      };
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function lockExpenseDependents(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    expenseIds: string[],
  ) {
    if (expenseIds.length === 0) return { receipts: [], publicReceipts: [], shares: [], allocations: [] };
    const receipts = await transaction
      .select({ id: expenseReceipts.id })
      .from(expenseReceipts)
      .where(and(eq(expenseReceipts.ownerUserId, owner), inArray(expenseReceipts.expenseId, expenseIds)))
      .orderBy(asc(expenseReceipts.id))
      .for("update");
    const publicReceipts = await transaction
      .select({ id: debtorShareReceipts.id })
      .from(debtorShareReceipts)
      .where(and(eq(debtorShareReceipts.ownerUserId, owner), inArray(debtorShareReceipts.expenseId, expenseIds)))
      .orderBy(asc(debtorShareReceipts.id))
      .for("update");
    const shares = await transaction
      .select({ id: expenseShares.id, friendId: expenseShares.friendId })
      .from(expenseShares)
      .where(and(eq(expenseShares.ownerUserId, owner), inArray(expenseShares.expenseId, expenseIds)))
      .orderBy(asc(expenseShares.id))
      .for("update");
    const shareIds = safeDeletionIds(shares.map((share) => share.id), "Expense share ID");
    const allocations = shareIds.length
      ? await transaction
          .select({ repaymentId: repaymentAllocations.repaymentId, expenseShareId: repaymentAllocations.expenseShareId })
          .from(repaymentAllocations)
          .where(and(eq(repaymentAllocations.ownerUserId, owner), inArray(repaymentAllocations.expenseShareId, shareIds)))
          .orderBy(asc(repaymentAllocations.expenseShareId), asc(repaymentAllocations.repaymentId))
          .for("update")
      : [];
    return { receipts, publicReceipts, shares, allocations };
  }

  async function deleteOuting(outingId: string, options: DeleteRecordOptions = { cascadeDependents: false }) {
    assertOutingId(outingId);
    assertDeleteOptions(options);
    try {
      return await database.transaction(async (transaction) => {
        const [outing] = await transaction
          .select({ id: outings.id })
          .from(outings)
          .where(and(eq(outings.ownerUserId, owner), eq(outings.id, outingId)))
          .limit(1)
          .for("update");
        if (!outing) return notFound();
        const dependentExpenses = await transaction
          .select({ id: expenses.id, amount: expenses.amount })
          .from(expenses)
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.outingId, outingId)))
          .orderBy(asc(expenses.id))
          .for("update");
        const expenseIds = safeDeletionIds(dependentExpenses.map((expense) => expense.id), "Outing expense ID");
        const dependents = await lockExpenseDependents(transaction, expenseIds);
        const affectedRepaymentIds = safeDeletionIds(dependents.allocations.map((allocation) => allocation.repaymentId), "Affected repayment ID");
        const impact: OutingDeletionImpact = {
          recordType: "outing",
          expenseCount: safeRetrievalInteger(dependentExpenses.length, "Outing expense count"),
          expenseTotal: dependentExpenses.reduce((total, expense) => addDeletionAmount(total, expense.amount, `Expense ${expense.id} amount`), 0),
          receiptCount: safeRetrievalInteger(dependents.receipts.length, "Outing receipt count"),
          shareCount: safeRetrievalInteger(dependents.shares.length, "Outing share count"),
          allocationCount: safeRetrievalInteger(dependents.allocations.length, "Outing allocation count"),
          affectedRepaymentCount: safeRetrievalInteger(affectedRepaymentIds.length, "Affected repayment count"),
          affectedRepaymentIds,
          affectedFriendIds: safeDeletionIds(dependents.shares.map((share) => share.friendId), "Affected friend ID"),
        };
        assertDeletionConfirmation(impact, options, OutingDeletionInvariantError);
        const deleted = await transaction
          .delete(outings)
          .where(and(eq(outings.ownerUserId, owner), eq(outings.id, outingId)))
          .returning({ id: outings.id });
        if (deleted.length === 0) return notFound();
        return { friendIds: impact.affectedFriendIds, repaymentIds: impact.affectedRepaymentIds };
      });
    } catch (error) {
      return persistenceError(error);
    }
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

  async function getExpenseDeletionImpact(expenseId: string): Promise<ExpenseDeletionImpact> {
    assertExpenseId(expenseId);
    try {
      const [expense] = await database
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
        .limit(1);
      if (!expense) return notFound();
      const [receiptRows, shareRows] = await Promise.all([
        database.select({ id: expenseReceipts.id }).from(expenseReceipts).where(and(eq(expenseReceipts.ownerUserId, owner), eq(expenseReceipts.expenseId, expenseId))),
        database.select({ id: expenseShares.id, friendId: expenseShares.friendId }).from(expenseShares).where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.expenseId, expenseId))),
      ]);
      const shareIds = safeDeletionIds(shareRows.map((share) => share.id), "Expense share ID");
      const allocationRows = shareIds.length
        ? await database.select({ repaymentId: repaymentAllocations.repaymentId }).from(repaymentAllocations).where(and(eq(repaymentAllocations.ownerUserId, owner), inArray(repaymentAllocations.expenseShareId, shareIds)))
        : [];
      const affectedRepaymentIds = safeDeletionIds(allocationRows.map((allocation) => allocation.repaymentId), "Affected repayment ID");
      return {
        recordType: "expense",
        receiptCount: safeRetrievalInteger(receiptRows.length, "Expense receipt count"),
        shareCount: safeRetrievalInteger(shareRows.length, "Expense share count"),
        allocationCount: safeRetrievalInteger(allocationRows.length, "Expense allocation count"),
        affectedRepaymentCount: safeRetrievalInteger(affectedRepaymentIds.length, "Affected repayment count"),
        affectedRepaymentIds,
        affectedFriendIds: safeDeletionIds(shareRows.map((share) => share.friendId), "Affected friend ID"),
      };
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function deleteExpense(expenseId: string, options: DeleteRecordOptions = { cascadeDependents: false }) {
    assertExpenseId(expenseId);
    assertDeleteOptions(options);
    try {
      return await database.transaction(async (transaction) => {
        const [expense] = await transaction
          .select({ id: expenses.id })
          .from(expenses)
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
          .limit(1)
          .for("update");
        if (!expense) return notFound();
        const dependents = await lockExpenseDependents(transaction, [expenseId]);
        const affectedRepaymentIds = safeDeletionIds(dependents.allocations.map((allocation) => allocation.repaymentId), "Affected repayment ID");
        const impact: ExpenseDeletionImpact = {
          recordType: "expense",
          receiptCount: safeRetrievalInteger(dependents.receipts.length, "Expense receipt count"),
          shareCount: safeRetrievalInteger(dependents.shares.length, "Expense share count"),
          allocationCount: safeRetrievalInteger(dependents.allocations.length, "Expense allocation count"),
          affectedRepaymentCount: safeRetrievalInteger(affectedRepaymentIds.length, "Affected repayment count"),
          affectedRepaymentIds,
          affectedFriendIds: safeDeletionIds(dependents.shares.map((share) => share.friendId), "Affected friend ID"),
        };
        assertDeletionConfirmation(impact, options, ExpenseDeletionInvariantError);
        const deleted = await transaction
          .delete(expenses)
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
          .returning({ id: expenses.id });
        if (deleted.length === 0) return notFound();
        return { friendIds: impact.affectedFriendIds, repaymentIds: impact.affectedRepaymentIds };
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getRepaymentFriendContext(friendId: string, includeOpenExpenseShares = false): Promise<RepaymentFriendContext> {
    assertFriendId(friendId);
    const [friend, balances, shares] = await Promise.all([
      getFriend(friendId),
      getFriendBalances([friendId]),
      includeOpenExpenseShares ? listOpenExpenseSharesByFriend(friendId) : Promise.resolve({} as OpenExpenseSharesByFriend),
    ]);
    return {
      option: { id: friend.id, name: friend.name, archived: friend.archivedAt !== null },
      outstandingAmount: balances[0]?.outstandingAmount ?? 0,
      openExpenseShares: shares[friendId] ?? [],
    };
  }

  async function replaceExpenseShares(expenseId: string, shares: ExpenseShareInput[], charges?: ExpenseChargeInput[]) {
    assertExpenseId(expenseId);
    assertExpenseSharesInput(shares);
    if (charges !== undefined) assertExpenseChargesInput(charges);
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
          .select({ id: expenseShares.id, friendId: expenseShares.friendId, baseAmount: expenseShares.baseAmount, amountOwed: expenseShares.amountOwed })
          .from(expenseShares)
          .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.expenseId, expenseId)));
        const currentByFriend = new Map(currentShares.map((share) => [share.friendId, share]));
        const requested = shares.map((share) => ({ friendId: share.friendId.trim().toLowerCase(), baseAmount: shareBaseAmount(share) }));
        const storedCharges = charges === undefined ? await listExpenseChargesFor(transaction, expenseId) : [];
        const requestedCharges: ExpenseChargeInput[] = charges ?? storedCharges.map(({ name, percentageBasisPoints, scope, friendIds }) => ({ name, percentageBasisPoints, scope, friendIds }));

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
        const requestedFriendIds = new Set(friendIds);
        for (const charge of requestedCharges) {
          if (charge.scope === "selected" && charge.friendIds.some((friendId) => !requestedFriendIds.has(friendId.toLowerCase()))) {
            throw new LedgerRepositoryError("INVALID_INPUT", "Selected charge targets must have a share amount.");
          }
        }
        const finalByFriend = new Map(requested.map((share) => {
          try {
            return [share.friendId, calculateShareBreakdown(share.baseAmount, requestedCharges, share.friendId).finalAmount] as const;
          } catch {
            throw new LedgerRepositoryError("INVALID_INPUT", "The final share amount is too large.");
          }
        }));
        const total = [...finalByFriend.values()].reduce((sum, amount) => sum + amount, 0);
        if (total > expense.amount) throw new ExpenseShareInvariantError();

        const allocationTotals = currentShares.length
          ? await transaction
              .select({ expenseShareId: repaymentAllocations.expenseShareId, amount: sql<number>`coalesce(sum(${repaymentAllocations.amount}), 0)` })
              .from(repaymentAllocations)
              .where(and(eq(repaymentAllocations.ownerUserId, owner), inArray(repaymentAllocations.expenseShareId, currentShares.map((share) => share.id))))
              .groupBy(repaymentAllocations.expenseShareId)
          : [];
        const allocatedByShare = new Map(allocationTotals.map((allocation) => [allocation.expenseShareId, Number(allocation.amount)]));
        for (const requestedShare of requested) {
          const current = currentByFriend.get(requestedShare.friendId);
          if (current && finalByFriend.get(requestedShare.friendId)! < (allocatedByShare.get(current.id) ?? 0)) {
            throw new ExpenseShareAllocationInvariantError();
          }
        }

        const requestedByFriend = new Map(requested.map((share) => [share.friendId, share]));
        for (const current of currentShares) {
          const requestedShare = requestedByFriend.get(current.friendId);
          if (requestedShare === undefined) continue;
          const amountOwed = finalByFriend.get(current.friendId)!;
          if (requestedShare.baseAmount !== current.baseAmount || amountOwed !== current.amountOwed) {
            await transaction
              .update(expenseShares)
              .set({ baseAmount: requestedShare.baseAmount, amountOwed })
              .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.id, current.id)));
          }
        }

        const newShares = requested.filter((share) => !currentByFriend.has(share.friendId));
        if (newShares.length > 0) {
          await transaction.insert(expenseShares).values(
            newShares.map((share) => ({ ownerUserId: owner, expenseId, friendId: share.friendId, baseAmount: share.baseAmount, amountOwed: finalByFriend.get(share.friendId)! })),
          );
        }

        const omittedIds = currentShares.filter((share) => !requestedByFriend.has(share.friendId)).map((share) => share.id);
        if (omittedIds.length > 0) {
          await transaction
            .delete(expenseShares)
            .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.expenseId, expenseId), inArray(expenseShares.id, omittedIds)));
        }

        if (charges !== undefined) {
          await transaction.delete(expenseCharges).where(and(eq(expenseCharges.ownerUserId, owner), eq(expenseCharges.expenseId, expenseId)));
          const shareRows = requested.length
            ? await transaction
                .select({ id: expenseShares.id, friendId: expenseShares.friendId })
                .from(expenseShares)
                .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.expenseId, expenseId)))
            : [];
          const shareIdByFriend = new Map(shareRows.map((share) => [share.friendId, share.id]));
          const createdCharges = requestedCharges.length
            ? await transaction
                .insert(expenseCharges)
                .values(requestedCharges.map((charge) => ({ ownerUserId: owner, expenseId, name: charge.name.trim(), percentageBasisPoints: charge.percentageBasisPoints, scope: charge.scope })))
                .returning({ id: expenseCharges.id })
            : [];
          const targetRows = requestedCharges.flatMap((charge, index) => charge.scope === "selected"
            ? charge.friendIds.map((friendId) => ({ ownerUserId: owner, expenseId, expenseChargeId: createdCharges[index]!.id, expenseShareId: shareIdByFriend.get(friendId.toLowerCase())! }))
            : []);
          if (targetRows.length > 0) await transaction.insert(expenseChargeTargets).values(targetRows);
        }

        return await listExpenseSharesFor(transaction, expenseId);
      });
    } catch (error) {
      return persistenceError(error);
    }
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

  async function lockOwnedFriend(transaction: Pick<Database, "select">, friendId: string) {
    const [friend] = await transaction
      .select({ id: friends.id })
      .from(friends)
      .where(and(eq(friends.ownerUserId, owner), eq(friends.id, friendId)))
      .limit(1)
      .for("update");
    if (!friend) return notFound();
  }

  async function createRepaymentWithAllocations(input: CreateRepaymentInput, allocations: RepaymentAllocationInput[]) {
    assertRepaymentInput(input);
    assertRepaymentAllocationsInput(allocations);
    const requested = { ...input, friendId: input.friendId.trim().toLowerCase() };
    const normalizedAllocations = allocations.map((allocation) => ({ ...allocation, expenseShareId: allocation.expenseShareId.trim().toLowerCase() }));
    try {
      return await database.transaction(async (transaction) => {
        await lockOwnedFriend(transaction, requested.friendId);
        const shareIds = normalizedAllocations.map((allocation) => allocation.expenseShareId).sort();
        const lockedShares = shareIds.length
          ? await transaction
              .select({ id: expenseShares.id, friendId: expenseShares.friendId, amountOwed: expenseShares.amountOwed })
              .from(expenseShares)
              .where(and(eq(expenseShares.ownerUserId, owner), inArray(expenseShares.id, shareIds)))
              .orderBy(asc(expenseShares.id))
              .for("update")
          : [];
        if (lockedShares.length !== shareIds.length || lockedShares.some((share) => share.friendId !== requested.friendId)) return notFound();
        const existingAllocations = shareIds.length
          ? await transaction
              .select({ expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
              .from(repaymentAllocations)
              .where(and(eq(repaymentAllocations.ownerUserId, owner), inArray(repaymentAllocations.expenseShareId, shareIds)))
              .orderBy(asc(repaymentAllocations.expenseShareId), asc(repaymentAllocations.repaymentId))
              .for("update")
          : [];
        const allocatedByShare = new Map<string, number>();
        for (const allocation of existingAllocations) {
          if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) throw new LedgerIntegrityError(`Allocation for share ${allocation.expenseShareId} is invalid.`);
          const total = (allocatedByShare.get(allocation.expenseShareId) ?? 0) + allocation.amount;
          if (!Number.isSafeInteger(total)) throw new LedgerIntegrityError(`Allocation for share ${allocation.expenseShareId} is unsafe.`);
          allocatedByShare.set(allocation.expenseShareId, total);
        }
        const requestedTotal = normalizedAllocations.reduce((total, allocation) => total + allocation.amount, 0);
        if (!Number.isSafeInteger(requestedTotal) || requestedTotal > requested.amount) throw new RepaymentAllocationAmountInvariantError();
        const shareById = new Map(lockedShares.map((share) => [share.id, share]));
        for (const allocation of normalizedAllocations) {
          const share = shareById.get(allocation.expenseShareId);
          if (!share) return notFound();
          if (allocation.amount > share.amountOwed - (allocatedByShare.get(share.id) ?? 0)) throw new RepaymentAllocationShareInvariantError();
        }
        const [repayment] = await transaction.insert(repayments).values({ ...requested, ownerUserId: owner }).returning();
        if (!repayment) return persistenceError(new Error("repayment insert returned no row"));
        if (normalizedAllocations.length > 0) {
          await transaction.insert(repaymentAllocations).values(normalizedAllocations.map((allocation) => ({ ownerUserId: owner, repaymentId: repayment.id, ...allocation })));
        }
        return repayment;
      });
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

  async function getRepaymentDeletionImpact(repaymentId: string): Promise<RepaymentDeletionImpact> {
    assertRepaymentId(repaymentId);
    try {
      const [repayment] = await database
        .select({ id: repayments.id, friendId: repayments.friendId })
        .from(repayments)
        .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
        .limit(1);
      if (!repayment) return notFound();
      const allocations = await database
        .select({ expenseShareId: repaymentAllocations.expenseShareId })
        .from(repaymentAllocations)
        .where(and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.repaymentId, repaymentId)));
      const [friendId] = safeDeletionIds([repayment.friendId], "Affected friend ID");
      return {
        recordType: "repayment",
        allocationCount: safeRetrievalInteger(allocations.length, "Repayment allocation count"),
        friendId,
      };
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function deleteRepayment(repaymentId: string, options: DeleteRecordOptions = { cascadeDependents: false }) {
    assertRepaymentId(repaymentId);
    assertDeleteOptions(options);
    try {
      return await database.transaction(async (transaction) => {
        const [repayment] = await transaction
          .select({ id: repayments.id, friendId: repayments.friendId })
          .from(repayments)
          .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
          .limit(1)
          .for("update");
        if (!repayment) return notFound();
        const allocations = await transaction
          .select({ expenseShareId: repaymentAllocations.expenseShareId })
          .from(repaymentAllocations)
          .where(and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.repaymentId, repaymentId)))
          .orderBy(asc(repaymentAllocations.expenseShareId))
          .for("update");
        const [friendId] = safeDeletionIds([repayment.friendId], "Affected friend ID");
        const impact: RepaymentDeletionImpact = {
          recordType: "repayment",
          allocationCount: safeRetrievalInteger(allocations.length, "Repayment allocation count"),
          friendId,
        };
        assertDeletionConfirmation(impact, options, RepaymentDeletionInvariantError);
        const deleted = await transaction
          .delete(repayments)
          .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
          .returning({ id: repayments.id });
        if (deleted.length === 0) return notFound();
        return { friendIds: [friendId], repaymentIds: [] as string[] };
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function removeRepaymentAllocation(repaymentId: string, expenseShareId: string) {
    assertRepaymentId(repaymentId);
    if (typeof expenseShareId !== "string" || !expenseShareId.trim()) {
      throw new LedgerRepositoryError("INVALID_INPUT", "An expense share ID is required");
    }
    const shareId = expenseShareId.trim().toLowerCase();
    try {
      return await database.transaction(async (transaction) => {
        const [repayment] = await transaction
          .select({ id: repayments.id, friendId: repayments.friendId })
          .from(repayments)
          .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
          .limit(1)
          .for("update");
        if (!repayment) return notFound();

        const [share] = await transaction
          .select({ id: expenseShares.id, expenseId: expenseShares.expenseId, friendId: expenseShares.friendId })
          .from(expenseShares)
          .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.id, shareId)))
          .limit(1)
          .for("update");
        if (!share || share.friendId !== repayment.friendId) return notFound();

        const [allocation] = await transaction
          .select({ repaymentId: repaymentAllocations.repaymentId, expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
          .from(repaymentAllocations)
          .where(and(
            eq(repaymentAllocations.ownerUserId, owner),
            eq(repaymentAllocations.repaymentId, repayment.id),
            eq(repaymentAllocations.expenseShareId, share.id),
          ))
          .limit(1)
          .for("update");
        if (!allocation) return notFound();
        if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) {
          throw new LedgerIntegrityError(`Allocation for repayment ${repaymentId} is invalid.`);
        }

        const [deleted] = await transaction
          .delete(repaymentAllocations)
          .where(and(
            eq(repaymentAllocations.ownerUserId, owner),
            eq(repaymentAllocations.repaymentId, allocation.repaymentId),
            eq(repaymentAllocations.expenseShareId, allocation.expenseShareId),
          ))
          .returning({ repaymentId: repaymentAllocations.repaymentId, expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount });
        if (!deleted) return notFound();

        const reversalReceipt: RepaymentAllocationReversalReceipt = {
          version: 1,
          reversalId: randomUUID(),
          allocationId: repaymentAllocationId(deleted.repaymentId, deleted.expenseShareId),
          repaymentId: deleted.repaymentId,
          expenseShareId: deleted.expenseShareId,
          friendId: share.friendId,
          amount: deleted.amount,
        };
        return { expenseId: share.expenseId, friendId: share.friendId, repaymentId: repayment.id, reversalReceipt };
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function undoRepaymentAllocation(receipt: RepaymentAllocationReversalReceipt) {
    assertRepaymentAllocationReversalReceipt(receipt);
    try {
      return await database.transaction(async (transaction) => {
        const [repayment] = await transaction
          .select({ id: repayments.id, friendId: repayments.friendId, amount: repayments.amount })
          .from(repayments)
          .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, receipt.repaymentId)))
          .limit(1)
          .for("update");
        if (!repayment) return notFound();

        const [share] = await transaction
          .select({ id: expenseShares.id, expenseId: expenseShares.expenseId, friendId: expenseShares.friendId, amountOwed: expenseShares.amountOwed })
          .from(expenseShares)
          .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.id, receipt.expenseShareId)))
          .limit(1)
          .for("update");
        if (!share) return notFound();
        if (
          repayment.friendId !== receipt.friendId ||
          share.friendId !== receipt.friendId ||
          repayment.friendId !== share.friendId
        ) return notFound();

        const [existing] = await transaction
          .select({ repaymentId: repaymentAllocations.repaymentId, expenseShareId: repaymentAllocations.expenseShareId })
          .from(repaymentAllocations)
          .where(and(
            eq(repaymentAllocations.ownerUserId, owner),
            eq(repaymentAllocations.repaymentId, receipt.repaymentId),
            eq(repaymentAllocations.expenseShareId, receipt.expenseShareId),
          ))
          .limit(1)
          .for("update");
        if (existing) return notFound();

        if (!Number.isSafeInteger(repayment.amount) || repayment.amount < 0 || !Number.isSafeInteger(share.amountOwed) || share.amountOwed < 0) {
          throw new LedgerIntegrityError("Related allocation records contain an invalid amount.");
        }
        const repaymentAllocationsForRepayment = await transaction
          .select({ amount: repaymentAllocations.amount })
          .from(repaymentAllocations)
          .where(and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.repaymentId, receipt.repaymentId)))
          .for("update");
        let repaymentAllocatedAmount = 0;
        for (const allocation of repaymentAllocationsForRepayment) {
          if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) throw new LedgerIntegrityError(`Allocation for repayment ${receipt.repaymentId} is invalid.`);
          repaymentAllocatedAmount += allocation.amount;
          if (!Number.isSafeInteger(repaymentAllocatedAmount)) throw new LedgerIntegrityError(`Allocated amount for repayment ${receipt.repaymentId} is unsafe.`);
        }
        if (repaymentAllocatedAmount + receipt.amount > repayment.amount) throw new RepaymentAllocationAmountInvariantError();

        const repaymentAllocationsForShare = await transaction
          .select({ amount: repaymentAllocations.amount })
          .from(repaymentAllocations)
          .where(and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.expenseShareId, receipt.expenseShareId)))
          .for("update");
        let shareAllocatedAmount = 0;
        for (const allocation of repaymentAllocationsForShare) {
          if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) throw new LedgerIntegrityError(`Allocation for share ${receipt.expenseShareId} is invalid.`);
          shareAllocatedAmount += allocation.amount;
          if (!Number.isSafeInteger(shareAllocatedAmount)) throw new LedgerIntegrityError(`Allocated amount for share ${receipt.expenseShareId} is unsafe.`);
        }
        if (shareAllocatedAmount + receipt.amount > share.amountOwed) throw new RepaymentAllocationShareInvariantError();

        const [restored] = await transaction
          .insert(repaymentAllocations)
          .values({
            ownerUserId: owner,
            repaymentId: receipt.repaymentId,
            expenseShareId: receipt.expenseShareId,
            amount: receipt.amount,
          })
          .returning({ repaymentId: repaymentAllocations.repaymentId, expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount });
        if (!restored || repaymentAllocationId(restored.repaymentId, restored.expenseShareId) !== receipt.allocationId || restored.amount !== receipt.amount) {
          return persistenceError(new Error("allocation restore returned an unexpected row"));
        }
        return { expenseId: share.expenseId, friendId: share.friendId, repaymentId: repayment.id };
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function replaceRepaymentAllocations(repaymentId: string, allocations: RepaymentAllocationInput[], options: { q?: unknown; page?: unknown } = {}) {
    assertRepaymentId(repaymentId);
    assertRepaymentAllocationsInput(allocations);
    const requested = allocations.map((allocation) => ({
      expenseShareId: allocation.expenseShareId.trim().toLowerCase(),
      amount: allocation.amount,
    }));
    try {
      return await database.transaction(async (transaction) => {
        const [repayment] = await transaction
          .select({ id: repayments.id, friendId: repayments.friendId, amount: repayments.amount })
          .from(repayments)
          .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
          .limit(1)
          .for("update");
        if (!repayment) return notFound();

        const allocationPlan = await allocationPlanFor(transaction, repaymentId, options);
        const currentAllocations = await transaction
          .select({ expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
          .from(repaymentAllocations)
          .where(and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.repaymentId, repaymentId)));
        const editableShareIds = new Set(allocationPlan.shares.map((share) => share.expenseShareId));
        if (requested.some((allocation) => !editableShareIds.has(allocation.expenseShareId))) return notFound();
        const lockedShareIds = [...editableShareIds].sort();
        const lockedShares = lockedShareIds.length
          ? await transaction
              .select({ id: expenseShares.id, friendId: expenseShares.friendId, amountOwed: expenseShares.amountOwed })
              .from(expenseShares)
              .where(and(eq(expenseShares.ownerUserId, owner), inArray(expenseShares.id, lockedShareIds)))
              .orderBy(asc(expenseShares.id))
              .for("update")
          : [];
        if (lockedShares.length !== lockedShareIds.length) return notFound();
        if (lockedShares.some((share) => share.friendId !== repayment.friendId)) return notFound();

        const otherAllocations = lockedShareIds.length
          ? await transaction
              .select({ expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
              .from(repaymentAllocations)
              .where(and(
                eq(repaymentAllocations.ownerUserId, owner),
                inArray(repaymentAllocations.expenseShareId, lockedShareIds),
                ne(repaymentAllocations.repaymentId, repaymentId),
              ))
          : [];
        const allocatedByOther = new Map<string, number>();
        for (const allocation of otherAllocations) {
          if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) {
            throw new LedgerIntegrityError(`Allocated amount for share ${allocation.expenseShareId} is invalid.`);
          }
          const total = (allocatedByOther.get(allocation.expenseShareId) ?? 0) + allocation.amount;
          if (!Number.isSafeInteger(total)) throw new LedgerIntegrityError(`Allocated amount for share ${allocation.expenseShareId} is unsafe.`);
          allocatedByOther.set(allocation.expenseShareId, total);
        }

        const requestedTotal = requested.reduce((total, allocation) => total + allocation.amount, 0);
        const editableCurrentTotal = currentAllocations
          .filter((allocation) => editableShareIds.has(allocation.expenseShareId))
          .reduce((total, allocation) => total + allocation.amount, 0);
        if (!Number.isSafeInteger(requestedTotal) || !Number.isSafeInteger(editableCurrentTotal)) throw new LedgerRepositoryError("INVALID_INPUT", "Repayment allocations are invalid");
        const preservedAllocationTotal = allocationPlan.allocatedAmount - editableCurrentTotal;
        if (!Number.isSafeInteger(preservedAllocationTotal) || preservedAllocationTotal < 0 || preservedAllocationTotal + requestedTotal > repayment.amount) throw new RepaymentAllocationAmountInvariantError();
        const sharesById = new Map(lockedShares.map((share) => [share.id, share]));
        for (const allocation of requested) {
          const share = sharesById.get(allocation.expenseShareId);
          if (!share) return notFound();
          const capacityAvailable = share.amountOwed - (allocatedByOther.get(share.id) ?? 0);
          if (allocation.amount > capacityAvailable) throw new RepaymentAllocationShareInvariantError();
        }

        const currentById = new Map(currentAllocations.map((allocation) => [allocation.expenseShareId, allocation]));
        for (const allocation of requested) {
          if (currentById.has(allocation.expenseShareId)) {
            const current = currentById.get(allocation.expenseShareId)!;
            if (current.amount !== allocation.amount) {
              await transaction
                .update(repaymentAllocations)
                .set({ amount: allocation.amount })
                .where(and(
                  eq(repaymentAllocations.ownerUserId, owner),
                  eq(repaymentAllocations.repaymentId, repaymentId),
                  eq(repaymentAllocations.expenseShareId, allocation.expenseShareId),
                ));
            }
          } else {
            await transaction.insert(repaymentAllocations).values({
              ownerUserId: owner,
              repaymentId,
              expenseShareId: allocation.expenseShareId,
              amount: allocation.amount,
            });
          }
        }

        const requestedIds = new Set(requested.map((allocation) => allocation.expenseShareId));
        const omittedIds = currentAllocations.map((allocation) => allocation.expenseShareId).filter((id) => editableShareIds.has(id) && !requestedIds.has(id));
        if (omittedIds.length > 0) {
          await transaction
            .delete(repaymentAllocations)
            .where(and(
              eq(repaymentAllocations.ownerUserId, owner),
              eq(repaymentAllocations.repaymentId, repaymentId),
              inArray(repaymentAllocations.expenseShareId, omittedIds),
            ));
        }

        return await allocationPlanFor(transaction, repaymentId, options);
      });
    } catch (error) {
      return persistenceError(error);
    }
  }
  return {
    ...friendReads,
    getFriend,
    createFriend,
    updateFriend,
    setFriendArchived,
    archiveFriend,
    undoFriendArchive,
    ...tripsReads,
    createTrip,
    updateTrip,
    deleteTrip,
    ...outingsReads,
    createOuting,
    updateOuting,
    getOutingDeletionImpact,
    deleteOuting,
    ...searchReads,
    ...historyReads,
    ...statementReads,
    getFriendBalances,
    ...expenseReadMethods,
    listOpenExpenseSharesByFriend,
    createExpense,
    updateExpense,
    getExpenseDeletionImpact,
    deleteExpense,
    getRepaymentFriendContext,
    replaceExpenseShares,
    ...repaymentReadMethods,
    createRepayment,
    createRepaymentWithAllocations,
    updateRepayment,
    getRepaymentDeletionImpact,
    deleteRepayment,
    removeRepaymentAllocation,
    undoRepaymentAllocation,
    replaceRepaymentAllocations,
  };
}
