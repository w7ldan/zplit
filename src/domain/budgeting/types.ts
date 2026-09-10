import type { BudgetPeriodStatus, BudgetTransactionDirection, BudgetTransactionOrigin, BudgetTransactionStatus } from "@/db/schema";

export type BudgetCategoryPlan = {
  id: string;
  name: string;
  systemKey: string | null;
  allocatedAmount: number;
  displayOrder: number;
  outflowApplied: number;
  inflowApplied: number;
  netSpent: number;
  remaining: number;
};

export type BudgetPeriodSummary = {
  id: string;
  ordinal: number;
  name: string;
  startsOn: string;
  endsOn: string;
  updatedAt: string;
  totalBudget: number;
  totalAllocated: number;
  unallocatedBudget: number;
  outflowApplied: number;
  inflowApplied: number;
  netSpent: number;
  remaining: number;
  categories: BudgetCategoryPlan[];
};

export type BudgetPeriodHistoryCategory = {
  id: string;
  name: string;
  allocatedAmount: number;
  outflowApplied: number;
  inflowApplied: number;
  netSpent: number;
  remaining: number;
};

export type BudgetPeriodHistorySummary = {
  id: string;
  ordinal: number;
  name: string;
  startsOn: string;
  endsOn: string;
  status: BudgetPeriodStatus;
  totalBudget: number;
  netSpent: number;
  remaining: number;
  categories: BudgetPeriodHistoryCategory[];
};

export type BudgetTransactionView = {
  id: string;
  direction: BudgetTransactionDirection;
  amount: number;
  description: string;
  occurredOn: string;
  status: BudgetTransactionStatus;
  origin: BudgetTransactionOrigin;
  sourceType: "manual" | "personal_expense" | "personal_repayment" | "group_expense" | "group_payment_sent" | "group_payment_received";
  sourceId: string | null;
  categoryName: string;
  categoryNames: string[];
  categoryId: string | null;
  spreadCount?: number | null;
  pendingImpactCount?: number;
  spreadCanChange?: boolean;
  spreadLocked?: boolean;
};

export function summarizeBudgetCategories(categoryNames: readonly string[]) {
  if (categoryNames.length === 0) return "Not absorbed";
  if (categoryNames.length <= 2) return categoryNames.join(" + ");
  return "Multiple categories";
}
