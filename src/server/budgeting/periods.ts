import { and, asc, eq, gte, gt, lt, lte, or, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  budgetCategories,
  budgetGroupExpenseSources,
  budgetGroupSettlementSources,
  budgetImpacts,
  budgetPeriods,
  budgetPeriodCategories,
  budgetPersonalExpenseSources,
  budgetPersonalRepaymentSources,
  budgetTransactions,
} from "@/db/schema";
import { BudgetError } from "@/domain/budgeting/errors";
import { isValidBudgetDate } from "@/domain/budgeting/dates";
import { MAX_RUPIAH } from "@/domain/budgeting/amounts";
import type { BudgetRecurringTransitionSelection } from "@/domain/budgeting/recurrence";
import type { LedgerTransaction } from "@/domain/ledger/mutation-hooks";
import { lockBudgetProfile } from "./locks";
import { absorbZeroImpactRecurringActivity, materializeRecurringOccurrencesForPeriod } from "./recurring";

export type BudgetPeriodUpdate = { name: string; startsOn: string; endsOn: string; totalBudget: number };

export type StartNextBudgetPeriodInput = {
  expectedActivePeriodId: string;
  name: string;
  startsOn: string;
  endsOn: string;
  totalBudget: number;
  allocations: Array<{ categoryId: string; allocatedAmount: number }>;
  recurrence?: BudgetRecurringTransitionSelection[];
};

export type PendingBudgetImpactPreview = { categoryId: string; categoryName: string; amount: number };

function isValidPeriodUpdate(input: BudgetPeriodUpdate, name: string) {
  return Boolean(name)
    && name.length <= 120
    && isValidBudgetDate(input.startsOn)
    && isValidBudgetDate(input.endsOn)
    && input.startsOn <= input.endsOn
    && Number.isSafeInteger(input.totalBudget)
    && input.totalBudget >= 1
    && input.totalBudget <= MAX_RUPIAH;
}

export async function getActiveBudgetPeriod(database: Database, ownerUserId: string) {
  const [period] = await database.select().from(budgetPeriods).where(and(eq(budgetPeriods.ownerUserId, ownerUserId), eq(budgetPeriods.status, "active"))).limit(1);
  return period ?? null;
}

export async function updateActiveBudgetPeriod(database: Database, ownerUserId: string, input: BudgetPeriodUpdate) {
  const name = input.name.trim();
  if (!isValidPeriodUpdate(input, name)) {
    throw new BudgetError("INVALID_INPUT", "Enter a period name, a valid date range, and a total budget.");
  }
  return database.transaction(async (transaction) => {
    await lockBudgetProfile(transaction as Database, ownerUserId);
    const [period] = await transaction.select().from(budgetPeriods).where(and(eq(budgetPeriods.ownerUserId, ownerUserId), eq(budgetPeriods.status, "active"))).limit(1).for("update");
    if (!period) throw new BudgetError("NOT_FOUND", "No active budget period is available.");
    await rejectPeriodOverlap(transaction as Database, ownerUserId, period, input.startsOn);
    const [allocationTotal] = await transaction.select({ total: sql<string>`coalesce(sum(${budgetPeriodCategories.allocatedAmount}), 0)::text` }).from(budgetPeriodCategories).where(and(eq(budgetPeriodCategories.ownerUserId, ownerUserId), eq(budgetPeriodCategories.budgetPeriodId, period.id)));
    if (Number(allocationTotal?.total ?? 0) > input.totalBudget) throw new BudgetError("ALLOCATION_EXCEEDS_BUDGET", "The total budget cannot be lower than current category allocations.");
    if (input.startsOn !== period.startsOn || input.endsOn !== period.endsOn) {
      const [excludedTransaction] = await transaction
        .select({ id: budgetTransactions.id })
        .from(budgetTransactions)
        .innerJoin(budgetImpacts, and(eq(budgetImpacts.ownerUserId, ownerUserId), eq(budgetImpacts.budgetTransactionId, budgetTransactions.id), eq(budgetImpacts.budgetPeriodId, period.id)))
        .where(and(
          eq(budgetTransactions.ownerUserId, ownerUserId),
          eq(budgetTransactions.status, "posted"),
          eq(budgetTransactions.origin, "manual"),
          or(lt(budgetTransactions.occurredOn, input.startsOn), gt(budgetTransactions.occurredOn, input.endsOn)),
        ))
        .limit(1);
      if (excludedTransaction) throw new BudgetError("CONFLICT", "The date range cannot exclude a posted budget transaction.");
    }
    const [updated] = await transaction.update(budgetPeriods).set({ name, startsOn: input.startsOn, endsOn: input.endsOn, totalBudget: input.totalBudget, updatedAt: new Date() }).where(and(eq(budgetPeriods.ownerUserId, ownerUserId), eq(budgetPeriods.id, period.id))).returning();
    return updated ?? period;
  });
}

