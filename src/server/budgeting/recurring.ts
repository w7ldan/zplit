import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  budgetCategories,
  budgetImpacts,
  budgetPeriodCategories,
  budgetPeriods,
  budgetRecurringOccurrences,
  budgetRecurringTemplates,
  budgetTransactions,
} from "@/db/schema";
import { BudgetError } from "@/domain/budgeting/errors";
import { MAX_RUPIAH } from "@/domain/budgeting/amounts";
import { isValidBudgetDate } from "@/domain/budgeting/dates";
import { splitBudgetAmount } from "@/domain/budgeting/spread";
import {
  buildRecurringCandidates,
  recurringCandidateKey,
  resolveRecurringOccurrenceCategory,
  scheduledRecurringDates,
  type BudgetRecurringFrequency,
  type BudgetRecurringOccurrenceStatus,
  type BudgetRecurringTemplateRule,
  type BudgetRecurringTransitionSelection,
} from "@/domain/budgeting/recurrence";
import { lockBudgetProfile } from "./locks";

export type BudgetRecurringTemplateInput = {
  name: string;
  amount: number;
  categoryId: string;
  frequency: BudgetRecurringFrequency;
  startsOn: string;
  spreadCount: number;
};

export type BudgetRecurringTemplateView = {
  id: string;
  name: string;
  amount: number;
  categoryId: string;
  categoryName: string;
  frequency: BudgetRecurringFrequency;
  startsOn: string;
  spreadCount: number;
  dueCount: number;
  nextDueOn: string | null;
};

export type BudgetRecurringOccurrenceView = {
  id: string;
  templateId: string;
  templateName: string;
  scheduledOn: string;
  amount: number;
  categoryId: string;
  categoryName: string;
  spreadCount: number;
  status: BudgetRecurringOccurrenceStatus;
  budgetTransactionId: string | null;
};

export type BudgetRecurringDashboardSummary = {
  dueCount: number;
  expectedAmount: number;
  nextDueOn: string | null;
};

function validateTemplateInput(input: BudgetRecurringTemplateInput) {
  const name = input.name.trim();
  if (!name || name.length > 240) throw new BudgetError("INVALID_INPUT", "Enter a name for the recurring expense.");
  if (!Number.isSafeInteger(input.amount) || input.amount < 1 || input.amount > MAX_RUPIAH) {
    throw new BudgetError("INVALID_INPUT", "Enter a whole Rupiah amount greater than zero.");
  }
  if (input.frequency !== "every_budget_period" && input.frequency !== "monthly") throw new BudgetError("INVALID_INPUT", "Choose a recurring frequency.");
  if (!isValidBudgetDate(input.startsOn)) throw new BudgetError("INVALID_INPUT", "Enter a valid start date.");
  if (!Number.isSafeInteger(input.spreadCount) || input.spreadCount < 1 || input.spreadCount > 24 || input.spreadCount > input.amount) {
    throw new BudgetError("INVALID_INPUT", "Spread must be between 1 and 24 periods and cannot exceed the amount.");
  }
  if (!input.categoryId.trim()) throw new BudgetError("INVALID_INPUT", "Choose a category.");
  return { ...input, name };
}

async function activePeriodForUpdate(transaction: Database, ownerUserId: string) {
  const [period] = await transaction.select().from(budgetPeriods)
    .where(and(eq(budgetPeriods.ownerUserId, ownerUserId), eq(budgetPeriods.status, "active")))
    .limit(1)
    .for("update");
  if (!period) throw new BudgetError("NOT_FOUND", "No active budget period is available.");
  return period;
}

