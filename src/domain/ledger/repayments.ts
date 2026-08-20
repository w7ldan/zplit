import { and, asc, desc, eq, gte, lt, ne, or, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { expenseShares, expenses, friends, outings, repaymentAllocations, repayments } from "../../db/schema";
import { LedgerIntegrityError } from "../ledger-summary";
import { literalContains, notFound, persistenceError, safeRetrievalInteger } from "./query-utils";
import { clampPage, monthStart, nextMonthStart, normalizePage, normalizeRepaymentFilters, normalizeText, normalizeTimezoneOffset, pageResult, parseAmountSearch, RECORD_PAGE_SIZE, type RecordPage } from "../record-retrieval";
import { assertRepaymentId } from "./validation";
import { REPAYMENT_ALLOCATION_PAGE_SIZE } from "./types";
import type { RepaymentAllocationPlan, RepaymentListRecord, RepaymentRecord } from "./types";

export function createRepaymentReadRepository(database: Database, owner: string) {
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

async function listRepaymentRecords(options: { q?: unknown; friendId?: unknown; month?: unknown; allocation?: unknown; page?: unknown; timezoneOffsetMinutes?: unknown } = {}): Promise<RecordPage<RepaymentListRecord>> {
    const filters = normalizeRepaymentFilters(options);
    const timezoneOffsetMinutes = normalizeTimezoneOffset(options.timezoneOffsetMinutes) ?? 0;
    const allocationValue = sql<number>`coalesce((select sum(${repaymentAllocations.amount}) from ${repaymentAllocations} where ${repaymentAllocations.ownerUserId} = ${owner} and ${repaymentAllocations.repaymentId} = ${repayments.id}), 0)`.mapWith(Number);
    const allocationCondition = filters.allocation === "all"
      ? undefined
      : filters.allocation === "complete"
        ? sql`${allocationValue} >= ${repayments.amount}`
        : sql`${allocationValue} < ${repayments.amount}`;
    const amount = parseAmountSearch(filters.q);
    const queryCondition = filters.q
      ? amount === undefined
        ? sql`(${literalContains(friends.name, filters.q)} OR ${literalContains(repayments.paymentMethod, filters.q)})`
        : sql`(${literalContains(friends.name, filters.q)} OR ${literalContains(repayments.paymentMethod, filters.q)} OR ${eq(repayments.amount, amount)})`
      : undefined;
    const conditions = [
      eq(repayments.ownerUserId, owner),
      eq(friends.ownerUserId, owner),
      ...(queryCondition ? [queryCondition] : []),
      ...(filters.friendId ? [eq(repayments.friendId, filters.friendId)] : []),
      ...(filters.month ? [gte(repayments.paidAt, monthStart(filters.month, timezoneOffsetMinutes)), lt(repayments.paidAt, nextMonthStart(filters.month, timezoneOffsetMinutes))] : []),
      ...(allocationCondition ? [allocationCondition] : []),
    ];
    try {
      const [{ count = 0 } = {}] = await database
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(repayments)
        .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, repayments.friendId)))
        .where(and(...conditions));
      const totalItems = safeRetrievalInteger(count, "Repayment count");
      const page = clampPage(filters.page, totalItems);
      const pageRepayments = database
        .select({ id: repayments.id, ownerUserId: repayments.ownerUserId, allocatedAmount: allocationValue.as("allocated_amount") })
        .from(repayments)
        .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, repayments.friendId)))
        .where(and(...conditions))
        .orderBy(desc(repayments.paidAt), desc(repayments.createdAt), asc(repayments.id))
        .limit(RECORD_PAGE_SIZE)
        .offset((page - 1) * RECORD_PAGE_SIZE)
        .as("repayment_page");
      const rows = await database
        .select({ ...repaymentSelection(), allocatedAmount: pageRepayments.allocatedAmount })
        .from(repayments)
        .innerJoin(pageRepayments, and(eq(pageRepayments.id, repayments.id), eq(pageRepayments.ownerUserId, repayments.ownerUserId)))
        .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, repayments.friendId)))
        .where(eq(repayments.ownerUserId, owner))
        .orderBy(desc(repayments.paidAt), desc(repayments.createdAt), asc(repayments.id));
      const items = rows.map(({ allocatedAmount, ...repayment }) => {
        const allocated = safeRetrievalInteger(allocatedAmount ?? 0, `Allocation for repayment ${repayment.id}`);
        if (!Number.isSafeInteger(repayment.amount) || repayment.amount < 0 || allocated > repayment.amount) {
          throw new LedgerIntegrityError(`Allocations exceed repayment ${repayment.id}.`);
        }
        return { ...repayment, allocatedAmount: allocated, unallocatedAmount: repayment.amount - allocated };
      });
      return pageResult(items, totalItems, page);
    } catch (error) {
      return persistenceError(error);
    }
  }

