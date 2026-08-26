import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Database } from "../../db/client";
import { friends, repaymentAllocations, repayments } from "../../db/schema";
import { LedgerIntegrityError } from "../ledger-summary";
import type { RepaymentAllocationRepository } from "./allocations";
import { assertDeleteOptions, assertDeletionConfirmation, literalContains, notFound, persistenceError, safeDeletionIds, safeRetrievalInteger } from "./query-utils";
import { clampPage, monthStart, nextMonthStart, normalizeRepaymentFilters, normalizeTimezoneOffset, pageResult, parseAmountSearch, RECORD_PAGE_SIZE, type RecordPage } from "../record-retrieval";
import { assertRepaymentAllocationReversalReceipt, assertRepaymentAllocationsInput, assertRepaymentId, assertRepaymentInput, repaymentAllocationId } from "./validation";
import type { CreateRepaymentInput, DeleteRecordOptions, NeedsAttentionRepaymentResult, RepaymentAllocationReversalReceipt, RepaymentDeletionImpact, RepaymentListRecord, UpdateRepaymentInput } from "./types";
import type { RepaymentAllocationInput } from "../repayment-allocation-input";
import {
  LedgerRepositoryError,
  RepaymentAmountInvariantError,
  RepaymentFriendInvariantError,
  RepaymentDeletionInvariantError,
} from "./errors";

const NEEDS_ATTENTION_PREVIEW_LIMIT = 4;

