"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { validateExpenseShareInput, type ExpenseShareFieldErrors, type ExpenseShareInputValues } from "@/domain/expense-share-input";
import { validateExpenseInput, type ExpenseFieldErrors, type ExpenseInputValues } from "@/domain/expense-input";
import { createLedgerRepository, deletionImpactRevision, ExpenseShareInvariantError, LedgerDeletionConfirmationRequiredError, LedgerNotFoundError } from "@/domain/ledger-repository";
import type { DeleteRecordActionState } from "@/components/app/delete-record-form";
import type { SearchableOption } from "@/components/records/searchable-combobox";

export type ExpenseActionState = {
  fieldErrors: ExpenseFieldErrors;
  formError: string;
  values: ExpenseInputValues;
};

export type ExpenseShareActionState = {
  fieldErrors: ExpenseShareFieldErrors;
  formError: string;
  values: ExpenseShareInputValues;
};

export type ExpenseDeleteActionState = DeleteRecordActionState;

export async function searchOutingOptions(query = "", selectedId?: string): Promise<SearchableOption[]> {
  const session = await requireSession();
  return (await createLedgerRepository(getDatabase(), session.user.id).searchOutings({ q: query, selectedId })).map((outing) => ({ id: outing.id, label: outing.title }));
}

export async function searchOutingFilterOptions(query = "", selectedId?: string): Promise<SearchableOption[]> {
  return [{ id: "", label: "All outings" }, ...(await searchOutingOptions(query, selectedId)).slice(0, 19)];
}

function cascadeValue(formData: FormData) {
  const values = formData.getAll("confirmCascade");
  if (values.length === 0) return false;
  if (values.length !== 1 || values[0] !== "delete-dependents") throw new Error("Cascade confirmation is invalid.");
  return true;
}

function impactRevisionValue(formData: FormData) {
  const values = formData.getAll("impactRevision");
  if (values.length !== 1 || typeof values[0] !== "string" || !/^[0-9a-f]{64}$/.test(values[0])) return null;
  return values[0];
}

function valuesFromForm(formData: FormData) {
  return validateExpenseInput({
    description: formData.get("description"),
    amountRupiah: formData.get("amountRupiah"),
    outingId: formData.get("outingId"),
  });
}

function invalidState(result: Extract<ReturnType<typeof validateExpenseInput>, { ok: false }>): ExpenseActionState {
  return { fieldErrors: result.errors, formError: "Please correct the marked fields.", values: result.values };
}

function errorState(error: unknown, values: ExpenseInputValues): ExpenseActionState {
  return {
    fieldErrors: {},
    formError: error instanceof LedgerNotFoundError
      ? "This outing or expense is no longer available."
      : error instanceof ExpenseShareInvariantError
        ? "Expense amount cannot be lower than its assigned shares."
        : "Unable to save this expense.",
    values,
  };
}

function shareValuesFromForm(formData: FormData) {
  const friendIds = formData.getAll("friendId");
  const amounts = formData.getAll("amountRupiah");
  const values = friendIds.map((friendId, index) => ({
    friendId: typeof friendId === "string" ? friendId.trim() : "",
    amountRupiah: typeof amounts[index] === "string" ? amounts[index].trim() : "",
  }));
  return { values, result: friendIds.length === amounts.length ? validateExpenseShareInput(values) : null };
}

export async function createExpenseAction(
  _previousState: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  const session = await requireSession();
  const result = valuesFromForm(formData);
  if (!result.ok) return invalidState(result);

  let expense;
  try {
    expense = await createLedgerRepository(getDatabase(), session.user.id).createExpense(result.value);
  } catch (error) {
    return errorState(error, result.values);
  }
  revalidatePath("/app");
  revalidatePath("/app/expenses");
  redirect(`/app/expenses/${encodeURIComponent(expense.id)}?created=1`);
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
    await createLedgerRepository(getDatabase(), session.user.id).updateExpense(expenseId, result.value);
  } catch (error) {
    return errorState(error, result.values);
  }

  revalidatePath("/app");
  revalidatePath("/app/expenses");
  revalidatePath(`/app/expenses/${expenseId}`);
  redirect(`/app/expenses/${expenseId}?saved=1`);
}

export async function replaceExpenseSharesAction(
  expenseId: string,
  _previousState: ExpenseShareActionState,
  formData: FormData,
): Promise<ExpenseShareActionState> {
  const session = await requireSession();
  const { values, result } = shareValuesFromForm(formData);
  if (!result) {
    return {
      fieldErrors: {},
      formError: "Please correct the marked fields.",
      values,
    };
  }
  if (!result.ok) return { fieldErrors: result.errors, formError: "Please correct the marked fields.", values: result.values };

  try {
    await createLedgerRepository(getDatabase(), session.user.id).replaceExpenseShares(expenseId, result.value);
  } catch (error) {
    return {
      fieldErrors: {},
      formError: error instanceof LedgerNotFoundError
        ? "This expense or friend is no longer available."
        : error instanceof ExpenseShareInvariantError
          ? "Assigned shares cannot exceed the expense amount."
          : "Unable to save this split.",
      values,
    };
  }

  revalidatePath(`/app/expenses/${expenseId}`);
  redirect(`/app/expenses/${expenseId}?saved=1`);
}

export async function deleteExpenseAction(
  expenseId: string,
  _previousState: ExpenseDeleteActionState,
  formData: FormData,
): Promise<ExpenseDeleteActionState> {
  const session = await requireSession();
  if (formData.getAll("confirm").length !== 1 || formData.get("confirm") !== "delete") return { formError: "Type delete to confirm." };
  const expectedImpactRevision = impactRevisionValue(formData);
  if (!expectedImpactRevision) return { formError: "Impact revision is invalid." };

  const repository = createLedgerRepository(getDatabase(), session.user.id);
  let result;
  try {
    let cascadeDependents;
    try {
      cascadeDependents = cascadeValue(formData);
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

  revalidatePath("/app");
  revalidatePath("/app/history");
  revalidatePath("/app/expenses");
  revalidatePath("/app/outings");
  revalidatePath("/app/repayments");
  revalidatePath("/app/friends");
  for (const friendId of result.friendIds) {
    revalidatePath(`/app/friends/${friendId}`);
  }
  for (const repaymentId of result.repaymentIds) {
    revalidatePath(`/app/repayments/${repaymentId}`);
  }
  revalidatePath("/share/[token]", "page");
  redirect("/app/expenses?deleted=1");
}
