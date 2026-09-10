import { and, asc, eq, gt, lt, or, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { budgetCategories, budgetImpacts, budgetPeriodCategories, budgetPeriods, budgetTransactions } from "@/db/schema";
import { canonicalBudgetCategoryName, normalizeBudgetCategoryName } from "@/domain/budgeting/categories";
import { BudgetError } from "@/domain/budgeting/errors";
import { MAX_RUPIAH } from "@/domain/budgeting/amounts";
import { isValidBudgetDate } from "@/domain/budgeting/dates";
import { lockBudgetProfile } from "./locks";
import { rejectPeriodOverlap } from "./periods";

export type BudgetPlanCategoryUpdate = { id: string; name: string; allocatedAmount: number };
export type BudgetPlanUpdate = {
  period: { name: string; startsOn: string; endsOn: string; totalBudget: number };
  expectedPeriodUpdatedAt: string;
  categories: BudgetPlanCategoryUpdate[];
  newCategory?: { name: string; allocatedAmount: number };
};

type PlanRow = {
  plan: typeof budgetPeriodCategories.$inferSelect;
  category: typeof budgetCategories.$inferSelect;
};

function isValidAllocation(value: number) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_RUPIAH;
}

function isValidCategoryDraft(category: { name: string; allocatedAmount: number }) {
  const name = canonicalBudgetCategoryName(category.name);
  return Boolean(name) && name.length <= 80 && isValidAllocation(category.allocatedAmount);
}

function validatePlanCategories(input: BudgetPlanUpdate, rows: PlanRow[]) {
  const currentIds = new Set(rows.map((row) => row.category.id));
  if (input.categories.length !== rows.length || new Set(input.categories.map((category) => category.id)).size !== rows.length || input.categories.some((category) => !currentIds.has(category.id))) throw new BudgetError("NOT_FOUND", "One or more budget categories are no longer available.");
  if (!input.categories.every(isValidCategoryDraft) || (input.newCategory !== undefined && !isValidCategoryDraft(input.newCategory))) throw new BudgetError("INVALID_INPUT", "Category names and allocations must be valid.");
  const systemRows = rows.filter((row) => row.category.systemKey === "uncategorized");
  if (systemRows.length !== 1) throw new BudgetError("CONFLICT", "The budget system category is unavailable.");
  const systemCategory = systemRows[0].category;
  if (systemCategory.name !== "Uncategorized" || systemCategory.normalizedName !== "uncategorized") throw new BudgetError("SYSTEM_CATEGORY_IMMUTABLE", "Uncategorized cannot be changed.");
  const submittedSystem = input.categories.find((category) => category.id === systemCategory.id);
  if (!submittedSystem || canonicalBudgetCategoryName(submittedSystem.name) !== "Uncategorized") throw new BudgetError("SYSTEM_CATEGORY_IMMUTABLE", "Uncategorized cannot be changed.");
  const names = input.categories.map((category) => normalizeBudgetCategoryName(category.name));
  if (input.newCategory) names.push(normalizeBudgetCategoryName(input.newCategory.name));
  const hasReservedCustomName = input.categories.some((category) => category.id !== systemCategory.id && normalizeBudgetCategoryName(category.name) === "uncategorized")
    || input.newCategory !== undefined && normalizeBudgetCategoryName(input.newCategory.name) === "uncategorized";
  if (names.some((name) => !name) || new Set(names).size !== names.length || hasReservedCustomName) throw new BudgetError("INVALID_INPUT", "Category names must be unique, and Uncategorized is reserved.");
}

function validatePlanPeriod(input: BudgetPlanUpdate) {
  if (!input.period.name.trim() || input.period.name.trim().length > 120 || !Number.isSafeInteger(input.period.totalBudget) || input.period.totalBudget < 1 || input.period.totalBudget > MAX_RUPIAH) throw new BudgetError("INVALID_INPUT", "Enter a valid period name and total budget.");
  if (!isValidBudgetDate(input.period.startsOn) || !isValidBudgetDate(input.period.endsOn) || input.period.startsOn > input.period.endsOn) throw new BudgetError("INVALID_INPUT", "Enter a valid period date range.");
}

