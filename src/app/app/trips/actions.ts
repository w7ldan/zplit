"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { validateTripInput, type TripFieldErrors, type TripInputValues } from "@/domain/trip-input";
import { LedgerNotFoundError } from "@/domain/ledger-repository";
import type { DeleteRecordActionState } from "@/components/app/delete-record-form";
import { getAuthenticatedLedger } from "@/server/authenticated-ledger";
import { getLedgerForAction, ledgerPath } from "@/server/organization-ledger";

export type TripActionState = { fieldErrors: TripFieldErrors; formError: string; values: TripInputValues };
export type TripDeleteActionState = DeleteRecordActionState;

const initialTripActionState: TripActionState = { fieldErrors: {}, formError: "", values: { name: "", startsOn: "", endsOn: "", notes: "" } };

const actionLedger = (session: Awaited<ReturnType<typeof requireSession>>, formData: FormData, capability: "trips.manage") => getLedgerForAction(session, formData, capability, () => getAuthenticatedLedger(session));

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
    const { ledger } = await actionLedger(session, formData, "trips.manage");
    trip = await ledger.createTrip(result.value);
  } catch (error) {
    return errorState(error);
  }
  revalidatePath(ledgerPath(formData, "/app"));
  revalidatePath(ledgerPath(formData, "/trips"));
  redirect(`${ledgerPath(formData, "/trips")}?created=${encodeURIComponent(trip.id)}`);
}

export async function updateTripAction(tripId: string, _previousState: TripActionState, formData: FormData): Promise<TripActionState> {
  const session = await requireSession();
  const result = valuesFromForm(formData);
  if (!result.ok) return invalidState(result);
  try {
    const { ledger } = await actionLedger(session, formData, "trips.manage");
    await ledger.updateTrip(tripId, result.value);
  } catch (error) {
    return errorState(error);
  }
  const tripsPath = ledgerPath(formData, "/trips");
  revalidatePath(tripsPath);
  revalidatePath(`${tripsPath}/${tripId}`);
  redirect(`${tripsPath}/${tripId}?saved=1`);
}

export async function deleteTripAction(tripId: string, _previousState: TripDeleteActionState, formData: FormData): Promise<TripDeleteActionState> {
  const session = await requireSession();
  if (formData.getAll("confirm").length !== 1 || formData.get("confirm") !== "delete") return { formError: "Confirm deletion to continue." };
  try {
    const { ledger } = await actionLedger(session, formData, "trips.manage");
    await ledger.deleteTrip(tripId);
  } catch (error) {
    return { formError: error instanceof LedgerNotFoundError ? "This Trip is no longer available." : "Unable to delete this Trip." };
  }
  revalidatePath(ledgerPath(formData, "/app"));
  revalidatePath(ledgerPath(formData, "/trips"));
  revalidatePath(ledgerPath(formData, "/outings"));
  redirect(`${ledgerPath(formData, "/trips")}?deleted=1`);
}
