"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { parseNonNegativeRupiah } from "@/domain/budgeting/amounts";
import { canonicalBudgetCategoryName, normalizeBudgetCategoryName } from "@/domain/budgeting/categories";
import { BudgetError } from "@/domain/budgeting/errors";
import { isValidBudgetDate } from "@/domain/budgeting/dates";
import { parseRupiah } from "@/domain/rupiah";
import { getDatabase } from "@/db/client";
import { createBudgetSetup } from "@/server/budgeting/profiles";
import { createBudgetCategory, updateBudgetPlan } from "@/server/budgeting/categories";
import { createManualBudgetTransaction, spreadBudgetTransaction, voidBudgetTransaction } from "@/server/budgeting/transactions";
import { startNextBudgetPeriod } from "@/server/budgeting/periods";
import {
  archiveBudgetRecurringTemplate,
  createBudgetRecurringTemplate,
  recordBudgetRecurringOccurrence,
  skipBudgetRecurringOccurrence,
  updateBudgetRecurringTemplate,
} from "@/server/budgeting/recurring";
import { changePersonalExpenseBudgetCategory, importBudgetActivity } from "@/server/budgeting/sources-personal";
import { changeGroupExpenseBudgetCategory, changeGroupObligationBudgetCategory } from "@/server/budgeting/sources-group";
import { getPersonalLedgerScopeId, LedgerScopeError } from "@/server/ledger-scopes";
import type { BudgetRecurringFrequency, BudgetRecurringTransitionSelection } from "@/domain/budgeting/recurrence";

export type BudgetFormState<T> = { fieldErrors: Record<string, string>; formError: string; values: T };

export type BudgetSetupValues = {
  periodName: string;
  startsOn: string;
  endsOn: string;
  totalBudget: string;
  categories: Array<{ name: string; allocation: string }>;
};

export type BudgetPlanValues = {
  periodName: string;
  startsOn: string;
  endsOn: string;
  periodUpdatedAt: string;
  totalBudget: string;
  categories: Array<{ id: string; name: string; allocation: string; systemKey: string | null }>;
  newCategoryName: string;
  newCategoryAllocation: string;
};

export type BudgetTransactionValues = {
  direction: "outflow" | "inflow";
  amount: string;
  description: string;
  occurredOn: string;
  categoryId: string;
};

export type BudgetTransitionValues = {
  expectedActivePeriodId: string;
  name: string;
  startsOn: string;
  endsOn: string;
  totalBudget: string;
  categories: Array<{ id: string; name: string; allocation: string }>;
  recurrence: BudgetRecurringTransitionSelection[];
};

export type BudgetSpreadValues = { transactionId: string; count: string };

export type BudgetRecurringTemplateValues = {
  templateId: string;
  name: string;
  amount: string;
  categoryId: string;
  frequency: string;
  startsOn: string;
  spreadCount: string;
};

export type BudgetRecurringRecordValues = { occurrenceId: string; occurredOn: string };

function textValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function budgetErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof BudgetError)) return fallback;
  return {
    INVALID_INPUT: "Please correct the marked fields.",
    NOT_CONFIGURED: "Budgeting is not configured yet.",
    ALREADY_CONFIGURED: "Budgeting is already configured.",
    NOT_FOUND: "That budget record is no longer available.",
    ALLOCATION_EXCEEDS_BUDGET: "Category allocations cannot exceed the total budget.",
    TRANSACTION_OUTSIDE_PERIOD: "The transaction date must be within the active period.",
    SYSTEM_CATEGORY_IMMUTABLE: "Uncategorized cannot be changed.",
    CONFLICT: error.message || "This budget changed in another request. Reload and try again.",
  }[error.code];
}

function revalidateBudget() {
  revalidatePath("/app/personal");
  revalidatePath("/app/personal/budget");
  revalidatePath("/app/personal/budget/transactions");
  revalidatePath("/app/personal/budget/periods");
  revalidatePath("/app/personal/budget/subscriptions");
}

function setupValues(formData: FormData): BudgetSetupValues {
  const names = formData.getAll("categoryName");
  const allocations = formData.getAll("categoryAllocation");
  return {
    periodName: textValue(formData, "periodName"),
    startsOn: textValue(formData, "startsOn"),
    endsOn: textValue(formData, "endsOn"),
    totalBudget: textValue(formData, "totalBudget"),
    categories: Array.from({ length: Math.max(names.length, allocations.length, 3) }, (_, index) => ({
      name: typeof names[index] === "string" ? names[index].trim() : "",
      allocation: typeof allocations[index] === "string" ? allocations[index].trim() : "",
    })),
  };
}

