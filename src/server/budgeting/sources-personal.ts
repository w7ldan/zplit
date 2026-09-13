import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  budgetCategories,
  budgetImpacts,
  budgetPersonalExpenseExclusions,
  budgetPersonalExpenseSources,
  budgetPersonalRepaymentSources,
  budgetProfiles,
  budgetPeriods,
  budgetTransactions,
  expenses,
  expenseShares,
  outings,
  repaymentAllocations,
  repayments,
  friends,
} from "@/db/schema";
import { BudgetError } from "@/domain/budgeting/errors";
import type { ExpenseBudgetParticipation } from "@/domain/budgeting/participation";
import { splitBudgetAmount } from "@/domain/budgeting/spread";
import { LedgerIntegrityError } from "@/domain/ledger-summary";
import type { LedgerTransaction, PersonalBudgetMutationHooks } from "@/domain/ledger/mutation-hooks";
import { lockBudgetProfile } from "./locks";

type ActivePeriod = typeof budgetPeriods.$inferSelect;

export type PersonalBudgetIntegration = PersonalBudgetMutationHooks;

export type PersonalExpenseBudgetState =
  | { status: "included"; transactionId: string; categoryId: string | null; categoryName: string }
  | { status: "not_included" }
  | { status: "unprocessed" };

type BudgetTransactionRecord = typeof budgetTransactions.$inferSelect;

function uniqueIds(ids: string[]) {
  return [...new Set(ids)].sort();
}

function isInside(period: ActivePeriod, date: string) {
  return date >= period.startsOn && date <= period.endsOn;
}

function addAmount(target: Map<string, number>, key: string, amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new LedgerIntegrityError("Budget source amount is invalid.");
  const next = (target.get(key) ?? 0) + amount;
  if (!Number.isSafeInteger(next)) throw new LedgerIntegrityError("Budget source amount is unsafe.");
  target.set(key, next);
}

export function buildRepaymentBudgetDistribution(
  amount: number,
  allocations: readonly { amount: number; expenseId: string }[],
  uncategorizedId: string,
  categoryByExpense: ReadonlyMap<string, string>,
) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new LedgerIntegrityError("Repayment amount is invalid.");
  let allocatedAmount = 0;
  const distribution = new Map<string, number>();
  for (const allocation of allocations) {
    if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) throw new LedgerIntegrityError("Repayment allocation amount is invalid.");
    allocatedAmount += allocation.amount;
    if (!Number.isSafeInteger(allocatedAmount) || allocatedAmount > amount) throw new LedgerIntegrityError("Repayment allocations exceed the source amount.");
    addAmount(distribution, categoryByExpense.get(allocation.expenseId) ?? uncategorizedId, allocation.amount);
  }
  if (amount - allocatedAmount > 0) addAmount(distribution, uncategorizedId, amount - allocatedAmount);
  const total = [...distribution.values()].reduce((sum, value) => sum + value, 0);
  if (total !== amount) throw new LedgerIntegrityError("Repayment budget impacts do not reconcile.");
  return distribution;
}