export async function rejectPeriodOverlap(transaction: Database, ownerUserId: string, period: typeof budgetPeriods.$inferSelect, startsOn = period.startsOn) {
  if (period.ordinal <= 1) return;
  const [previous] = await transaction.select({ endsOn: budgetPeriods.endsOn }).from(budgetPeriods).where(and(eq(budgetPeriods.ownerUserId, ownerUserId), eq(budgetPeriods.ordinal, period.ordinal - 1), eq(budgetPeriods.status, "closed"))).limit(1);
  if (previous && startsOn <= previous.endsOn) throw new BudgetError("CONFLICT", "The active period overlaps the previous closed period.");
}

function validateTransitionInput(input: StartNextBudgetPeriodInput) {
  const name = input.name.trim();
  if (!input.expectedActivePeriodId.trim() || !name || name.length > 120 || !isValidBudgetDate(input.startsOn) || !isValidBudgetDate(input.endsOn) || input.startsOn > input.endsOn) {
    throw new BudgetError("INVALID_INPUT", "Enter a period name and a valid date range.");
  }
  if (!Number.isSafeInteger(input.totalBudget) || input.totalBudget < 1 || input.totalBudget > MAX_RUPIAH) {
    throw new BudgetError("INVALID_INPUT", "Total budget must be a whole Rupiah amount greater than zero.");
  }
  return name;
}

function validateTransitionAllocations(input: StartNextBudgetPeriodInput, rows: Array<{ plan: typeof budgetPeriodCategories.$inferSelect; category: typeof budgetCategories.$inferSelect }>) {
  if (rows.filter((row) => row.category.systemKey === "uncategorized").length !== 1) throw new BudgetError("CONFLICT", "The budget system category is unavailable.");
  if (input.allocations.length !== rows.length || new Set(input.allocations.map((allocation) => allocation.categoryId)).size !== rows.length) {
    throw new BudgetError("NOT_FOUND", "The category plan changed. Reload before starting the next period.");
  }
  const currentIds = new Set(rows.map((row) => row.category.id));
  const allocationById = new Map<string, number>();
  for (const allocation of input.allocations) {
    if (!currentIds.has(allocation.categoryId) || !Number.isSafeInteger(allocation.allocatedAmount) || allocation.allocatedAmount < 0 || allocation.allocatedAmount > MAX_RUPIAH) {
      throw new BudgetError("INVALID_INPUT", "Every category needs a valid non-negative allocation.");
    }
    allocationById.set(allocation.categoryId, allocation.allocatedAmount);
  }
  const total = [...allocationById.values()].reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total) || total > input.totalBudget) throw new BudgetError("ALLOCATION_EXCEEDS_BUDGET", "Category allocations cannot exceed the total budget.");
  return allocationById;
}

async function zeroImpactPersonalExpenseIds(transaction: LedgerTransaction, ownerUserId: string, startsOn: string, endsOn: string) {
  const rows = await transaction.select({ id: budgetPersonalExpenseSources.expenseId }).from(budgetPersonalExpenseSources)
    .innerJoin(budgetTransactions, and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, budgetPersonalExpenseSources.budgetTransactionId)))
    .where(and(eq(budgetPersonalExpenseSources.ownerUserId, ownerUserId), eq(budgetTransactions.status, "posted"), gte(budgetTransactions.occurredOn, startsOn), lte(budgetTransactions.occurredOn, endsOn), sql`not exists (select 1 from ${budgetImpacts} impact where impact.owner_user_id = ${ownerUserId} and impact.budget_transaction_id = ${budgetTransactions.id})`))
    .orderBy(asc(budgetTransactions.occurredOn), asc(budgetPersonalExpenseSources.expenseId));
  return rows.map((row) => row.id);
}

async function zeroImpactPersonalRepaymentIds(transaction: LedgerTransaction, ownerUserId: string, startsOn: string, endsOn: string) {
  const rows = await transaction.select({ id: budgetPersonalRepaymentSources.repaymentId }).from(budgetPersonalRepaymentSources)
    .innerJoin(budgetTransactions, and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, budgetPersonalRepaymentSources.budgetTransactionId)))
    .where(and(eq(budgetPersonalRepaymentSources.ownerUserId, ownerUserId), eq(budgetTransactions.status, "posted"), gte(budgetTransactions.occurredOn, startsOn), lte(budgetTransactions.occurredOn, endsOn), sql`not exists (select 1 from ${budgetImpacts} impact where impact.owner_user_id = ${ownerUserId} and impact.budget_transaction_id = ${budgetTransactions.id})`))
    .orderBy(asc(budgetTransactions.occurredOn), asc(budgetPersonalRepaymentSources.repaymentId));
  return rows.map((row) => row.id);
}