async function requireUsableCategory(transaction: Database, ownerUserId: string, periodId: string, categoryId: string) {
  const [category] = await transaction.select().from(budgetCategories)
    .where(and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.id, categoryId)))
    .limit(1)
    .for("update");
  if (!category || category.archivedAt) throw new BudgetError("NOT_FOUND", "That budget category is no longer available.");
  const [plan] = await transaction.select({ categoryId: budgetPeriodCategories.budgetCategoryId }).from(budgetPeriodCategories)
    .where(and(eq(budgetPeriodCategories.ownerUserId, ownerUserId), eq(budgetPeriodCategories.budgetPeriodId, periodId), eq(budgetPeriodCategories.budgetCategoryId, category.id)))
    .limit(1);
  if (!plan) throw new BudgetError("NOT_FOUND", "That budget category is not available in the active period.");
  return category;
}

async function materializeCurrentPeriodOccurrences(transaction: Database, ownerUserId: string, template: typeof budgetRecurringTemplates.$inferSelect, period: typeof budgetPeriods.$inferSelect) {
  const dates = scheduledRecurringDates(template, period);
  if (dates.length === 0) return 0;
  const inserted = await transaction.insert(budgetRecurringOccurrences).values(dates.map((scheduledOn) => ({
    ownerUserId,
    recurringTemplateId: template.id,
    scheduledPeriodId: period.id,
    scheduledOn,
    amount: template.amount,
    categoryId: template.categoryId,
    spreadCount: template.spreadCount,
    status: "due" as const,
  }))).onConflictDoNothing({ target: [budgetRecurringOccurrences.ownerUserId, budgetRecurringOccurrences.recurringTemplateId, budgetRecurringOccurrences.scheduledOn] }).returning({ id: budgetRecurringOccurrences.id });
  return inserted.length;
}

export async function createBudgetRecurringTemplate(database: Database, ownerUserId: string, input: BudgetRecurringTemplateInput) {
  const valid = validateTemplateInput(input);
  return database.transaction(async (transaction) => {
    await lockBudgetProfile(transaction as Database, ownerUserId);
    const period = await activePeriodForUpdate(transaction as Database, ownerUserId);
    await requireUsableCategory(transaction as Database, ownerUserId, period.id, valid.categoryId);
    const [template] = await transaction.insert(budgetRecurringTemplates).values({
      ownerUserId,
      name: valid.name,
      amount: valid.amount,
      categoryId: valid.categoryId,
      frequency: valid.frequency,
      startsOn: valid.startsOn,
      spreadCount: valid.spreadCount,
    }).returning();
    if (!template) throw new BudgetError("CONFLICT", "The recurring expense could not be created.");
    await materializeCurrentPeriodOccurrences(transaction as Database, ownerUserId, template, period);
    return template;
  });
}

export async function updateBudgetRecurringTemplate(database: Database, ownerUserId: string, templateId: string, input: BudgetRecurringTemplateInput) {
  const valid = validateTemplateInput(input);
  return database.transaction(async (transaction) => {
    await lockBudgetProfile(transaction as Database, ownerUserId);
    const period = await activePeriodForUpdate(transaction as Database, ownerUserId);
    await requireUsableCategory(transaction as Database, ownerUserId, period.id, valid.categoryId);
    const [template] = await transaction.select().from(budgetRecurringTemplates)
      .where(and(eq(budgetRecurringTemplates.ownerUserId, ownerUserId), eq(budgetRecurringTemplates.id, templateId)))
      .limit(1)
      .for("update");
    if (!template || template.archivedAt) throw new BudgetError("NOT_FOUND", "That recurring expense is no longer available.");
    const [updated] = await transaction.update(budgetRecurringTemplates).set({
      name: valid.name,
      amount: valid.amount,
      categoryId: valid.categoryId,
      frequency: valid.frequency,
      startsOn: valid.startsOn,
      spreadCount: valid.spreadCount,
      updatedAt: new Date(),
    }).where(and(eq(budgetRecurringTemplates.ownerUserId, ownerUserId), eq(budgetRecurringTemplates.id, templateId))).returning();
    return updated ?? template;
  });
}