export function createPersonalBudgetIntegration(ownerUserId: string, scope: string): PersonalBudgetIntegration {
  if (!ownerUserId.trim() || !scope.trim()) throw new TypeError("Personal budget ownership is required");

  async function lockProfileAndPeriod(transaction: LedgerTransaction): Promise<ActivePeriod | null | undefined> {
    const profile = await transaction
      .select({ ownerUserId: budgetProfiles.ownerUserId })
      .from(budgetProfiles)
      .where(eq(budgetProfiles.ownerUserId, ownerUserId))
      .limit(1)
      .for("update");
    if (profile.length === 0) return undefined;
    const [period] = await transaction
      .select()
      .from(budgetPeriods)
      .where(and(eq(budgetPeriods.ownerUserId, ownerUserId), eq(budgetPeriods.status, "active")))
      .limit(1)
      .for("update");
    return period ?? null;
  }

  async function lockProfile(transaction: LedgerTransaction) {
    const profile = await transaction
      .select({ ownerUserId: budgetProfiles.ownerUserId })
      .from(budgetProfiles)
      .where(eq(budgetProfiles.ownerUserId, ownerUserId))
      .limit(1)
      .for("update");
    return profile.length > 0;
  }

  async function getUncategorizedId(transaction: LedgerTransaction) {
    const [category] = await transaction
      .select({ id: budgetCategories.id })
      .from(budgetCategories)
      .where(and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.systemKey, "uncategorized")))
      .limit(1);
    if (!category) throw new BudgetError("CONFLICT", "The budget system category is unavailable.");
    return category.id;
  }

  async function getExpense(transaction: LedgerTransaction, expenseId: string) {
    const [expense] = await transaction
      .select({ id: expenses.id, amount: expenses.amount, description: expenses.description, occurredOn: outings.occurredOn })
      .from(expenses)
      .innerJoin(outings, and(eq(outings.ledgerScopeId, scope), eq(outings.id, expenses.outingId)))
      .where(and(eq(expenses.ledgerScopeId, scope), eq(expenses.id, expenseId)))
      .limit(1);
    return expense ?? null;
  }

  async function getRepayment(transaction: LedgerTransaction, repaymentId: string) {
    const [repayment] = await transaction
      .select({ id: repayments.id, amount: repayments.amount, paidOn: repayments.paidOn, notes: repayments.notes, friendName: friends.name })
      .from(repayments)
      .innerJoin(friends, and(eq(friends.ledgerScopeId, scope), eq(friends.id, repayments.friendId)))
      .where(and(eq(repayments.ledgerScopeId, scope), eq(repayments.id, repaymentId)))
      .limit(1);
    return repayment ?? null;
  }

  async function expenseLink(transaction: LedgerTransaction, expenseId: string) {
    const [link] = await transaction
      .select({ link: budgetPersonalExpenseSources, transaction: budgetTransactions })
      .from(budgetPersonalExpenseSources)
      .innerJoin(budgetTransactions, and(
        eq(budgetTransactions.ownerUserId, ownerUserId),
        eq(budgetTransactions.id, budgetPersonalExpenseSources.budgetTransactionId),
      ))
      .where(and(eq(budgetPersonalExpenseSources.ownerUserId, ownerUserId), eq(budgetPersonalExpenseSources.expenseId, expenseId)))
      .limit(1);
    return link ?? null;
  }

  async function expenseExcluded(transaction: LedgerTransaction, expenseId: string) {
    const [exclusion] = await transaction
      .select({ expenseId: budgetPersonalExpenseExclusions.expenseId })
      .from(budgetPersonalExpenseExclusions)
      .where(and(eq(budgetPersonalExpenseExclusions.ownerUserId, ownerUserId), eq(budgetPersonalExpenseExclusions.expenseId, expenseId)))
      .limit(1);
    return Boolean(exclusion);
  }

  async function recordExpenseExclusion(transaction: LedgerTransaction, expenseId: string) {
    await transaction
      .insert(budgetPersonalExpenseExclusions)
      .values({ ownerUserId, expenseId })
      .onConflictDoNothing({ target: [budgetPersonalExpenseExclusions.ownerUserId, budgetPersonalExpenseExclusions.expenseId] });
  }

  async function resolveParticipationCategoryId(transaction: LedgerTransaction, categoryId: string | null) {
    if (!categoryId) return null;
    const [category] = await transaction
      .select({ id: budgetCategories.id })
      .from(budgetCategories)
      .where(and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.id, categoryId), isNull(budgetCategories.archivedAt)))
      .limit(1);
    if (!category) throw new BudgetError("NOT_FOUND", "That budget category is no longer available.");
    return category.id;
  }

  /**
   * Applies the creation-time decision, if any, and reports whether this
   * source must stay out of the Budget. Without a decision the persisted
   * exclusion still wins over the legacy "eligible until imported" default.
   */
  async function applyParticipationDecision(
    transaction: LedgerTransaction,
    expenseId: string,
    existing: Awaited<ReturnType<typeof expenseLink>>,
    participation?: ExpenseBudgetParticipation,
  ): Promise<{ excluded: boolean; categoryId: string | null }> {
    if (participation && !participation.includeInBudget) {
      await recordExpenseExclusion(transaction, expenseId);
      return { excluded: true, categoryId: null };
    }
    if (!existing && await expenseExcluded(transaction, expenseId)) return { excluded: true, categoryId: null };
    if (participation?.includeInBudget) return { excluded: false, categoryId: await resolveParticipationCategoryId(transaction, participation.categoryId) };
    return { excluded: false, categoryId: null };
  }

  async function repaymentLink(transaction: LedgerTransaction, repaymentId: string) {
    const [link] = await transaction
      .select({ link: budgetPersonalRepaymentSources, transaction: budgetTransactions })
      .from(budgetPersonalRepaymentSources)
      .innerJoin(budgetTransactions, and(
        eq(budgetTransactions.ownerUserId, ownerUserId),
        eq(budgetTransactions.id, budgetPersonalRepaymentSources.budgetTransactionId),
      ))
      .where(and(eq(budgetPersonalRepaymentSources.ownerUserId, ownerUserId), eq(budgetPersonalRepaymentSources.repaymentId, repaymentId)))
      .limit(1);
    return link ?? null;
  }

  async function lockImpacts(transaction: LedgerTransaction, transactionId: string) {
    return transaction
      .select()
      .from(budgetImpacts)
      .where(and(eq(budgetImpacts.ownerUserId, ownerUserId), eq(budgetImpacts.budgetTransactionId, transactionId)))
      .orderBy(asc(budgetImpacts.targetPeriodOrdinal), asc(budgetImpacts.id))
      .for("update");
  }

  async function createOrSyncTransaction(
    transaction: LedgerTransaction,
    input: { direction: "outflow" | "inflow"; amount: number; description: string; occurredOn: string },
    link: { transaction: BudgetTransactionRecord } | null,
  ) {
    if (link) {
      const [updated] = await transaction
        .update(budgetTransactions)
        .set({ ...input, status: "posted", origin: "linked", voidedAt: null, updatedAt: new Date() })
        .where(and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, link.transaction.id)))
        .returning();
      if (!updated) throw new BudgetError("CONFLICT", "The linked budget transaction is unavailable.");
      return updated;
    }
    const [created] = await transaction
      .insert(budgetTransactions)
      .values({ ownerUserId, ...input, status: "posted", origin: "linked" })
      .returning();
    if (!created) throw new BudgetError("CONFLICT", "The linked budget transaction could not be created.");
    return created;
  }

  async function createExpenseLink(transaction: LedgerTransaction, expenseId: string, transactionId: string) {
    const [created] = await transaction
      .insert(budgetPersonalExpenseSources)
      .values({ ownerUserId, budgetTransactionId: transactionId, expenseId })
      .onConflictDoNothing({ target: [budgetPersonalExpenseSources.ownerUserId, budgetPersonalExpenseSources.expenseId] })
      .returning();
    if (created) return created;
    const [existing] = await transaction
      .select()
      .from(budgetPersonalExpenseSources)
      .where(and(eq(budgetPersonalExpenseSources.ownerUserId, ownerUserId), eq(budgetPersonalExpenseSources.expenseId, expenseId)))
      .limit(1);
    if (!existing) throw new BudgetError("CONFLICT", "The linked expense source could not be created.");
    if (existing.budgetTransactionId !== transactionId) {
      await transaction.delete(budgetTransactions).where(and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, transactionId)));
    }
    return existing;
  }

  async function createRepaymentLink(transaction: LedgerTransaction, repaymentId: string, transactionId: string) {
    const [created] = await transaction
      .insert(budgetPersonalRepaymentSources)
      .values({ ownerUserId, budgetTransactionId: transactionId, repaymentId })
      .onConflictDoNothing({ target: [budgetPersonalRepaymentSources.ownerUserId, budgetPersonalRepaymentSources.repaymentId] })
      .returning();
    if (created) return created;
    const [existing] = await transaction
      .select()
      .from(budgetPersonalRepaymentSources)
      .where(and(eq(budgetPersonalRepaymentSources.ownerUserId, ownerUserId), eq(budgetPersonalRepaymentSources.repaymentId, repaymentId)))
      .limit(1);
    if (!existing) throw new BudgetError("CONFLICT", "The linked repayment source could not be created.");
    if (existing.budgetTransactionId !== transactionId) {
      await transaction.delete(budgetTransactions).where(and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, transactionId)));
    }
    return existing;
  }

  async function reconcileExpenseWithPeriod(transaction: LedgerTransaction, expenseId: string, period: ActivePeriod | null, participation?: ExpenseBudgetParticipation) {
    const expense = await getExpense(transaction, expenseId);
    if (!expense) return;
    const existing = await expenseLink(transaction, expenseId);
    const decision = await applyParticipationDecision(transaction, expenseId, existing, participation);
    if (decision.excluded) return;
    const participationCategoryId = decision.categoryId;
    if (!expense.occurredOn) {
      if (existing && existing.transaction.status === "posted") {
        await transaction.update(budgetTransactions).set({ status: "voided", voidedAt: new Date(), updatedAt: new Date() }).where(and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, existing.transaction.id)));
      }
      return;
    }
    const linkedTransaction = await createOrSyncTransaction(transaction, { direction: "outflow", amount: expense.amount, description: expense.description, occurredOn: expense.occurredOn }, existing);
    if (!existing) await createExpenseLink(transaction, expenseId, linkedTransaction.id);
    const impacts = await lockImpacts(transaction, linkedTransaction.id);
    if (impacts.length === 0 && period && isInside(period, expense.occurredOn)) {
      const categoryId = participationCategoryId ?? await getUncategorizedId(transaction);
      await transaction.insert(budgetImpacts).values({ ownerUserId, budgetTransactionId: linkedTransaction.id, budgetCategoryId: categoryId, budgetPeriodId: period.id, amount: expense.amount, status: "applied", targetPeriodOrdinal: period.ordinal });
    } else if (impacts.length === 1) {
      await transaction.update(budgetImpacts).set({ amount: expense.amount, updatedAt: new Date() }).where(and(eq(budgetImpacts.ownerUserId, ownerUserId), eq(budgetImpacts.id, impacts[0]!.id)));
    } else if (impacts.length > 1) {
      const categoryId = impacts[0]!.budgetCategoryId;
      if (impacts.some((impact) => impact.budgetCategoryId !== categoryId)) throw new LedgerIntegrityError("A spread Personal expense has inconsistent Budget categories.");
      let amounts: number[];
      try {
        amounts = splitBudgetAmount(expense.amount, impacts.length);
      } catch {
        throw new LedgerIntegrityError("A spread Personal expense cannot be distributed into positive impacts.");
      }
      for (const [index, impact] of impacts.entries()) {
        await transaction.update(budgetImpacts).set({ amount: amounts[index], updatedAt: new Date() }).where(and(eq(budgetImpacts.ownerUserId, ownerUserId), eq(budgetImpacts.id, impact.id)));
      }
    }
  }

  async function repaymentCategoryDistribution(transaction: LedgerTransaction, repaymentId: string, amount: number) {
    const allocationRows = await transaction
      .select({ amount: repaymentAllocations.amount, expenseId: expenseShares.expenseId })
      .from(repaymentAllocations)
      .innerJoin(expenseShares, and(eq(expenseShares.ledgerScopeId, scope), eq(expenseShares.id, repaymentAllocations.expenseShareId)))
      .innerJoin(expenses, and(eq(expenses.ledgerScopeId, scope), eq(expenses.id, expenseShares.expenseId)))
      .where(and(eq(repaymentAllocations.ledgerScopeId, scope), eq(repaymentAllocations.repaymentId, repaymentId)))
      .orderBy(asc(repaymentAllocations.expenseShareId));
    const expenseIds = uniqueIds(allocationRows.map((row) => row.expenseId));
    const categoryRows = expenseIds.length
      ? await transaction
          .select({ expenseId: budgetPersonalExpenseSources.expenseId, categoryId: budgetImpacts.budgetCategoryId, archivedAt: budgetCategories.archivedAt })
          .from(budgetPersonalExpenseSources)
          .innerJoin(expenses, and(eq(expenses.ledgerScopeId, scope), eq(expenses.id, budgetPersonalExpenseSources.expenseId)))
          .innerJoin(budgetTransactions, and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, budgetPersonalExpenseSources.budgetTransactionId), eq(budgetTransactions.status, "posted")))
          .innerJoin(budgetImpacts, and(eq(budgetImpacts.ownerUserId, ownerUserId), eq(budgetImpacts.budgetTransactionId, budgetTransactions.id)))
          .innerJoin(budgetCategories, and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.id, budgetImpacts.budgetCategoryId)))
          .where(and(eq(budgetPersonalExpenseSources.ownerUserId, ownerUserId), inArray(budgetPersonalExpenseSources.expenseId, expenseIds)))
      : [];
    const categoryByExpense = new Map<string, string>();
    const seenCategoryByExpense = new Map<string, string>();
    for (const row of categoryRows) {
      const seen = seenCategoryByExpense.get(row.expenseId);
      if (seen && seen !== row.categoryId) throw new LedgerIntegrityError("A Personal expense has inconsistent spread Budget categories.");
      seenCategoryByExpense.set(row.expenseId, row.categoryId);
      if (!row.archivedAt) categoryByExpense.set(row.expenseId, row.categoryId);
    }
    const uncategorizedId = await getUncategorizedId(transaction);
    return buildRepaymentBudgetDistribution(amount, allocationRows, uncategorizedId, categoryByExpense);
  }

  async function reconcileRepaymentWithPeriod(transaction: LedgerTransaction, repaymentId: string, period: ActivePeriod | null) {
    const repayment = await getRepayment(transaction, repaymentId);
    if (!repayment) return;
    const existing = await repaymentLink(transaction, repaymentId);
    if (!repayment.paidOn) {
      if (existing && existing.transaction.status === "posted") {
        await transaction.update(budgetTransactions).set({ status: "voided", voidedAt: new Date(), updatedAt: new Date() }).where(and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, existing.transaction.id)));
      }
      return;
    }
    const description = repayment.notes?.trim().slice(0, 240) || `Repayment from ${repayment.friendName}`;
    const linkedTransaction = await createOrSyncTransaction(transaction, { direction: "inflow", amount: repayment.amount, description, occurredOn: repayment.paidOn }, existing);
    if (!existing) await createRepaymentLink(transaction, repaymentId, linkedTransaction.id);
    const impacts = await lockImpacts(transaction, linkedTransaction.id);
    if (impacts.length === 0 && (!period || !isInside(period, repayment.paidOn))) return;
    const distribution = await repaymentCategoryDistribution(transaction, repaymentId, repayment.amount);
    if (impacts.length > 0) {
      const assignedPeriodId = impacts[0]!.budgetPeriodId;
      const assignedOrdinal = impacts[0]!.targetPeriodOrdinal;
      await transaction.delete(budgetImpacts).where(and(eq(budgetImpacts.ownerUserId, ownerUserId), eq(budgetImpacts.budgetTransactionId, linkedTransaction.id)));
      for (const [categoryId, impactAmount] of distribution) {
        await transaction.insert(budgetImpacts).values({ ownerUserId, budgetTransactionId: linkedTransaction.id, budgetCategoryId: categoryId, budgetPeriodId: assignedPeriodId, amount: impactAmount, status: "applied", targetPeriodOrdinal: assignedOrdinal });
      }
    } else {
      if (!period) throw new BudgetError("NOT_FOUND", "No active budget period is available.");
      for (const [categoryId, impactAmount] of distribution) {
        await transaction.insert(budgetImpacts).values({ ownerUserId, budgetTransactionId: linkedTransaction.id, budgetCategoryId: categoryId, budgetPeriodId: period.id, amount: impactAmount, status: "applied", targetPeriodOrdinal: period.ordinal });
      }
    }
  }

  async function reconcileExpense(transaction: LedgerTransaction, expenseId: string, participation?: ExpenseBudgetParticipation) {
    const period = await lockProfileAndPeriod(transaction);
    if (period !== undefined) await reconcileExpenseWithPeriod(transaction, expenseId, period, participation);
  }

  async function reconcileRepayment(transaction: LedgerTransaction, repaymentId: string) {
    const period = await lockProfileAndPeriod(transaction);
    if (period !== undefined) await reconcileRepaymentWithPeriod(transaction, repaymentId, period);
  }

  async function reconcileRepayments(transaction: LedgerTransaction, repaymentIds: string[]) {
    const period = await lockProfileAndPeriod(transaction);
    if (period === undefined) return;
    for (const repaymentId of uniqueIds(repaymentIds)) await reconcileRepaymentWithPeriod(transaction, repaymentId, period);
  }

  async function reconcileRepaymentsForExpense(transaction: LedgerTransaction, expenseId: string) {
    const repaymentRows = await transaction
      .select({ repaymentId: repaymentAllocations.repaymentId })
      .from(repaymentAllocations)
      .innerJoin(expenseShares, and(eq(expenseShares.ledgerScopeId, scope), eq(expenseShares.id, repaymentAllocations.expenseShareId), eq(expenseShares.expenseId, expenseId)))
      .where(eq(repaymentAllocations.ledgerScopeId, scope));
    const period = await lockProfileAndPeriod(transaction);
    if (period === undefined) return;
    for (const repaymentId of uniqueIds(repaymentRows.map((row) => row.repaymentId))) await reconcileRepaymentWithPeriod(transaction, repaymentId, period);
  }

  async function reconcileOuting(transaction: LedgerTransaction, outingId: string) {
    const expenseRows = await transaction
      .select({ id: expenses.id })
      .from(expenses)
      .where(and(eq(expenses.ledgerScopeId, scope), eq(expenses.outingId, outingId)))
      .orderBy(asc(expenses.id));
    const period = await lockProfileAndPeriod(transaction);
    if (period === undefined) return;
    for (const expense of expenseRows) await reconcileExpenseWithPeriod(transaction, expense.id, period);
  }

  async function voidExpense(transaction: LedgerTransaction, expenseId: string) {
    if (!await lockProfile(transaction)) return;
    const existing = await expenseLink(transaction, expenseId);
    if (existing?.transaction.status === "posted") {
      await transaction.update(budgetTransactions).set({ status: "voided", voidedAt: new Date(), updatedAt: new Date() }).where(and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, existing.transaction.id)));
    }
  }

  async function voidExpenses(transaction: LedgerTransaction, expenseIds: string[]) {
    if (!await lockProfile(transaction)) return;
    for (const expenseId of uniqueIds(expenseIds)) {
      const existing = await expenseLink(transaction, expenseId);
      if (existing?.transaction.status === "posted") {
        await transaction.update(budgetTransactions).set({ status: "voided", voidedAt: new Date(), updatedAt: new Date() }).where(and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, existing.transaction.id)));
      }
    }
  }

  async function voidRepayment(transaction: LedgerTransaction, repaymentId: string) {
    if (!await lockProfile(transaction)) return;
    const existing = await repaymentLink(transaction, repaymentId);
    if (existing?.transaction.status === "posted") {
      await transaction.update(budgetTransactions).set({ status: "voided", voidedAt: new Date(), updatedAt: new Date() }).where(and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, existing.transaction.id)));
    }
  }

  return { reconcileExpense, reconcileRepayment, reconcileRepayments, reconcileRepaymentsForExpense, reconcileOuting, voidExpense, voidExpenses, voidRepayment };
}

