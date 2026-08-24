import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { expenseShares, expenses, friends, outings, repaymentAllocations, repayments } from "../../db/schema";
import { LedgerIntegrityError } from "../ledger-summary";
import type { RepaymentAllocationInput } from "../repayment-allocation-input";
import { clampPage, normalizePage, normalizeText, parseAmountSearch } from "../record-retrieval";
import { repaymentAllocationId } from "./validation";
import { LedgerRepositoryError, RepaymentAllocationAmountInvariantError, RepaymentAllocationShareInvariantError } from "./errors";
import { literalContains, notFound, persistenceError, safeDeletionIds, safeRetrievalInteger } from "./query-utils";
import { REPAYMENT_ALLOCATION_PAGE_SIZE } from "./types";
import type { RepaymentAllocationPlan, RepaymentAllocationReversalReceipt, RepaymentRecord } from "./types";

export type RepaymentAllocationStrategy = "manual" | "oldest" | "newest";
export type RepaymentStrategyShare = { id: string; remainingAmount: number };
export type GeneratedRepaymentAllocation = { expenseShareId: string; amount: number };

export type LedgerTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function calculateRepaymentAllocations(
  amount: number,
  shares: readonly RepaymentStrategyShare[],
  strategy: Exclude<RepaymentAllocationStrategy, "manual">,
): GeneratedRepaymentAllocation[] {
  if (!Number.isSafeInteger(amount) || amount <= 0) return [];
  let remaining = amount;
  const orderedShares = strategy === "newest" ? [...shares].reverse() : shares;
  const allocations: GeneratedRepaymentAllocation[] = [];

  for (const share of orderedShares) {
    if (!Number.isSafeInteger(share.remainingAmount) || share.remainingAmount < 0) throw new RangeError("Expense share remaining amount must be a safe non-negative integer");
    if (remaining === 0) break;
    const allocation = Math.min(remaining, share.remainingAmount);
    if (allocation > 0) {
      allocations.push({ expenseShareId: share.id, amount: allocation });
      remaining -= allocation;
    }
  }

  return allocations;
}

export function createRepaymentAllocationRepository(database: Database, owner: string) {
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

  async function getRepaymentAllocatedAmount(transaction: Pick<Database, "select">, repaymentId: string, options: { requirePositive?: boolean } = {}) {
    const allocations = await transaction
      .select({ amount: repaymentAllocations.amount })
      .from(repaymentAllocations)
      .where(and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.repaymentId, repaymentId)))
      .for("update");
    let allocatedAmount = 0;
    for (const allocation of allocations) {
      if (!Number.isSafeInteger(allocation.amount) || (options.requirePositive ? allocation.amount <= 0 : allocation.amount < 0)) {
        throw new LedgerIntegrityError(`Allocated amount for repayment ${repaymentId} is invalid.`);
      }
      allocatedAmount += allocation.amount;
      if (!Number.isSafeInteger(allocatedAmount)) throw new LedgerIntegrityError(`Allocated amount for repayment ${repaymentId} is unsafe.`);
    }
    return { allocatedAmount, allocationCount: allocations.length };
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

  async function lockRepaymentAllocationsForShares(transaction: LedgerTransaction, shareIds: string[]) {
    return shareIds.length
      ? transaction
          .select({ repaymentId: repaymentAllocations.repaymentId, expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
          .from(repaymentAllocations)
          .where(and(eq(repaymentAllocations.ownerUserId, owner), inArray(repaymentAllocations.expenseShareId, shareIds)))
          .orderBy(asc(repaymentAllocations.expenseShareId), asc(repaymentAllocations.repaymentId))
          .for("update")
      : [];
  }

  async function validateNewRepaymentAllocations(
    transaction: LedgerTransaction,
    friendId: string,
    repaymentAmount: number,
    allocations: RepaymentAllocationInput[],
  ) {
    const shareIds = allocations.map((allocation) => allocation.expenseShareId).sort();
    const lockedShares = shareIds.length
      ? await transaction
          .select({ id: expenseShares.id, friendId: expenseShares.friendId, amountOwed: expenseShares.amountOwed })
          .from(expenseShares)
          .where(and(eq(expenseShares.ownerUserId, owner), inArray(expenseShares.id, shareIds)))
          .orderBy(asc(expenseShares.id))
          .for("update")
      : [];
    if (lockedShares.length !== shareIds.length || lockedShares.some((share) => share.friendId !== friendId)) return notFound();
    const existingAllocations = await lockRepaymentAllocationsForShares(transaction, shareIds);
    const allocatedByShare = new Map<string, number>();
    for (const allocation of existingAllocations) {
      if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) throw new LedgerIntegrityError(`Allocation for share ${allocation.expenseShareId} is invalid.`);
      const total = (allocatedByShare.get(allocation.expenseShareId) ?? 0) + allocation.amount;
      if (!Number.isSafeInteger(total)) throw new LedgerIntegrityError(`Allocation for share ${allocation.expenseShareId} is unsafe.`);
      allocatedByShare.set(allocation.expenseShareId, total);
    }
    const requestedTotal = allocations.reduce((total, allocation) => total + allocation.amount, 0);
    if (!Number.isSafeInteger(requestedTotal) || requestedTotal > repaymentAmount) throw new RepaymentAllocationAmountInvariantError();
    const shareById = new Map(lockedShares.map((share) => [share.id, share]));
    for (const allocation of allocations) {
      const share = shareById.get(allocation.expenseShareId);
      if (!share) return notFound();
      if (allocation.amount > share.amountOwed - (allocatedByShare.get(share.id) ?? 0)) throw new RepaymentAllocationShareInvariantError();
    }
  }

  async function removeRepaymentAllocation(transaction: LedgerTransaction, repaymentId: string, shareId: string) {
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
    return { expenseId: share.expenseId, friendId: share.friendId, repaymentId: repayment.id, allocation: deleted };
  }

  async function restoreRepaymentAllocation(transaction: LedgerTransaction, receipt: RepaymentAllocationReversalReceipt) {
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
    const { allocatedAmount: repaymentAllocatedAmount } = await getRepaymentAllocatedAmount(transaction, receipt.repaymentId, { requirePositive: true });
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
  }

  async function replaceAllocationRows(
    transaction: LedgerTransaction,
    repaymentId: string,
    requested: RepaymentAllocationInput[],
    options: { q?: unknown; page?: unknown } = {},
  ) {
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
  }

  async function reconcileDeletedExpenseAllocations(
    transaction: LedgerTransaction,
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
      const allocations = calculateRepaymentAllocations(amountToReallocate, candidates, "oldest");
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

  return {
    repaymentSelection,
    withRepaymentTotals,
    getRepaymentAllocatedAmount,
    allocationPlanFor,
    lockRepaymentAllocationsForShares,
    validateNewRepaymentAllocations,
    removeRepaymentAllocation,
    restoreRepaymentAllocation,
    replaceAllocationRows,
    reconcileDeletedExpenseAllocations,
  };
}

export type RepaymentAllocationRepository = ReturnType<typeof createRepaymentAllocationRepository>;