async function zeroImpactGroupExpenseIds(transaction: LedgerTransaction, ownerUserId: string, startsOn: string, endsOn: string) {
  const rows = await transaction.select({ id: budgetGroupExpenseSources.groupExpenseId }).from(budgetGroupExpenseSources)
    .innerJoin(budgetTransactions, and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, budgetGroupExpenseSources.budgetTransactionId)))
    .where(and(eq(budgetGroupExpenseSources.ownerUserId, ownerUserId), eq(budgetTransactions.status, "posted"), gte(budgetTransactions.occurredOn, startsOn), lte(budgetTransactions.occurredOn, endsOn), sql`not exists (select 1 from ${budgetImpacts} impact where impact.owner_user_id = ${ownerUserId} and impact.budget_transaction_id = ${budgetTransactions.id})`))
    .orderBy(asc(budgetTransactions.occurredOn), asc(budgetGroupExpenseSources.groupExpenseId));
  return rows.map((row) => row.id);
}

async function zeroImpactGroupSettlementIds(transaction: LedgerTransaction, ownerUserId: string, startsOn: string, endsOn: string) {
  const rows = await transaction.select({ id: budgetGroupSettlementSources.groupSettlementId }).from(budgetGroupSettlementSources)
    .innerJoin(budgetTransactions, and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, budgetGroupSettlementSources.budgetTransactionId)))
    .where(and(eq(budgetGroupSettlementSources.ownerUserId, ownerUserId), eq(budgetTransactions.status, "posted"), gte(budgetTransactions.occurredOn, startsOn), lte(budgetTransactions.occurredOn, endsOn), sql`not exists (select 1 from ${budgetImpacts} impact where impact.owner_user_id = ${ownerUserId} and impact.budget_transaction_id = ${budgetTransactions.id})`))
    .orderBy(asc(budgetTransactions.occurredOn), asc(budgetGroupSettlementSources.groupSettlementId));
  return rows.map((row) => row.id);
}

async function absorbZeroImpactActivity(transaction: LedgerTransaction, ownerUserId: string, period: typeof budgetPeriods.$inferSelect) {
  const personalExpenseIds = await zeroImpactPersonalExpenseIds(transaction, ownerUserId, period.startsOn, period.endsOn);
  const personalRepaymentIds = await zeroImpactPersonalRepaymentIds(transaction, ownerUserId, period.startsOn, period.endsOn);
  const groupExpenseIds = await zeroImpactGroupExpenseIds(transaction, ownerUserId, period.startsOn, period.endsOn);
  const groupSettlementIds = await zeroImpactGroupSettlementIds(transaction, ownerUserId, period.startsOn, period.endsOn);
  if (personalExpenseIds.length || personalRepaymentIds.length) {
    const { getPersonalLedgerScopeId, LedgerScopeError } = await import("@/server/ledger-scopes");
    const scope = await getPersonalLedgerScopeId(transaction as Database, ownerUserId).catch((error: unknown) => {
      if (error instanceof LedgerScopeError && error.code === "personal_scope_missing") return null;
      throw error;
    });
    if (scope) {
      const { createPersonalBudgetIntegration } = await import("./sources-personal");
      const integration = createPersonalBudgetIntegration(ownerUserId, scope);
      for (const expenseId of personalExpenseIds) await integration.reconcileExpense(transaction, expenseId);
      for (const repaymentId of personalRepaymentIds) await integration.reconcileRepayment(transaction, repaymentId);
    }
  }
  if (groupExpenseIds.length || groupSettlementIds.length) {
    const { reconcileGroupExpense, reconcileGroupSettlement } = await import("./sources-group");
    for (const expenseId of groupExpenseIds) await reconcileGroupExpense(transaction, expenseId);
    for (const settlementId of groupSettlementIds) await reconcileGroupSettlement(transaction, settlementId, [ownerUserId]);
  }
  return personalExpenseIds.length + personalRepaymentIds.length + groupExpenseIds.length + groupSettlementIds.length;
}