export async function changePersonalExpenseBudgetCategory(database: Database, ownerUserId: string, scope: string, transactionId: string, categoryId: string) {
  return database.transaction(async (transaction) => {
    await lockBudgetProfile(transaction as Database, ownerUserId);
    const [category] = await transaction
      .select()
      .from(budgetCategories)
      .where(and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.id, categoryId), isNull(budgetCategories.archivedAt)))
      .limit(1)
      .for("update");
    if (!category) throw new BudgetError("NOT_FOUND", "That budget category is no longer available.");
    const [source] = await transaction
      .select({ source: budgetPersonalExpenseSources, transaction: budgetTransactions, expenseId: expenses.id })
      .from(budgetPersonalExpenseSources)
      .innerJoin(budgetTransactions, and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, budgetPersonalExpenseSources.budgetTransactionId)))
      .innerJoin(expenses, and(eq(expenses.ledgerScopeId, scope), eq(expenses.id, budgetPersonalExpenseSources.expenseId)))
      .where(and(eq(budgetPersonalExpenseSources.ownerUserId, ownerUserId), eq(budgetPersonalExpenseSources.budgetTransactionId, transactionId), eq(budgetTransactions.status, "posted")))
      .limit(1);
    if (!source) throw new BudgetError("NOT_FOUND", "That linked Personal expense is no longer available.");
    const [lockedTransaction] = await transaction
      .select()
      .from(budgetTransactions)
      .where(and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, transactionId), eq(budgetTransactions.status, "posted")))
      .limit(1)
      .for("update");
    if (!lockedTransaction) throw new BudgetError("NOT_FOUND", "That linked Personal expense is no longer available.");
    const impacts = await transaction
      .select()
      .from(budgetImpacts)
      .where(and(eq(budgetImpacts.ownerUserId, ownerUserId), eq(budgetImpacts.budgetTransactionId, transactionId)))
      .orderBy(asc(budgetImpacts.id))
      .for("update");
    if (impacts.length > 0) {
      await transaction.update(budgetImpacts).set({ budgetCategoryId: category.id, updatedAt: new Date() }).where(and(eq(budgetImpacts.ownerUserId, ownerUserId), eq(budgetImpacts.budgetTransactionId, transactionId)));
    } else {
      const [period] = await transaction.select().from(budgetPeriods).where(and(eq(budgetPeriods.ownerUserId, ownerUserId), eq(budgetPeriods.status, "active"))).limit(1).for("update");
      if (!period) throw new BudgetError("NOT_FOUND", "No active budget period is available.");
      await transaction.insert(budgetImpacts).values({ ownerUserId, budgetTransactionId: transactionId, budgetCategoryId: category.id, budgetPeriodId: period.id, amount: lockedTransaction.amount, status: "applied", targetPeriodOrdinal: period.ordinal });
    }
    const integration = createPersonalBudgetIntegration(ownerUserId, scope);
    await integration.reconcileRepaymentsForExpense(transaction as LedgerTransaction, source.expenseId);
    return lockedTransaction;
  });
}

