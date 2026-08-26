import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { expenseReceipts, expenseShares, expenses, outings, repaymentAllocations, repayments, trips } from "../../db/schema";
import { OutingDeletionInvariantError } from "./errors";
import { addDeletionAmount, assertDeleteOptions, assertDeletionConfirmation, literalContains, notFound, persistenceError, safeDeletionIds, safeRetrievalInteger } from "./query-utils";
import {
  clampPage,
  monthStart,
  nextMonthStart,
  normalizeOutingFilters,
  normalizeText,
  normalizeTimezoneOffset,
  normalizeUuid,
  pageResult,
  RECORD_PAGE_SIZE,
  type RecordPage,
} from "../record-retrieval";
import { assertOutingId, assertOutingInput } from "./validation";
import type { CreateOutingInput, DeleteRecordOptions, OutingDeletionImpact, OutingListRecord, OutingSelectorOption, UpdateOutingInput } from "./types";

export function createOutingsReadRepository(database: Database, scope: string) {
async function getOuting(outingId: string) {
    assertOutingId(outingId);
    try {
      const [outing] = await database
        .select()
        .from(outings)
        .where(and(eq(outings.ledgerScopeId, scope), eq(outings.id, outingId)))
        .limit(1);
      if (!outing) return notFound();
      return outing;
    } catch (error) {
      return persistenceError(error);
    }
  }

async function listOutings() {
    try {
      return await database.select().from(outings).where(eq(outings.ledgerScopeId, scope)).orderBy(desc(outings.occurredAt), asc(outings.id));
    } catch (error) {
      return persistenceError(error);
    }
  }

async function searchOutings(options: { q?: unknown; selectedId?: unknown } = {}): Promise<OutingSelectorOption[]> {
    const query = normalizeText(options.q);
    const selectedId = normalizeUuid(options.selectedId);
    const conditions = [
      eq(outings.ledgerScopeId, scope),
      ...(query && selectedId ? [or(literalContains(outings.title, query), eq(outings.id, selectedId))] : query ? [literalContains(outings.title, query)] : []),
    ];
    try {
      if (query) {
        return await database
          .select({ id: outings.id, title: outings.title })
          .from(outings)
          .where(and(...conditions))
          .orderBy(
            ...(selectedId ? [sql`case when ${outings.id} = ${selectedId} then 0 else 1 end`] : []),
            desc(outings.occurredAt),
            desc(outings.createdAt),
            asc(outings.id),
          )
          .limit(20);
      }

      const recentRows = await database
        .select({ id: outings.id, title: outings.title })
        .from(expenses)
        .innerJoin(outings, and(eq(outings.ledgerScopeId, scope), eq(outings.id, expenses.outingId)))
        .where(eq(expenses.ledgerScopeId, scope))
        .orderBy(desc(expenses.updatedAt), desc(expenses.createdAt), desc(expenses.id))
        .limit(40);
      const recentIds = new Set<string>();
      const recent = recentRows.filter((outing) => {
        if (recentIds.has(outing.id) || recentIds.size >= 5) return false;
        recentIds.add(outing.id);
        return true;
      });
      const normal = await database
        .select({ id: outings.id, title: outings.title })
        .from(outings)
        .where(and(...conditions))
        .orderBy(
          ...(selectedId ? [sql`case when ${outings.id} = ${selectedId} then 0 else 1 end`] : []),
          desc(outings.occurredAt),
          desc(outings.createdAt),
          asc(outings.id),
        )
        .limit(20);
      return [...recent.map((outing) => ({ ...outing, recent: true })), ...normal]
        .filter((outing, index, all) => all.findIndex((candidate) => candidate.id === outing.id) === index)
        .slice(0, 20);
    } catch (error) {
      return persistenceError(error);
    }
  }

async function listRecentPaymentMethods(): Promise<string[]> {
    try {
      const rows = await database
        .select({ paymentMethod: repayments.paymentMethod })
        .from(repayments)
        .where(and(eq(repayments.ledgerScopeId, scope), isNotNull(repayments.paymentMethod)))
        .orderBy(desc(repayments.createdAt), desc(repayments.id))
        .limit(40);
      const seen = new Set<string>();
      return rows.flatMap(({ paymentMethod }) => {
        if (!paymentMethod?.trim()) return [];
        const value = paymentMethod.trim();
        const key = value.replace(/\s+/g, " ").toLocaleLowerCase();
        if (seen.has(key)) return [];
        seen.add(key);
        return [value];
      }).slice(0, 8);
    } catch (error) {
      return persistenceError(error);
    }
  }

async function listOutingRecords(options: { q?: unknown; month?: unknown; trip?: unknown; page?: unknown; timezoneOffsetMinutes?: unknown } = {}): Promise<RecordPage<OutingListRecord & { expenseCount: number; expenseTotal: number }>> {
    const filters = normalizeOutingFilters(options);
    const timezoneOffsetMinutes = normalizeTimezoneOffset(options.timezoneOffsetMinutes) ?? 0;
    const conditions = [
      eq(outings.ledgerScopeId, scope),
      ...(filters.q ? [literalContains(outings.title, filters.q)] : []),
      ...(filters.month ? [gte(outings.occurredAt, monthStart(filters.month, timezoneOffsetMinutes)), lt(outings.occurredAt, nextMonthStart(filters.month, timezoneOffsetMinutes))] : []),
      ...(filters.trip === "unassigned" ? [isNull(outings.tripId)] : filters.trip ? [eq(outings.tripId, filters.trip)] : []),
    ];
    try {
      const [{ count = 0 } = {}] = await database
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(outings)
        .where(and(...conditions));
      const totalItems = safeRetrievalInteger(count, "Outing count");
      const page = clampPage(filters.page, totalItems);
      const pageOutings = database
        .select({ id: outings.id, ledgerScopeId: outings.ledgerScopeId, tripId: outings.tripId })
        .from(outings)
        .where(and(...conditions))
        .orderBy(desc(outings.occurredAt), desc(outings.createdAt), asc(outings.id))
        .limit(RECORD_PAGE_SIZE)
        .offset((page - 1) * RECORD_PAGE_SIZE)
        .as("outing_page");
      const expenseTotals = database
        .select({
          outingId: expenses.outingId,
          expenseCount: sql<number>`count(${expenses.id})`.mapWith(Number).as("expense_count"),
          expenseTotal: sql<number>`coalesce(sum(${expenses.amount}), 0)`.mapWith(Number).as("expense_total"),
        })
        .from(expenses)
        .innerJoin(pageOutings, and(eq(pageOutings.id, expenses.outingId), eq(pageOutings.ledgerScopeId, expenses.ledgerScopeId)))
        .where(eq(expenses.ledgerScopeId, scope))
        .groupBy(expenses.ledgerScopeId, expenses.outingId)
        .as("outing_expense_totals");
      const rows = await database
        .select({ outing: outings, tripName: trips.name, expenseCount: expenseTotals.expenseCount, expenseTotal: expenseTotals.expenseTotal })
        .from(outings)
        .innerJoin(pageOutings, and(eq(pageOutings.id, outings.id), eq(pageOutings.ledgerScopeId, outings.ledgerScopeId)))
        .leftJoin(expenseTotals, eq(expenseTotals.outingId, outings.id))
        .leftJoin(trips, and(eq(trips.ledgerScopeId, outings.ledgerScopeId), eq(trips.id, outings.tripId)))
        .where(eq(outings.ledgerScopeId, scope))
        .orderBy(desc(outings.occurredAt), desc(outings.createdAt), asc(outings.id));
      const items = rows.map(({ outing, tripName, expenseCount, expenseTotal }) => ({
        ...outing,
        tripName: tripName ?? null,
        expenseCount: safeRetrievalInteger(expenseCount ?? 0, "Outing expense count"),
        expenseTotal: safeRetrievalInteger(expenseTotal ?? 0, "Outing expense total"),
      }));
      return pageResult(items, totalItems, page);
    } catch (error) {
      return persistenceError(error);
    }
  }

  return { getOuting, listOutings, searchOutings, listRecentPaymentMethods, listOutingRecords };
}

