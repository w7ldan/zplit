import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { budgetCategories, budgetImpacts, budgetPeriodCategories, budgetTransactions } from "@/db/schema";
import { categoryNetSpent, netBudgetSpent, remainingBudget, sumBudgetAppliedAmounts } from "@/domain/budgeting/reporting";
import type { BudgetCategoryPlan, BudgetPeriodSummary, BudgetTransactionView } from "@/domain/budgeting/types";
import { getBudgetProfile } from "./profiles";
import { getActiveBudgetPeriod } from "./periods";
import { listBudgetTransactions } from "./transactions";
import { createLedgerSummaryRepository } from "@/domain/ledger/summary";
import { getPersonalLedgerScopeId, LedgerScopeError } from "@/server/ledger-scopes";
import { hasImportableBudgetActivity } from "./sources-personal";
import type { GroupBudgetObligation } from "./sources-group";

function amount(value: string | number | null | undefined) {
  return Number(value ?? 0);
}

type GroupSharedMoney = { expectedBack: number; stillOwe: number; obligations: GroupBudgetObligation[] };

async function groupSharedMoney(database: Database, ownerUserId: string): Promise<GroupSharedMoney> {
  const { readGroupBudgetSharedMoney } = await import("./sources-group");
  return readGroupBudgetSharedMoney(database, ownerUserId);
}

export async function getBudgetDashboard(database: Database, ownerUserId: string): Promise<{ configured: false } | { configured: true; period: BudgetPeriodSummary; recentTransactions: BudgetTransactionView[]; expectedBack: number; stillOwe: number; groupObligations: GroupBudgetObligation[]; importAvailable: boolean } | { configured: true; period: null }> {
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
  const [plans, impactRows, recentTransactions] = await Promise.all([
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
  };
}
