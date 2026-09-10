import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import { budgetCategories, budgetGroupExpenseSources, budgetGroupSettlementSources, budgetImpacts, budgetPeriodCategories, budgetPeriods, budgetPersonalExpenseSources, budgetPersonalRepaymentSources, budgetTransactions } from "@/db/schema";
import { summarizeBudgetCategories, type BudgetTransactionView } from "@/domain/budgeting/types";
import { BudgetError } from "@/domain/budgeting/errors";
import { isValidBudgetDate } from "@/domain/budgeting/dates";
import { MAX_RUPIAH } from "@/domain/budgeting/amounts";
import { splitBudgetAmount } from "@/domain/budgeting/spread";
import type { LedgerTransaction } from "@/domain/ledger/mutation-hooks";
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

export async function voidBudgetTransaction(database: Database, ownerUserId: string, transactionId: string) {
  return database.transaction(async (transaction) => {
    await lockBudgetProfile(transaction as Database, ownerUserId);
    const [record] = await transaction.select().from(budgetTransactions).where(and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, transactionId))).limit(1).for("update");
    if (!record || (record.origin !== "manual" && record.origin !== "recurring") || record.status !== "posted") throw new BudgetError("NOT_FOUND", "That budget transaction is no longer available.");
    const [updated] = await transaction.update(budgetTransactions).set({ status: "voided", voidedAt: new Date(), updatedAt: new Date() }).where(and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, transactionId))).returning();
    return updated ?? record;
  });
}

function isSpreadSource(origin: string, sourceType: BudgetTransactionView["sourceType"]) {
  return origin === "manual" || sourceType === "personal_expense" || sourceType === "group_expense";
}

type SpreadTransactionRow = {
  direction: BudgetTransactionView["direction"];
  status: BudgetTransactionView["status"];
  origin: BudgetTransactionView["origin"];
  expenseId: string | null;
  repaymentId: string | null;
  groupExpenseId: string | null;
  groupSettlementId: string | null;
};

function sourceTypeFor(row: SpreadTransactionRow): BudgetTransactionView["sourceType"] {
  if (row.expenseId) return "personal_expense";
  if (row.repaymentId) return "personal_repayment";
  if (row.groupExpenseId) return "group_expense";
  if (row.groupSettlementId) return row.direction === "outflow" ? "group_payment_sent" : "group_payment_received";
  if (row.origin === "recurring") return "recurring";
  if (row.origin === "linked") return row.direction === "outflow" ? "personal_expense" : "personal_repayment";
  return "manual";
}

async function spreadSourceType(transaction: LedgerTransaction, ownerUserId: string, record: typeof budgetTransactions.$inferSelect) {
  if (record.origin === "manual") return "manual" as const;
  if (record.origin !== "linked") throw new BudgetError("CONFLICT", "This budget transaction is not eligible for spreading.");
  const [personalExpense] = await transaction.select({ id: budgetPersonalExpenseSources.expenseId }).from(budgetPersonalExpenseSources).where(and(eq(budgetPersonalExpenseSources.ownerUserId, ownerUserId), eq(budgetPersonalExpenseSources.budgetTransactionId, record.id))).limit(1);
  if (personalExpense) return "personal_expense" as const;
  const [groupExpense] = await transaction.select({ id: budgetGroupExpenseSources.groupExpenseId }).from(budgetGroupExpenseSources).where(and(eq(budgetGroupExpenseSources.ownerUserId, ownerUserId), eq(budgetGroupExpenseSources.budgetTransactionId, record.id))).limit(1);
  if (groupExpense) return "group_expense" as const;
  throw new BudgetError("CONFLICT", "This budget transaction is not eligible for spreading.");
}

function restructurableImpact(period: typeof budgetPeriods.$inferSelect, impacts: Array<typeof budgetImpacts.$inferSelect>) {
  const categoryIds = new Set(impacts.map((impact) => impact.budgetCategoryId));
  const applied = impacts.filter((impact) => impact.status === "applied");
  const pending = impacts.filter((impact) => impact.status === "pending");
  const current = applied[0];
  const valid = impacts.length > 0
    && categoryIds.size === 1
    && applied.length === 1
    && Boolean(current)
    && current.budgetPeriodId === period.id
    && current.targetPeriodOrdinal === period.ordinal
    && pending.every((impact) => impact.budgetPeriodId === null && impact.targetPeriodOrdinal > period.ordinal)
    && impacts.length === new Set(impacts.map((impact) => impact.targetPeriodOrdinal)).size
    && impacts.every((impact, index) => impact.targetPeriodOrdinal === period.ordinal + index);
  if (!valid) throw new BudgetError("CONFLICT", "This spread is already committed and cannot be restructured.");
  return current!;
}

