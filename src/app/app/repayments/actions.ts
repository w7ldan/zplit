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
  LedgerDeletionConfirmationRequiredError,
  type RepaymentDeletionImpact,
} from "@/domain/ledger-repository";
import type { DeleteRecordActionState } from "@/components/app/delete-record-form";

export type RepaymentActionState = {
  fieldErrors: RepaymentFieldErrors;
  formError: string;
  values: RepaymentInputValues;
  allocations?: RepaymentAllocationInputValues;
  allocationFieldErrors?: RepaymentAllocationFieldErrors;
};

export type RepaymentAllocationActionState = {
  fieldErrors: RepaymentAllocationFieldErrors;
  formError: string;
  values: RepaymentAllocationInputValues;
};

export type RepaymentDeleteActionState = DeleteRecordActionState;

function dependencyWarning(impact: RepaymentDeletionImpact) {
  return `This repayment now has ${impact.allocationCount} allocation${impact.allocationCount === 1 ? "" : "s"}. Check the additional cascade confirmation to continue.`;
}

function cascadeValue(formData: FormData) {
  const values = formData.getAll("confirmCascade");
  if (values.length === 0) return false;
  if (values.length !== 1 || values[0] !== "delete-dependents") throw new Error("Cascade confirmation is invalid.");
  return true;
}

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

function errorState(error: unknown, values: RepaymentInputValues, allocations: RepaymentAllocationInputValues = [], allocationFieldErrors: RepaymentAllocationFieldErrors = {}): RepaymentActionState {
  return {
    fieldErrors: {},
    formError: error instanceof LedgerNotFoundError
      ? "This friend or repayment is no longer available."
      : error instanceof RepaymentAmountInvariantError || error instanceof RepaymentFriendInvariantError || error instanceof RepaymentAllocationAmountInvariantError || error instanceof RepaymentAllocationShareInvariantError
        ? error.message
        : "Unable to save this repayment.",
    values,
    allocations,
    allocationFieldErrors,
  };
}

function allocationValuesFromForm(formData: FormData) {
  const ids = formData.getAll("expenseShareId");
  const amounts = ids.length ? formData.getAll("amountRupiah").slice(-ids.length) : [];
  const values = ids.map((_, index) => ({
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
  const allocationResult = allocationValuesFromForm(formData);
  if (!result.ok) return { ...invalidState(result), allocations: allocationResult.ok ? allocationResult.values : allocationResult.values, allocationFieldErrors: allocationResult.ok ? {} : allocationResult.errors };
  if (!allocationResult.ok) return { fieldErrors: {}, formError: "Please correct the marked fields.", values: result.values, allocations: allocationResult.values, allocationFieldErrors: allocationResult.errors };

  let repayment;
  try {
    repayment = await createLedgerRepository(getDatabase(), session.user.id).createRepaymentWithAllocations(result.value, allocationResult.value);
  } catch (error) {
    return errorState(error, result.values, allocationResult.values);
  }
  revalidatePath("/app");
  revalidatePath("/app/repayments");
  redirect(`/app/repayments/${encodeURIComponent(repayment.id)}?created=1`);
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
  redirect(`/app/repayments/${repaymentId}?saved=1`);
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
  redirect(`/app/repayments/${repaymentId}?saved=1`);
}

export async function deleteRepaymentAction(
  repaymentId: string,
  _previousState: RepaymentDeleteActionState,
  formData: FormData,
): Promise<RepaymentDeleteActionState> {
  const session = await requireSession();
  if (formData.getAll("confirm").length !== 1 || formData.get("confirm") !== "delete") return { formError: "Type delete to confirm." };

  const repository = createLedgerRepository(getDatabase(), session.user.id);
  let result;
  try {
    const impact = await repository.getRepaymentDeletionImpact(repaymentId);
    let cascadeDependents;
    try {
      cascadeDependents = cascadeValue(formData);
    } catch (error) {
      return { formError: error instanceof Error ? error.message : "Cascade confirmation is invalid." };
    }
    if (impact.allocationCount === 0 && cascadeDependents) return { formError: "Cascade confirmation is no longer applicable." };
    result = await repository.deleteRepayment(repaymentId, { cascadeDependents });
  } catch (error) {
    return {
      formError: error instanceof LedgerDeletionConfirmationRequiredError
        ? dependencyWarning(error.impact as RepaymentDeletionImpact)
        : error instanceof LedgerNotFoundError
          ? "This repayment is no longer available."
          : "Unable to delete this repayment.",
    };
  }

  revalidatePath("/app");
  revalidatePath("/app/history");
  revalidatePath("/app/repayments");
  revalidatePath("/app/expenses");
  revalidatePath("/app/friends");
  for (const friendId of result.friendIds) {
    revalidatePath(`/app/friends/${friendId}`);
  }
  revalidatePath("/share/[token]", "page");
  redirect("/app/repayments?deleted=1");
}