export async function createBudgetSetupAction(_previousState: BudgetFormState<BudgetSetupValues>, formData: FormData): Promise<BudgetFormState<BudgetSetupValues>> {
  const values = setupValues(formData);
  const fieldErrors: Record<string, string> = {};
  const totalBudget = parseRupiah(values.totalBudget);
  if (!values.periodName) fieldErrors.periodName = "Period name is required.";
  if (!isValidBudgetDate(values.startsOn)) fieldErrors.startsOn = "Enter a valid date.";
  if (!isValidBudgetDate(values.endsOn)) fieldErrors.endsOn = "Enter a valid date.";
  if (isValidBudgetDate(values.startsOn) && isValidBudgetDate(values.endsOn) && values.startsOn > values.endsOn) fieldErrors.endsOn = "End date must be on or after the start date.";
  if (totalBudget === null) fieldErrors.totalBudget = "Enter a whole Rupiah amount greater than zero.";
  const categories: Array<{ name: string; allocatedAmount: number }> = [];
  values.categories.forEach((category, index) => {
    if (!category.name && !category.allocation) return;
    if (!category.name) fieldErrors[`categoryName${index}`] = "Category name is required.";
    const allocation = parseNonNegativeRupiah(category.allocation);
    if (allocation === null) fieldErrors[`categoryAllocation${index}`] = "Enter zero or a whole Rupiah amount.";
    if (category.name && allocation !== null) categories.push({ name: category.name, allocatedAmount: allocation });
  });
  const normalized = categories.map((category) => normalizeBudgetCategoryName(category.name));
  if (new Set(normalized).size !== normalized.length || normalized.includes("uncategorized")) fieldErrors.categories = "Category names must be unique, and Uncategorized is reserved.";
  if (totalBudget !== null && categories.reduce((sum, category) => sum + category.allocatedAmount, 0) > totalBudget) fieldErrors.categories = "Category allocations cannot exceed the total budget.";
  if (Object.keys(fieldErrors).length) return { fieldErrors, formError: "Please correct the marked fields.", values };
  try {
    const session = await requireSession();
    await createBudgetSetup(getDatabase(), session.user.id, { periodName: values.periodName, startsOn: values.startsOn, endsOn: values.endsOn, totalBudget: totalBudget!, categories });
  } catch (error) {
    return { fieldErrors: {}, formError: budgetErrorMessage(error, "Unable to configure budgeting."), values };
  }
  revalidateBudget();
  redirect("/app/personal/budget");
}

function planValues(formData: FormData): BudgetPlanValues {
  const ids = formData.getAll("categoryId");
  const names = formData.getAll("categoryName");
  const allocations = formData.getAll("categoryAllocation");
  return {
    periodName: textValue(formData, "periodName"),
    startsOn: textValue(formData, "startsOn"),
    endsOn: textValue(formData, "endsOn"),
    periodUpdatedAt: textValue(formData, "periodUpdatedAt"),
    totalBudget: textValue(formData, "totalBudget"),
    categories: ids.map((id, index) => ({
      id: String(id),
      name: typeof names[index] === "string" ? names[index].trim() : "",
      allocation: typeof allocations[index] === "string" ? allocations[index].trim() : "",
      systemKey: typeof formData.get(`categorySystemKey${index}`) === "string" ? String(formData.get(`categorySystemKey${index}`)) : null,
    })),
    newCategoryName: textValue(formData, "newCategoryName"),
    newCategoryAllocation: textValue(formData, "newCategoryAllocation"),
  };
}

