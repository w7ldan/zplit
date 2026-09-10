import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { budgetCategories, budgetImpacts, budgetPeriodCategories, budgetPeriods, budgetTransactions } from "@/db/schema";
import { categoryNetSpent, netBudgetSpent, remainingBudget, sumBudgetAppliedAmounts } from "@/domain/budgeting/reporting";
import type { BudgetCategoryPlan, BudgetPeriodHistorySummary, BudgetPeriodSummary, BudgetTransactionView } from "@/domain/budgeting/types";
import type { PendingBudgetImpactPreview } from "./periods";
import { getBudgetProfile } from "./profiles";
import { getActiveBudgetPeriod, listPendingBudgetImpactPreview } from "./periods";
import { listBudgetTransactions } from "./transactions";
import { createLedgerSummaryRepository } from "@/domain/ledger/summary";
import { getPersonalLedgerScopeId, LedgerScopeError } from "@/server/ledger-scopes";
import { hasImportableBudgetActivity } from "./sources-personal";
import type { GroupBudgetObligation } from "./sources-group";

function amount(value: string | number | null | undefined) {
  return Number(value ?? 0);
}

type GroupSharedMoney = { expectedBack: number; stillOwe: number; obligations: GroupBudgetObligation[] };

type BudgetDashboard =
  | { configured: false }
  | { configured: true; period: BudgetPeriodSummary; recentTransactions: BudgetTransactionView[]; expectedBack: number; stillOwe: number; groupObligations: GroupBudgetObligation[]; importAvailable: boolean; pendingNextPeriod: PendingBudgetImpactPreview[] }
  | { configured: true; period: null };

async function groupSharedMoney(database: Database, ownerUserId: string): Promise<GroupSharedMoney> {
  const { readGroupBudgetSharedMoney } = await import("./sources-group");
  return readGroupBudgetSharedMoney(database, ownerUserId);
}