function spreadPresentation(row: SpreadTransactionRow, sourceType: BudgetTransactionView["sourceType"], impacts: Array<{ categoryId: string; status: string; periodId: string | null; targetPeriodOrdinal: number }>, activePeriod: { id: string; ordinal: number } | undefined) {
  const sameCategory = impacts.length > 0 && new Set(impacts.map((impact) => impact.categoryId)).size === 1;
  const restructurable = isSpreadSource(row.origin, sourceType);
  const eligible = (restructurable || row.origin === "recurring") && row.direction === "outflow" && row.status === "posted";
  const applied = impacts.filter((impact) => impact.status === "applied");
  const pending = impacts.filter((impact) => impact.status === "pending");
  const spread = eligible && sameCategory && impacts.length > 1;
  const canChange = eligible
    && restructurable
    && sameCategory
    && applied.length === 1
    && Boolean(activePeriod)
    && applied[0]?.periodId === activePeriod?.id
    && pending.every((impact) => impact.targetPeriodOrdinal > activePeriod!.ordinal);
  return { spreadCount: spread ? impacts.length : null, pendingImpactCount: spread ? pending.length : 0, spreadCanChange: canChange, spreadLocked: spread && (applied.length > 1 || !restructurable) };
}

export async function spreadBudgetTransaction(database: Database, ownerUserId: string, transactionId: string, count: number) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 24) throw new BudgetError("INVALID_INPUT", "Choose between 1 and 24 periods.");
  return database.transaction(async (transaction) => {
    await lockBudgetProfile(transaction as Database, ownerUserId);
    const [period] = await transaction.select().from(budgetPeriods).where(and(eq(budgetPeriods.ownerUserId, ownerUserId), eq(budgetPeriods.status, "active"))).limit(1).for("update");
    if (!period) throw new BudgetError("NOT_FOUND", "No active budget period is available.");
    const [record] = await transaction.select().from(budgetTransactions).where(and(eq(budgetTransactions.ownerUserId, ownerUserId), eq(budgetTransactions.id, transactionId))).limit(1).for("update");
    if (!record || record.status !== "posted" || record.direction !== "outflow") throw new BudgetError("CONFLICT", "Only posted outflows can be spread across periods.");
    await spreadSourceType(transaction, ownerUserId, record);

    const impacts = await transaction.select().from(budgetImpacts)
      .where(and(eq(budgetImpacts.ownerUserId, ownerUserId), eq(budgetImpacts.budgetTransactionId, record.id)))
      .orderBy(asc(budgetImpacts.targetPeriodOrdinal), asc(budgetImpacts.id))
      .for("update");
    const current = restructurableImpact(period, impacts);
    const [plan] = await transaction.select({ id: budgetPeriodCategories.budgetCategoryId }).from(budgetPeriodCategories).where(and(eq(budgetPeriodCategories.ownerUserId, ownerUserId), eq(budgetPeriodCategories.budgetPeriodId, period.id), eq(budgetPeriodCategories.budgetCategoryId, current!.budgetCategoryId))).limit(1);
    if (!plan) throw new BudgetError("CONFLICT", "The transaction category is not available in the active period.");

    let amounts: number[];
    try {
      amounts = splitBudgetAmount(record.amount, count);
    } catch {
      throw new BudgetError("INVALID_INPUT", "The spread count cannot exceed the transaction amount.");
    }
    await transaction.update(budgetImpacts).set({ amount: amounts[0]!, updatedAt: new Date() }).where(and(eq(budgetImpacts.ownerUserId, ownerUserId), eq(budgetImpacts.id, current!.id)));
    await transaction.delete(budgetImpacts).where(and(eq(budgetImpacts.ownerUserId, ownerUserId), eq(budgetImpacts.budgetTransactionId, record.id), eq(budgetImpacts.status, "pending")));
    if (count > 1) {
      await transaction.insert(budgetImpacts).values(amounts.slice(1).map((amount, index) => ({
        ownerUserId,
        budgetTransactionId: record.id,
        budgetCategoryId: current!.budgetCategoryId,
        budgetPeriodId: null,
        amount,
        status: "pending" as const,
        targetPeriodOrdinal: period.ordinal + index + 1,
      })));
    }
    return { transaction: record, count };
  });
}

