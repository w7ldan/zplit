import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { debtorShareReceipts, expenseCharges, expenseChargeTargets, expenseReceipts, expenseShares, expenses, friends, outings, repaymentAllocations, repayments } from "../../db/schema";
import { LedgerIntegrityError } from "../ledger-summary";
import { calculateShareBreakdown } from "../expense-share-input";
import { calculateRepaymentAllocations } from "../repayment-allocation-strategy";
import { ExpenseDeletionInvariantError, ExpenseShareAllocationInvariantError, ExpenseShareInvariantError, LedgerRepositoryError } from "./errors";
import { assertDeleteOptions, assertDeletionConfirmation, literalContains, notFound, persistenceError, safeDeletionIds, safeRetrievalInteger } from "./query-utils";
import { clampPage, monthStart, nextMonthStart, normalizeExpenseFilters, normalizePage, normalizeTimezoneOffset, pageResult, parseAmountSearch, RECORD_PAGE_SIZE, type RecordPage } from "../record-retrieval";
import { assertExpenseChargesInput, assertExpenseId, assertExpenseInput, assertExpenseSharesInput, assertFriendId, shareBaseAmount } from "./validation";
import type { CreateExpenseInput, DeleteRecordOptions, ExpenseChargeInput, ExpenseChargeRecord, ExpenseDeletionImpact, ExpenseDeletionResult, ExpenseShareInput, ExpenseSplitDefinition, FriendExpenseShareRecord, OpenExpenseSharesByFriend, UpdateExpenseInput } from "./types";

export function createExpenseReadRepository(database: Database, owner: string) {
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

function shareSelection() {
    return {
      id: expenseShares.id,
      friendId: friends.id,
      friendName: friends.name,
      friendArchivedAt: friends.archivedAt,
      baseAmount: expenseShares.baseAmount,
      amountOwed: expenseShares.amountOwed,
    };
  }

async function listExpenseChargesFor(transaction: Pick<Database, "select">, expenseId: string): Promise<ExpenseChargeRecord[]> {
    const rows = await transaction
      .select({
        id: expenseCharges.id,
        name: expenseCharges.name,
        percentageBasisPoints: expenseCharges.percentageBasisPoints,
        scope: expenseCharges.scope,
        targetFriendId: expenseShares.friendId,
      })
      .from(expenseCharges)
      .leftJoin(expenseChargeTargets, and(
        eq(expenseChargeTargets.ownerUserId, owner),
        eq(expenseChargeTargets.expenseId, expenseId),
        eq(expenseChargeTargets.expenseChargeId, expenseCharges.id),
      ))
      .leftJoin(expenseShares, and(
        eq(expenseShares.ownerUserId, owner),
        eq(expenseShares.expenseId, expenseId),
        eq(expenseShares.id, expenseChargeTargets.expenseShareId),
      ))
      .where(and(eq(expenseCharges.ownerUserId, owner), eq(expenseCharges.expenseId, expenseId)))
      .orderBy(asc(expenseCharges.createdAt), asc(expenseCharges.id), asc(expenseShares.friendId));
    const charges = new Map<string, ExpenseChargeRecord>();
    for (const row of rows) {
      const charge = charges.get(row.id) ?? {
        id: row.id,
        name: row.name,
        percentageBasisPoints: row.percentageBasisPoints,
        scope: row.scope as ExpenseChargeInput["scope"],
        friendIds: [],
      };
      if (row.targetFriendId) charge.friendIds.push(row.targetFriendId);
      charges.set(row.id, charge);
    }
    return [...charges.values()];
  }

async function listExpenseSharesFor(transaction: Pick<Database, "select">, expenseId: string) {
    const allocationTotals = transaction
      .select({
        ownerUserId: repaymentAllocations.ownerUserId,
        expenseShareId: repaymentAllocations.expenseShareId,
        appliedAmount: sql<number>`sum(${repaymentAllocations.amount})`.mapWith(Number).as("applied_amount"),
      })
      .from(repaymentAllocations)
      .where(eq(repaymentAllocations.ownerUserId, owner))
      .groupBy(repaymentAllocations.ownerUserId, repaymentAllocations.expenseShareId)
      .as("expense_share_allocations");
    const appliedAmount = sql<number>`coalesce(${allocationTotals.appliedAmount}, 0)`.mapWith(Number);
    const rows = await transaction
      .select({ ...shareSelection(), appliedAmount })
      .from(expenseShares)
      .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, expenseShares.friendId)))
      .leftJoin(allocationTotals, and(eq(allocationTotals.ownerUserId, owner), eq(allocationTotals.expenseShareId, expenseShares.id)))
      .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.expenseId, expenseId)))
      .orderBy(asc(friends.name), asc(expenseShares.id));
    return rows.map((share) => {
      if (share.appliedAmount > share.amountOwed) throw new LedgerIntegrityError(`Allocations exceed expense share ${share.id}.`);
      return { ...share, remainingAmount: share.amountOwed - share.appliedAmount, settled: share.appliedAmount === share.amountOwed };
    });
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