export async function getBudgetDashboard(database: Database, ownerUserId: string): Promise<BudgetDashboard> {
  if (!(await getBudgetProfile(database, ownerUserId))) return { configured: false };
  const period = await getActiveBudgetPeriod(database, ownerUserId);
  if (!period) return { configured: true, period: null };
  const personalScopeId = await getPersonalLedgerScopeId(database, ownerUserId).catch((error: unknown) => {
    if (error instanceof LedgerScopeError && error.code === "personal_scope_missing") return null;
    throw error;
  });
  const [personalSummary, importAvailable, groupMoney] = personalScopeId
    ? await Promise.all([
      createLedgerSummaryRepository(database, personalScopeId).getLedgerSummary(),
      hasImportableBudgetActivity(database, ownerUserId, personalScopeId, period),
      groupSharedMoney(database, ownerUserId),
    ])
    : await Promise.all([
      Promise.resolve({ totalOutstandingAmount: 0 }),
      hasImportableBudgetActivity(database, ownerUserId, null, period),
      groupSharedMoney(database, ownerUserId),
    ]);
  const [plans, impactRows, recentTransactions, pendingNextPeriod] = await Promise.all([
    database.select({
      id: budgetCategories.id,
      name: budgetCategories.name,
      systemKey: budgetCategories.systemKey,
      allocatedAmount: budgetPeriodCategories.allocatedAmount,
      displayOrder: budgetPeriodCategories.displayOrder,
    }).from(budgetPeriodCategories).innerJoin(budgetCategories, and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.id, budgetPeriodCategories.budgetCategoryId))).where(and(eq(budgetPeriodCategories.ownerUserId, ownerUserId), eq(budgetPeriodCategories.budgetPeriodId, period.id))).orderBy(asc(budgetPeriodCategories.displayOrder), asc(budgetCategories.name)),
    database.select({
      categoryId: budgetImpacts.budgetCategoryId,
      direction: budgetTransactions.direction,
      amount: sql<string>`coalesce(sum(${budgetImpacts.amount}), 0)::text`,
    }).from(budgetImpacts)
      .innerJoin(budgetTransactions, and(
        eq(budgetTransactions.ownerUserId, ownerUserId),
        eq(budgetTransactions.id, budgetImpacts.budgetTransactionId),
        eq(budgetTransactions.status, "posted"),
      ))
      .where(and(
        eq(budgetImpacts.ownerUserId, ownerUserId),
        eq(budgetImpacts.budgetPeriodId, period.id),
        eq(budgetImpacts.status, "applied"),
      ))
      .groupBy(budgetImpacts.budgetCategoryId, budgetTransactions.direction),
    listBudgetTransactions(database, ownerUserId, 5),
    listPendingBudgetImpactPreview(database, ownerUserId, period.ordinal + 1),
  ]);
  const byCategory = new Map<string, { outflow: number; inflow: number }>();
  for (const row of impactRows) {
    const totals = byCategory.get(row.categoryId) ?? { outflow: 0, inflow: 0 };
    totals[row.direction] = amount(row.amount);
    byCategory.set(row.categoryId, totals);
  }
  const categories: BudgetCategoryPlan[] = plans.map((plan) => {
    const totals = byCategory.get(plan.id) ?? { outflow: 0, inflow: 0 };
    const netSpent = categoryNetSpent(totals.outflow, totals.inflow);
    return { ...plan, outflowApplied: totals.outflow, inflowApplied: totals.inflow, netSpent, remaining: plan.allocatedAmount - netSpent };
  });
  const overall = sumBudgetAppliedAmounts(impactRows.map((row) => ({ direction: row.direction, amount: amount(row.amount) })));
  const netSpent = netBudgetSpent(overall.outflow, overall.inflow);
  return {
    configured: true,
    period: {
      id: period.id,
      ordinal: period.ordinal,
      name: period.name,
      startsOn: period.startsOn,
      endsOn: period.endsOn,
      updatedAt: period.updatedAt.toISOString(),
      totalBudget: period.totalBudget,
      totalAllocated: categories.reduce((sum, category) => sum + category.allocatedAmount, 0),
      unallocatedBudget: period.totalBudget - categories.reduce((sum, category) => sum + category.allocatedAmount, 0),
      outflowApplied: overall.outflow,
      inflowApplied: overall.inflow,
      netSpent,
      remaining: remainingBudget(period.totalBudget, netSpent),
      categories,
    },
    recentTransactions,
    expectedBack: personalSummary.totalOutstandingAmount + groupMoney.expectedBack,
    stillOwe: groupMoney.stillOwe,
    groupObligations: groupMoney.obligations,
    importAvailable,
    pendingNextPeriod,
  };
}