async function allocationPlanFor(transaction: Pick<Database, "select">, repaymentId: string, options: { q?: unknown; page?: unknown } = {}): Promise<RepaymentAllocationPlan> {
    const [repayment] = await transaction
      .select(repaymentSelection())
      .from(repayments)
      .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, repayments.friendId)))
      .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
      .limit(1);
    if (!repayment) return notFound();

    const search = normalizeText(options.q);
    const amount = parseAmountSearch(search);
    const requestedPage = normalizePage(options.page);
    const currentAllocationRows = transaction
      .select({ expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
      .from(repaymentAllocations)
      .where(and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.repaymentId, repaymentId)))
      .as("current_repayment_allocations");
    const otherAllocationTotals = transaction
      .select({
        ownerUserId: repaymentAllocations.ownerUserId,
        expenseShareId: repaymentAllocations.expenseShareId,
        allocatedAmount: sql<number>`sum(${repaymentAllocations.amount})`.mapWith(Number).as("allocated_amount"),
      })
      .from(repaymentAllocations)
      .where(and(eq(repaymentAllocations.ownerUserId, owner), ne(repaymentAllocations.repaymentId, repaymentId)))
      .groupBy(repaymentAllocations.ownerUserId, repaymentAllocations.expenseShareId)
      .as("other_repayment_allocations");
    const currentAllocatedAmount = sql<number>`coalesce(${currentAllocationRows.amount}, 0)`.mapWith(Number);
    const allocatedByOtherRepayments = sql<number>`coalesce(${otherAllocationTotals.allocatedAmount}, 0)`.mapWith(Number);
    const queryCondition = search
      ? amount === undefined
        ? or(literalContains(expenses.description, search), literalContains(outings.title, search))
        : or(literalContains(expenses.description, search), literalContains(outings.title, search), eq(expenseShares.amountOwed, amount))
      : undefined;
    const conditions = [
      eq(expenseShares.ownerUserId, owner),
      eq(expenseShares.friendId, repayment.friendId),
      eq(expenses.ownerUserId, owner),
      eq(outings.ownerUserId, owner),
      sql`(${allocatedByOtherRepayments} < ${expenseShares.amountOwed} OR ${currentAllocatedAmount} > 0)`,
      ...(queryCondition ? [queryCondition] : []),
    ];

    const currentAllocations = await transaction
      .select({
        expenseShareId: repaymentAllocations.expenseShareId,
        amount: repaymentAllocations.amount,
        friendId: expenseShares.friendId,
        amountOwed: expenseShares.amountOwed,
        allocatedByOtherRepayments,
      })
      .from(repaymentAllocations)
      .innerJoin(expenseShares, and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.id, repaymentAllocations.expenseShareId)))
      .leftJoin(otherAllocationTotals, and(eq(otherAllocationTotals.ownerUserId, owner), eq(otherAllocationTotals.expenseShareId, repaymentAllocations.expenseShareId)))
      .where(and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.repaymentId, repaymentId)));
    let allocatedAmount = 0;
    for (const allocation of currentAllocations) {
      if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) {
        throw new LedgerIntegrityError(`Allocated amount for repayment ${repaymentId} is invalid.`);
      }
      if (allocation.friendId !== repayment.friendId) {
        throw new LedgerIntegrityError(`Repayment ${repaymentId} references an unavailable expense share.`);
      }
      allocatedAmount += allocation.amount;
      if (!Number.isSafeInteger(allocatedAmount)) throw new LedgerIntegrityError(`Allocated amount for repayment ${repaymentId} is unsafe.`);
      const amountOwed = safeRetrievalInteger(allocation.amountOwed, `Share for repayment ${repaymentId}`);
      const allocatedByOther = safeRetrievalInteger(allocation.allocatedByOtherRepayments ?? 0, `Other allocations for share ${allocation.expenseShareId}`);
      if (allocatedAmount > repayment.amount || allocation.amount + allocatedByOther > amountOwed) {
        throw new LedgerIntegrityError(`Allocations exceed repayment ${repaymentId}.`);
      }
    }
    if (allocatedAmount > repayment.amount) throw new LedgerIntegrityError(`Allocations exceed repayment ${repaymentId}.`);

    const [{ count = 0 } = {}] = await transaction
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(expenseShares)
      .innerJoin(expenses, and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseShares.expenseId)))
      .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
      .leftJoin(currentAllocationRows, eq(currentAllocationRows.expenseShareId, expenseShares.id))
      .leftJoin(otherAllocationTotals, and(eq(otherAllocationTotals.ownerUserId, owner), eq(otherAllocationTotals.expenseShareId, expenseShares.id)))
      .where(and(...conditions));
    const totalItems = safeRetrievalInteger(count, "Repayment allocation share count");
    const page = clampPage(requestedPage, totalItems, REPAYMENT_ALLOCATION_PAGE_SIZE);
    const eligibleShares = await transaction
      .select({
        id: expenseShares.id,
        expenseDescription: expenses.description,
        outingTitle: outings.title,
        outingOccurredAt: outings.occurredAt,
        amountOwed: expenseShares.amountOwed,
        allocatedByOtherRepayments,
        currentAllocation: currentAllocatedAmount,
      })
      .from(expenseShares)
      .innerJoin(expenses, and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseShares.expenseId)))
      .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
      .leftJoin(currentAllocationRows, eq(currentAllocationRows.expenseShareId, expenseShares.id))
      .leftJoin(otherAllocationTotals, and(eq(otherAllocationTotals.ownerUserId, owner), eq(otherAllocationTotals.expenseShareId, expenseShares.id)))
      .where(and(...conditions))
      .orderBy(asc(outings.occurredAt), asc(expenses.createdAt), asc(expenseShares.id))
      .limit(REPAYMENT_ALLOCATION_PAGE_SIZE)
      .offset((page - 1) * REPAYMENT_ALLOCATION_PAGE_SIZE);

    const shares = eligibleShares.map((share) => {
      const amountOwed = safeRetrievalInteger(share.amountOwed, `Share for expense ${share.id}`);
      const allocatedByOtherRepayments = safeRetrievalInteger(share.allocatedByOtherRepayments ?? 0, `Other allocations for share ${share.id}`);
      const currentAllocation = safeRetrievalInteger(share.currentAllocation ?? 0, `Allocation for share ${share.id}`);
      const capacityAvailable = amountOwed - allocatedByOtherRepayments;
      if (capacityAvailable < 0 || currentAllocation + allocatedByOtherRepayments > amountOwed) {
        throw new LedgerIntegrityError(`Allocations exceed expense share ${share.id}.`);
      }
      return {
        id: share.id,
        expenseShareId: share.id,
        expenseDescription: share.expenseDescription,
        outingTitle: share.outingTitle,
        outingOccurredAt: share.outingOccurredAt,
        amountOwed,
        allocatedByOtherRepayments,
        currentAllocation,
        capacityAvailable,
      };
    });
    return {
      ...repayment,
      allocatedAmount,
      unallocatedAmount: repayment.amount - allocatedAmount,
      shares,
      sharePage: { items: shares, page, pageSize: REPAYMENT_ALLOCATION_PAGE_SIZE, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / REPAYMENT_ALLOCATION_PAGE_SIZE)) },
    };
  }

async function getRepaymentAllocationPlan(repaymentId: string, options: { q?: unknown; page?: unknown } = {}) {
    assertRepaymentId(repaymentId);
    try {
      return await allocationPlanFor(database, repaymentId, options);
    } catch (error) {
      return persistenceError(error);
    }
  }

  return {
    getRepayment,
    listRepayments,
    listRepaymentRecords,
    allocationPlanFor,
    getRepaymentAllocationPlan,
    repaymentSelection,
    withRepaymentTotals,
  };
}