export async function archiveBudgetRecurringTemplate(database: Database, ownerUserId: string, templateId: string) {
  return database.transaction(async (transaction) => {
    await lockBudgetProfile(transaction as Database, ownerUserId);
    const [template] = await transaction.select().from(budgetRecurringTemplates)
      .where(and(eq(budgetRecurringTemplates.ownerUserId, ownerUserId), eq(budgetRecurringTemplates.id, templateId)))
      .limit(1)
      .for("update");
    if (!template || template.archivedAt) throw new BudgetError("NOT_FOUND", "That recurring expense is no longer available.");
    const [updated] = await transaction.update(budgetRecurringTemplates).set({ archivedAt: new Date(), updatedAt: new Date() }).where(and(eq(budgetRecurringTemplates.ownerUserId, ownerUserId), eq(budgetRecurringTemplates.id, templateId))).returning();
    return updated ?? template;
  });
}

export async function listBudgetRecurringTemplates(database: Database, ownerUserId: string): Promise<BudgetRecurringTemplateView[]> {
  const templates = await database.select({
    id: budgetRecurringTemplates.id,
    name: budgetRecurringTemplates.name,
    amount: budgetRecurringTemplates.amount,
    categoryId: budgetRecurringTemplates.categoryId,
    categoryName: budgetCategories.name,
    frequency: budgetRecurringTemplates.frequency,
    startsOn: budgetRecurringTemplates.startsOn,
    spreadCount: budgetRecurringTemplates.spreadCount,
  }).from(budgetRecurringTemplates)
    .innerJoin(budgetCategories, and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.id, budgetRecurringTemplates.categoryId)))
    .where(and(eq(budgetRecurringTemplates.ownerUserId, ownerUserId), isNull(budgetRecurringTemplates.archivedAt)))
    .orderBy(asc(budgetRecurringTemplates.name), asc(budgetRecurringTemplates.id));
  if (templates.length === 0) return [];
  const dueRows = await database.select({
    templateId: budgetRecurringOccurrences.recurringTemplateId,
    dueCount: sql<string>`count(*)::text`,
    nextDueOn: sql<string | null>`min(${budgetRecurringOccurrences.scheduledOn})::text`,
  }).from(budgetRecurringOccurrences)
    .where(and(
      eq(budgetRecurringOccurrences.ownerUserId, ownerUserId),
      eq(budgetRecurringOccurrences.status, "due"),
      inArray(budgetRecurringOccurrences.recurringTemplateId, templates.map((template) => template.id)),
    ))
    .groupBy(budgetRecurringOccurrences.recurringTemplateId);
  const dueByTemplate = new Map(dueRows.map((row) => [row.templateId, row]));
  return templates.map((template) => {
    const due = dueByTemplate.get(template.id);
    return { ...template, dueCount: Number(due?.dueCount ?? 0), nextDueOn: due?.nextDueOn ?? null };
  });
}

export async function listDueBudgetRecurringOccurrences(database: Database, ownerUserId: string, limit = 100): Promise<BudgetRecurringOccurrenceView[]> {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  return database.select({
    id: budgetRecurringOccurrences.id,
    templateId: budgetRecurringOccurrences.recurringTemplateId,
    templateName: budgetRecurringTemplates.name,
    scheduledOn: budgetRecurringOccurrences.scheduledOn,
    amount: budgetRecurringOccurrences.amount,
    categoryId: budgetRecurringOccurrences.categoryId,
    categoryName: budgetCategories.name,
    spreadCount: budgetRecurringOccurrences.spreadCount,
    status: budgetRecurringOccurrences.status,
    budgetTransactionId: budgetRecurringOccurrences.budgetTransactionId,
  }).from(budgetRecurringOccurrences)
    .innerJoin(budgetRecurringTemplates, and(eq(budgetRecurringTemplates.ownerUserId, ownerUserId), eq(budgetRecurringTemplates.id, budgetRecurringOccurrences.recurringTemplateId)))
    .innerJoin(budgetCategories, and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.id, budgetRecurringOccurrences.categoryId)))
    .where(and(eq(budgetRecurringOccurrences.ownerUserId, ownerUserId), eq(budgetRecurringOccurrences.status, "due")))
    .orderBy(asc(budgetRecurringOccurrences.scheduledOn), asc(budgetRecurringOccurrences.id))
    .limit(boundedLimit);
}