export async function hasImportablePersonalActivity(database: Database, ownerUserId: string, scope: string, period: Pick<ActivePeriod, "startsOn" | "endsOn">) {
  const [expensesCount, repaymentsCount] = await Promise.all([
    database
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(expenses)
      .innerJoin(outings, and(eq(outings.ledgerScopeId, scope), eq(outings.id, expenses.outingId)))
      .where(and(
        eq(expenses.ledgerScopeId, scope),
        gte(outings.occurredOn, period.startsOn),
        lte(outings.occurredOn, period.endsOn),
        sql`not exists (select 1 from ${budgetPersonalExpenseSources} source where source.owner_user_id = ${ownerUserId} and source.expense_id = ${expenses.id})`,
        sql`not exists (select 1 from ${budgetPersonalExpenseExclusions} exclusion where exclusion.owner_user_id = ${ownerUserId} and exclusion.expense_id = ${expenses.id})`,
      )),
    database
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(repayments)
      .where(and(
        eq(repayments.ledgerScopeId, scope),
        gte(repayments.paidOn, period.startsOn),
        lte(repayments.paidOn, period.endsOn),
        sql`not exists (select 1 from ${budgetPersonalRepaymentSources} source where source.owner_user_id = ${ownerUserId} and source.repayment_id = ${repayments.id})`,
      )),
  ]);
  return Number(expensesCount[0]?.count ?? 0) + Number(repaymentsCount[0]?.count ?? 0) > 0;
}

