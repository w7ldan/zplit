"use server";

import { getAuthenticatedOrganizationLedger } from "@/server/authenticated-ledger";
import type { SearchableOption } from "@/components/records/searchable-combobox";
import { normalizeUuid } from "@/domain/record-retrieval";
import type { FriendArchiveReversalReceipt } from "@/domain/ledger-repository";
import * as friends from "@/app/app/friends/actions";
import * as trips from "@/app/app/trips/actions";
import * as outings from "@/app/app/outings/actions";
import * as expenses from "@/app/app/expenses/actions";
import * as repayments from "@/app/app/repayments/actions";
import * as settings from "@/app/app/settings/actions";

function scopeForm(organizationId: string, formData: FormData) {
  formData.set("organizationId", organizationId);
  return formData;
}

export async function createFriendAction(organizationId: string, returnTo: string | undefined, state: friends.FriendActionState, formData: FormData) {
  return friends.createFriendAction(returnTo, state, scopeForm(organizationId, formData));
}
export async function updateFriendAction(organizationId: string, friendId: string, state: friends.FriendActionState, formData: FormData) {
  return friends.updateFriendAction(friendId, state, scopeForm(organizationId, formData));
}
export async function archiveFriendAction(organizationId: string, friendId: string, state: friends.FriendActionState, formData: FormData) {
  return friends.archiveFriendAction(friendId, state, scopeForm(organizationId, formData));
}
export async function restoreFriendAction(organizationId: string, friendId: string, state: friends.FriendActionState, formData: FormData) {
  return friends.restoreFriendAction(friendId, state, scopeForm(organizationId, formData));
}
export async function undoFriendArchiveAction(organizationId: string, receipt: FriendArchiveReversalReceipt) {
  return friends.undoFriendArchiveAction(receipt, scopeForm(organizationId, new FormData()));
}

export async function createTripAction(organizationId: string, state: trips.TripActionState, formData: FormData) {
  return trips.createTripAction(state, scopeForm(organizationId, formData));
}
export async function updateTripAction(organizationId: string, tripId: string, state: trips.TripActionState, formData: FormData) {
  return trips.updateTripAction(tripId, state, scopeForm(organizationId, formData));
}
export async function deleteTripAction(organizationId: string, tripId: string, state: trips.TripDeleteActionState, formData: FormData) {
  return trips.deleteTripAction(tripId, state, scopeForm(organizationId, formData));
}

export async function searchTripOptions(organizationId: string, query = "", selectedId?: string): Promise<SearchableOption[]> {
  const { ledger } = await getAuthenticatedOrganizationLedger(organizationId, "ledger.view");
  return [{ id: "", label: "No trip" }, ...(await ledger.searchTrips({ q: query, selectedId })).map((trip) => ({ id: trip.id, label: trip.name }))].slice(0, 20);
}
export async function searchTripFilterOptions(organizationId: string, query = "", selectedId?: string): Promise<SearchableOption[]> {
  return [{ id: "", label: "All trips" }, { id: "unassigned", label: "No trip" }, ...(await searchTripOptions(organizationId, query, selectedId)).filter((trip) => trip.id).slice(0, 18)];
}

export async function createOutingAction(organizationId: string, returnTo: string | undefined, state: outings.OutingActionState, formData: FormData) {
  return outings.createOutingAction(returnTo, state, scopeForm(organizationId, formData));
}
export async function updateOutingAction(organizationId: string, outingId: string, state: outings.OutingActionState, formData: FormData) {
  return outings.updateOutingAction(outingId, state, scopeForm(organizationId, formData));
}
export async function deleteOutingAction(organizationId: string, outingId: string, state: outings.OutingDeleteActionState, formData: FormData) {
  return outings.deleteOutingAction(outingId, state, scopeForm(organizationId, formData));
}

export async function searchOutingOptions(organizationId: string, query = "", selectedId?: string): Promise<SearchableOption[]> {
  const { ledger } = await getAuthenticatedOrganizationLedger(organizationId, "ledger.view");
  return (await ledger.searchOutings({ q: query, selectedId })).map((outing) => ({ id: outing.id, label: outing.title, group: outing.recent ? "Recent" : undefined }));
}
export async function searchOutingFilterOptions(organizationId: string, query = "", selectedId?: string): Promise<SearchableOption[]> {
  return [{ id: "", label: "All outings" }, ...(await searchOutingOptions(organizationId, query, selectedId)).slice(0, 19)];
}
export async function searchExpenseFriendOptions(organizationId: string, query = "", selectedId?: string): Promise<SearchableOption[]> {
  const { ledger } = await getAuthenticatedOrganizationLedger(organizationId, "ledger.view");
  return (await ledger.searchFriends({ q: query, selectedId, activeOnly: true })).filter((friend) => !friend.archived && friend.id !== selectedId).slice(0, 20).map((friend) => ({ id: friend.id, label: friend.name }));
}

