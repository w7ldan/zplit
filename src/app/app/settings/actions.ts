"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { parseRepaymentDestination, type RepaymentDestinationFieldErrors, type RepaymentDestinationFormValues } from "@/domain/repayment-destination";
import { parseUsername } from "@/domain/username";
import { LedgerNotFoundError } from "@/domain/ledger-repository";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { users } from "@/db/schema";
import { getAuthenticatedLedger } from "@/server/authenticated-ledger";

export type RepaymentDestinationActionState = {
  fieldErrors: RepaymentDestinationFieldErrors;
  formError: string;
  values: RepaymentDestinationFormValues;
};

export type RepaymentDestinationFormAction = (
  previousState: RepaymentDestinationActionState,
  formData: FormData,
) => Promise<RepaymentDestinationActionState>;

export type RepaymentDestinationOrderResult = { ok: true } | { ok: false; message: string };
export type RepaymentDestinationOrderAction = (orderedIds: string[]) => Promise<RepaymentDestinationOrderResult>;

export type UsernameActionState = { error: string; value: string };
export type UsernameFormAction = (previousState: UsernameActionState, formData: FormData) => Promise<UsernameActionState>;

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

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export async function updateUsernameAction(
  _previousState: UsernameActionState,
  formData: FormData,
): Promise<UsernameActionState> {
  const value = typeof formData.get("username") === "string" ? formData.get("username") as string : "";
  const result = parseUsername(value);
  if (!result.ok) return { error: result.error, value };

  const session = await requireSession();
  try {
    const [updated] = await getDatabase()
      .update(users)
      .set({ username: result.value })
      .where(eq(users.id, session.user.id))
      .returning({ username: users.username });
    if (!updated) return { error: "Unable to save your username.", value };
  } catch (error) {
    return { error: isUniqueViolation(error) ? "That username is already taken." : "Unable to save your username.", value };
  }
  revalidatePath("/app");
  revalidatePath("/app/settings");
  redirect("/app/settings?saved=1#settings-profile-heading");
}

async function persistRepaymentDestinationOrder(orderedIds: string[]) {
  const session = await requireSession();
  await (await getAuthenticatedLedger(session)).ledger.reorderRepaymentDestinations(orderedIds);
  revalidatePath("/app/settings");
  revalidatePath("/app/friends");
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
    await persistRepaymentDestinationOrder(orderedIds);
  } catch {
    redirect("/app/settings?error=1#repays-to");
  }
  redirect(settingsPath());
}

export async function setRepaymentDestinationOrderAction(orderedIds: string[]): Promise<RepaymentDestinationOrderResult> {
  if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== "string")) {
    return { ok: false, message: "Unable to save repayment destination order." };
  }
  try {
    await persistRepaymentDestinationOrder(orderedIds);
    return { ok: true };
  } catch {
    return { ok: false, message: "Unable to save repayment destination order." };
  }
}
