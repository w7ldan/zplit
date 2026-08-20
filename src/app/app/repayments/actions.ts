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
  deletionImpactRevision,
  LedgerNotFoundError,
  RepaymentAllocationAmountInvariantError,
  RepaymentAllocationShareInvariantError,
  RepaymentAmountInvariantError,
  RepaymentFriendInvariantError,
  LedgerDeletionConfirmationRequiredError,
  type RepaymentAllocationReversalReceipt,
} from "@/domain/ledger-repository";
import type { DeleteRecordActionState } from "@/components/app/delete-record-form";
import type { SearchableOption } from "@/components/records/searchable-combobox";
import type { OpenExpenseShare } from "@/domain/ledger-repository";
import { paymentMethodFormState, parsePaymentMethodFields, type PaymentMethodFormState } from "@/domain/payment-method";

export type RepaymentActionState = {
  fieldErrors: RepaymentFieldErrors;
  formError: string;
  values: RepaymentInputValues;
  allocations?: RepaymentAllocationInputValues;
  allocationFieldErrors?: RepaymentAllocationFieldErrors;
  paymentMethodForm?: PaymentMethodFormState;
};

export type RepaymentAllocationActionState = {
  fieldErrors: RepaymentAllocationFieldErrors;
  formError: string;
  values: RepaymentAllocationInputValues;
};

export type RepaymentAllocationRemovalActionState = {
  formError: string;
  removalReceipt?: RepaymentAllocationReversalReceipt;
};

export type RepaymentAllocationUndoState =
  | { ok: true }
  | { ok: false; message: string };

export type RepaymentDeleteActionState = DeleteRecordActionState;

export async function searchFriendOptions(query = "", selectedId?: string): Promise<SearchableOption[]> {
  const session = await requireSession();
  return (await createLedgerRepository(getDatabase(), session.user.id).searchFriends({ q: query, selectedId })).map((friend) => ({ id: friend.id, label: friend.name, archived: friend.archived }));
}

export async function searchFriendFilterOptions(query = "", selectedId?: string): Promise<SearchableOption[]> {
  return [{ id: "", label: "All friends" }, ...(await searchFriendOptions(query, selectedId)).slice(0, 19)];
}

export type RepaymentFriendContext = { option: SearchableOption; outstandingAmount: number; openExpenseShares: OpenExpenseShare[] };

export async function loadRepaymentFriendContext(friendId: string, includeOpenExpenseShares = true): Promise<RepaymentFriendContext> {
  const session = await requireSession();
  const context = await createLedgerRepository(getDatabase(), session.user.id).getRepaymentFriendContext(friendId, includeOpenExpenseShares);
  return { ...context, option: { id: context.option.id, label: context.option.name, archived: context.option.archived } };
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

function paymentMethodFormFromForm(formData: FormData): PaymentMethodFormState {
  const choice = formData.get("paymentMethodChoice");
  if (choice !== null) return parsePaymentMethodFields(choice, formData.get("paymentMethodOther")).form;
  return paymentMethodFormState(typeof formData.get("paymentMethod") === "string" ? formData.get("paymentMethod") as string : "");
}

function valuesFromForm(formData: FormData) {
  const paymentMethodChoice = formData.get("paymentMethodChoice");
  const input = {
    friendId: formData.get("friendId"),
    amountRupiah: formData.get("amountRupiah"),
    paidAtLocal: formData.get("paidAtLocal"),
    timezoneOffsetMinutes: formData.get("timezoneOffsetMinutes"),
    ...(paymentMethodChoice !== null ? { paymentMethodChoice, paymentMethodOther: formData.get("paymentMethodOther") } : { paymentMethod: formData.get("paymentMethod") }),
    notes: formData.get("notes"),
  };
  return { result: validateRepaymentInput(input), paymentMethodForm: paymentMethodFormFromForm(formData) };
}

function invalidState(result: Extract<ReturnType<typeof validateRepaymentInput>, { ok: false }>, paymentMethodForm: PaymentMethodFormState): RepaymentActionState {
  return { fieldErrors: result.errors, formError: "Please correct the marked fields.", values: result.values, paymentMethodForm };
}

function errorState(error: unknown, values: RepaymentInputValues, allocations: RepaymentAllocationInputValues = [], allocationFieldErrors: RepaymentAllocationFieldErrors = {}, paymentMethodForm?: PaymentMethodFormState): RepaymentActionState {
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
    ...(paymentMethodForm ? { paymentMethodForm } : {}),
  };
}

function allocationValuesFromForm(formData: FormData) {
  const ids = formData.getAll("expenseShareId");
  const amounts = ids.length ? formData.getAll("amountRupiah").slice(-ids.length) : [];
  const values = ids.map((_, index) => ({
    expenseShareId: typeof ids[index] === "string" ? ids[index].trim() : "",
    amountRupiah: typeof amounts[index] === "string" ? amounts[index].trim() : "",
  })).filter((allocation) => allocation.expenseShareId);
  return validateRepaymentAllocationInput(values);
}

