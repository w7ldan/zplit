import { and, asc, desc, eq, gte, inArray, lt, ne, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Database } from "../../db/client";
import { expenseShares, expenses, friends, outings, repaymentAllocations, repayments } from "../../db/schema";
import { LedgerIntegrityError } from "../ledger-summary";
import { assertDeleteOptions, assertDeletionConfirmation, literalContains, notFound, persistenceError, safeDeletionIds, safeRetrievalInteger } from "./query-utils";
import { clampPage, monthStart, nextMonthStart, normalizePage, normalizeRepaymentFilters, normalizeText, normalizeTimezoneOffset, pageResult, parseAmountSearch, RECORD_PAGE_SIZE, type RecordPage } from "../record-retrieval";
import { assertRepaymentAllocationReversalReceipt, assertRepaymentAllocationsInput, assertRepaymentId, assertRepaymentInput, repaymentAllocationId } from "./validation";
import { REPAYMENT_ALLOCATION_PAGE_SIZE } from "./types";
import type { CreateRepaymentInput, DeleteRecordOptions, NeedsAttentionRepaymentResult, RepaymentAllocationPlan, RepaymentAllocationReversalReceipt, RepaymentDeletionImpact, RepaymentListRecord, RepaymentRecord, UpdateRepaymentInput } from "./types";
import type { RepaymentAllocationInput } from "../repayment-allocation-input";
import {
  LedgerRepositoryError,
  RepaymentAllocationAmountInvariantError,
  RepaymentAllocationShareInvariantError,
  RepaymentAmountInvariantError,
  RepaymentFriendInvariantError,
  RepaymentDeletionInvariantError,
} from "./errors";

const NEEDS_ATTENTION_PREVIEW_LIMIT = 4;

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

async function listNeedsAttentionRepayments(): Promise<NeedsAttentionRepaymentResult> {
    const allocationValue = sql<number>`coalesce((select sum(${repaymentAllocations.amount}) from ${repaymentAllocations} where ${repaymentAllocations.ownerUserId} = ${owner} and ${repaymentAllocations.repaymentId} = ${repayments.id}), 0)`.mapWith(Number);
    try {
      const rows = await database
        .select({ ...repaymentSelection(), allocatedAmount: allocationValue.as("allocated_amount"), totalItems: sql<number>`count(*) over()`.mapWith(Number).as("total_items") })
        .from(repayments)
        .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, repayments.friendId)))
        .where(and(eq(repayments.ownerUserId, owner), eq(friends.ownerUserId, owner), sql`${allocationValue} < ${repayments.amount}`))
        .orderBy(asc(repayments.paidAt), asc(repayments.createdAt), asc(repayments.id))
        .limit(NEEDS_ATTENTION_PREVIEW_LIMIT);
      const totalItems = rows.length === 0 ? 0 : safeRetrievalInteger(rows[0]!.totalItems, "Needs attention repayment count");
      const items = rows.map(({ allocatedAmount, totalItems: _totalItems, ...repayment }) => {
        const allocated = safeRetrievalInteger(allocatedAmount ?? 0, `Allocation for repayment ${repayment.id}`);
        if (!Number.isSafeInteger(repayment.amount) || repayment.amount < 0 || allocated > repayment.amount) {
          throw new LedgerIntegrityError(`Allocations exceed repayment ${repayment.id}.`);
        }
        return { ...repayment, allocatedAmount: allocated, unallocatedAmount: repayment.amount - allocated };
      });
      return { items, totalItems };
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
    listNeedsAttentionRepayments,
    allocationPlanFor,
    getRepaymentAllocationPlan,
    repaymentSelection,
    withRepaymentTotals,
  };
}

export function createRepaymentMutationRepository(
  database: Database,
  owner: string,
  read: Pick<ReturnType<typeof createRepaymentReadRepository>, "allocationPlanFor" | "repaymentSelection" | "withRepaymentTotals">,
) {
  const { allocationPlanFor, repaymentSelection, withRepaymentTotals } = read;
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