export async function hasImportableBudgetActivity(database: Database, ownerUserId: string, scope: string | null, period: Pick<ActivePeriod, "startsOn" | "endsOn">) {
  const personal = scope ? await hasImportablePersonalActivity(database, ownerUserId, scope, period) : false;
  const { hasImportableGroupActivity } = await import("./sources-group");
  return personal || await hasImportableGroupActivity(database, ownerUserId, period);
}

export async function importBudgetActivity(database: Database, ownerUserId: string, scope: string | null) {
  const { importGroupActivity } = await import("./sources-group");
  return database.transaction(async (transaction) => {
    const [profile] = await transaction
      .select({ ownerUserId: budgetProfiles.ownerUserId })
      .from(budgetProfiles)
      .where(eq(budgetProfiles.ownerUserId, ownerUserId))
      .limit(1)
      .for("update");
    if (!profile) throw new BudgetError("NOT_CONFIGURED", "Budgeting is not configured.");
    const [period] = await transaction
      .select()
      .from(budgetPeriods)
      .where(and(eq(budgetPeriods.ownerUserId, ownerUserId), eq(budgetPeriods.status, "active")))
      .limit(1)
      .for("update");
    if (!period) throw new BudgetError("NOT_FOUND", "No active budget period is available.");
    let expenseCount = 0;
    let repaymentCount = 0;
    if (scope) {
      const expenseRows = await transaction
        .select({ id: expenses.id })
        .from(expenses)
        .innerJoin(outings, and(eq(outings.ledgerScopeId, scope), eq(outings.id, expenses.outingId)))
        .where(and(eq(expenses.ledgerScopeId, scope), gte(outings.occurredOn, period.startsOn), lte(outings.occurredOn, period.endsOn), sql`not exists (select 1 from ${budgetPersonalExpenseSources} source where source.owner_user_id = ${ownerUserId} and source.expense_id = ${expenses.id})`, sql`not exists (select 1 from ${budgetPersonalExpenseExclusions} exclusion where exclusion.owner_user_id = ${ownerUserId} and exclusion.expense_id = ${expenses.id})`))
        .orderBy(asc(outings.occurredOn), asc(expenses.id));
      const repaymentRows = await transaction
        .select({ id: repayments.id })
        .from(repayments)
        .where(and(eq(repayments.ledgerScopeId, scope), gte(repayments.paidOn, period.startsOn), lte(repayments.paidOn, period.endsOn), sql`not exists (select 1 from ${budgetPersonalRepaymentSources} source where source.owner_user_id = ${ownerUserId} and source.repayment_id = ${repayments.id})`))
        .orderBy(asc(repayments.paidOn), asc(repayments.id));
      const integration = createPersonalBudgetIntegration(ownerUserId, scope);
      for (const expense of expenseRows) await integration.reconcileExpense(transaction as LedgerTransaction, expense.id);
      for (const repayment of repaymentRows) await integration.reconcileRepayment(transaction as LedgerTransaction, repayment.id);
      expenseCount = expenseRows.length;
      repaymentCount = repaymentRows.length;
    }
    const group = await importGroupActivity(transaction as LedgerTransaction, ownerUserId, period);
    return { expenseCount, repaymentCount, groupExpenseCount: group.expenseCount, groupSettlementCount: group.settlementCount };
  });
}

