"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { validateOutingInput, type OutingFieldErrors, type OutingInputValues } from "@/domain/outing-input";
import { createLedgerRepository, deletionImpactRevision, LedgerDeletionConfirmationRequiredError, LedgerNotFoundError } from "@/domain/ledger-repository";
import { addOutingToExpenseReturnTarget, validateExpenseReturnTarget } from "@/domain/expense-return";
import type { DeleteRecordActionState } from "@/components/app/delete-record-form";
import type { SearchableOption } from "@/components/records/searchable-combobox";

export type OutingActionState = {
  fieldErrors: OutingFieldErrors;
  formError: string;
  values: OutingInputValues;
};

export type OutingDeleteActionState = DeleteRecordActionState;

export async function searchTripOptions(query = "", selectedId?: string): Promise<SearchableOption[]> {
  const session = await requireSession();
  return [
    { id: "", label: "No trip" },
    ...(await createLedgerRepository(getDatabase(), session.user.id).searchTrips({ q: query, selectedId })).map((trip) => ({ id: trip.id, label: trip.name })),
  ].slice(0, 20);
}

export async function searchTripFilterOptions(query = "", selectedId?: string): Promise<SearchableOption[]> {
  return [
    { id: "", label: "All trips" },
    { id: "unassigned", label: "No trip" },
    ...(await searchTripOptions(query, selectedId)).filter((trip) => trip.id).slice(0, 18),
  ];
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
  return validateOutingInput({
    title: formData.get("title"),
    occurredAtLocal: formData.get("occurredAtLocal"),
    timezoneOffsetMinutes: formData.get("timezoneOffsetMinutes"),
    notes: formData.get("notes"),
    tripId: formData.get("tripId"),
  });
}

function invalidState(result: Extract<ReturnType<typeof validateOutingInput>, { ok: false }>): OutingActionState {
  return { fieldErrors: result.errors, formError: "Please correct the marked fields.", values: result.values };
}

function addTimezoneOffset(target: string, offset: string) {
  const url = new URL(target, "https://zplit.invalid");
  url.searchParams.set("tz", offset);
  return `${url.pathname}${url.search}${url.hash}`;
}

function unavailableTripState(values: OutingInputValues): OutingActionState {
  return { fieldErrors: { tripId: "Selected trip is no longer available." }, formError: "Please correct the marked fields.", values };
}

function errorState(error: unknown, values: OutingInputValues): OutingActionState {
  return {
    fieldErrors: {},
    formError: error instanceof LedgerNotFoundError ? "This outing is no longer available." : "Unable to save this outing.",
    values,
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
    return error instanceof LedgerNotFoundError ? unavailableTripState(result.values) : errorState(error, result.values);
  }
  revalidatePath("/app");
  revalidatePath("/app/outings");
  revalidatePath("/app/trips");
  if (result.value.tripId) revalidatePath(`/app/trips/${result.value.tripId}`);
  const returnTarget = returnTo ? addOutingToExpenseReturnTarget(returnTo, outing.id) : undefined;
  if (returnTarget) redirect(addTimezoneOffset(returnTarget, result.values.timezoneOffsetMinutes));
  redirect(`/app/outings?created=${encodeURIComponent(outing.id)}&tz=${encodeURIComponent(result.values.timezoneOffsetMinutes)}`);
}

export async function updateOutingAction(
  outingId: string,
  _previousState: OutingActionState,
  formData: FormData,
): Promise<OutingActionState> {
  const session = await requireSession();
  const result = valuesFromForm(formData);
  if (!result.ok) return invalidState(result);

  const repository = createLedgerRepository(getDatabase(), session.user.id);
  try {
    await repository.updateOuting(outingId, result.value);
  } catch (error) {
    if (error instanceof LedgerNotFoundError && result.value.tripId) {
      try {
        await repository.getOuting(outingId);
      } catch (outingError) {
        return errorState(outingError, result.values);
      }
      return unavailableTripState(result.values);
    }
    return errorState(error, result.values);
  }

  revalidatePath("/app");
  revalidatePath("/app/outings");
  revalidatePath("/app/trips");
  redirect(`/app/outings/${outingId}?saved=1`);
}

export async function deleteOutingAction(
  outingId: string,
  _previousState: OutingDeleteActionState,
  formData: FormData,
): Promise<OutingDeleteActionState> {
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
    result = await repository.deleteOuting(outingId, { cascadeDependents, expectedImpactRevision });
  } catch (error) {
    return {
      formError: error instanceof LedgerDeletionConfirmationRequiredError
        ? error.reason === "cascade_confirmation_required"
          ? "Review the dependent records and confirm their deletion."
          : "The dependent records changed. Review the updated deletion impact and confirm again."
        : error instanceof LedgerNotFoundError
          ? "This outing is no longer available."
          : "Unable to delete this outing.",
      ...(error instanceof LedgerDeletionConfirmationRequiredError ? { impact: error.impact, impactRevision: deletionImpactRevision(error.impact) } : {}),
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
