"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { validateTripInput, type TripFieldErrors, type TripInputValues } from "@/domain/trip-input";
import { createLedgerRepository, LedgerNotFoundError } from "@/domain/ledger-repository";
import type { DeleteRecordActionState } from "@/components/app/delete-record-form";

export type TripActionState = { fieldErrors: TripFieldErrors; formError: string; values: TripInputValues };
export type TripDeleteActionState = DeleteRecordActionState;

const initialTripActionState: TripActionState = { fieldErrors: {}, formError: "", values: { name: "", startsOn: "", endsOn: "", notes: "" } };

function valuesFromForm(formData: FormData) {
  return validateTripInput({ name: formData.get("name"), startsOn: formData.get("startsOn"), endsOn: formData.get("endsOn"), notes: formData.get("notes") });
}

function invalidState(result: Extract<ReturnType<typeof validateTripInput>, { ok: false }>): TripActionState {
  return { fieldErrors: result.errors, formError: "Please correct the marked fields.", values: result.values };
}

function errorState(error: unknown): TripActionState {
  return { fieldErrors: {}, formError: error instanceof LedgerNotFoundError ? "This Trip is no longer available." : "Unable to save this Trip.", values: initialTripActionState.values };
}

export async function createTripAction(_previousState: TripActionState, formData: FormData): Promise<TripActionState> {
  const session = await requireSession();
  const result = valuesFromForm(formData);
  if (!result.ok) return invalidState(result);
  let trip;
  try {
    trip = await createLedgerRepository(getDatabase(), session.user.id).createTrip(result.value);
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/app");
  revalidatePath("/app/trips");
  redirect(`/app/trips?created=${encodeURIComponent(trip.id)}`);
}

export async function updateTripAction(tripId: string, _previousState: TripActionState, formData: FormData): Promise<TripActionState> {
  const session = await requireSession();
  const result = valuesFromForm(formData);
  if (!result.ok) return invalidState(result);
  try {
    await createLedgerRepository(getDatabase(), session.user.id).updateTrip(tripId, result.value);
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/app/trips");
  revalidatePath(`/app/trips/${tripId}`);
  redirect(`/app/trips/${tripId}?saved=1`);
}

export async function deleteTripAction(tripId: string, _previousState: TripDeleteActionState, formData: FormData): Promise<TripDeleteActionState> {
  const session = await requireSession();
  if (formData.getAll("confirm").length !== 1 || formData.get("confirm") !== "delete") return { formError: "Confirm deletion to continue." };
  try {
    await createLedgerRepository(getDatabase(), session.user.id).deleteTrip(tripId);
  } catch (error) {
    return { formError: error instanceof LedgerNotFoundError ? "This Trip is no longer available." : "Unable to delete this Trip." };
  }
  revalidatePath("/app");
  revalidatePath("/app/trips");
  revalidatePath("/app/outings");
  redirect("/app/trips?deleted=1");
}