async function listExpenseRecords(options: { q?: unknown; outingId?: unknown; month?: unknown; assignment?: unknown; page?: unknown; timezoneOffsetMinutes?: unknown } = {}) {
    const filters = normalizeExpenseFilters(options);
    const timezoneOffsetMinutes = normalizeTimezoneOffset(options.timezoneOffsetMinutes) ?? 0;
    const assignmentCondition = filters.assignment === "all"
      ? undefined
      : filters.assignment === "assigned"
        ? sql`exists (select 1 from ${expenseShares} where ${expenseShares.ownerUserId} = ${owner} and ${expenseShares.expenseId} = ${expenses.id})`
        : sql`not exists (select 1 from ${expenseShares} where ${expenseShares.ownerUserId} = ${owner} and ${expenseShares.expenseId} = ${expenses.id})`;
    const amount = parseAmountSearch(filters.q);
    const queryCondition = filters.q
      ? amount === undefined
        ? sql`(${literalContains(expenses.description, filters.q)} OR ${literalContains(outings.title, filters.q)})`
        : sql`(${literalContains(expenses.description, filters.q)} OR ${literalContains(outings.title, filters.q)} OR ${eq(expenses.amount, amount)})`
      : undefined;
    const conditions = [
      eq(expenses.ownerUserId, owner),
      eq(outings.ownerUserId, owner),
      ...(queryCondition ? [queryCondition] : []),
      ...(filters.outingId ? [eq(expenses.outingId, filters.outingId)] : []),
      ...(filters.month ? [gte(outings.occurredAt, monthStart(filters.month, timezoneOffsetMinutes)), lt(outings.occurredAt, nextMonthStart(filters.month, timezoneOffsetMinutes))] : []),
      ...(assignmentCondition ? [assignmentCondition] : []),
    ];
    try {
      const [{ count = 0 } = {}] = await database
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(expenses)
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .where(and(...conditions));
      const totalItems = safeRetrievalInteger(count, "Expense count");
      const page = clampPage(filters.page, totalItems);
      const pageExpenses = database
        .select({ id: expenses.id, ownerUserId: expenses.ownerUserId })
        .from(expenses)
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .where(and(...conditions))
        .orderBy(desc(outings.occurredAt), desc(expenses.createdAt), asc(expenses.id))
        .limit(RECORD_PAGE_SIZE)
        .offset((page - 1) * RECORD_PAGE_SIZE)
        .as("expense_page");
      const items = await database
        .select(expenseSelection())
        .from(expenses)
        .innerJoin(pageExpenses, and(eq(pageExpenses.id, expenses.id), eq(pageExpenses.ownerUserId, expenses.ownerUserId)))
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .where(eq(expenses.ownerUserId, owner))
        .orderBy(desc(outings.occurredAt), desc(expenses.createdAt), asc(expenses.id));
      return pageResult(items, totalItems, page);
    } catch (error) {
      return persistenceError(error);
    }
  }