export async function listActiveBudgetRecurringRules(database: Database, ownerUserId: string): Promise<BudgetRecurringTemplateRule[]> {
  return database.select({
    id: budgetRecurringTemplates.id,
    name: budgetRecurringTemplates.name,
    amount: budgetRecurringTemplates.amount,
    categoryId: budgetRecurringTemplates.categoryId,
    frequency: budgetRecurringTemplates.frequency,
    startsOn: budgetRecurringTemplates.startsOn,
    spreadCount: budgetRecurringTemplates.spreadCount,
  }).from(budgetRecurringTemplates)
    .where(and(eq(budgetRecurringTemplates.ownerUserId, ownerUserId), isNull(budgetRecurringTemplates.archivedAt)))
    .orderBy(asc(budgetRecurringTemplates.startsOn), asc(budgetRecurringTemplates.name), asc(budgetRecurringTemplates.id));
}

export async function getBudgetRecurringDashboardSummary(database: Database, ownerUserId: string): Promise<BudgetRecurringDashboardSummary> {
  const [row] = await database.select({
    dueCount: sql<string>`count(*)::text`,
    expectedAmount: sql<string>`coalesce(sum(${budgetRecurringOccurrences.amount}), 0)::text`,
    nextDueOn: sql<string | null>`min(${budgetRecurringOccurrences.scheduledOn})::text`,
  }).from(budgetRecurringOccurrences)
    .where(and(eq(budgetRecurringOccurrences.ownerUserId, ownerUserId), eq(budgetRecurringOccurrences.status, "due")));
  return {
    dueCount: Number(row?.dueCount ?? 0),
    expectedAmount: Number(row?.expectedAmount ?? 0),
    nextDueOn: row?.nextDueOn ?? null,
  };
}

export async function recordBudgetRecurringOccurrence(database: Database, ownerUserId: string, occurrenceId: string, occurredOn: string) {
  if (!isValidBudgetDate(occurredOn)) throw new BudgetError("INVALID_INPUT", "Enter a valid payment date.");
  return database.transaction(async (transaction) => {
    await lockBudgetProfile(transaction as Database, ownerUserId);
    const period = await activePeriodForUpdate(transaction as Database, ownerUserId);
    const [occurrence] = await transaction.select().from(budgetRecurringOccurrences)
      .where(and(eq(budgetRecurringOccurrences.ownerUserId, ownerUserId), eq(budgetRecurringOccurrences.id, occurrenceId)))
      .limit(1)
      .for("update");
    if (!occurrence) throw new BudgetError("NOT_FOUND", "That recurring occurrence is no longer available.");
    if (occurrence.status !== "due") throw new BudgetError("CONFLICT", "This recurring occurrence has already been handled.");
    const [template] = await transaction.select().from(budgetRecurringTemplates)
      .where(and(eq(budgetRecurringTemplates.ownerUserId, ownerUserId), eq(budgetRecurringTemplates.id, occurrence.recurringTemplateId)))
      .limit(1);
    if (!template) throw new BudgetError("CONFLICT", "The recurring expense is no longer available.");

    const [plan] = await transaction.select({ categoryId: budgetPeriodCategories.budgetCategoryId }).from(budgetPeriodCategories)
      .where(and(
        eq(budgetPeriodCategories.ownerUserId, ownerUserId),
        eq(budgetPeriodCategories.budgetPeriodId, period.id),
        eq(budgetPeriodCategories.budgetCategoryId, occurrence.categoryId),
      ))
      .limit(1);
    let impactCategoryId = occurrence.categoryId;
    if (!plan) {
      const [uncategorized] = await transaction.select({ id: budgetCategories.id }).from(budgetCategories)
        .where(and(eq(budgetCategories.ownerUserId, ownerUserId), eq(budgetCategories.systemKey, "uncategorized")))
        .limit(1);
      if (!uncategorized) throw new BudgetError("CONFLICT", "The budget system category is unavailable.");
      impactCategoryId = uncategorized.id;
    }

    const [created] = await transaction.insert(budgetTransactions).values({
      ownerUserId,
      direction: "outflow",
      amount: occurrence.amount,
      description: template.name,
      occurredOn,
      status: "posted",
      origin: "recurring",
    }).returning();
    if (!created) throw new BudgetError("CONFLICT", "The recurring payment could not be recorded.");

    if (occurredOn >= period.startsOn && occurredOn <= period.endsOn) {
      const amounts = splitBudgetAmount(occurrence.amount, occurrence.spreadCount);
      await transaction.insert(budgetImpacts).values(amounts.map((amount, index) => ({
        ownerUserId,
        budgetTransactionId: created.id,
        budgetCategoryId: impactCategoryId,
        budgetPeriodId: index === 0 ? period.id : null,
        amount,
        status: index === 0 ? "applied" as const : "pending" as const,
        targetPeriodOrdinal: period.ordinal + index,
      })));
    }

    const [updated] = await transaction.update(budgetRecurringOccurrences).set({
      status: "recorded",
      budgetTransactionId: created.id,
      updatedAt: new Date(),
    }).where(and(
      eq(budgetRecurringOccurrences.ownerUserId, ownerUserId),
      eq(budgetRecurringOccurrences.id, occurrenceId),
      eq(budgetRecurringOccurrences.status, "due"),
    )).returning();
    if (!updated) throw new BudgetError("CONFLICT", "This recurring occurrence has already been handled.");
    return { occurrence: updated, transaction: created };
  });
}