export async function listBudgetTransactions(database: Database, ownerUserId: string, limit = 100): Promise<BudgetTransactionView[]> {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const [activePeriod, transactionRows] = await Promise.all([
    database.select({ id: budgetPeriods.id, ordinal: budgetPeriods.ordinal }).from(budgetPeriods).where(and(eq(budgetPeriods.ownerUserId, ownerUserId), eq(budgetPeriods.status, "active"))).limit(1),
    database.select({
    id: budgetTransactions.id,
    direction: budgetTransactions.direction,
    amount: budgetTransactions.amount,
    description: budgetTransactions.description,
    occurredOn: budgetTransactions.occurredOn,
    status: budgetTransactions.status,
    origin: budgetTransactions.origin,
    expenseId: budgetPersonalExpenseSources.expenseId,
    repaymentId: budgetPersonalRepaymentSources.repaymentId,
    groupExpenseId: budgetGroupExpenseSources.groupExpenseId,
    groupSettlementId: budgetGroupSettlementSources.groupSettlementId,
    }).from(budgetTransactions)
    .leftJoin(budgetPersonalExpenseSources, and(eq(budgetPersonalExpenseSources.ownerUserId, ownerUserId), eq(budgetPersonalExpenseSources.budgetTransactionId, budgetTransactions.id)))
    .leftJoin(budgetPersonalRepaymentSources, and(eq(budgetPersonalRepaymentSources.ownerUserId, ownerUserId), eq(budgetPersonalRepaymentSources.budgetTransactionId, budgetTransactions.id)))
    .leftJoin(budgetGroupExpenseSources, and(eq(budgetGroupExpenseSources.ownerUserId, ownerUserId), eq(budgetGroupExpenseSources.budgetTransactionId, budgetTransactions.id)))
    .leftJoin(budgetGroupSettlementSources, and(eq(budgetGroupSettlementSources.ownerUserId, ownerUserId), eq(budgetGroupSettlementSources.budgetTransactionId, budgetTransactions.id)))
    .where(eq(budgetTransactions.ownerUserId, ownerUserId))
    .orderBy(desc(budgetTransactions.occurredOn), desc(budgetTransactions.id))
      .limit(boundedLimit),
  ]);
  if (transactionRows.length === 0) return [];
  const impactRows = await database.select({
    transactionId: budgetImpacts.budgetTransactionId,
    categoryId: budgetCategories.id,
    categoryName: budgetCategories.name,
    status: budgetImpacts.status,
    periodId: budgetImpacts.budgetPeriodId,
    targetPeriodOrdinal: budgetImpacts.targetPeriodOrdinal,
  }).from(budgetImpacts)
    .innerJoin(budgetCategories, and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.id, budgetImpacts.budgetCategoryId)))
    .where(and(eq(budgetImpacts.ownerUserId, ownerUserId), inArray(budgetImpacts.budgetTransactionId, transactionRows.map((row) => row.id))));
  const categoriesByTransaction = new Map<string, Array<{ id: string; name: string }>>();
  const impactsByTransaction = new Map<string, typeof impactRows>();
  for (const row of impactRows) {
    const categories = categoriesByTransaction.get(row.transactionId) ?? [];
    if (!categories.some((category) => category.id === row.categoryId)) categories.push({ id: row.categoryId, name: row.categoryName });
    categoriesByTransaction.set(row.transactionId, categories);
    impactsByTransaction.set(row.transactionId, [...(impactsByTransaction.get(row.transactionId) ?? []), row]);
  }
  return transactionRows.map((row) => {
    const categories = categoriesByTransaction.get(row.id) ?? [];
    const sourceType = sourceTypeFor(row);
    const transactionImpacts = impactsByTransaction.get(row.id) ?? [];
    const currentPeriod = activePeriod[0];
    const spreadState = spreadPresentation(row, sourceType, transactionImpacts, currentPeriod);
    return {
      id: row.id,
      direction: row.direction,
      amount: row.amount,
      description: row.description,
      occurredOn: row.occurredOn,
      status: row.status,
      origin: row.origin,
      sourceType,
      sourceId: row.expenseId ?? row.repaymentId ?? row.groupExpenseId ?? row.groupSettlementId ?? null,
      categoryName: summarizeBudgetCategories(categories.map((category) => category.name)),
      categoryNames: categories.map((category) => category.name),
      categoryId: categories.length === 1 ? categories[0]!.id : null,
      ...spreadState,
    } satisfies BudgetTransactionView;
  });
}
