"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { validateRepaymentInput, type RepaymentFieldErrors, type RepaymentInputValues } from "@/domain/repayment-input";
import {
  validateRepaymentAllocationInput,
  type RepaymentAllocationFieldErrors,
  type RepaymentAllocationInputValues,
} from "@/domain/repayment-allocation-input";
import {
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
import { normalizeUuid } from "@/domain/record-retrieval";
import { parseCascadeConfirmation, parseImpactRevision } from "@/domain/deletion-confirmation";
import { getAuthenticatedLedger } from "@/server/authenticated-ledger";
import { getLedgerForAction, ledgerPath } from "@/server/organization-ledger";

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

const actionLedger = (session: Awaited<ReturnType<typeof requireSession>>, formData: FormData, capability: "repayments.create" | "repayments.edit" | "repayments.delete") => getLedgerForAction(session, formData, capability, () => getAuthenticatedLedger(session));

export async function searchFriendOptions(query = "", selectedId?: string): Promise<SearchableOption[]> {
  const { ledger } = await getAuthenticatedLedger();
  return (await ledger.searchFriends({ q: query, selectedId })).map((friend) => ({ id: friend.id, label: friend.name, archived: friend.archived }));
}

export async function searchFriendFilterOptions(query = "", selectedId?: string): Promise<SearchableOption[]> {
  return [{ id: "", label: "All friends" }, ...(await searchFriendOptions(query, selectedId)).slice(0, 19)];
}

export type RepaymentFriendContext = { option: SearchableOption; outstandingAmount: number; openExpenseShares: OpenExpenseShare[] };

export async function loadRepaymentFriendContext(friendId: string, includeOpenExpenseShares = true, tripId?: string): Promise<RepaymentFriendContext> {
  const session = await requireSession();
  const { ledger: repository } = await getAuthenticatedLedger(session);
  const requestedTripId = normalizeUuid(tripId);
  let validTripId: string | undefined;
  if (requestedTripId) {
    try {
      await repository.getTrip(requestedTripId);
      validTripId = requestedTripId;
    } catch (error) {
      if (!(error instanceof LedgerNotFoundError)) throw error;
    }
  }
  const context = validTripId ? await repository.getRepaymentFriendContext(friendId, includeOpenExpenseShares, validTripId) : await repository.getRepaymentFriendContext(friendId, includeOpenExpenseShares);
  return { ...context, option: { id: context.option.id, label: context.option.name, archived: context.option.archived } };
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

function revalidateAllocationRoutes({ repaymentId, expenseId, friendId }: { repaymentId: string; expenseId: string; friendId: string }, formData?: FormData) {
  const path = (suffix: string) => formData ? ledgerPath(formData, suffix) : `/app${suffix}`;
  revalidatePath(path(""));
  revalidatePath(path("/history"));
  revalidatePath(path("/repayments"));
  revalidatePath(path("/expenses"));
  revalidatePath(`${path("/repayments")}/${repaymentId}`);
  revalidatePath(`${path("/expenses")}/${expenseId}`);
  revalidatePath(`${path("/friends")}/${friendId}`);
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

  const { ledger: repository } = await actionLedger(session, formData, "repayments.create");
  let contextTripId: string | undefined;
  const requestedTripId = normalizeUuid(typeof formData.get("tripId") === "string" ? formData.get("tripId") : undefined);
  if (requestedTripId) {
    try {
      await repository.getTrip(requestedTripId);
      contextTripId = requestedTripId;
    } catch (error) {
      if (!(error instanceof LedgerNotFoundError)) return errorState(error, result.values, allocationResult.values, {}, paymentMethodForm);
    }
  }
  if (contextTripId && allocationResult.value.length > 0) {
    try {
      const context = await repository.getRepaymentFriendContext(result.value.friendId, true, contextTripId);
      const eligibleShareIds = new Set(context.openExpenseShares.map((share) => share.id));
      if (allocationResult.value.some((allocation) => !eligibleShareIds.has(allocation.expenseShareId))) {
        return { fieldErrors: {}, formError: "Trip context only allows allocations to this Trip's outstanding shares.", values: result.values, allocations: allocationResult.values, paymentMethodForm };
      }
    } catch (error) {
      return errorState(error, result.values, allocationResult.values, {}, paymentMethodForm);
    }
  }

  let repayment;
  try {
    repayment = await repository.createRepaymentWithAllocations(result.value, allocationResult.value);
  } catch (error) {
    return errorState(error, result.values, allocationResult.values, {}, paymentMethodForm);
  }
  revalidatePath(ledgerPath(formData, "/app"));
  revalidatePath(ledgerPath(formData, "/repayments"));
  if (contextTripId) revalidatePath(`${ledgerPath(formData, "/trips")}/${contextTripId}`);
  const redirectQuery = new URLSearchParams({ created: "1" });
  if (contextTripId) redirectQuery.set("tripId", contextTripId);
  redirect(`${ledgerPath(formData, "/repayments")}/${encodeURIComponent(repayment.id)}?${redirectQuery.toString()}`);
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
    const { ledger } = await actionLedger(session, formData, "repayments.edit");
    await ledger.updateRepayment(repaymentId, result.value);
  } catch (error) {
    return errorState(error, result.values, [], {}, paymentMethodForm);
  }

  const repaymentsPath = ledgerPath(formData, "/repayments");
  revalidatePath(ledgerPath(formData, "/app"));
  revalidatePath(repaymentsPath);
  revalidatePath(`${repaymentsPath}/${repaymentId}`);
  redirect(`${repaymentsPath}/${repaymentId}?saved=1`);
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
    const { ledger: repository } = await actionLedger(session, formData, "repayments.edit");
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

  revalidatePath(ledgerPath(formData, "/app"));
  revalidatePath(ledgerPath(formData, "/repayments"));
  revalidatePath(`${ledgerPath(formData, "/repayments")}/${repaymentId}`);
  if (!hasAllocationContext) redirect(`${ledgerPath(formData, "/repayments")}/${repaymentId}?saved=1`);
  const query = new URLSearchParams({ saved: "1" });
  if (typeof allocationQuery === "string" && allocationQuery.trim()) query.set("q", allocationQuery.trim());
  if (typeof allocationPage === "string" && /^[1-9]\d*$/.test(allocationPage)) query.set("page", allocationPage);
  redirect(`${ledgerPath(formData, "/repayments")}/${repaymentId}?${query.toString()}#repayment-allocations`);
}

export async function removeRepaymentAllocationAction(
  repaymentId: string,
  expenseShareId: string,
  _previousState: RepaymentAllocationRemovalActionState,
  formData: FormData,
): Promise<RepaymentAllocationRemovalActionState> {
  void _previousState;
  const session = await requireSession();
  try {
    const { ledger } = await actionLedger(session, formData, "repayments.edit");
    const result = await ledger.removeRepaymentAllocation(repaymentId, expenseShareId);
    revalidateAllocationRoutes(result, formData);
    return { formError: "", removalReceipt: result.reversalReceipt };
  } catch (error) {
    return {
      formError: error instanceof LedgerNotFoundError
        ? "This repayment or expense share is no longer available."
        : "Unable to remove this allocation.",
    };
  }
}

export async function undoRepaymentAllocationAction(receipt: RepaymentAllocationReversalReceipt, formData?: FormData): Promise<RepaymentAllocationUndoState> {
  const session = await requireSession();
  try {
    const { ledger } = formData ? await actionLedger(session, formData, "repayments.edit") : await getAuthenticatedLedger(session);
    const result = await ledger.undoRepaymentAllocation(receipt);
    revalidateAllocationRoutes(result, formData);
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
  const expectedImpactRevision = parseImpactRevision(formData);
  if (!expectedImpactRevision) return { formError: "Impact revision is invalid." };

  const { ledger: repository } = await actionLedger(session, formData, "repayments.delete");
  let result;
  try {
    let cascadeDependents;
    try {
      cascadeDependents = parseCascadeConfirmation(formData);
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

  revalidatePath(ledgerPath(formData, "/app"));
  revalidatePath(ledgerPath(formData, "/history"));
  revalidatePath(ledgerPath(formData, "/repayments"));
  revalidatePath(ledgerPath(formData, "/expenses"));
  revalidatePath(ledgerPath(formData, "/friends"));
  for (const friendId of result.friendIds) {
    revalidatePath(`${ledgerPath(formData, "/friends")}/${friendId}`);
  }
  if (!formData.get("organizationId")) revalidatePath("/share/[token]", "page");
  redirect(`${ledgerPath(formData, "/repayments")}?deleted=1`);
}
