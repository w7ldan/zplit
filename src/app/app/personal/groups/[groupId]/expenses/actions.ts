"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { GroupAccountingInputError, normalizeGroupExpenseInput } from "@/domain/group-accounting";
import { parseLocalDateTime } from "@/domain/outing-input";
import { GroupAccountingError, confirmGroupExpenseAsPayer, createGroupExpense } from "@/server/group-accounting";

export type GroupExpenseShareFormValue = { participantId: string; amount: string };
export type GroupExpenseFormValues = { description: string; totalAmount: string; occurredAtLocal: string; timezoneOffsetMinutes: string; payerParticipantId: string; shares: GroupExpenseShareFormValue[] };
export type GroupExpenseActionState = { fieldErrors: Partial<Record<"description" | "totalAmount" | "occurredAtLocal" | "payerParticipantId" | "shares", string>>; formError: string; values: GroupExpenseFormValues };
export type GroupExpenseConfirmationState = { error: string; success?: string };

const emptyValues: GroupExpenseFormValues = { description: "", totalAmount: "", occurredAtLocal: "", timezoneOffsetMinutes: "", payerParticipantId: "", shares: [] };

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function valuesFromForm(formData: FormData): GroupExpenseFormValues {
  const participantIds = formData.getAll("participantId");
  const amounts = formData.getAll("shareAmount");
  return {
    description: text(formData, "description"),
    totalAmount: text(formData, "totalAmount"),
    occurredAtLocal: text(formData, "occurredAtLocal"),
    timezoneOffsetMinutes: text(formData, "timezoneOffsetMinutes"),
    payerParticipantId: text(formData, "payerParticipantId"),
    shares: participantIds.map((participantId, index) => ({ participantId: typeof participantId === "string" ? participantId.trim() : "", amount: typeof amounts[index] === "string" ? amounts[index].trim() : "" })),
  };
}

function state(values: GroupExpenseFormValues, fieldErrors: GroupExpenseActionState["fieldErrors"] = {}, formError = "") {
  return { fieldErrors, formError, values };
}

function inputFromValues(values: GroupExpenseFormValues) {
  const offset = Number(values.timezoneOffsetMinutes);
  const occurredAt = /^-?\d+$/.test(values.timezoneOffsetMinutes) && Number.isInteger(offset) && offset >= -840 && offset <= 840 ? parseLocalDateTime(values.occurredAtLocal, offset) : null;
  if (!occurredAt) return null;
  return { description: values.description, totalAmount: values.totalAmount, occurredAt, payerParticipantId: values.payerParticipantId, shares: values.shares.map((share) => ({ participantId: share.participantId, amount: share.amount })) };
}

function inputErrorState(error: unknown, values: GroupExpenseFormValues): GroupExpenseActionState {
  if (error instanceof GroupAccountingInputError) {
    const field = error.code === "invalid_amount" ? error.amountField === "share" ? "shares" : "totalAmount" : error.code === "invalid_date" ? "occurredAtLocal" : error.code === "share_total_mismatch" ? "shares" : undefined;
    return state(values, field ? { [field]: error.code === "share_total_mismatch" ? "Shares must equal the expense total." : error.code === "invalid_amount" ? "Use a positive whole-rupiah amount." : "Enter a valid date and time." } : {}, error.code === "duplicate_share" ? "Each participant can appear only once." : "Please correct the marked fields.");
  }
  if (error instanceof GroupAccountingError) {
    const messages: Partial<Record<GroupAccountingError["code"], string>> = {
      not_member: "You are no longer a member of this Group.",
      forbidden: "You cannot add an expense to this Group.",
      payer_not_found: "Choose an active registered payer.",
      payer_external: "External participants cannot be payers.",
      payer_not_active: "That payer is no longer an active Group member.",
      participant_not_found: "One of the selected participants is no longer available.",
      participant_not_eligible: "Former participants cannot receive new shares.",
      share_total_mismatch: "Shares must equal the expense total.",
      financial_integrity: "The accounting data changed. Reload and try again.",
    };
    return state(values, {}, messages[error.code] ?? "This Group expense is no longer available.");
  }
  return state(values, {}, "Unable to save this Group expense.");
}

export async function createGroupExpenseAction(groupId: string, _previousState: GroupExpenseActionState, formData: FormData): Promise<GroupExpenseActionState> {
  const values = valuesFromForm(formData);
  if (!values.description) return state(values, { description: "Enter a description." }, "Please correct the marked fields.");
  if (!values.occurredAtLocal || !values.timezoneOffsetMinutes || !inputFromValues(values)) return state(values, { occurredAtLocal: "Enter a valid date and time." }, "Please correct the marked fields.");
  if (values.shares.length === 0) return state(values, { shares: "Add at least one participant share." }, "Please correct the marked fields.");
  const input = inputFromValues(values);
  if (!input) return state(values, { occurredAtLocal: "Enter a valid date and time." }, "Please correct the marked fields.");
  const session = await requireSession();
  let expense;
  try {
    expense = await createGroupExpense(getDatabase(), groupId, session.user.id, normalizeGroupExpenseInput(input));
  } catch (error) {
    return inputErrorState(error, values);
  }
  const path = `/app/personal/groups/${groupId}/expenses`;
  revalidatePath(`/app/personal/groups/${groupId}`);
  revalidatePath(path);
  redirect(`${path}/${expense.id}?created=1`);
}

export async function confirmGroupExpenseAction(groupId: string, expenseId: string, _previousState: GroupExpenseConfirmationState, _formData: FormData): Promise<GroupExpenseConfirmationState> {
  void _previousState;
  void _formData;
  const session = await requireSession();
  try {
    await confirmGroupExpenseAsPayer(getDatabase(), groupId, expenseId, session.user.id);
  } catch (error) {
    if (error instanceof GroupAccountingError) {
      const message = error.code === "forbidden" ? "Only the claimed payer can confirm this expense." : error.code === "not_member" ? "You are no longer a member of this Group." : error.code === "invalid_state" ? "This expense is no longer pending." : "This expense is no longer available.";
      return { error: message };
    }
    return { error: "Unable to confirm this expense." };
  }
  const path = `/app/personal/groups/${groupId}/expenses`;
  revalidatePath(`/app/personal/groups/${groupId}`);
  revalidatePath(path);
  revalidatePath(`${path}/${expenseId}`);
  return { error: "", success: "Expense confirmed. Participant obligations are now authoritative." };
}

export const emptyGroupExpenseActionState: GroupExpenseActionState = state(emptyValues);