async function listFriendExpenseShareRecords(friendId: string, options: { page?: unknown } = {}): Promise<RecordPage<FriendExpenseShareRecord>> {
    assertFriendId(friendId);
    const page = normalizePage(options.page);
    const allocationTotals = database
      .select({
        ownerUserId: repaymentAllocations.ownerUserId,
        expenseShareId: repaymentAllocations.expenseShareId,
        appliedAmount: sql<number>`sum(${repaymentAllocations.amount})`.mapWith(Number).as("applied_amount"),
      })
      .from(repaymentAllocations)
      .where(eq(repaymentAllocations.ownerUserId, owner))
      .groupBy(repaymentAllocations.ownerUserId, repaymentAllocations.expenseShareId)
      .as("friend_expense_share_allocations");
    const conditions = [
      eq(expenseShares.ownerUserId, owner),
      eq(expenseShares.friendId, friendId.trim().toLowerCase()),
      eq(expenses.ownerUserId, owner),
      eq(outings.ownerUserId, owner),
      eq(friends.ownerUserId, owner),
    ];
    try {
      const [{ count = 0 } = {}] = await database
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(expenseShares)
        .innerJoin(expenses, and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseShares.expenseId)))
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, expenseShares.friendId)))
        .where(and(...conditions));
      const totalItems = safeRetrievalInteger(count, "Friend expense share count");
      const requestedPage = clampPage(page, totalItems);
      const appliedAmount = sql<number>`coalesce(${allocationTotals.appliedAmount}, 0)`.mapWith(Number);
      const rows = await database
        .select({
          id: expenseShares.id,
          expenseId: expenses.id,
          expenseDescription: expenses.description,
          outingTitle: outings.title,
          outingOccurredAt: outings.occurredAt,
          amountOwed: expenseShares.amountOwed,
          appliedAmount,
        })
        .from(expenseShares)
        .innerJoin(expenses, and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseShares.expenseId)))
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, expenseShares.friendId)))
        .leftJoin(allocationTotals, and(eq(allocationTotals.ownerUserId, owner), eq(allocationTotals.expenseShareId, expenseShares.id)))
        .where(and(...conditions))
        .orderBy(
          sql`case when ${appliedAmount} < ${expenseShares.amountOwed} then 0 else 1 end`,
          desc(outings.occurredAt),
          desc(expenses.createdAt),
          asc(expenses.id),
          asc(expenseShares.id),
        )
        .limit(RECORD_PAGE_SIZE)
        .offset((requestedPage - 1) * RECORD_PAGE_SIZE);
      const items = rows.map((row) => {
        const amountOwed = safeRetrievalInteger(row.amountOwed, `Share for expense ${row.expenseId}`);
        const applied = safeRetrievalInteger(row.appliedAmount ?? 0, `Applied amount for expense ${row.expenseId}`);
        if (applied > amountOwed) throw new LedgerIntegrityError(`Allocations exceed share for expense ${row.expenseId}.`);
        return {
          ...row,
          amountOwed,
          appliedAmount: applied,
          remainingAmount: amountOwed - applied,
          settled: applied === amountOwed,
        };
      });
      return pageResult(items, totalItems, requestedPage);
    } catch (error) {
      return persistenceError(error);
    }
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

async function listExpenseCharges(expenseId: string) {
    assertExpenseId(expenseId);
    try {
      const [expense] = await database
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
        .limit(1);
      if (!expense) return notFound();
      return await listExpenseChargesFor(database, expenseId);
    } catch (error) {
      return persistenceError(error);
    }
  }

async function getPreviousExpenseSplit(expenseId: string): Promise<ExpenseSplitDefinition | null> {
    assertExpenseId(expenseId);
    try {
      const [current] = await database
        .select({ outingId: expenses.outingId })
        .from(expenses)
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
        .limit(1);
      if (!current) return notFound();

      const [previous] = await database
        .select({ id: expenses.id })
        .from(expenses)
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .where(and(
          eq(expenses.ownerUserId, owner),
          eq(expenses.outingId, current.outingId),
          ne(expenses.id, expenseId),
          sql`exists (
            select 1
            from ${expenseShares} previous_shares
            inner join ${friends} reusable_friends on reusable_friends.owner_user_id = ${owner} and reusable_friends.id = previous_shares.friend_id
            where previous_shares.owner_user_id = ${owner}
              and previous_shares.expense_id = ${expenses.id}
              and reusable_friends.archived_at is null
          )`,
        ))
        .orderBy(desc(expenses.createdAt), asc(expenses.id))
        .limit(1);
      if (!previous) return null;

      const [friendRows, charges] = await Promise.all([
        database
          .select({ friendId: friends.id, friendName: friends.name, friendArchivedAt: friends.archivedAt, baseAmount: expenseShares.baseAmount })
          .from(expenseShares)
          .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, expenseShares.friendId)))
          .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.expenseId, previous.id)))
          .orderBy(asc(friends.name), asc(expenseShares.id)),
        listExpenseChargesFor(database, previous.id),
      ]);

      return {
        friends: friendRows,
        charges: charges.map(({ name, percentageBasisPoints, scope, friendIds }) => ({ name, percentageBasisPoints, scope, friendIds })),
      };
    } catch (error) {
      return persistenceError(error);
    }
  }

