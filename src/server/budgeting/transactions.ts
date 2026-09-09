import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import { budgetCategories, budgetImpacts, budgetPeriodCategories, budgetPeriods, budgetPersonalExpenseSources, budgetPersonalRepaymentSources, budgetTransactions } from "@/db/schema";
import { summarizeBudgetCategories, type BudgetTransactionView } from "@/domain/budgeting/types";
import { BudgetError } from "@/domain/budgeting/errors";
import { isValidBudgetDate } from "@/domain/budgeting/dates";
import { MAX_RUPIAH } from "@/domain/budgeting/amounts";
import { lockBudgetProfile } from "./locks";

export type CreateBudgetTransactionInput = {
  direction: "outflow" | "inflow";
  amount: number;
  description: string;
  occurredOn: string;
  categoryId: string;
};

function isValidTransactionInput(input: CreateBudgetTransactionInput, description: string) {
  const validDirection = input.direction === "outflow" || input.direction === "inflow";
  return isValidBudgetDate(input.occurredOn)
    && Boolean(description)
    && description.length <= 240
    && Number.isSafeInteger(input.amount)
    && input.amount >= 1
    && input.amount <= MAX_RUPIAH
    && validDirection;
}

export async function createManualBudgetTransaction(database: Database, ownerUserId: string, input: CreateBudgetTransactionInput) {
  const description = input.description.trim();
  if (!isValidTransactionInput(input, description)) throw new BudgetError("INVALID_INPUT", "Enter a valid direction, amount, description, and date.");
  return database.transaction(async (transaction) => {
    await lockBudgetProfile(transaction as Database, ownerUserId);
    const [period] = await transaction.select().from(budgetPeriods).where(and(eq(budgetPeriods.ownerUserId, ownerUserId), eq(budgetPeriods.status, "active"))).limit(1).for("update");
    if (!period) throw new BudgetError("NOT_FOUND", "No active budget period is available.");
    if (input.occurredOn < period.startsOn || input.occurredOn > period.endsOn) throw new BudgetError("TRANSACTION_OUTSIDE_PERIOD", "The transaction date must be within the active period.");
    const [category] = await transaction.select().from(budgetCategories).where(and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.id, input.categoryId))).limit(1).for("update");
    if (!category || category.archivedAt) throw new BudgetError("NOT_FOUND", "That budget category is no longer available.");
    const [plan] = await transaction.select({ categoryId: budgetPeriodCategories.budgetCategoryId }).from(budgetPeriodCategories).where(and(eq(budgetPeriodCategories.ownerUserId, ownerUserId), eq(budgetPeriodCategories.budgetPeriodId, period.id), eq(budgetPeriodCategories.budgetCategoryId, category.id))).limit(1);
    if (!plan) throw new BudgetError("NOT_FOUND", "That budget category is not available in the active period.");
    const [created] = await transaction.insert(budgetTransactions).values({ ownerUserId, direction: input.direction, amount: input.amount, description, occurredOn: input.occurredOn, status: "posted", origin: "manual" }).returning();
    if (!created) throw new BudgetError("CONFLICT", "Transaction could not be created.");
    const [impact] = await transaction.insert(budgetImpacts).values({ ownerUserId, budgetTransactionId: created.id, budgetCategoryId: category.id, budgetPeriodId: period.id, amount: input.amount, status: "applied", targetPeriodOrdinal: period.ordinal }).returning();
    if (!impact) throw new BudgetError("CONFLICT", "Transaction impact could not be created.");
    return created;
  });
}

export async function voidManualBudgetTransaction(database: Database, ownerUserId: string, transactionId: string) {
  return database.transaction(async (transaction) => {
    await lockBudgetProfile(transaction as Database, ownerUserId);
    const [record] = await transaction.select().from(budgetTransactions).where(and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, transactionId))).limit(1).for("update");
    if (!record || record.origin !== "manual" || record.status !== "posted") throw new BudgetError("NOT_FOUND", "That budget transaction is no longer available.");
    const [updated] = await transaction.update(budgetTransactions).set({ status: "voided", voidedAt: new Date(), updatedAt: new Date() }).where(and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, transactionId))).returning();
    return updated ?? record;
  });
}

export async function listBudgetTransactions(database: Database, ownerUserId: string, limit = 100): Promise<BudgetTransactionView[]> {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const transactionRows = await database.select({
    id: budgetTransactions.id,
    direction: budgetTransactions.direction,
    amount: budgetTransactions.amount,
    description: budgetTransactions.description,
    occurredOn: budgetTransactions.occurredOn,
    status: budgetTransactions.status,
    origin: budgetTransactions.origin,
    expenseId: budgetPersonalExpenseSources.expenseId,
    repaymentId: budgetPersonalRepaymentSources.repaymentId,
  }).from(budgetTransactions)
    .leftJoin(budgetPersonalExpenseSources, and(eq(budgetPersonalExpenseSources.ownerUserId, ownerUserId), eq(budgetPersonalExpenseSources.budgetTransactionId, budgetTransactions.id)))
    .leftJoin(budgetPersonalRepaymentSources, and(eq(budgetPersonalRepaymentSources.ownerUserId, ownerUserId), eq(budgetPersonalRepaymentSources.budgetTransactionId, budgetTransactions.id)))
    .where(eq(budgetTransactions.ownerUserId, ownerUserId))
    .orderBy(desc(budgetTransactions.occurredOn), desc(budgetTransactions.id))
    .limit(boundedLimit);
  if (transactionRows.length === 0) return [];
  const impactRows = await database.select({
    transactionId: budgetImpacts.budgetTransactionId,
    categoryId: budgetCategories.id,
    categoryName: budgetCategories.name,
  }).from(budgetImpacts)
    .innerJoin(budgetCategories, and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.id, budgetImpacts.budgetCategoryId)))
    .where(and(eq(budgetImpacts.ownerUserId, ownerUserId), inArray(budgetImpacts.budgetTransactionId, transactionRows.map((row) => row.id))));
  const categoriesByTransaction = new Map<string, Array<{ id: string; name: string }>>();
  for (const row of impactRows) {
    const categories = categoriesByTransaction.get(row.transactionId) ?? [];
    if (!categories.some((category) => category.id === row.categoryId)) categories.push({ id: row.categoryId, name: row.categoryName });
    categoriesByTransaction.set(row.transactionId, categories);
  }
  return transactionRows.map((row) => {
    const categories = categoriesByTransaction.get(row.id) ?? [];
    const sourceType = row.expenseId
      ? "personal_expense"
      : row.repaymentId
        ? "personal_repayment"
        : row.origin === "linked"
          ? row.direction === "outflow" ? "personal_expense" : "personal_repayment"
          : "manual";
    return {
      id: row.id,
      direction: row.direction,
      amount: row.amount,
      description: row.description,
      occurredOn: row.occurredOn,
      status: row.status,
      origin: row.origin,
      sourceType,
      sourceId: row.expenseId ?? row.repaymentId ?? null,
      categoryName: summarizeBudgetCategories(categories.map((category) => category.name)),
      categoryNames: categories.map((category) => category.name),
      categoryId: categories.length === 1 ? categories[0]!.id : null,
    } satisfies BudgetTransactionView;
  });
}
