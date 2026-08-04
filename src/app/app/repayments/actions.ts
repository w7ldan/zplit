"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { validateRepaymentInput, type RepaymentFieldErrors, type RepaymentInputValues } from "@/domain/repayment-input";
import {
  validateRepaymentAllocationInput,
  type RepaymentAllocationFieldErrors,
  type RepaymentAllocationInputValues,
} from "@/domain/repayment-allocation-input";
import {
  createLedgerRepository,
  LedgerNotFoundError,
  RepaymentAllocationAmountInvariantError,
  RepaymentAllocationShareInvariantError,
  RepaymentAmountInvariantError,
  RepaymentFriendInvariantError,
} from "@/domain/ledger-repository";

export type RepaymentActionState = {
  fieldErrors: RepaymentFieldErrors;
  formError: string;
  values: RepaymentInputValues;
};

export type RepaymentAllocationActionState = {
  fieldErrors: RepaymentAllocationFieldErrors;
  formError: string;
  values: RepaymentAllocationInputValues;
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

function allocationValuesFromForm(formData: FormData) {
  const ids = formData.getAll("expenseShareId");
  const amounts = formData.getAll("amountRupiah");
  const values = Array.from({ length: Math.max(ids.length, amounts.length) }, (_, index) => ({
    expenseShareId: typeof ids[index] === "string" ? ids[index].trim() : "",
    amountRupiah: typeof amounts[index] === "string" ? amounts[index].trim() : "",
  }));
  return validateRepaymentAllocationInput(values);
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

export async function replaceRepaymentAllocationsAction(
  repaymentId: string,
  _previousState: RepaymentAllocationActionState,
  formData: FormData,
): Promise<RepaymentAllocationActionState> {
  const session = await requireSession();
  const result = allocationValuesFromForm(formData);
  if (!result.ok) return { fieldErrors: result.errors, formError: "Please correct the marked fields.", values: result.values };

  try {
    await createLedgerRepository(getDatabase(), session.user.id).replaceRepaymentAllocations(repaymentId, result.value);
  } catch (error) {
    return {
      fieldErrors: {},
      formError: error instanceof LedgerNotFoundError
        ? "This friend, repayment, or expense share is no longer available."
        : error instanceof RepaymentAllocationAmountInvariantError || error instanceof RepaymentAllocationShareInvariantError
          ? error.message
          : "Unable to save these allocations.",
      values: result.values,
    };
  }

  revalidatePath("/app");
  revalidatePath("/app/repayments");
  revalidatePath(`/app/repayments/${repaymentId}`);
  redirect(`/app/repayments/${repaymentId}`);
}
