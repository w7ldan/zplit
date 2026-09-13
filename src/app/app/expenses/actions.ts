"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { validateExpenseShareCharges, validateExpenseShareInput, type ExpenseShareChargeValues, type ExpenseShareFieldErrors, type ExpenseShareInputValues } from "@/domain/expense-share-input";
import { validateExpenseInput, type ExpenseFieldErrors, type ExpenseInputValues } from "@/domain/expense-input";
import { deletionImpactRevision, ExpenseShareAllocationInvariantError, ExpenseShareInvariantError, LedgerDeletionConfirmationRequiredError, LedgerNotFoundError } from "@/domain/ledger-repository";
import type { DeleteRecordActionState } from "@/components/app/delete-record-form";
import type { SearchableOption } from "@/components/records/searchable-combobox";
import { BudgetError } from "@/domain/budgeting/errors";
import { parseExpenseBudgetParticipation } from "@/domain/budgeting/participation";
import { parseCascadeConfirmation, parseImpactRevision } from "@/domain/deletion-confirmation";
import { normalizeUuid } from "@/domain/record-retrieval";
import { getAuthenticatedLedger } from "@/server/authenticated-ledger";
import { listBudgetCategoryOptions } from "@/server/budgeting/categories";
import { changePersonalExpenseBudgetCategory } from "@/server/budgeting/sources-personal";
import { getPersonalLedgerScopeId } from "@/server/ledger-scopes";
import { getDatabase } from "@/db/client";
import { getLedgerForAction, assertOrganizationLedgerWritableFromForm, ledgerPath, organizationIdFromForm } from "@/server/organization-ledger";

export type ExpenseSubmitIntent = "add" | "continue";
export type ExpenseActionSuccess = { expenseId: string; amount: number };

export type ExpenseActionState = {
  fieldErrors: ExpenseFieldErrors;
  formError: string;
  values: ExpenseInputValues;
  intent?: ExpenseSubmitIntent;
  success?: ExpenseActionSuccess;
};

export type ExpenseShareActionState = {
  fieldErrors: ExpenseShareFieldErrors;
  formError: string;
  values: ExpenseShareInputValues;
  charges?: ExpenseShareChargeValues[];
};

export type ExpenseDeleteActionState = DeleteRecordActionState;

const actionLedger = (session: Awaited<ReturnType<typeof requireSession>>, formData: FormData, capability: "expenses.create" | "expenses.edit" | "expenses.delete") => getLedgerForAction(session, formData, capability, () => getAuthenticatedLedger(session));

export async function searchOutingOptions(query = "", selectedId?: string): Promise<SearchableOption[]> {
  const { ledger } = await getAuthenticatedLedger();
  return (await ledger.searchOutings({ q: query, selectedId })).map((outing) => ({ id: outing.id, label: outing.title, group: outing.recent ? "Recent" : undefined }));
}

export async function searchExpenseFriendOptions(query = "", selectedId?: string): Promise<SearchableOption[]> {
  const { ledger } = await getAuthenticatedLedger();
  return (await ledger.searchFriends({ q: query, selectedId, activeOnly: true }))
    .filter((friend) => !friend.archived && friend.id !== selectedId)
    .slice(0, 20)
    .map((friend) => ({ id: friend.id, label: friend.name }));
}

export async function searchOutingFilterOptions(query = "", selectedId?: string): Promise<SearchableOption[]> {
  return [{ id: "", label: "All outings" }, ...(await searchOutingOptions(query, selectedId)).slice(0, 19)];
}

function valuesFromForm(formData: FormData) {
  return validateExpenseInput({
    description: formData.get("description"),
    amountRupiah: formData.get("amountRupiah"),
    outingId: formData.get("outingId"),
  });
}

function textValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function budgetCategoryErrorState(values: ExpenseInputValues, message: string, intent?: ExpenseSubmitIntent): ExpenseActionState {
  return { fieldErrors: { budgetCategoryId: message }, formError: "Please correct the marked fields.", values, ...(intent === "continue" ? { intent } : {}) };
}

function expenseSubmitIntent(formData: FormData): ExpenseSubmitIntent | null {
  const values = formData.getAll("intent");
  if (values.length === 0) return "add";
  if (values.length !== 1 || typeof values[0] !== "string") return null;
  return values[0] === "add" || values[0] === "continue" ? values[0] : null;
}

function invalidIntentState(values: ExpenseInputValues): ExpenseActionState {
  return { fieldErrors: {}, formError: "Invalid expense submission.", values };
}

function invalidState(result: Extract<ReturnType<typeof validateExpenseInput>, { ok: false }>, intent?: ExpenseSubmitIntent): ExpenseActionState {
  return { fieldErrors: result.errors, formError: "Please correct the marked fields.", values: result.values, ...(intent === "continue" ? { intent } : {}) };
}