export async function startNextBudgetPeriod(database: Database, ownerUserId: string, input: StartNextBudgetPeriodInput) {
  const name = validateTransitionInput(input);
  return database.transaction(async (transaction) => {
    await lockBudgetProfile(transaction as Database, ownerUserId);
    const [current] = await transaction.select().from(budgetPeriods).where(and(eq(budgetPeriods.ownerUserId, ownerUserId), eq(budgetPeriods.status, "active"))).limit(1).for("update");
    if (!current) throw new BudgetError("NOT_FOUND", "No active budget period is available.");
    if (current.id !== input.expectedActivePeriodId) throw new BudgetError("CONFLICT", "This period changed in another request. Reload before starting the next period.");
    if (input.startsOn <= current.endsOn) throw new BudgetError("INVALID_INPUT", "The next period must start after the current period ends.");

    const rows = await transaction.select({ plan: budgetPeriodCategories, category: budgetCategories })
      .from(budgetPeriodCategories)
      .innerJoin(budgetCategories, and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.id, budgetPeriodCategories.budgetCategoryId)))
      .where(and(eq(budgetPeriodCategories.ownerUserId, ownerUserId), eq(budgetPeriodCategories.budgetPeriodId, current.id)))
      .orderBy(asc(budgetPeriodCategories.displayOrder), asc(budgetCategories.name))
      .for("update") as Array<{ plan: typeof budgetPeriodCategories.$inferSelect; category: typeof budgetCategories.$inferSelect }>;
    const allocationById = validateTransitionAllocations(input, rows);
    const nextOrdinal = current.ordinal + 1;
    const pending = await transaction.select({ impact: budgetImpacts, parentStatus: budgetTransactions.status })
      .from(budgetImpacts)
      .innerJoin(budgetTransactions, and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, budgetImpacts.budgetTransactionId)))
      .where(and(eq(budgetImpacts.ownerUserId, ownerUserId), eq(budgetImpacts.targetPeriodOrdinal, nextOrdinal), eq(budgetImpacts.status, "pending")))
      .orderBy(asc(budgetImpacts.id))
      .for("update");
    const categoryIds = new Set(rows.map((row) => row.category.id));
    if (pending.some((row) => !categoryIds.has(row.impact.budgetCategoryId))) throw new BudgetError("CONFLICT", "A pending budget impact targets a category missing from the next plan.");

    await transaction.update(budgetPeriods).set({ status: "closed", updatedAt: new Date() }).where(and(eq(budgetPeriods.ownerUserId, ownerUserId), eq(budgetPeriods.id, current.id), eq(budgetPeriods.status, "active")));
    const [next] = await transaction.insert(budgetPeriods).values({ ownerUserId, ordinal: nextOrdinal, name, startsOn: input.startsOn, endsOn: input.endsOn, totalBudget: input.totalBudget, status: "active" }).returning();
    if (!next) throw new BudgetError("CONFLICT", "The next budget period could not be created.");
    await transaction.insert(budgetPeriodCategories).values(rows.map((row) => ({ ownerUserId, budgetPeriodId: next.id, budgetCategoryId: row.category.id, allocatedAmount: allocationById.get(row.category.id)!, displayOrder: row.plan.displayOrder })));
    for (const row of pending) {
      if (row.parentStatus !== "posted") continue;
      await transaction.update(budgetImpacts).set({ status: "applied", budgetPeriodId: next.id, updatedAt: new Date() }).where(and(eq(budgetImpacts.ownerUserId, ownerUserId), eq(budgetImpacts.id, row.impact.id), eq(budgetImpacts.status, "pending")));
    }
    const absorbedCount = await absorbZeroImpactActivity(transaction as LedgerTransaction, ownerUserId, next);
    const uncategorizedId = rows.find((row) => row.category.systemKey === "uncategorized")!.category.id;
    const absorbedRecurringCount = await absorbZeroImpactRecurringActivity(transaction as Database, ownerUserId, next, categoryIds, uncategorizedId);
    const recurrence = await materializeRecurringOccurrencesForPeriod(transaction as Database, ownerUserId, next, categoryIds, uncategorizedId, input.recurrence ?? []);
    return {
      previousPeriod: current,
      period: next,
      appliedPendingCount: pending.filter((row) => row.parentStatus === "posted").length,
      absorbedCount,
      absorbedRecurringCount,
      recurrence,
    };
  });
}

export async function listPendingBudgetImpactPreview(database: Database, ownerUserId: string, targetPeriodOrdinal: number): Promise<PendingBudgetImpactPreview[]> {
  const rows = await database.select({ categoryId: budgetCategories.id, categoryName: budgetCategories.name, amount: sql<string>`sum(${budgetImpacts.amount})::text` })
    .from(budgetImpacts)
    .innerJoin(budgetTransactions, and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, budgetImpacts.budgetTransactionId), eq(budgetTransactions.status, "posted")))
    .innerJoin(budgetCategories, and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.id, budgetImpacts.budgetCategoryId)))
    .where(and(eq(budgetImpacts.ownerUserId, ownerUserId), eq(budgetImpacts.targetPeriodOrdinal, targetPeriodOrdinal), eq(budgetImpacts.status, "pending")))
    .groupBy(budgetCategories.id, budgetCategories.name)
    .orderBy(asc(budgetCategories.name), asc(budgetCategories.id));
  return rows.map((row) => ({ categoryId: row.categoryId, categoryName: row.categoryName, amount: Number(row.amount) }));
}
