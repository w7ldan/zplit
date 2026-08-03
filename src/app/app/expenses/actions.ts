"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { validateExpenseInput, type ExpenseFieldErrors, type ExpenseInputValues } from "@/domain/expense-input";
import { createLedgerRepository, LedgerNotFoundError } from "@/domain/ledger-repository";

export type ExpenseActionState = {
  fieldErrors: ExpenseFieldErrors;
  formError: string;
  values: ExpenseInputValues;
};

function valuesFromForm(formData: FormData) {
  return validateExpenseInput({
    description: formData.get("description"),
    amountRupiah: formData.get("amountRupiah"),
    occurredAtLocal: formData.get("occurredAtLocal"),
    timezoneOffsetMinutes: formData.get("timezoneOffsetMinutes"),
    outingId: formData.get("outingId"),
  });
}

function invalidState(result: Extract<ReturnType<typeof validateExpenseInput>, { ok: false }>): ExpenseActionState {
  return { fieldErrors: result.errors, formError: "Please correct the marked fields.", values: result.values };
}

function errorState(error: unknown, values: ExpenseInputValues): ExpenseActionState {
  return {
    fieldErrors: {},
    formError: error instanceof LedgerNotFoundError ? "This outing or expense is no longer available." : "Unable to save this expense.",
    values,
  };
}

export async function createExpenseAction(
  _previousState: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  const session = await requireSession();
  const result = valuesFromForm(formData);
  if (!result.ok) return invalidState(result);

  try {
    await createLedgerRepository(getDatabase(), session.user.id).createExpense(result.value);
  } catch (error) {
    return errorState(error, result.values);
  }

  revalidatePath("/app");
  revalidatePath("/app/expenses");
  redirect("/app/expenses");
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
  redirect(`/app/expenses/${expenseId}`);
}