export async function importPersonalActivity(database: Database, ownerUserId: string, scope: string) {
  return database.transaction(async (transaction) => {
    const [profile] = await transaction
      .select({ ownerUserId: budgetProfiles.ownerUserId })
      .from(budgetProfiles)
      .where(eq(budgetProfiles.ownerUserId, ownerUserId))
      .limit(1)
      .for("update");
    if (!profile) throw new BudgetError("NOT_CONFIGURED", "Budgeting is not configured.");
    const [period] = await transaction.select().from(budgetPeriods).where(and(eq(budgetPeriods.ownerUserId, ownerUserId), eq(budgetPeriods.status, "active"))).limit(1).for("update");
    if (!period) throw new BudgetError("NOT_FOUND", "No active budget period is available.");
    const expenseRows = await transaction
      .select({ id: expenses.id })
      .from(expenses)
      .innerJoin(outings, and(eq(outings.ledgerScopeId, scope), eq(outings.id, expenses.outingId)))
      .where(and(eq(expenses.ledgerScopeId, scope), gte(outings.occurredOn, period.startsOn), lte(outings.occurredOn, period.endsOn), sql`not exists (select 1 from ${budgetPersonalExpenseSources} source where source.owner_user_id = ${ownerUserId} and source.expense_id = ${expenses.id})`, sql`not exists (select 1 from ${budgetPersonalExpenseExclusions} exclusion where exclusion.owner_user_id = ${ownerUserId} and exclusion.expense_id = ${expenses.id})`))
      .orderBy(asc(outings.occurredOn), asc(expenses.id));
    const repaymentRows = await transaction
      .select({ id: repayments.id })
      .from(repayments)
      .where(and(eq(repayments.ledgerScopeId, scope), gte(repayments.paidOn, period.startsOn), lte(repayments.paidOn, period.endsOn), sql`not exists (select 1 from ${budgetPersonalRepaymentSources} source where source.owner_user_id = ${ownerUserId} and source.repayment_id = ${repayments.id})`))
      .orderBy(asc(repayments.paidOn), asc(repayments.id));
    const integration = createPersonalBudgetIntegration(ownerUserId, scope);
    for (const expense of expenseRows) await integration.reconcileExpense(transaction as LedgerTransaction, expense.id);
    for (const repayment of repaymentRows) await integration.reconcileRepayment(transaction as LedgerTransaction, repayment.id);
    return { expenseCount: expenseRows.length, repaymentCount: repaymentRows.length };
  });
}