export async function listBudgetPeriodHistory(database: Database, ownerUserId: string, limit = 100): Promise<BudgetPeriodHistorySummary[]> {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const periods = await database.select({
    id: budgetPeriods.id,
    ordinal: budgetPeriods.ordinal,
    name: budgetPeriods.name,
    startsOn: budgetPeriods.startsOn,
    endsOn: budgetPeriods.endsOn,
    status: budgetPeriods.status,
    totalBudget: budgetPeriods.totalBudget,
  }).from(budgetPeriods)
    .where(eq(budgetPeriods.ownerUserId, ownerUserId))
    .orderBy(desc(budgetPeriods.ordinal))
    .limit(boundedLimit);
  if (periods.length === 0) return [];
  const periodIds = periods.map((period) => period.id);
  const [plans, impactRows] = await Promise.all([
    database.select({ periodId: budgetPeriodCategories.budgetPeriodId, categoryId: budgetCategories.id, categoryName: budgetCategories.name, allocatedAmount: budgetPeriodCategories.allocatedAmount, displayOrder: budgetPeriodCategories.displayOrder })
      .from(budgetPeriodCategories)
      .innerJoin(budgetCategories, and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.id, budgetPeriodCategories.budgetCategoryId)))
      .where(and(eq(budgetPeriodCategories.ownerUserId, ownerUserId), inArray(budgetPeriodCategories.budgetPeriodId, periodIds)))
      .orderBy(asc(budgetPeriodCategories.budgetPeriodId), asc(budgetPeriodCategories.displayOrder), asc(budgetCategories.name)),
    database.select({ periodId: budgetImpacts.budgetPeriodId, categoryId: budgetCategories.id, categoryName: budgetCategories.name, direction: budgetTransactions.direction, amount: sql<string>`sum(${budgetImpacts.amount})::text` })
      .from(budgetImpacts)
      .innerJoin(budgetTransactions, and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, budgetImpacts.budgetTransactionId), eq(budgetTransactions.status, "posted")))
      .innerJoin(budgetCategories, and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.id, budgetImpacts.budgetCategoryId)))
      .where(and(eq(budgetImpacts.ownerUserId, ownerUserId), inArray(budgetImpacts.budgetPeriodId, periodIds), eq(budgetImpacts.status, "applied")))
      .groupBy(budgetImpacts.budgetPeriodId, budgetCategories.id, budgetCategories.name, budgetTransactions.direction)
      .orderBy(asc(budgetImpacts.budgetPeriodId), asc(budgetCategories.name), asc(budgetCategories.id), asc(budgetTransactions.direction)),
  ]);
  const totalsByPeriod = new Map<string, { outflow: number; inflow: number }>();
  const categoriesByPeriod = new Map<string, Map<string, { id: string; name: string; outflow: number; inflow: number }>>();
  for (const row of impactRows) {
    if (!row.periodId) continue;
    const totals = totalsByPeriod.get(row.periodId) ?? { outflow: 0, inflow: 0 };
    totals[row.direction] += Number(row.amount);
    totalsByPeriod.set(row.periodId, totals);
    const categories = categoriesByPeriod.get(row.periodId) ?? new Map();
    const category = categories.get(row.categoryId) ?? { id: row.categoryId, name: row.categoryName, outflow: 0, inflow: 0 };
    category[row.direction] += Number(row.amount);
    categories.set(row.categoryId, category);
    categoriesByPeriod.set(row.periodId, categories);
  }
  const plansByPeriod = new Map<string, typeof plans>();
  for (const row of plans) plansByPeriod.set(row.periodId, [...(plansByPeriod.get(row.periodId) ?? []), row]);
  return periods.map((period) => {
    const totals = totalsByPeriod.get(period.id) ?? { outflow: 0, inflow: 0 };
    const netSpent = netBudgetSpent(totals.outflow, totals.inflow);
    const plannedCategoryIds = new Set((plansByPeriod.get(period.id) ?? []).map((plan) => plan.categoryId));
    const plannedCategories = (plansByPeriod.get(period.id) ?? []).map((plan) => {
      const applied = categoriesByPeriod.get(period.id)?.get(plan.categoryId) ?? { name: plan.categoryName, outflow: 0, inflow: 0 };
      const categoryNet = categoryNetSpent(applied.outflow, applied.inflow);
      return { id: plan.categoryId, name: plan.categoryName, allocatedAmount: plan.allocatedAmount, outflowApplied: applied.outflow, inflowApplied: applied.inflow, netSpent: categoryNet, remaining: plan.allocatedAmount - categoryNet };
    });
    const impactOnlyCategories = [...(categoriesByPeriod.get(period.id)?.values() ?? [])]
      .filter((category) => !plannedCategoryIds.has(category.id))
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
      .map((category) => {
        const categoryNet = categoryNetSpent(category.outflow, category.inflow);
        return { id: category.id, name: category.name, allocatedAmount: 0, outflowApplied: category.outflow, inflowApplied: category.inflow, netSpent: categoryNet, remaining: 0 - categoryNet };
      });
    return { ...period, netSpent, remaining: remainingBudget(period.totalBudget, netSpent), categories: [...plannedCategories, ...impactOnlyCategories] };
  });
}