export function createRepaymentReadRepository(database: Database, scope: string, allocations: RepaymentAllocationRepository) {
  const { allocationPlanFor, repaymentSelection, withRepaymentTotals } = allocations;

async function getRepayment(repaymentId: string) {
    assertRepaymentId(repaymentId);
    try {
      const [repayment] = await database
        .select(repaymentSelection())
        .from(repayments)
        .innerJoin(friends, and(eq(friends.ledgerScopeId, scope), eq(friends.id, repayments.friendId)))
        .where(and(eq(repayments.ledgerScopeId, scope), eq(repayments.id, repaymentId)))
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
        .innerJoin(friends, and(eq(friends.ledgerScopeId, scope), eq(friends.id, repayments.friendId)))
        .where(eq(repayments.ledgerScopeId, scope))
        .orderBy(desc(repayments.paidAt), desc(repayments.createdAt), asc(repayments.id));
      return await withRepaymentTotals(database, rows);
    } catch (error) {
      return persistenceError(error);
    }
  }

async function listRepaymentRecords(options: { q?: unknown; friendId?: unknown; month?: unknown; allocation?: unknown; page?: unknown; timezoneOffsetMinutes?: unknown } = {}): Promise<RecordPage<RepaymentListRecord>> {
    const filters = normalizeRepaymentFilters(options);
    const timezoneOffsetMinutes = normalizeTimezoneOffset(options.timezoneOffsetMinutes) ?? 0;
    const allocationValue = sql<number>`coalesce((select sum(${repaymentAllocations.amount}) from ${repaymentAllocations} where ${repaymentAllocations.ledgerScopeId} = ${scope} and ${repaymentAllocations.repaymentId} = ${repayments.id}), 0)`.mapWith(Number);
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
      eq(repayments.ledgerScopeId, scope),
      eq(friends.ledgerScopeId, scope),
      ...(queryCondition ? [queryCondition] : []),
      ...(filters.friendId ? [eq(repayments.friendId, filters.friendId)] : []),
      ...(filters.month ? [gte(repayments.paidAt, monthStart(filters.month, timezoneOffsetMinutes)), lt(repayments.paidAt, nextMonthStart(filters.month, timezoneOffsetMinutes))] : []),
      ...(allocationCondition ? [allocationCondition] : []),
    ];
    try {
      const [{ count = 0 } = {}] = await database
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(repayments)
        .innerJoin(friends, and(eq(friends.ledgerScopeId, scope), eq(friends.id, repayments.friendId)))
        .where(and(...conditions));
      const totalItems = safeRetrievalInteger(count, "Repayment count");
      const page = clampPage(filters.page, totalItems);
      const pageRepayments = database
        .select({ id: repayments.id, ledgerScopeId: repayments.ledgerScopeId, allocatedAmount: allocationValue.as("allocated_amount") })
        .from(repayments)
        .innerJoin(friends, and(eq(friends.ledgerScopeId, scope), eq(friends.id, repayments.friendId)))
        .where(and(...conditions))
        .orderBy(desc(repayments.paidAt), desc(repayments.createdAt), asc(repayments.id))
        .limit(RECORD_PAGE_SIZE)
        .offset((page - 1) * RECORD_PAGE_SIZE)
        .as("repayment_page");
      const rows = await database
        .select({ ...repaymentSelection(), allocatedAmount: pageRepayments.allocatedAmount })
        .from(repayments)
        .innerJoin(pageRepayments, and(eq(pageRepayments.id, repayments.id), eq(pageRepayments.ledgerScopeId, repayments.ledgerScopeId)))
        .innerJoin(friends, and(eq(friends.ledgerScopeId, scope), eq(friends.id, repayments.friendId)))
        .where(eq(repayments.ledgerScopeId, scope))
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
    const allocationValue = sql<number>`coalesce((select sum(${repaymentAllocations.amount}) from ${repaymentAllocations} where ${repaymentAllocations.ledgerScopeId} = ${scope} and ${repaymentAllocations.repaymentId} = ${repayments.id}), 0)`.mapWith(Number);
    try {
      const rows = await database
        .select({ ...repaymentSelection(), allocatedAmount: allocationValue.as("allocated_amount"), totalItems: sql<number>`count(*) over()`.mapWith(Number).as("total_items") })
        .from(repayments)
        .innerJoin(friends, and(eq(friends.ledgerScopeId, scope), eq(friends.id, repayments.friendId)))
        .where(and(eq(repayments.ledgerScopeId, scope), eq(friends.ledgerScopeId, scope), sql`${allocationValue} < ${repayments.amount}`))
        .orderBy(asc(repayments.paidAt), asc(repayments.createdAt), asc(repayments.id))
        .limit(NEEDS_ATTENTION_PREVIEW_LIMIT);
      const totalItems = rows.length === 0 ? 0 : safeRetrievalInteger(rows[0]!.totalItems, "Needs attention repayment count");
      const items = rows.map(({ allocatedAmount, ...repayment }) => {
        Reflect.deleteProperty(repayment, "totalItems");
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
    getRepaymentAllocationPlan,
  };
}

export function createRepaymentMutationRepository(
  database: Database,
  scope: string,
  allocations: RepaymentAllocationRepository,
) {
  const { getRepaymentAllocatedAmount, repaymentSelection, validateNewRepaymentAllocations, withRepaymentTotals, removeRepaymentAllocation: removeAllocation, restoreRepaymentAllocation, replaceAllocationRows } = allocations;
async function assertOwnedFriend(transaction: Pick<Database, "select">, friendId: string) {
    const [friend] = await transaction
      .select({ id: friends.id })
      .from(friends)
      .where(and(eq(friends.ledgerScopeId, scope), eq(friends.id, friendId)))
      .limit(1);
    if (!friend) return notFound();
  }

async function createRepayment(input: CreateRepaymentInput) {
    assertRepaymentInput(input);
    const requested = { ...input, friendId: input.friendId.trim().toLowerCase() };
    try {
      return await database.transaction(async (transaction) => {
        await assertOwnedFriend(transaction, requested.friendId);
        const [repayment] = await transaction.insert(repayments).values({ ...requested, ledgerScopeId: scope }).returning();
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
      .where(and(eq(friends.ledgerScopeId, scope), eq(friends.id, friendId)))
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
        await validateNewRepaymentAllocations(transaction, requested.friendId, requested.amount, normalizedAllocations);
        const [repayment] = await transaction.insert(repayments).values({ ...requested, ledgerScopeId: scope }).returning();
        if (!repayment) return persistenceError(new Error("repayment insert returned no row"));
        if (normalizedAllocations.length > 0) {
          await transaction.insert(repaymentAllocations).values(normalizedAllocations.map((allocation) => ({ ledgerScopeId: scope, repaymentId: repayment.id, ...allocation })));
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
          .where(and(eq(repayments.ledgerScopeId, scope), eq(repayments.id, repaymentId)))
          .limit(1)
          .for("update");
        if (!current) return notFound();

        if (!Number.isSafeInteger(current.amount) || current.amount < 0) throw new LedgerIntegrityError(`Repayment ${repaymentId} amount is invalid.`);
        const { allocatedAmount, allocationCount } = await getRepaymentAllocatedAmount(transaction, repaymentId);
        if (allocatedAmount > current.amount) throw new LedgerIntegrityError(`Allocations exceed repayment ${repaymentId}.`);
        if (requested.amount < allocatedAmount) throw new RepaymentAmountInvariantError();
        if (allocationCount > 0 && requested.friendId !== current.friendId) throw new RepaymentFriendInvariantError();

        await assertOwnedFriend(transaction, requested.friendId);
        const [repayment] = await transaction
          .update(repayments)
          .set(requested)
          .where(and(eq(repayments.ledgerScopeId, scope), eq(repayments.id, repaymentId)))
          .returning();
        if (!repayment) return notFound();

        const [updated] = await transaction
          .select(repaymentSelection())
          .from(repayments)
          .innerJoin(friends, and(eq(friends.ledgerScopeId, scope), eq(friends.id, repayments.friendId)))
          .where(and(eq(repayments.ledgerScopeId, scope), eq(repayments.id, repaymentId)))
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
        .where(and(eq(repayments.ledgerScopeId, scope), eq(repayments.id, repaymentId)))
        .limit(1);
      if (!repayment) return notFound();
      const allocations = await database
        .select({ expenseShareId: repaymentAllocations.expenseShareId })
        .from(repaymentAllocations)
        .where(and(eq(repaymentAllocations.ledgerScopeId, scope), eq(repaymentAllocations.repaymentId, repaymentId)));
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
          .where(and(eq(repayments.ledgerScopeId, scope), eq(repayments.id, repaymentId)))
          .limit(1)
          .for("update");
        if (!repayment) return notFound();
        const allocations = await transaction
          .select({ expenseShareId: repaymentAllocations.expenseShareId })
          .from(repaymentAllocations)
          .where(and(eq(repaymentAllocations.ledgerScopeId, scope), eq(repaymentAllocations.repaymentId, repaymentId)))
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
          .where(and(eq(repayments.ledgerScopeId, scope), eq(repayments.id, repaymentId)))
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
        const removed = await removeAllocation(transaction, repaymentId, shareId);
        const reversalReceipt: RepaymentAllocationReversalReceipt = {
          version: 1,
          reversalId: randomUUID(),
          allocationId: repaymentAllocationId(removed.allocation.repaymentId, removed.allocation.expenseShareId),
          repaymentId: removed.allocation.repaymentId,
          expenseShareId: removed.allocation.expenseShareId,
          friendId: removed.friendId,
          amount: removed.allocation.amount,
        };
        return { expenseId: removed.expenseId, friendId: removed.friendId, repaymentId: removed.repaymentId, reversalReceipt };
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

async function undoRepaymentAllocation(receipt: RepaymentAllocationReversalReceipt) {
    assertRepaymentAllocationReversalReceipt(receipt);
    try {
      return await database.transaction(async (transaction) => {
        return await restoreRepaymentAllocation(transaction, receipt);
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
        return await replaceAllocationRows(transaction, repaymentId, requested, options);
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
