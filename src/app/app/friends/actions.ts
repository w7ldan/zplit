"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { validateFriendInput, type FriendFieldErrors, type FriendInputValues } from "@/domain/friend-input";
import { LedgerNotFoundError, type FriendArchiveReversalReceipt } from "@/domain/ledger-repository";
import { addFriendToRepaymentReturnTarget, validateRepaymentReturnTarget } from "@/domain/repayment-return";
import { getAuthenticatedLedger } from "@/server/authenticated-ledger";
import type { SearchableOption } from "@/components/records/searchable-combobox";
import { searchUsernameDirectory } from "@/server/user-directory";
import { cancelFriendLinkRequest, createFriendLinkRequest, FriendLinkError } from "@/server/friend-links";
import { getDatabase } from "@/db/client";

export type FriendActionState = {
  fieldErrors: FriendFieldErrors;
  formError: string;
  values: FriendInputValues;
  archiveReceipt?: FriendArchiveReversalReceipt;
};

export type FriendArchiveUndoState =
  | { ok: true }
  | { ok: false; message: string };

export type FriendLinkActionState = { error: string };

const initialFriendActionState: FriendActionState = {
  fieldErrors: {},
  formError: "",
  values: { name: "", phoneNumber: "", notes: "" },
};

export async function searchFriendLinkUserOptions(query = ""): Promise<SearchableOption[]> {
  return (await searchUsernameDirectory(query)).map((user) => ({ id: user.id, label: `${user.displayName} · @${user.username}` }));
}

function friendLinkErrorMessage(error: unknown) {
  if (!(error instanceof FriendLinkError)) return "Unable to update this Friend link.";
  return {
    not_found: "This Friend link request is no longer available.",
    invalid_target: "Choose a Zplit account with a username.",
    self: "You cannot link a Friend to your own account.",
    already_linked: "This Friend or account is already linked.",
    duplicate_request: "A request to this account is already waiting.",
    resolved: "This Friend link request has already been resolved.",
    conflict: "This account was linked to another Friend first.",
  }[error.code];
}

export async function createFriendLinkRequestAction(
  friendId: string,
  _previousState: FriendLinkActionState,
  formData: FormData,
): Promise<FriendLinkActionState> {
  const session = await requireSession();
  const targetUserId = formData.get("targetUserId");
  if (typeof targetUserId !== "string" || !targetUserId.trim()) return { error: "Choose a Zplit account first." };
  try {
    await createFriendLinkRequest(getDatabase(), session.user.id, friendId, targetUserId);
  } catch (error) {
    return { error: friendLinkErrorMessage(error) };
  }
  revalidatePath(`/app/friends/${friendId}`);
  redirect(`/app/friends/${friendId}`);
}

export async function cancelFriendLinkRequestAction(friendId: string, requestId: string) {
  const session = await requireSession();
  try {
    await cancelFriendLinkRequest(getDatabase(), session.user.id, requestId);
  } catch {
    // The page refetches the canonical pending/confirmed state below.
  }
  revalidatePath(`/app/friends/${friendId}`);
  redirect(`/app/friends/${friendId}`);
}

function valuesFromForm(formData: FormData) {
  return validateFriendInput({
    name: formData.get("name"),
    phoneNumber: formData.get("phoneNumber"),
    countryCode: formData.get("countryCode"),
    otherCountryCode: formData.get("otherCountryCode"),
    legacyPhoneNumber: formData.get("legacyPhoneNumber"),
    phoneFieldsChanged: formData.get("phoneFieldsChanged"),
    notes: formData.get("notes"),
  });
}

function invalidState(result: Extract<ReturnType<typeof validateFriendInput>, { ok: false }>): FriendActionState {
  return { fieldErrors: result.errors, formError: "Please correct the marked fields.", values: result.values };
}

function errorState(error: unknown, operation: "save" | "archive") {
  if (error instanceof LedgerNotFoundError) {
    return { fieldErrors: {}, formError: "This friend is no longer available.", values: initialFriendActionState.values };
  }
  return {
    fieldErrors: {},
    formError: operation === "archive" ? "Unable to update this friend." : "Unable to save this friend.",
    values: initialFriendActionState.values,
  };
}

export async function createFriendAction(
  boundReturnTo: string | undefined,
  _previousState: FriendActionState,
  formData: FormData,
): Promise<FriendActionState> {
  const session = await requireSession();
  const returnTo = validateRepaymentReturnTarget(boundReturnTo);
  const result = valuesFromForm(formData);
  if (!result.ok) return invalidState(result);

  let friend;
  try {
    const { ledger } = await getAuthenticatedLedger(session);
    friend = await ledger.createFriend(result.value);
  } catch (error) {
    return errorState(error, "save");
  }
  revalidatePath("/app");
  revalidatePath("/app/friends");
  const returnTarget = returnTo ? addFriendToRepaymentReturnTarget(returnTo, friend.id) : undefined;
  if (returnTarget) redirect(returnTarget);
  redirect(`/app/friends?created=${encodeURIComponent(friend.id)}`);
}

export async function updateFriendAction(
  friendId: string,
  _previousState: FriendActionState,
  formData: FormData,
): Promise<FriendActionState> {
  const session = await requireSession();
  const result = valuesFromForm(formData);
  if (!result.ok) return invalidState(result);

  try {
    const { ledger } = await getAuthenticatedLedger(session);
    await ledger.updateFriend(friendId, result.value);
  } catch (error) {
    return errorState(error, "save");
  }

  revalidatePath("/app/friends");
  revalidatePath(`/app/friends/${friendId}`);
  redirect(`/app/friends/${friendId}?saved=1`);
}

export async function archiveFriendAction(
  friendId: string,
  _previousState: FriendActionState,
  _formData: FormData,
): Promise<FriendActionState> {
  void _previousState;
  void _formData;
  const session = await requireSession();
  try {
    const { ledger } = await getAuthenticatedLedger(session);
    const result = await ledger.archiveFriend(friendId);
    revalidatePath("/app");
    revalidatePath("/app/friends");
    revalidatePath(`/app/friends/${friendId}`);
    return { ...initialFriendActionState, archiveReceipt: result.reversalReceipt };
  } catch (error) {
    return errorState(error, "archive");
  }
}

export async function restoreFriendAction(
  friendId: string,
  _previousState: FriendActionState,
  _formData: FormData,
): Promise<FriendActionState> {
  void _previousState;
  void _formData;
  return setArchived(friendId, false);
}

export async function undoFriendArchiveAction(receipt: FriendArchiveReversalReceipt): Promise<FriendArchiveUndoState> {
  const session = await requireSession();
  try {
    const { ledger } = await getAuthenticatedLedger(session);
    await ledger.undoFriendArchive(receipt);
    revalidatePath("/app");
    revalidatePath("/app/friends");
    revalidatePath(`/app/friends/${receipt.friendId}`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof LedgerNotFoundError
        ? "Undo unavailable: this friend changed after it was archived."
        : "Undo unavailable: the archive could not be reversed.",
    };
  }
}

async function setArchived(friendId: string, archived: boolean): Promise<FriendActionState> {
  const session = await requireSession();
  try {
    const { ledger } = await getAuthenticatedLedger(session);
    await ledger.setFriendArchived(friendId, archived);
  } catch (error) {
    return errorState(error, "archive");
  }

  revalidatePath("/app/friends");
  revalidatePath(`/app/friends/${friendId}`);
  redirect(`/app/friends/${friendId}?saved=1`);
}