export async function skipBudgetRecurringOccurrence(database: Database, ownerUserId: string, occurrenceId: string) {
  return database.transaction(async (transaction) => {
    await lockBudgetProfile(transaction as Database, ownerUserId);
    const [occurrence] = await transaction.select().from(budgetRecurringOccurrences)
      .where(and(eq(budgetRecurringOccurrences.ownerUserId, ownerUserId), eq(budgetRecurringOccurrences.id, occurrenceId)))
      .limit(1)
      .for("update");
    if (!occurrence) throw new BudgetError("NOT_FOUND", "That recurring occurrence is no longer available.");
    if (occurrence.status !== "due") throw new BudgetError("CONFLICT", "Only a due occurrence can be skipped.");
    const [updated] = await transaction.update(budgetRecurringOccurrences).set({ status: "skipped", updatedAt: new Date() })
      .where(and(eq(budgetRecurringOccurrences.ownerUserId, ownerUserId), eq(budgetRecurringOccurrences.id, occurrenceId), eq(budgetRecurringOccurrences.status, "due")))
      .returning();
    if (!updated) throw new BudgetError("CONFLICT", "This recurring occurrence has already been handled.");
    return updated;
  });
}

export async function materializeRecurringOccurrencesForPeriod(
  transaction: Database,
  ownerUserId: string,
  period: { id: string; startsOn: string; endsOn: string },
  planCategoryIds: ReadonlySet<string>,
  uncategorizedId: string,
  selections: readonly BudgetRecurringTransitionSelection[] = [],
) {
  const rules = await listActiveBudgetRecurringRules(transaction, ownerUserId);
  const candidates = buildRecurringCandidates(rules, period);
  if (candidates.length === 0) return { materializedCount: 0, dueCount: 0, skippedCount: 0 };
  const candidatesByKey = new Map(candidates.map((candidate) => [recurringCandidateKey(candidate.templateId, candidate.scheduledOn), candidate]));
  const submitted = new Map<string, BudgetRecurringTransitionSelection>();
  for (const selection of selections) {
    const key = recurringCandidateKey(selection.templateId, selection.scheduledOn);
    if (!candidatesByKey.has(key)) throw new BudgetError("NOT_FOUND", "The recurring candidates changed. Reload before starting the next period.");
    if (submitted.has(key)) throw new BudgetError("INVALID_INPUT", "Duplicate recurring occurrence selection.");
    if (selection.categoryId && !planCategoryIds.has(selection.categoryId)) throw new BudgetError("INVALID_INPUT", "Choose a category from the next period plan.");
    submitted.set(key, selection);
  }

  const rows = candidates.map((candidate) => {
    const key = recurringCandidateKey(candidate.templateId, candidate.scheduledOn);
    const selection = submitted.get(key);
    return {
      ownerUserId,
      recurringTemplateId: candidate.templateId,
      scheduledPeriodId: period.id,
      scheduledOn: candidate.scheduledOn,
      amount: candidate.amount,
      categoryId: selection?.categoryId ?? resolveRecurringOccurrenceCategory(candidate.categoryId, planCategoryIds, uncategorizedId),
      spreadCount: candidate.spreadCount,
      status: selection?.selected === false ? "skipped" as const : "due" as const,
    };
  });
  const inserted = await transaction.insert(budgetRecurringOccurrences).values(rows)
    .onConflictDoNothing({ target: [budgetRecurringOccurrences.ownerUserId, budgetRecurringOccurrences.recurringTemplateId, budgetRecurringOccurrences.scheduledOn] })
    .returning({ status: budgetRecurringOccurrences.status });
  return {
    materializedCount: inserted.length,
    dueCount: inserted.filter((row) => row.status === "due").length,
    skippedCount: inserted.filter((row) => row.status === "skipped").length,
  };
}

