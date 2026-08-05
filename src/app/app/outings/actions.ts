"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { validateOutingInput, type OutingFieldErrors, type OutingInputValues } from "@/domain/outing-input";
import { createLedgerRepository, LedgerDeletionConfirmationRequiredError, LedgerNotFoundError, type OutingDeletionImpact } from "@/domain/ledger-repository";
import { addOutingToExpenseReturnTarget, validateExpenseReturnTarget } from "@/domain/expense-return";
import type { DeleteRecordActionState } from "@/components/app/delete-record-form";

export type OutingActionState = {
  fieldErrors: OutingFieldErrors;
  formError: string;
  values: OutingInputValues;
};

export type OutingDeleteActionState = DeleteRecordActionState;

function hasDependents(impact: OutingDeletionImpact) {
  return impact.expenseCount > 0 || impact.receiptCount > 0 || impact.shareCount > 0 || impact.allocationCount > 0;
}

function dependencyWarning(impact: OutingDeletionImpact) {
  return `This outing now has ${impact.expenseCount} expense${impact.expenseCount === 1 ? "" : "s"}, ${impact.receiptCount} receipt${impact.receiptCount === 1 ? "" : "s"}, ${impact.shareCount} share${impact.shareCount === 1 ? "" : "s"}, and ${impact.allocationCount} allocation${impact.allocationCount === 1 ? "" : "s"}. Check the additional cascade confirmation to continue.`;
}

function cascadeValue(formData: FormData) {
  const values = formData.getAll("confirmCascade");
  if (values.length === 0) return false;
  if (values.length !== 1 || values[0] !== "delete-dependents") throw new Error("Cascade confirmation is invalid.");
  return true;
}

const initialOutingActionState: OutingActionState = {
  fieldErrors: {},
  formError: "",
  values: { title: "", occurredAtLocal: "", timezoneOffsetMinutes: "", notes: "" },
};

function valuesFromForm(formData: FormData) {
  return validateOutingInput({
    title: formData.get("title"),
    occurredAtLocal: formData.get("occurredAtLocal"),
    timezoneOffsetMinutes: formData.get("timezoneOffsetMinutes"),
    notes: formData.get("notes"),
  });
}

function invalidState(result: Extract<ReturnType<typeof validateOutingInput>, { ok: false }>): OutingActionState {
  return { fieldErrors: result.errors, formError: "Please correct the marked fields.", values: result.values };
}

function errorState(error: unknown): OutingActionState {
  return {
    fieldErrors: {},
    formError: error instanceof LedgerNotFoundError ? "This outing is no longer available." : "Unable to save this outing.",
    values: initialOutingActionState.values,
  };
}

export async function createOutingAction(
  boundReturnTo: string | undefined,
  _previousState: OutingActionState,
  formData: FormData,
): Promise<OutingActionState> {
  const session = await requireSession();
  const returnTo = validateExpenseReturnTarget(boundReturnTo);
  const result = valuesFromForm(formData);
  if (!result.ok) return invalidState(result);

  let outing;
  try {
    outing = await createLedgerRepository(getDatabase(), session.user.id).createOuting(result.value);
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/app");
  revalidatePath("/app/outings");
  const returnTarget = returnTo ? addOutingToExpenseReturnTarget(returnTo, outing.id) : undefined;
  if (returnTarget) redirect(returnTarget);
  redirect(`/app/outings?created=${encodeURIComponent(outing.id)}`);
}

export async function updateOutingAction(
  outingId: string,
  _previousState: OutingActionState,
  formData: FormData,
): Promise<OutingActionState> {
  const session = await requireSession();
  const result = valuesFromForm(formData);
  if (!result.ok) return invalidState(result);

  try {
    await createLedgerRepository(getDatabase(), session.user.id).updateOuting(outingId, result.value);
  } catch (error) {
    return errorState(error);
  }

  revalidatePath("/app");
  revalidatePath("/app/outings");
  redirect(`/app/outings/${outingId}?saved=1`);
}

export async function deleteOutingAction(
  outingId: string,
  _previousState: OutingDeleteActionState,
  formData: FormData,
): Promise<OutingDeleteActionState> {
  const session = await requireSession();
  if (formData.getAll("confirm").length !== 1 || formData.get("confirm") !== "delete") return { formError: "Type delete to confirm." };

  const repository = createLedgerRepository(getDatabase(), session.user.id);
  let result;
  try {
    const impact = await repository.getOutingDeletionImpact(outingId);
    let cascadeDependents;
    try {
      cascadeDependents = cascadeValue(formData);
    } catch (error) {
      return { formError: error instanceof Error ? error.message : "Cascade confirmation is invalid." };
    }
    if (!hasDependents(impact) && cascadeDependents) return { formError: "Cascade confirmation is no longer applicable." };
    result = await repository.deleteOuting(outingId, { cascadeDependents });
  } catch (error) {
    return {
      formError: error instanceof LedgerDeletionConfirmationRequiredError
        ? dependencyWarning(error.impact as OutingDeletionImpact)
        : error instanceof LedgerNotFoundError
          ? "This outing is no longer available."
          : "Unable to delete this outing.",
    };
  }

  revalidatePath("/app");
  revalidatePath("/app/history");
  revalidatePath("/app/outings");
  revalidatePath("/app/expenses");
  revalidatePath("/app/repayments");
  revalidatePath("/app/friends");
  for (const friendId of result.friendIds) revalidatePath(`/app/friends/${friendId}`);
  for (const repaymentId of result.repaymentIds) revalidatePath(`/app/repayments/${repaymentId}`);
  revalidatePath("/share/[token]", "page");
  redirect("/app/outings?deleted=1");
}
