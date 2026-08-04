"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { createDebtorShareLink, revokeDebtorShareLink } from "@/server/debtor-share-links";

export type DebtorShareActionState = {
  error: string;
  link: { token: string; expiresAt: string } | null;
  revoked: boolean;
};

const initialDebtorShareActionState: DebtorShareActionState = {
  error: "",
  link: null,
  revoked: false,
};

export async function createDebtorShareLinkAction(
  friendId: string,
  _previousState: DebtorShareActionState,
  _formData: FormData,
): Promise<DebtorShareActionState> {
  void _previousState;
  void _formData;
  const session = await requireSession();
  try {
    const link = await createDebtorShareLink(getDatabase(), session.user.id, friendId);
    revalidatePath(`/app/friends/${friendId}`);
    return { error: "", link: { token: link.token, expiresAt: link.expiresAt.toISOString() }, revoked: false };
  } catch {
    return { ...initialDebtorShareActionState, error: "This friend is no longer available." };
  }
}

export async function revokeDebtorShareLinkAction(
  friendId: string,
  _previousState: DebtorShareActionState,
  _formData: FormData,
): Promise<DebtorShareActionState> {
  void _previousState;
  void _formData;
  const session = await requireSession();
  try {
    await revokeDebtorShareLink(getDatabase(), session.user.id, friendId);
    revalidatePath(`/app/friends/${friendId}`);
    return { error: "", link: null, revoked: true };
  } catch {
    return { ...initialDebtorShareActionState, error: "Unable to revoke this balance link." };
  }
}
