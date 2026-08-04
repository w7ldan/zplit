"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { validateFriendInput, type FriendFieldErrors, type FriendInputValues } from "@/domain/friend-input";
import { createLedgerRepository, LedgerNotFoundError } from "@/domain/ledger-repository";

export type FriendActionState = {
  fieldErrors: FriendFieldErrors;
  formError: string;
  values: FriendInputValues;
};

const initialFriendActionState: FriendActionState = {
  fieldErrors: {},
  formError: "",
  values: { name: "", phoneNumber: "", notes: "" },
};

function valuesFromForm(formData: FormData) {
  return validateFriendInput({
    name: formData.get("name"),
    phoneNumber: formData.get("phoneNumber"),
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
  _previousState: FriendActionState,
  formData: FormData,
): Promise<FriendActionState> {
  const session = await requireSession();
  const result = valuesFromForm(formData);
  if (!result.ok) return invalidState(result);

  let friend;
  try {
    friend = await createLedgerRepository(getDatabase(), session.user.id).createFriend(result.value);
  } catch (error) {
    return errorState(error, "save");
  }
  revalidatePath("/app");
  revalidatePath("/app/friends");
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
    await createLedgerRepository(getDatabase(), session.user.id).updateFriend(friendId, result.value);
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
  return setArchived(friendId, true);
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

async function setArchived(friendId: string, archived: boolean): Promise<FriendActionState> {
  const session = await requireSession();
  try {
    await createLedgerRepository(getDatabase(), session.user.id).setFriendArchived(friendId, archived);
  } catch (error) {
    return errorState(error, "archive");
  }

  revalidatePath("/app/friends");
  revalidatePath(`/app/friends/${friendId}`);
  redirect(`/app/friends/${friendId}?saved=1`);
}
