import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { expenseCharges, expenseChargeTargets, expenseShares, expenses, friends, outings, repaymentAllocations } from "../../db/schema";
import { LedgerIntegrityError } from "../ledger-summary";
import { literalContains, notFound, persistenceError, safeRetrievalInteger } from "./query-utils";
import { clampPage, monthStart, nextMonthStart, normalizeExpenseFilters, normalizePage, normalizeTimezoneOffset, pageResult, parseAmountSearch, RECORD_PAGE_SIZE, type RecordPage } from "../record-retrieval";
import { assertExpenseId, assertFriendId } from "./validation";
import type { ExpenseChargeInput, ExpenseChargeRecord, ExpenseSplitDefinition, FriendExpenseShareRecord, OpenExpenseSharesByFriend } from "./types";

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