function parsePlanSubmission(values: BudgetPlanValues) {
  const fieldErrors: Record<string, string> = {};
  const totalBudget = parseRupiah(values.totalBudget);
  if (!values.periodName) fieldErrors.periodName = "Period name is required.";
  if (!isValidBudgetDate(values.startsOn)) fieldErrors.startsOn = "Enter a valid date.";
  if (!isValidBudgetDate(values.endsOn)) fieldErrors.endsOn = "Enter a valid date.";
  if (isValidBudgetDate(values.startsOn) && isValidBudgetDate(values.endsOn) && values.startsOn > values.endsOn) fieldErrors.endsOn = "End date must be on or after the start date.";
  if (totalBudget === null) fieldErrors.totalBudget = "Enter a whole Rupiah amount greater than zero.";
  const categories = values.categories.map((category, index) => ({
    id: category.id,
    name: category.name,
    allocatedAmount: parseNonNegativeRupiah(category.allocation),
    index,
  }));
  categories.forEach((category) => { if (category.allocatedAmount === null) fieldErrors[`categoryAllocation${category.index}`] = "Enter zero or a whole Rupiah amount."; });
  const newAllocation = values.newCategoryName || values.newCategoryAllocation ? parseNonNegativeRupiah(values.newCategoryAllocation) : null;
  if (values.newCategoryName && newAllocation === null) fieldErrors.newCategoryAllocation = "Enter zero or a whole Rupiah amount.";
  if (!values.newCategoryName && values.newCategoryAllocation) fieldErrors.newCategoryName = "Category name is required.";
  const names = categories.map((category) => normalizeBudgetCategoryName(category.name));
  if (values.newCategoryName) names.push(normalizeBudgetCategoryName(values.newCategoryName));
  if (names.some((name) => !name) || new Set(names).size !== names.length) fieldErrors.categories = "Category names must be unique, and Uncategorized is reserved.";
  if (Object.keys(fieldErrors).length) return { ok: false as const, state: { fieldErrors, formError: "Please correct the marked fields.", values } };
  return {
    ok: true as const,
    totalBudget: totalBudget!,
    categories: categories.map((category) => ({ id: category.id, name: category.name, allocatedAmount: category.allocatedAmount! })),
    newCategory: values.newCategoryName ? { name: canonicalBudgetCategoryName(values.newCategoryName), allocatedAmount: newAllocation! } : undefined,
  };
}

export async function updateBudgetPlanAction(_previousState: BudgetFormState<BudgetPlanValues>, formData: FormData): Promise<BudgetFormState<BudgetPlanValues>> {
  const values = planValues(formData);
  const parsed = parsePlanSubmission(values);
  if (!parsed.ok) return parsed.state;
  try {
    const session = await requireSession();
    await updateBudgetPlan(getDatabase(), session.user.id, {
      period: { name: values.periodName, startsOn: values.startsOn, endsOn: values.endsOn, totalBudget: parsed.totalBudget },
      expectedPeriodUpdatedAt: values.periodUpdatedAt,
      categories: parsed.categories,
      ...(parsed.newCategory ? { newCategory: parsed.newCategory } : {}),
    });
  } catch (error) {
    return { fieldErrors: {}, formError: budgetErrorMessage(error, "Unable to save the budget plan."), values };
  }
  revalidateBudget();
  redirect("/app/personal/budget");
}

export async function createBudgetCategoryAction(_previousState: { error: string }, formData: FormData): Promise<{ error: string }> {
  const name = textValue(formData, "name");
  const allocation = parseNonNegativeRupiah(textValue(formData, "allocation"));
  if (!name || allocation === null) return { error: "Enter a category name and a non-negative allocation." };
  try {
    const session = await requireSession();
    await createBudgetCategory(getDatabase(), session.user.id, name, allocation);
  } catch (error) {
    return { error: budgetErrorMessage(error, "Unable to create the category.") };
  }
  revalidateBudget();
  redirect("/app/personal/budget?create=plan");
}

function transactionValues(formData: FormData): BudgetTransactionValues {
  const direction = textValue(formData, "direction");
  return { direction: direction === "inflow" ? "inflow" : "outflow", amount: textValue(formData, "amount"), description: textValue(formData, "description"), occurredOn: textValue(formData, "occurredOn"), categoryId: textValue(formData, "categoryId") };
}