import type { createExpenseMutationRepository } from "./expenses";

export function createOutingsMutationRepository(
  database: Database,
  scope: string,
  { lockExpenseDependents }: Pick<ReturnType<typeof createExpenseMutationRepository>, "lockExpenseDependents">,
) {
async function assertOwnedTrip(databaseLike: Pick<Database, "select">, tripId: string) {
    const [trip] = await databaseLike
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.ledgerScopeId, scope), eq(trips.id, tripId)))
      .limit(1);
    if (!trip) return notFound();
  }

async function createOuting(input: CreateOutingInput) {
    assertOutingInput(input);
    const requested = { ...input, tripId: input.tripId ?? null };
    try {
      if (requested.tripId) await assertOwnedTrip(database, requested.tripId);
      const [outing] = await database.insert(outings).values({ ...requested, ledgerScopeId: scope }).returning();
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
        .where(and(eq(outings.ledgerScopeId, scope), eq(outings.id, outingId)))
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
        .where(and(eq(outings.ledgerScopeId, scope), eq(outings.id, outingId)))
        .limit(1);
      if (!outing) return notFound();
      const expenseRows = await database
        .select({ id: expenses.id, amount: expenses.amount })
        .from(expenses)
        .where(and(eq(expenses.ledgerScopeId, scope), eq(expenses.outingId, outingId)));
      const expenseIds = safeDeletionIds(expenseRows.map((expense) => expense.id), "Outing expense ID");
      let expenseTotal = 0;
      for (const expense of expenseRows) expenseTotal = addDeletionAmount(expenseTotal, expense.amount, `Expense ${expense.id} amount`);
      const shareRows = expenseIds.length
        ? await database.select({ id: expenseShares.id, friendId: expenseShares.friendId }).from(expenseShares).where(and(eq(expenseShares.ledgerScopeId, scope), inArray(expenseShares.expenseId, expenseIds)))
        : [];
      const shareIds = safeDeletionIds(shareRows.map((share) => share.id), "Expense share ID");
      const [receiptRows, allocationRows] = expenseIds.length
        ? await Promise.all([
            database.select({ id: expenseReceipts.id }).from(expenseReceipts).where(and(eq(expenseReceipts.ledgerScopeId, scope), inArray(expenseReceipts.expenseId, expenseIds))),
            shareIds.length
              ? database.select({ repaymentId: repaymentAllocations.repaymentId }).from(repaymentAllocations).where(and(eq(repaymentAllocations.ledgerScopeId, scope), inArray(repaymentAllocations.expenseShareId, shareIds)))
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

async function deleteOuting(outingId: string, options: DeleteRecordOptions = { cascadeDependents: false }) {
    assertOutingId(outingId);
    assertDeleteOptions(options);
    try {
      return await database.transaction(async (transaction) => {
        const [outing] = await transaction
          .select({ id: outings.id })
          .from(outings)
          .where(and(eq(outings.ledgerScopeId, scope), eq(outings.id, outingId)))
          .limit(1)
          .for("update");
        if (!outing) return notFound();
        const dependentExpenses = await transaction
          .select({ id: expenses.id, amount: expenses.amount })
          .from(expenses)
          .where(and(eq(expenses.ledgerScopeId, scope), eq(expenses.outingId, outingId)))
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
          .where(and(eq(outings.ledgerScopeId, scope), eq(outings.id, outingId)))
          .returning({ id: outings.id });
        if (deleted.length === 0) return notFound();
        return { friendIds: impact.affectedFriendIds, repaymentIds: impact.affectedRepaymentIds };
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  return { createOuting, updateOuting, getOutingDeletionImpact, deleteOuting };
}