/**
 * Private Budget participation for one Personal expense, read for the expense
 * detail surface. `unprocessed` means no decision and no link: a legacy source
 * that existing import/reconciliation behavior may still absorb.
 */
export async function getPersonalExpenseBudgetState(database: Database, ownerUserId: string, scope: string, expenseId: string): Promise<PersonalExpenseBudgetState> {
  const [link] = await database
    .select({
      transactionId: budgetTransactions.id,
      categoryId: budgetImpacts.budgetCategoryId,
      categoryName: budgetCategories.name,
    })
    .from(budgetPersonalExpenseSources)
    .innerJoin(expenses, and(eq(expenses.ledgerScopeId, scope), eq(expenses.id, budgetPersonalExpenseSources.expenseId)))
    .innerJoin(budgetTransactions, and(
      eq(budgetTransactions.ownerUserId, ownerUserId),
      eq(budgetTransactions.id, budgetPersonalExpenseSources.budgetTransactionId),
      eq(budgetTransactions.status, "posted"),
    ))
    .leftJoin(budgetImpacts, and(eq(budgetImpacts.ownerUserId, ownerUserId), eq(budgetImpacts.budgetTransactionId, budgetTransactions.id)))
    .leftJoin(budgetCategories, and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.id, budgetImpacts.budgetCategoryId)))
    .where(and(eq(budgetPersonalExpenseSources.ownerUserId, ownerUserId), eq(budgetPersonalExpenseSources.expenseId, expenseId)))
    .orderBy(asc(budgetImpacts.targetPeriodOrdinal), asc(budgetImpacts.id))
    .limit(1);
  if (link) {
    return {
      status: "included",
      transactionId: link.transactionId,
      categoryId: link.categoryId ?? null,
      categoryName: link.categoryName ?? "Uncategorized",
    };
  }
  const [exclusion] = await database
    .select({ expenseId: budgetPersonalExpenseExclusions.expenseId })
    .from(budgetPersonalExpenseExclusions)
    .where(and(eq(budgetPersonalExpenseExclusions.ownerUserId, ownerUserId), eq(budgetPersonalExpenseExclusions.expenseId, expenseId)))
    .limit(1);
  return exclusion ? { status: "not_included" } : { status: "unprocessed" };
}