export async function createBudgetTransactionAction(_previousState: BudgetFormState<BudgetTransactionValues>, formData: FormData): Promise<BudgetFormState<BudgetTransactionValues>> {
  const values = transactionValues(formData);
  const fieldErrors: Record<string, string> = {};
  const amount = parseRupiah(values.amount);
  if (amount === null) fieldErrors.amount = "Enter a whole Rupiah amount greater than zero.";
  if (!values.description) fieldErrors.description = "Description is required.";
  if (!isValidBudgetDate(values.occurredOn)) fieldErrors.occurredOn = "Enter a valid date.";
  if (!values.categoryId) fieldErrors.categoryId = "Choose a category.";
  if (Object.keys(fieldErrors).length) return { fieldErrors, formError: "Please correct the marked fields.", values };
  try {
    const session = await requireSession();
    await createManualBudgetTransaction(getDatabase(), session.user.id, { direction: values.direction, amount: amount!, description: values.description, occurredOn: values.occurredOn, categoryId: values.categoryId });
  } catch (error) {
    return { fieldErrors: {}, formError: budgetErrorMessage(error, "Unable to add the transaction."), values };
  }
  revalidateBudget();
  redirect("/app/personal/budget?created=1");
}

function transitionValues(formData: FormData): BudgetTransitionValues {
  const ids = formData.getAll("categoryId");
  const names = formData.getAll("categoryName");
  const allocations = formData.getAll("categoryAllocation");
  const recurrenceTemplateIds = formData.getAll("recurrenceTemplateId").map(String);
  const recurrenceScheduledOn = formData.getAll("recurrenceScheduledOn").map(String);
  const recurrenceCategoryIds = formData.getAll("recurrenceCategoryId").map(String);
  const selectedKeys = new Set(formData.getAll("recurrenceSelected").map(String));
  return {
    expectedActivePeriodId: textValue(formData, "expectedActivePeriodId"),
    name: textValue(formData, "periodName"),
    startsOn: textValue(formData, "startsOn"),
    endsOn: textValue(formData, "endsOn"),
    totalBudget: textValue(formData, "totalBudget"),
    categories: ids.map((id, index) => ({ id: String(id), name: typeof names[index] === "string" ? names[index].trim() : "", allocation: typeof allocations[index] === "string" ? allocations[index].trim() : "" })),
    recurrence: recurrenceTemplateIds.map((templateId, index) => {
      const scheduledOn = recurrenceScheduledOn[index] ?? "";
      return {
        templateId,
        scheduledOn,
        selected: selectedKeys.has(`${templateId}|${scheduledOn}`),
        categoryId: recurrenceCategoryIds[index] ? recurrenceCategoryIds[index] : null,
      };
    }),
  };
}

function parseTransitionSubmission(values: BudgetTransitionValues) {
  const fieldErrors: Record<string, string> = {};
  const totalBudget = parseRupiah(values.totalBudget);
  if (!values.name) fieldErrors.periodName = "Period name is required.";
  if (!isValidBudgetDate(values.startsOn)) fieldErrors.startsOn = "Enter a valid date.";
  if (!isValidBudgetDate(values.endsOn)) fieldErrors.endsOn = "Enter a valid date.";
  if (isValidBudgetDate(values.startsOn) && isValidBudgetDate(values.endsOn) && values.startsOn > values.endsOn) fieldErrors.endsOn = "End date must be on or after the start date.";
  if (totalBudget === null) fieldErrors.totalBudget = "Enter a whole Rupiah amount greater than zero.";
  const categories = values.categories.map((category, index) => ({ id: category.id, allocatedAmount: parseNonNegativeRupiah(category.allocation), index }));
  categories.forEach((category) => { if (category.allocatedAmount === null) fieldErrors[`categoryAllocation${category.index}`] = "Enter zero or a whole Rupiah amount."; });
  if (Object.keys(fieldErrors).length) return { ok: false as const, state: { fieldErrors, formError: "Please correct the marked fields.", values } };
  return { ok: true as const, totalBudget: totalBudget!, allocations: categories.map((category) => ({ categoryId: category.id, allocatedAmount: category.allocatedAmount! })) };
}

export async function startNextBudgetPeriodAction(_previousState: BudgetFormState<BudgetTransitionValues>, formData: FormData): Promise<BudgetFormState<BudgetTransitionValues>> {
  const values = transitionValues(formData);
  const parsed = parseTransitionSubmission(values);
  if (!parsed.ok) return parsed.state;
  try {
    const session = await requireSession();
    await startNextBudgetPeriod(getDatabase(), session.user.id, { expectedActivePeriodId: values.expectedActivePeriodId, name: values.name, startsOn: values.startsOn, endsOn: values.endsOn, totalBudget: parsed.totalBudget, allocations: parsed.allocations, recurrence: values.recurrence });
  } catch (error) {
    return { fieldErrors: {}, formError: budgetErrorMessage(error, "Unable to start the next budget period."), values };
  }
  revalidateBudget();
  redirect("/app/personal/budget");
}