async function listOpenExpenseSharesByFriend(friendId?: string): Promise<OpenExpenseSharesByFriend> {
    if (friendId) assertFriendId(friendId);
    try {
      const shares = await database
        .select({
          id: expenseShares.id,
          friendId: friends.id,
          friendName: friends.name,
          expenseDescription: expenses.description,
          outingTitle: outings.title,
          outingOccurredAt: outings.occurredAt,
          amountOwed: expenseShares.amountOwed,
        })
        .from(expenseShares)
        .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, expenseShares.friendId)))
        .innerJoin(expenses, and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseShares.expenseId)))
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .where(and(eq(expenseShares.ownerUserId, owner), ...(friendId ? [eq(expenseShares.friendId, friendId)] : [])))
        .orderBy(asc(friends.name), asc(outings.occurredAt), asc(expenses.createdAt), asc(expenseShares.id));
      const allocations = shares.length
        ? await database
            .select({ expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
            .from(repaymentAllocations)
            .where(and(eq(repaymentAllocations.ownerUserId, owner), inArray(repaymentAllocations.expenseShareId, shares.map((share) => share.id))))
        : [];
      const repaidByShare = new Map<string, number>();
      for (const allocation of allocations) {
        if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) throw new LedgerIntegrityError(`Allocation for share ${allocation.expenseShareId} is invalid.`);
        const total = (repaidByShare.get(allocation.expenseShareId) ?? 0) + allocation.amount;
        if (!Number.isSafeInteger(total)) throw new LedgerIntegrityError(`Allocation for share ${allocation.expenseShareId} is unsafe.`);
        repaidByShare.set(allocation.expenseShareId, total);
      }
      const grouped: OpenExpenseSharesByFriend = {};
      for (const share of shares) {
        const repaidAmount = repaidByShare.get(share.id) ?? 0;
        const remainingAmount = share.amountOwed - repaidAmount;
        if (remainingAmount < 0) throw new LedgerIntegrityError(`Allocations exceed expense share ${share.id}.`);
        if (remainingAmount > 0) (grouped[share.friendId] ??= []).push({ ...share, repaidAmount, remainingAmount });
      }
      return grouped;
    } catch (error) {
      return persistenceError(error);
    }
  }

  return {
    expenseSelection,
    shareSelection,
    listExpenseChargesFor,
    listExpenseSharesFor,
    getExpense,
    listExpenses,
    listExpenseRecords,
    listFriendExpenseShareRecords,
    listExpenseShares,
    listExpenseCharges,
    getPreviousExpenseSplit,
    listOpenExpenseSharesByFriend,
  };
}