function errorState(error: unknown, values: ExpenseInputValues, intent?: ExpenseSubmitIntent): ExpenseActionState {
  return {
    fieldErrors: {},
    formError: error instanceof LedgerNotFoundError
      ? "This outing or expense is no longer available."
      : error instanceof ExpenseShareInvariantError
        ? "Expense amount cannot be lower than its assigned shares."
        : "Unable to save this expense.",
    values,
    ...(intent === "continue" ? { intent } : {}),
  };
}

function shareValuesFromForm(formData: FormData) {
  const friendIds = formData.getAll("friendId");
  const amounts = formData.getAll("amountRupiah");
  const values = friendIds.map((friendId, index) => ({
    friendId: typeof friendId === "string" ? friendId.trim() : "",
    amountRupiah: typeof amounts[index] === "string" ? amounts[index].trim() : "",
  }));
  const additionalFriendId = formData.get("additionalFriendId");
  const additionalAmountRupiah = formData.get("additionalAmountRupiah");
  if (typeof additionalFriendId === "string" || typeof additionalAmountRupiah === "string") {
    const additional = {
      friendId: typeof additionalFriendId === "string" ? additionalFriendId.trim() : "",
      amountRupiah: typeof additionalAmountRupiah === "string" ? additionalAmountRupiah.trim() : "",
    };
    if (additional.friendId || additional.amountRupiah) values.push(additional);
  }
  const rawCharges = formData.get("charges");
  let charges: unknown;
  if (typeof rawCharges === "string") {
    try {
      charges = JSON.parse(rawCharges);
    } catch {
      charges = null;
    }
  }
  return { values, result: friendIds.length === amounts.length ? validateExpenseShareInput(values) : null, charges };
}

export async function createExpenseAction(
  _previousState: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  const session = await requireSession();
  const intent = expenseSubmitIntent(formData);
  const result = valuesFromForm(formData);
  if (!intent) return invalidIntentState(result.values);
  if (!result.ok) return invalidState(result, intent);
  try {
    await assertOrganizationLedgerWritableFromForm(formData);
  } catch {
    return { fieldErrors: {}, formError: "This organization is archived. Its history is preserved, but new expenses cannot be added.", values: result.values, ...(intent === "continue" ? { intent } : {}) };
  }

  let expense;
  try {
    const { ledger } = await actionLedger(session, formData, "expenses.create");
    const parsedBudget = parseExpenseBudgetParticipation(formData);
    if (!parsedBudget.ok) return budgetCategoryErrorState(result.values, parsedBudget.categoryError, intent);
    const participation = organizationIdFromForm(formData) ? undefined : parsedBudget.participation;
    if (participation?.includeInBudget && participation.categoryId) {
      const categories = await listBudgetCategoryOptions(getDatabase(), session.user.id);
      if (!categories.some((category) => category.id === participation.categoryId)) return budgetCategoryErrorState(result.values, "Choose a valid Budget category.", intent);
    }
    expense = await ledger.createExpense(result.value, participation);
  } catch (error) {
    return errorState(error, result.values, intent);
  }
  revalidatePath(ledgerPath(formData, "/app"));
  revalidatePath(ledgerPath(formData, "/expenses"));
  if (intent === "continue") {
    return {
      fieldErrors: {},
      formError: "",
      values: { description: "", amountRupiah: "", outingId: result.value.outingId },
      success: { expenseId: expense.id, amount: expense.amount },
    };
  }
  redirect(`${ledgerPath(formData, "/expenses")}/${encodeURIComponent(expense.id)}?created=1#friend-shares`);
}

export async function changeExpenseBudgetCategoryAction(expenseId: string, formData: FormData) {
  const session = await requireSession();
  const transactionId = textValue(formData, "transactionId");
  const categoryId = textValue(formData, "categoryId");
  const canonicalExpenseId = normalizeUuid(expenseId);
  const canonicalTransactionId = normalizeUuid(transactionId);
  const canonicalCategoryId = normalizeUuid(categoryId);
  if (!canonicalExpenseId || !canonicalTransactionId || !canonicalCategoryId) throw new BudgetError("INVALID_INPUT", "A budget transaction and category are required.");
  const database = getDatabase();
  const scope = await getPersonalLedgerScopeId(database, session.user.id);
  await changePersonalExpenseBudgetCategory(database, session.user.id, scope, canonicalTransactionId, canonicalCategoryId);
  revalidatePath("/app");
  revalidatePath("/app/expenses");
  revalidatePath(`/app/expenses/${canonicalExpenseId}`);
  revalidatePath("/app/personal");
  revalidatePath("/app/personal/budget");
  revalidatePath("/app/personal/budget/transactions");
  redirect(`/app/expenses/${canonicalExpenseId}?budgetSaved=1#expense-details`);
}