export async function spreadBudgetTransactionAction(_previousState: BudgetFormState<BudgetSpreadValues>, formData: FormData): Promise<BudgetFormState<BudgetSpreadValues>> {
  const values = { transactionId: textValue(formData, "transactionId"), count: textValue(formData, "count") };
  const count = parseNonNegativeRupiah(values.count);
  if (!values.transactionId || count === null || count < 1 || count > 24) return { fieldErrors: { count: "Choose between 1 and 24 periods." }, formError: "Please correct the marked field.", values };
  try {
    const session = await requireSession();
    await spreadBudgetTransaction(getDatabase(), session.user.id, values.transactionId, count);
  } catch (error) {
    return { fieldErrors: {}, formError: budgetErrorMessage(error, "Unable to spread this transaction."), values };
  }
  revalidateBudget();
  redirect("/app/personal/budget");
}

export async function voidBudgetTransactionAction(transactionId: string) {
  const session = await requireSession();
  try {
    await voidBudgetTransaction(getDatabase(), session.user.id, transactionId);
  } catch (error) {
    if (!(error instanceof BudgetError) || error.code !== "NOT_FOUND") throw error;
  }
  revalidateBudget();
  redirect("/app/personal/budget/transactions");
}

function recurringTemplateValues(formData: FormData): BudgetRecurringTemplateValues {
  return {
    templateId: textValue(formData, "templateId"),
    name: textValue(formData, "name"),
    amount: textValue(formData, "amount"),
    categoryId: textValue(formData, "categoryId"),
    frequency: textValue(formData, "frequency"),
    startsOn: textValue(formData, "startsOn"),
    spreadCount: textValue(formData, "spreadCount"),
  };
}

function parseRecurringTemplateSubmission(values: BudgetRecurringTemplateValues) {
  const fieldErrors: Record<string, string> = {};
  const amount = parseRupiah(values.amount);
  const spreadCount = parseNonNegativeRupiah(values.spreadCount || "1");
  if (!values.name) fieldErrors.name = "Name is required.";
  if (amount === null) fieldErrors.amount = "Enter a whole Rupiah amount greater than zero.";
  if (!values.categoryId) fieldErrors.categoryId = "Choose a category.";
  if (values.frequency !== "every_budget_period" && values.frequency !== "monthly") fieldErrors.frequency = "Choose a frequency.";
  if (!isValidBudgetDate(values.startsOn)) fieldErrors.startsOn = "Enter a valid date.";
  if (spreadCount === null || spreadCount < 1 || spreadCount > 24 || amount !== null && spreadCount > amount) {
    fieldErrors.spreadCount = "Spread must be between 1 and 24 periods and cannot exceed the amount.";
  }
  if (Object.keys(fieldErrors).length) return { ok: false as const, state: { fieldErrors, formError: "Please correct the marked fields.", values } };
  return {
    ok: true as const,
    input: {
      name: values.name,
      amount: amount!,
      categoryId: values.categoryId,
      frequency: values.frequency as BudgetRecurringFrequency,
      startsOn: values.startsOn,
      spreadCount: spreadCount!,
    },
  };
}

export async function createBudgetRecurringTemplateAction(_previousState: BudgetFormState<BudgetRecurringTemplateValues>, formData: FormData): Promise<BudgetFormState<BudgetRecurringTemplateValues>> {
  const values = recurringTemplateValues(formData);
  const parsed = parseRecurringTemplateSubmission(values);
  if (!parsed.ok) return parsed.state;
  try {
    const session = await requireSession();
    await createBudgetRecurringTemplate(getDatabase(), session.user.id, parsed.input);
  } catch (error) {
    return { fieldErrors: {}, formError: budgetErrorMessage(error, "Unable to create the recurring expense."), values };
  }
  revalidateBudget();
  redirect("/app/personal/budget/subscriptions");
}

export async function updateBudgetRecurringTemplateAction(_previousState: BudgetFormState<BudgetRecurringTemplateValues>, formData: FormData): Promise<BudgetFormState<BudgetRecurringTemplateValues>> {
  const values = recurringTemplateValues(formData);
  const parsed = parseRecurringTemplateSubmission(values);
  if (!parsed.ok) return parsed.state;
  if (!values.templateId) return { fieldErrors: {}, formError: "That recurring expense is no longer available.", values };
  try {
    const session = await requireSession();
    await updateBudgetRecurringTemplate(getDatabase(), session.user.id, values.templateId, parsed.input);
  } catch (error) {
    return { fieldErrors: {}, formError: budgetErrorMessage(error, "Unable to save the recurring expense."), values };
  }
  revalidateBudget();
  redirect("/app/personal/budget/subscriptions");
}