export function createExpenseMutationRepository(
  database: Database,
  owner: string,
  read: Pick<ReturnType<typeof createExpenseReadRepository>, "expenseSelection" | "listExpenseChargesFor" | "listExpenseSharesFor">,
) {
  const { expenseSelection, listExpenseChargesFor, listExpenseSharesFor } = read;
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
        .select({ repaymentId: repaymentAllocations.repaymentId, expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
        .from(repaymentAllocations)
        .where(and(eq(repaymentAllocations.ownerUserId, owner), inArray(repaymentAllocations.expenseShareId, shareIds)))
        .orderBy(asc(repaymentAllocations.expenseShareId), asc(repaymentAllocations.repaymentId))
        .for("update")
    : [];
  return { receipts, publicReceipts, shares, allocations };
}

async function reconcileDeletedExpenseAllocations(
  transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
  expenseId: string,
  shares: Array<{ id: string; friendId: string }>,
  deletedAllocations: Array<{ repaymentId: string; expenseShareId: string; amount: number }>,
) {
  const repaymentIds = safeDeletionIds(deletedAllocations.map((allocation) => allocation.repaymentId), "Affected repayment ID");
  if (repaymentIds.length === 0) return { reallocatedAmount: 0, unallocatedAmount: 0 };

  const repaymentRows = await transaction
    .select({ id: repayments.id, friendId: repayments.friendId, amount: repayments.amount })
    .from(repayments)
    .where(and(eq(repayments.ownerUserId, owner), inArray(repayments.id, repaymentIds)))
    .orderBy(asc(repayments.id))
    .for("update");
  const repaymentById = new Map(repaymentRows.map((repayment) => [repayment.id, repayment]));
  const deletedShareIds = new Set(shares.map((share) => share.id));
  const allAffectedAllocations = await transaction
    .select({ repaymentId: repaymentAllocations.repaymentId, expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
    .from(repaymentAllocations)
    .where(and(eq(repaymentAllocations.ownerUserId, owner), inArray(repaymentAllocations.repaymentId, repaymentIds)))
    .orderBy(asc(repaymentAllocations.repaymentId), asc(repaymentAllocations.expenseShareId))
    .for("update");
  const allocatedByRepayment = new Map<string, number>();
  const releasedByRepayment = new Map<string, number>();
  for (const allocation of allAffectedAllocations) {
    if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) throw new LedgerIntegrityError(`Allocation for repayment ${allocation.repaymentId} is invalid.`);
    const total = (allocatedByRepayment.get(allocation.repaymentId) ?? 0) + allocation.amount;
    if (!Number.isSafeInteger(total)) throw new LedgerIntegrityError(`Allocated amount for repayment ${allocation.repaymentId} is unsafe.`);
    allocatedByRepayment.set(allocation.repaymentId, total);
    if (deletedShareIds.has(allocation.expenseShareId)) {
      const released = (releasedByRepayment.get(allocation.repaymentId) ?? 0) + allocation.amount;
      if (!Number.isSafeInteger(released)) throw new LedgerIntegrityError(`Released amount for repayment ${allocation.repaymentId} is unsafe.`);
      releasedByRepayment.set(allocation.repaymentId, released);
    }
  }
  for (const repaymentId of repaymentIds) {
    const repayment = repaymentById.get(repaymentId);
    if (!repayment) throw new LedgerIntegrityError(`Affected repayment ${repaymentId} is unavailable.`);
    if (!Number.isSafeInteger(repayment.amount) || repayment.amount < 0) throw new LedgerIntegrityError(`Repayment ${repaymentId} amount is invalid.`);
    const retained = (allocatedByRepayment.get(repaymentId) ?? 0) - (releasedByRepayment.get(repaymentId) ?? 0);
    if (retained < 0 || retained > repayment.amount) throw new LedgerIntegrityError(`Allocations exceed repayment ${repaymentId}.`);
  }

  const friendIds = safeDeletionIds(repaymentRows.map((repayment) => repayment.friendId), "Affected friend ID");
  const candidateShares = await transaction
    .select({
      id: expenseShares.id,
      ownerUserId: expenseShares.ownerUserId,
      expenseId: expenseShares.expenseId,
      friendId: expenseShares.friendId,
      amountOwed: expenseShares.amountOwed,
    })
    .from(expenseShares)
    .innerJoin(expenses, and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseShares.expenseId)))
    .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
    .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, expenseShares.friendId)))
    .where(and(
      eq(expenseShares.ownerUserId, owner),
      inArray(expenseShares.friendId, friendIds),
      ne(expenseShares.expenseId, expenseId),
    ))
    .orderBy(asc(outings.occurredAt), asc(expenses.createdAt), asc(expenseShares.id))
    .for("update");
  const candidateShareIds = safeDeletionIds(candidateShares.map((share) => share.id), "Candidate expense share ID");
  const candidateAllocations = candidateShareIds.length
    ? await transaction
        .select({ repaymentId: repaymentAllocations.repaymentId, expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount, friendId: repayments.friendId })
        .from(repaymentAllocations)
        .innerJoin(repayments, and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentAllocations.repaymentId)))
        .where(and(eq(repaymentAllocations.ownerUserId, owner), inArray(repaymentAllocations.expenseShareId, candidateShareIds)))
        .orderBy(asc(repaymentAllocations.expenseShareId), asc(repaymentAllocations.repaymentId))
        .for("update")
    : [];
  const allocatedByShare = new Map<string, number>();
  const existingAllocationByKey = new Map<string, number>();
  const invalidCandidateIds = new Set<string>();
  const candidateFriendById = new Map(candidateShares.map((share) => [share.id, share.friendId]));
  for (const allocation of candidateAllocations) {
    if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) throw new LedgerIntegrityError(`Allocation for share ${allocation.expenseShareId} is invalid.`);
    const total = (allocatedByShare.get(allocation.expenseShareId) ?? 0) + allocation.amount;
    if (!Number.isSafeInteger(total)) throw new LedgerIntegrityError(`Allocation for share ${allocation.expenseShareId} is unsafe.`);
    allocatedByShare.set(allocation.expenseShareId, total);
    existingAllocationByKey.set(`${allocation.repaymentId}:${allocation.expenseShareId}`, allocation.amount);
    if (candidateFriendById.get(allocation.expenseShareId) !== allocation.friendId) invalidCandidateIds.add(allocation.expenseShareId);
  }
  const candidatesByFriend = new Map<string, Array<{ id: string; remainingAmount: number }>>();
  for (const share of candidateShares) {
    if (share.ownerUserId !== owner || share.expenseId === expenseId || !friendIds.includes(share.friendId) || !Number.isSafeInteger(share.amountOwed) || share.amountOwed <= 0 || invalidCandidateIds.has(share.id)) continue;
    const remainingAmount = share.amountOwed - (allocatedByShare.get(share.id) ?? 0);
    if (remainingAmount <= 0) continue;
    const candidates = candidatesByFriend.get(share.friendId) ?? [];
    candidates.push({ id: share.id, remainingAmount });
    candidatesByFriend.set(share.friendId, candidates);
  }
  const candidateById = new Map([...candidatesByFriend.values()].flat().map((candidate) => [candidate.id, candidate]));

  let reallocatedAmount = 0;
  for (const repayment of repaymentRows) {
    const released = releasedByRepayment.get(repayment.id) ?? 0;
    if (released === 0) continue;
    const retained = (allocatedByRepayment.get(repayment.id) ?? 0) - released;
    const amountToReallocate = Math.min(released, repayment.amount - retained);
    const candidates = candidatesByFriend.get(repayment.friendId) ?? [];
    const allocations = calculateRepaymentAllocations(amountToReallocate, candidates.map((candidate) => ({ id: candidate.id, remainingAmount: candidate.remainingAmount })), "oldest");
    for (const allocation of allocations) {
      const key = `${repayment.id}:${allocation.expenseShareId}`;
      const current = existingAllocationByKey.get(key);
      if (current === undefined) {
        await transaction.insert(repaymentAllocations).values({ ownerUserId: owner, repaymentId: repayment.id, expenseShareId: allocation.expenseShareId, amount: allocation.amount });
      } else {
        await transaction
          .update(repaymentAllocations)
          .set({ amount: current + allocation.amount })
          .where(and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.repaymentId, repayment.id), eq(repaymentAllocations.expenseShareId, allocation.expenseShareId)));
      }
      existingAllocationByKey.set(key, (current ?? 0) + allocation.amount);
      allocatedByRepayment.set(repayment.id, (allocatedByRepayment.get(repayment.id) ?? 0) + allocation.amount);
      const candidate = candidateById.get(allocation.expenseShareId)!;
      candidate.remainingAmount -= allocation.amount;
      reallocatedAmount += allocation.amount;
    }
  }

  const releasedAmount = [...releasedByRepayment.values()].reduce((total, amount) => total + amount, 0);
  if (!Number.isSafeInteger(releasedAmount) || !Number.isSafeInteger(reallocatedAmount) || reallocatedAmount > releasedAmount) throw new LedgerIntegrityError("Expense allocation reconciliation is unsafe.");
  return { reallocatedAmount, unallocatedAmount: releasedAmount - reallocatedAmount };
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
        const reconciliation = await reconcileDeletedExpenseAllocations(transaction, expenseId, dependents.shares, dependents.allocations);
        const deleted = await transaction
          .delete(expenses)
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
          .returning({ id: expenses.id });
        if (deleted.length === 0) return notFound();
        return {
          friendIds: impact.affectedFriendIds,
          repaymentIds: impact.affectedRepaymentIds,
          ...reconciliation,
          affectedRepaymentCount: impact.affectedRepaymentCount,
        } satisfies ExpenseDeletionResult;
      });
    } catch (error) {
      return persistenceError(error);
    }
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

  return { lockExpenseDependents, createExpense, updateExpense, getExpenseDeletionImpact, deleteExpense, replaceExpenseShares };
}