function validatePlanAllocationTotal(input: BudgetPlanUpdate) {
  const total = input.categories.reduce((sum, category) => sum + category.allocatedAmount, 0) + (input.newCategory?.allocatedAmount ?? 0);
  if (total > input.period.totalBudget) throw new BudgetError("ALLOCATION_EXCEEDS_BUDGET", "Category allocations cannot exceed the total budget.");
}

function validateStalePlanAllocation(input: BudgetPlanUpdate, rows: PlanRow[], currentUpdatedAt: string) {
  if (input.expectedPeriodUpdatedAt === currentUpdatedAt) return;
  const currentTotal = rows.reduce((sum, row) => sum + row.plan.allocatedAmount, 0);
  const currentById = new Map(rows.map((row) => [row.category.id, row.plan.allocatedAmount]));
  const requestedIncrease = input.categories.reduce((sum, category) => sum + Math.max(0, category.allocatedAmount - (currentById.get(category.id) ?? 0)), 0) + (input.newCategory?.allocatedAmount ?? 0);
  if (currentTotal + requestedIncrease > input.period.totalBudget) throw new BudgetError("ALLOCATION_EXCEEDS_BUDGET", "Category allocations cannot exceed the total budget.");
  throw new BudgetError("CONFLICT", "This budget changed in another request. Reload and try again.");
}

function validatePlanShape(input: BudgetPlanUpdate, rows: PlanRow[]) {
  validatePlanCategories(input, rows);
  validatePlanPeriod(input);
  validatePlanAllocationTotal(input);
}

async function rejectExcludedPostedTransaction(transaction: Database, ownerUserId: string, periodId: string, startsOn: string, endsOn: string) {
  const [excluded] = await transaction
    .select({ id: budgetTransactions.id })
    .from(budgetTransactions)
    .innerJoin(budgetImpacts, and(eq(budgetImpacts.ownerUserId, ownerUserId), eq(budgetImpacts.budgetTransactionId, budgetTransactions.id), eq(budgetImpacts.budgetPeriodId, periodId)))
    .where(and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.status, "posted"), eq(budgetTransactions.origin, "manual"), or(lt(budgetTransactions.occurredOn, startsOn), gt(budgetTransactions.occurredOn, endsOn))))
    .limit(1);
  if (excluded) throw new BudgetError("CONFLICT", "The date range cannot exclude a posted budget transaction.");
}

async function insertNewCategory(transaction: Database, ownerUserId: string, periodId: string, displayOrder: number, category: { name: string; allocatedAmount: number }) {
  const normalizedName = normalizeBudgetCategoryName(category.name);
  const [existing] = await transaction.select({ id: budgetCategories.id }).from(budgetCategories).where(and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.normalizedName, normalizedName))).limit(1);
  if (existing) throw new BudgetError("CONFLICT", "A category with that name already exists.");
  const [created] = await transaction.insert(budgetCategories).values({ ownerUserId, name: canonicalBudgetCategoryName(category.name), normalizedName }).returning();
  if (!created) throw new BudgetError("CONFLICT", "Category could not be created.");
  await transaction.insert(budgetPeriodCategories).values({ ownerUserId, budgetPeriodId: periodId, budgetCategoryId: created.id, allocatedAmount: category.allocatedAmount, displayOrder });
}

export async function createBudgetCategory(database: Database, ownerUserId: string, name: string, allocatedAmount = 0) {
  if (!isValidCategoryDraft({ name, allocatedAmount }) || normalizeBudgetCategoryName(name) === "uncategorized") throw new BudgetError("INVALID_INPUT", "Enter a custom category and a non-negative allocation.");
  return database.transaction(async (transaction) => {
    await lockBudgetProfile(transaction as Database, ownerUserId);
    const [period] = await transaction.select().from(budgetPeriods).where(and(eq(budgetPeriods.ownerUserId, ownerUserId), eq(budgetPeriods.status, "active"))).limit(1).for("update");
    if (!period) throw new BudgetError("NOT_FOUND", "No active budget period is available.");
    const [total] = await transaction.select({ value: sql<string>`coalesce(sum(${budgetPeriodCategories.allocatedAmount}), 0)::text` }).from(budgetPeriodCategories).where(and(eq(budgetPeriodCategories.ownerUserId, ownerUserId), eq(budgetPeriodCategories.budgetPeriodId, period.id)));
    if (Number(total?.value ?? 0) + allocatedAmount > period.totalBudget) throw new BudgetError("ALLOCATION_EXCEEDS_BUDGET", "Category allocations cannot exceed the total budget.");
    const [order] = await transaction.select({ value: sql<string>`coalesce(max(${budgetPeriodCategories.displayOrder}), -1)::text` }).from(budgetPeriodCategories).where(and(eq(budgetPeriodCategories.ownerUserId, ownerUserId), eq(budgetPeriodCategories.budgetPeriodId, period.id)));
    await insertNewCategory(transaction as Database, ownerUserId, period.id, Number(order?.value ?? -1) + 1, { name, allocatedAmount });
    return period;
  });
}