export async function archiveBudgetRecurringTemplateAction(templateId: string) {
  const session = await requireSession();
  try {
    await archiveBudgetRecurringTemplate(getDatabase(), session.user.id, templateId);
  } catch (error) {
    if (!(error instanceof BudgetError) || error.code !== "NOT_FOUND") throw error;
  }
  revalidateBudget();
  redirect("/app/personal/budget/subscriptions");
}

export async function recordBudgetRecurringOccurrenceAction(_previousState: BudgetFormState<BudgetRecurringRecordValues>, formData: FormData): Promise<BudgetFormState<BudgetRecurringRecordValues>> {
  const values = { occurrenceId: textValue(formData, "occurrenceId"), occurredOn: textValue(formData, "occurredOn") };
  if (!values.occurrenceId) return { fieldErrors: {}, formError: "That recurring occurrence is no longer available.", values };
  if (!isValidBudgetDate(values.occurredOn)) return { fieldErrors: { occurredOn: "Enter a valid payment date." }, formError: "Please correct the marked field.", values };
  try {
    const session = await requireSession();
    await recordBudgetRecurringOccurrence(getDatabase(), session.user.id, values.occurrenceId, values.occurredOn);
  } catch (error) {
    return { fieldErrors: {}, formError: budgetErrorMessage(error, "Unable to record the recurring payment."), values };
  }
  revalidateBudget();
  redirect("/app/personal/budget/subscriptions");
}

export async function skipBudgetRecurringOccurrenceAction(occurrenceId: string) {
  const session = await requireSession();
  try {
    await skipBudgetRecurringOccurrence(getDatabase(), session.user.id, occurrenceId);
  } catch (error) {
    if (!(error instanceof BudgetError) || error.code !== "NOT_FOUND") throw error;
  }
  revalidateBudget();
  redirect("/app/personal/budget/subscriptions");
}

export async function changePersonalExpenseBudgetCategoryAction(formData: FormData) {
  const expenseId = textValue(formData, "expenseId");
  const categoryId = textValue(formData, "categoryId");
  if (!expenseId || !categoryId) throw new BudgetError("INVALID_INPUT", "A Personal expense and category are required.");
  const session = await requireSession();
  const database = getDatabase();
  const scope = await getPersonalLedgerScopeId(database, session.user.id);
  await changePersonalExpenseBudgetCategory(database, session.user.id, scope, expenseId, categoryId);
  revalidateBudget();
  redirect("/app/personal/budget");
}

export async function changeGroupExpenseBudgetCategoryAction(formData: FormData) {
  const groupExpenseId = textValue(formData, "groupExpenseId");
  const categoryId = textValue(formData, "categoryId");
  if (!groupExpenseId || !categoryId) throw new BudgetError("INVALID_INPUT", "A Group expense and category are required.");
  const session = await requireSession();
  await changeGroupExpenseBudgetCategory(getDatabase(), session.user.id, groupExpenseId, categoryId);
  revalidateBudget();
  redirect("/app/personal/budget");
}

export async function changeGroupObligationBudgetCategoryAction(formData: FormData) {
  const obligationId = textValue(formData, "obligationId");
  const categoryId = textValue(formData, "categoryId");
  if (!obligationId || !categoryId) throw new BudgetError("INVALID_INPUT", "A Group obligation and category are required.");
  const session = await requireSession();
  await changeGroupObligationBudgetCategory(getDatabase(), session.user.id, obligationId, categoryId);
  revalidateBudget();
  redirect("/app/personal/budget");
}

export async function importPersonalActivityAction() {
  const session = await requireSession();
  const database = getDatabase();
  const scope = await getPersonalLedgerScopeId(database, session.user.id).catch((error: unknown) => {
    if (error instanceof LedgerScopeError && error.code === "personal_scope_missing") return null;
    throw error;
  });
  await importBudgetActivity(database, session.user.id, scope);
  revalidateBudget();
  redirect("/app/personal/budget?imported=1");
}