export async function absorbZeroImpactRecurringActivity(
  transaction: Database,
  ownerUserId: string,
  period: typeof budgetPeriods.$inferSelect,
  planCategoryIds: ReadonlySet<string>,
  uncategorizedId: string,
) {
  const rows = await transaction.select({
    occurrenceId: budgetRecurringOccurrences.id,
    transactionId: budgetTransactions.id,
    amount: budgetRecurringOccurrences.amount,
    categoryId: budgetRecurringOccurrences.categoryId,
    spreadCount: budgetRecurringOccurrences.spreadCount,
  }).from(budgetRecurringOccurrences)
    .innerJoin(budgetTransactions, and(
      eq(budgetTransactions.ownerUserId, ownerUserId),
      eq(budgetTransactions.id, budgetRecurringOccurrences.budgetTransactionId),
    ))
    .where(and(
      eq(budgetRecurringOccurrences.ownerUserId, ownerUserId),
      eq(budgetRecurringOccurrences.status, "recorded"),
      eq(budgetTransactions.status, "posted"),
      eq(budgetTransactions.origin, "recurring"),
      gte(budgetTransactions.occurredOn, period.startsOn),
      lte(budgetTransactions.occurredOn, period.endsOn),
      sql`not exists (select 1 from ${budgetImpacts} impact where impact.owner_user_id = ${ownerUserId} and impact.budget_transaction_id = ${budgetTransactions.id})`,
    ))
    .orderBy(asc(budgetTransactions.occurredOn), asc(budgetRecurringOccurrences.id));
  for (const row of rows) {
    const amounts = splitBudgetAmount(row.amount, row.spreadCount);
    const categoryId = resolveRecurringOccurrenceCategory(row.categoryId, planCategoryIds, uncategorizedId);
    await transaction.insert(budgetImpacts).values(amounts.map((amount, index) => ({
      ownerUserId,
      budgetTransactionId: row.transactionId,
      budgetCategoryId: categoryId,
      budgetPeriodId: index === 0 ? period.id : null,
      amount,
      status: index === 0 ? "applied" as const : "pending" as const,
      targetPeriodOrdinal: period.ordinal + index,
    })));
  }
  return rows.length;
}