export async function listBudgetCategoryOptions(database: Database, ownerUserId: string) {
  return database
    .select({ id: budgetCategories.id, name: budgetCategories.name })
    .from(budgetCategories)
    .where(and(eq(budgetCategories.ownerUserId, ownerUserId), sql`${budgetCategories.archivedAt} IS NULL`))
    .orderBy(asc(budgetCategories.name), asc(budgetCategories.id));
}

export async function updateBudgetPlan(database: Database, ownerUserId: string, input: BudgetPlanUpdate) {
  return database.transaction(async (transaction) => {
    await lockBudgetProfile(transaction as Database, ownerUserId);
    const [period] = await transaction.select().from(budgetPeriods).where(and(eq(budgetPeriods.ownerUserId, ownerUserId), eq(budgetPeriods.status, "active"))).limit(1).for("update");
    if (!period) throw new BudgetError("NOT_FOUND", "No active budget period is available.");
    const rows = await transaction
      .select({ plan: budgetPeriodCategories, category: budgetCategories })
      .from(budgetPeriodCategories)
      .innerJoin(budgetCategories, and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.id, budgetPeriodCategories.budgetCategoryId)))
      .where(and(eq(budgetPeriodCategories.ownerUserId, ownerUserId), eq(budgetPeriodCategories.budgetPeriodId, period.id)))
      .for("update") as PlanRow[];
    validatePlanShape(input, rows);
    validateStalePlanAllocation(input, rows, period.updatedAt.toISOString());
    await rejectPeriodOverlap(transaction as Database, ownerUserId, period, input.period.startsOn);
    if (input.period.startsOn !== period.startsOn || input.period.endsOn !== period.endsOn) await rejectExcludedPostedTransaction(transaction as Database, ownerUserId, period.id, input.period.startsOn, input.period.endsOn);
    await transaction.update(budgetPeriods).set({ name: input.period.name.trim(), startsOn: input.period.startsOn, endsOn: input.period.endsOn, totalBudget: input.period.totalBudget, updatedAt: new Date() }).where(and(eq(budgetPeriods.ownerUserId, ownerUserId), eq(budgetPeriods.id, period.id)));
    await updatePlanCategories(transaction as Database, ownerUserId, period.id, input.categories, rows);
    if (input.newCategory) await insertNewCategory(transaction as Database, ownerUserId, period.id, rows.length, input.newCategory);
    return period;
  });
}

async function updatePlanCategories(transaction: Database, ownerUserId: string, periodId: string, updates: BudgetPlanCategoryUpdate[], rows: PlanRow[]) {
  const currentById = new Map(rows.map((row) => [row.category.id, row]));
  for (const update of updates) {
    const existing = currentById.get(update.id);
    if (!existing) continue;
    if (existing.category.systemKey !== "uncategorized") {
      const name = canonicalBudgetCategoryName(update.name);
      await transaction.update(budgetCategories).set({ name, normalizedName: normalizeBudgetCategoryName(name), updatedAt: new Date() }).where(and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.id, update.id)));
    }
    await transaction.update(budgetPeriodCategories).set({ allocatedAmount: update.allocatedAmount, updatedAt: new Date() }).where(and(eq(budgetPeriodCategories.ownerUserId, ownerUserId), eq(budgetPeriodCategories.budgetPeriodId, periodId), eq(budgetPeriodCategories.budgetCategoryId, update.id)));
  }
}