export async function createExpenseAction(organizationId: string, state: expenses.ExpenseActionState, formData: FormData) {
  return expenses.createExpenseAction(state, scopeForm(organizationId, formData));
}
export async function updateExpenseAction(organizationId: string, expenseId: string, state: expenses.ExpenseActionState, formData: FormData) {
  return expenses.updateExpenseAction(expenseId, state, scopeForm(organizationId, formData));
}
export async function replaceExpenseSharesAction(organizationId: string, expenseId: string, state: expenses.ExpenseShareActionState, formData: FormData) {
  return expenses.replaceExpenseSharesAction(expenseId, state, scopeForm(organizationId, formData));
}
export async function deleteExpenseAction(organizationId: string, expenseId: string, state: expenses.ExpenseDeleteActionState, formData: FormData) {
  return expenses.deleteExpenseAction(expenseId, state, scopeForm(organizationId, formData));
}

export async function searchFriendOptions(organizationId: string, query = "", selectedId?: string): Promise<SearchableOption[]> {
  const { ledger } = await getAuthenticatedOrganizationLedger(organizationId, "ledger.view");
  return (await ledger.searchFriends({ q: query, selectedId })).map((friend) => ({ id: friend.id, label: friend.name, archived: friend.archived }));
}
export async function searchFriendFilterOptions(organizationId: string, query = "", selectedId?: string): Promise<SearchableOption[]> {
  return [{ id: "", label: "All friends" }, ...(await searchFriendOptions(organizationId, query, selectedId)).slice(0, 19)];
}
export async function loadRepaymentFriendContext(organizationId: string, friendId: string, includeOpenExpenseShares = true, tripId?: string): Promise<repayments.RepaymentFriendContext> {
  const { ledger } = await getAuthenticatedOrganizationLedger(organizationId, "ledger.view");
  const requestedTripId = normalizeUuid(tripId);
  let validTripId: string | undefined;
  if (requestedTripId) {
    try {
      await ledger.getTrip(requestedTripId);
      validTripId = requestedTripId;
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "LedgerNotFoundError") throw error;
    }
  }
  const context = validTripId ? await ledger.getRepaymentFriendContext(friendId, includeOpenExpenseShares, validTripId) : await ledger.getRepaymentFriendContext(friendId, includeOpenExpenseShares);
  return { ...context, option: { id: context.option.id, label: context.option.name, archived: context.option.archived } };
}
export async function createRepaymentAction(organizationId: string, state: repayments.RepaymentActionState, formData: FormData) {
  return repayments.createRepaymentAction(state, scopeForm(organizationId, formData));
}
export async function updateRepaymentAction(organizationId: string, repaymentId: string, state: repayments.RepaymentActionState, formData: FormData) {
  return repayments.updateRepaymentAction(repaymentId, state, scopeForm(organizationId, formData));
}
export async function replaceRepaymentAllocationsAction(organizationId: string, repaymentId: string, state: repayments.RepaymentAllocationActionState, formData: FormData) {
  return repayments.replaceRepaymentAllocationsAction(repaymentId, state, scopeForm(organizationId, formData));
}
export async function removeRepaymentAllocationAction(organizationId: string, repaymentId: string, expenseShareId: string, state: repayments.RepaymentAllocationRemovalActionState, formData: FormData) {
  return repayments.removeRepaymentAllocationAction(repaymentId, expenseShareId, state, scopeForm(organizationId, formData));
}
export async function undoRepaymentAllocationAction(organizationId: string, receipt: Parameters<typeof repayments.undoRepaymentAllocationAction>[0]) {
  return repayments.undoRepaymentAllocationAction(receipt, scopeForm(organizationId, new FormData()));
}
export async function deleteRepaymentAction(organizationId: string, repaymentId: string, state: repayments.RepaymentDeleteActionState, formData: FormData) {
  return repayments.deleteRepaymentAction(repaymentId, state, scopeForm(organizationId, formData));
}

export async function createRepaymentDestinationAction(organizationId: string, state: settings.RepaymentDestinationActionState, formData: FormData) {
  return settings.createRepaymentDestinationAction(state, scopeForm(organizationId, formData));
}
export async function updateRepaymentDestinationAction(organizationId: string, destinationId: string, state: settings.RepaymentDestinationActionState, formData: FormData) {
  return settings.updateRepaymentDestinationAction(destinationId, state, scopeForm(organizationId, formData));
}
export async function deleteRepaymentDestinationAction(organizationId: string, destinationId: string, formData: FormData) {
  return settings.deleteRepaymentDestinationAction(destinationId, scopeForm(organizationId, formData));
}
export async function setRepaymentDestinationOrderAction(organizationId: string, orderedIds: string[]) {
  if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== "string")) return { ok: false as const, message: "Unable to save repayment destination order." };
  try {
    const { ledger } = await getAuthenticatedOrganizationLedger(organizationId, "repayment_destinations.manage");
    await ledger.reorderRepaymentDestinations(orderedIds);
    return { ok: true as const };
  } catch {
    return { ok: false as const, message: "Unable to save repayment destination order." };
  }
}
