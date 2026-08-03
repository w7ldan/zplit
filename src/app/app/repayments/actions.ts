"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { validateRepaymentInput, type RepaymentFieldErrors, type RepaymentInputValues } from "@/domain/repayment-input";
import {
  createLedgerRepository,
  LedgerNotFoundError,
  RepaymentAmountInvariantError,
  RepaymentFriendInvariantError,
} from "@/domain/ledger-repository";

export type RepaymentActionState = {
  fieldErrors: RepaymentFieldErrors;
  formError: string;
  values: RepaymentInputValues;
};

function valuesFromForm(formData: FormData) {
  return validateRepaymentInput({
    friendId: formData.get("friendId"),
    amountRupiah: formData.get("amountRupiah"),
    paidAtLocal: formData.get("paidAtLocal"),
    timezoneOffsetMinutes: formData.get("timezoneOffsetMinutes"),
    paymentMethod: formData.get("paymentMethod"),
    notes: formData.get("notes"),
  });
}

function invalidState(result: Extract<ReturnType<typeof validateRepaymentInput>, { ok: false }>): RepaymentActionState {
  return { fieldErrors: result.errors, formError: "Please correct the marked fields.", values: result.values };
}

function errorState(error: unknown, values: RepaymentInputValues): RepaymentActionState {
  return {
    fieldErrors: {},
    formError: error instanceof LedgerNotFoundError
      ? "This friend or repayment is no longer available."
      : error instanceof RepaymentAmountInvariantError || error instanceof RepaymentFriendInvariantError
        ? error.message
        : "Unable to save this repayment.",
    values,
  };
}

export async function createRepaymentAction(
  _previousState: RepaymentActionState,
  formData: FormData,
): Promise<RepaymentActionState> {
  const session = await requireSession();
  const result = valuesFromForm(formData);
  if (!result.ok) return invalidState(result);

  try {
    await createLedgerRepository(getDatabase(), session.user.id).createRepayment(result.value);
  } catch (error) {
    return errorState(error, result.values);
  }

  revalidatePath("/app");
  revalidatePath("/app/repayments");
  redirect("/app/repayments");
}

export async function updateRepaymentAction(
  repaymentId: string,
  _previousState: RepaymentActionState,
  formData: FormData,
): Promise<RepaymentActionState> {
  const session = await requireSession();
  const result = valuesFromForm(formData);
  if (!result.ok) return invalidState(result);

  try {
    await createLedgerRepository(getDatabase(), session.user.id).updateRepayment(repaymentId, result.value);
  } catch (error) {
    return errorState(error, result.values);
  }

  revalidatePath("/app");
  revalidatePath("/app/repayments");
  revalidatePath(`/app/repayments/${repaymentId}`);
  redirect(`/app/repayments/${repaymentId}`);
}