export async function updateExpenseAction(
  expenseId: string,
  _previousState: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  const session = await requireSession();
  const result = valuesFromForm(formData);
  if (!result.ok) return invalidState(result);

  try {
    const { ledger } = await actionLedger(session, formData, "expenses.edit");
    await ledger.updateExpense(expenseId, result.value);
  } catch (error) {
    return errorState(error, result.values);
  }

  const expensesPath = ledgerPath(formData, "/expenses");
  revalidatePath(ledgerPath(formData, "/app"));
  revalidatePath(expensesPath);
  revalidatePath(`${expensesPath}/${expenseId}`);
  redirect(`${expensesPath}/${expenseId}?updated=1#expense-details`);
}

export async function replaceExpenseSharesAction(
  expenseId: string,
  _previousState: ExpenseShareActionState,
  formData: FormData,
): Promise<ExpenseShareActionState> {
  const session = await requireSession();
  const { values, result, charges } = shareValuesFromForm(formData);
  if (!result) {
    return {
      fieldErrors: {},
      formError: "Please correct the marked fields.",
      values,
      charges: _previousState.charges ?? [],
    };
  }
  if (charges === undefined) return { fieldErrors: {}, formError: "Charge data is missing. Reload and try again.", values: result.values, charges: _previousState.charges ?? [] };
  const chargeResult = validateExpenseShareCharges(charges, values.map((value) => value.friendId));
  if (!result.ok || !chargeResult.ok) {
    return {
      fieldErrors: { ...(result.ok ? {} : result.errors), ...(chargeResult.ok ? {} : chargeResult.errors) },
      formError: "Please correct the marked fields.",
      values: result.values,
      charges: chargeResult.values,
    };
  }

  try {
    const { ledger } = await actionLedger(session, formData, "expenses.edit");
    await ledger.replaceExpenseShares(expenseId, result.value, chargeResult.value);
  } catch (error) {
    return {
      fieldErrors: {},
      formError: error instanceof LedgerNotFoundError
        ? "This expense or friend is no longer available."
        : error instanceof ExpenseShareInvariantError
          ? "Assigned shares cannot exceed the expense amount."
          : error instanceof ExpenseShareAllocationInvariantError
            ? "A share cannot be lower than repayments already applied to it."
          : "Unable to save this split.",
      values,
      charges: chargeResult.values,
    };
  }

  const expensePath = `${ledgerPath(formData, "/expenses")}/${expenseId}`;
  revalidatePath(expensePath);
  redirect(`${expensePath}?splitSaved=1#friend-shares`);
}

export async function deleteExpenseAction(
  expenseId: string,
  _previousState: ExpenseDeleteActionState,
  formData: FormData,
): Promise<ExpenseDeleteActionState> {
  const session = await requireSession();
  if (formData.getAll("confirm").length !== 1 || formData.get("confirm") !== "delete") return { formError: "Type delete to confirm." };
  const expectedImpactRevision = parseImpactRevision(formData);
  if (!expectedImpactRevision) return { formError: "Impact revision is invalid." };

  const { ledger: repository } = await actionLedger(session, formData, "expenses.delete");
  let result;
  try {
    let cascadeDependents;
    try {
      cascadeDependents = parseCascadeConfirmation(formData);
    } catch (error) {
      return { formError: error instanceof Error ? error.message : "Cascade confirmation is invalid." };
    }
    result = await repository.deleteExpense(expenseId, { cascadeDependents, expectedImpactRevision });
  } catch (error) {
    return {
      formError: error instanceof LedgerDeletionConfirmationRequiredError
        ? error.reason === "cascade_confirmation_required"
          ? "Review the dependent records and confirm their deletion."
          : "The dependent records changed. Review the updated deletion impact and confirm again."
        : error instanceof LedgerNotFoundError
          ? "This expense is no longer available."
          : "Unable to delete this expense.",
      ...(error instanceof LedgerDeletionConfirmationRequiredError ? { impact: error.impact, impactRevision: deletionImpactRevision(error.impact) } : {}),
    };
  }

  revalidatePath(ledgerPath(formData, "/app"));
  revalidatePath(ledgerPath(formData, "/history"));
  revalidatePath(ledgerPath(formData, "/expenses"));
  revalidatePath(ledgerPath(formData, "/outings"));
  revalidatePath(ledgerPath(formData, "/repayments"));
  revalidatePath(ledgerPath(formData, "/friends"));
  for (const friendId of result.friendIds) {
    revalidatePath(`${ledgerPath(formData, "/friends")}/${friendId}`);
  }
  for (const repaymentId of result.repaymentIds) {
    revalidatePath(`${ledgerPath(formData, "/repayments")}/${repaymentId}`);
  }
  if (!formData.get("organizationId")) revalidatePath("/share/[token]", "page");
  const feedback = new URLSearchParams({ deleted: "1" });
  if (result.reallocatedAmount > 0 || result.unallocatedAmount > 0) {
    feedback.set("reallocated", String(result.reallocatedAmount));
    feedback.set("unallocated", String(result.unallocatedAmount));
  }
  redirect(`${ledgerPath(formData, "/expenses")}?${feedback.toString()}`);
}
