"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { parseRepaymentDestination, type RepaymentDestinationFieldErrors, type RepaymentDestinationFormValues } from "@/domain/repayment-destination";
import { LedgerNotFoundError } from "@/domain/ledger-repository";
import { getAuthenticatedLedger } from "@/server/authenticated-ledger";

export type RepaymentDestinationActionState = {
  fieldErrors: RepaymentDestinationFieldErrors;
  formError: string;
  values: RepaymentDestinationFormValues;
};

function valuesFromForm(formData: FormData) {
  return parseRepaymentDestination({
    type: formData.get("type"),
    name: formData.get("name"),
    identifier: formData.get("identifier"),
    accountName: formData.get("accountName"),
    note: formData.get("note"),
    shareOnBalanceLinks: formData.get("shareOnBalanceLinks"),
  });
}

function invalidState(result: Extract<ReturnType<typeof parseRepaymentDestination>, { ok: false }>): RepaymentDestinationActionState {
  return { fieldErrors: result.errors, formError: "Please correct the marked fields.", values: result.values };
}

function errorState(error: unknown, values: RepaymentDestinationFormValues): RepaymentDestinationActionState {
  return {
    fieldErrors: {},
    formError: error instanceof LedgerNotFoundError ? "This repayment destination is no longer available." : "Unable to save this repayment destination.",
    values,
  };
}

function settingsPath() {
  return "/app/settings?saved=1#repays-to";
}

export async function createRepaymentDestinationAction(
  _previousState: RepaymentDestinationActionState,
  formData: FormData,
): Promise<RepaymentDestinationActionState> {
  const session = await requireSession();
  const result = valuesFromForm(formData);
  if (!result.ok) return invalidState(result);
  try {
    await (await getAuthenticatedLedger(session)).ledger.createRepaymentDestination(result.value);
  } catch (error) {
    return errorState(error, result.values);
  }
  revalidatePath("/app/settings");
  revalidatePath("/app/friends");
  redirect(settingsPath());
}

export async function updateRepaymentDestinationAction(
  destinationId: string,
  _previousState: RepaymentDestinationActionState,
  formData: FormData,
): Promise<RepaymentDestinationActionState> {
  const session = await requireSession();
  const result = valuesFromForm(formData);
  if (!result.ok) return invalidState(result);
  try {
    await (await getAuthenticatedLedger(session)).ledger.updateRepaymentDestination(destinationId, result.value);
  } catch (error) {
    return errorState(error, result.values);
  }
  revalidatePath("/app/settings");
  revalidatePath("/app/friends");
  redirect(settingsPath());
}

export async function deleteRepaymentDestinationAction(destinationId: string, _formData: FormData) {
  void _formData;
  const session = await requireSession();
  try {
    await (await getAuthenticatedLedger(session)).ledger.deleteRepaymentDestination(destinationId);
  } catch {
    redirect("/app/settings?error=1#repays-to");
  }
  revalidatePath("/app/settings");
  revalidatePath("/app/friends");
  redirect(settingsPath());
}

export async function reorderRepaymentDestinationsAction(formData: FormData) {
  const session = await requireSession();
  const ids = formData.getAll("destinationId");
  const movingId = formData.get("movingId");
  const direction = formData.get("direction");
  if (typeof movingId !== "string" || (direction !== "up" && direction !== "down") || ids.some((id) => typeof id !== "string")) {
    redirect("/app/settings?error=1#repays-to");
  }
  const orderedIds = ids as string[];
  const index = orderedIds.indexOf(movingId as string);
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || nextIndex < 0 || nextIndex >= orderedIds.length) redirect("/app/settings?error=1#repays-to");
  [orderedIds[index], orderedIds[nextIndex]] = [orderedIds[nextIndex]!, orderedIds[index]!];
  try {
    await (await getAuthenticatedLedger(session)).ledger.reorderRepaymentDestinations(orderedIds);
  } catch {
    redirect("/app/settings?error=1#repays-to");
  }
  revalidatePath("/app/settings");
  revalidatePath("/app/friends");
  redirect(settingsPath());
}
