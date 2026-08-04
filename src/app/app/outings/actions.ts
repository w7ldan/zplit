"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { validateOutingInput, type OutingFieldErrors, type OutingInputValues } from "@/domain/outing-input";
import { createLedgerRepository, LedgerNotFoundError } from "@/domain/ledger-repository";

export type OutingActionState = {
  fieldErrors: OutingFieldErrors;
  formError: string;
  values: OutingInputValues;
};

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
  _previousState: OutingActionState,
  formData: FormData,
): Promise<OutingActionState> {
  const session = await requireSession();
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