function revalidateAllocationRoutes({ repaymentId, expenseId, friendId }: { repaymentId: string; expenseId: string; friendId: string }) {
  revalidatePath("/app");
  revalidatePath("/app/history");
  revalidatePath("/app/repayments");
  revalidatePath("/app/expenses");
  revalidatePath(`/app/repayments/${repaymentId}`);
  revalidatePath(`/app/expenses/${expenseId}`);
  revalidatePath(`/app/friends/${friendId}`);
}

export async function createRepaymentAction(
  _previousState: RepaymentActionState,
  formData: FormData,
): Promise<RepaymentActionState> {
  const session = await requireSession();
  const { result, paymentMethodForm } = valuesFromForm(formData);
  const allocationResult = allocationValuesFromForm(formData);
  if (!result.ok) return { ...invalidState(result, paymentMethodForm), allocations: allocationResult.ok ? allocationResult.values : allocationResult.values, allocationFieldErrors: allocationResult.ok ? {} : allocationResult.errors };
  if (!allocationResult.ok) return { fieldErrors: {}, formError: "Please correct the marked fields.", values: result.values, allocations: allocationResult.values, allocationFieldErrors: allocationResult.errors, paymentMethodForm };

  let repayment;
  try {
    repayment = await createLedgerRepository(getDatabase(), session.user.id).createRepaymentWithAllocations(result.value, allocationResult.value);
  } catch (error) {
    return errorState(error, result.values, allocationResult.values, {}, paymentMethodForm);
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
  const { result, paymentMethodForm } = valuesFromForm(formData);
  if (!result.ok) return invalidState(result, paymentMethodForm);

  try {
    await createLedgerRepository(getDatabase(), session.user.id).updateRepayment(repaymentId, result.value);
  } catch (error) {
    return errorState(error, result.values, [], {}, paymentMethodForm);
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

  const allocationQuery = formData.get("allocationQuery");
  const allocationPage = formData.get("allocationPage");
  const hasAllocationContext = allocationQuery !== null || allocationPage !== null;
  try {
    const repository = createLedgerRepository(getDatabase(), session.user.id);
    if (hasAllocationContext) {
      await repository.replaceRepaymentAllocations(repaymentId, result.value, { q: allocationQuery, page: allocationPage });
    } else {
      await repository.replaceRepaymentAllocations(repaymentId, result.value);
    }
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
  if (!hasAllocationContext) redirect(`/app/repayments/${repaymentId}?saved=1`);
  const query = new URLSearchParams({ saved: "1" });
  if (typeof allocationQuery === "string" && allocationQuery.trim()) query.set("q", allocationQuery.trim());
  if (typeof allocationPage === "string" && /^[1-9]\d*$/.test(allocationPage)) query.set("page", allocationPage);
  redirect(`/app/repayments/${repaymentId}?${query.toString()}#repayment-allocations`);
}

export async function removeRepaymentAllocationAction(
  repaymentId: string,
  expenseShareId: string,
  _previousState: RepaymentAllocationRemovalActionState,
  _formData: FormData,
): Promise<RepaymentAllocationRemovalActionState> {
  void _previousState;
  void _formData;
  const session = await requireSession();
  try {
    const result = await createLedgerRepository(getDatabase(), session.user.id).removeRepaymentAllocation(repaymentId, expenseShareId);
    revalidateAllocationRoutes(result);
    return { formError: "", removalReceipt: result.reversalReceipt };
  } catch (error) {
    return {
      formError: error instanceof LedgerNotFoundError
        ? "This repayment or expense share is no longer available."
        : "Unable to remove this allocation.",
    };
  }
}

export async function undoRepaymentAllocationAction(receipt: RepaymentAllocationReversalReceipt): Promise<RepaymentAllocationUndoState> {
  const session = await requireSession();
  try {
    const result = await createLedgerRepository(getDatabase(), session.user.id).undoRepaymentAllocation(receipt);
    revalidateAllocationRoutes(result);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof LedgerNotFoundError
        ? "Undo unavailable: this allocation or a related record changed."
        : error instanceof RepaymentAllocationAmountInvariantError || error instanceof RepaymentAllocationShareInvariantError
          ? `Undo unavailable: ${error.message}`
          : "Undo unavailable: the allocation could not be restored.",
    };
  }
}

export async function deleteRepaymentAction(
  repaymentId: string,
  _previousState: RepaymentDeleteActionState,
  formData: FormData,
): Promise<RepaymentDeleteActionState> {
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
    result = await repository.deleteRepayment(repaymentId, { cascadeDependents, expectedImpactRevision });
  } catch (error) {
    return {
      formError: error instanceof LedgerDeletionConfirmationRequiredError
        ? error.reason === "cascade_confirmation_required"
          ? "Review the dependent records and confirm their deletion."
          : "The dependent records changed. Review the updated deletion impact and confirm again."
        : error instanceof LedgerNotFoundError
          ? "This repayment is no longer available."
          : "Unable to delete this repayment.",
      ...(error instanceof LedgerDeletionConfirmationRequiredError ? { impact: error.impact, impactRevision: deletionImpactRevision(error.impact) } : {}),
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
