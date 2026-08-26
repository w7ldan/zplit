"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { getAuthenticatedLedger } from "@/server/authenticated-ledger";
import {
  createDebtorShareLink,
  DebtorShareReceiptSelectionError,
  revokeDebtorShareLink,
  SHARED_RECEIPT_UNAVAILABLE,
  updateDebtorShareReceiptSelection,
} from "@/server/debtor-share-links";

export type DebtorShareStatement = {
  friendName: string;
  assignedAmount: number;
  repaidAmount: number;
  outstandingAmount: number;
};

export type DebtorShareActionState = {
  error: string;
  link: { token: string; expiresAt: string } | null;
  statement: DebtorShareStatement | null;
  revoked: boolean;
  selectedReceiptIds?: string[];
  selectionUpdated?: boolean;
  replacementCommitted?: boolean;
};

const initialDebtorShareActionState: DebtorShareActionState = {
  error: "",
  link: null,
  statement: null,
  revoked: false,
  selectedReceiptIds: [],
};

function selectedReceiptIds(formData: FormData) {
  const ids = formData.getAll("selectedReceiptId");
  if (ids.some((id) => typeof id !== "string")) throw new Error(SHARED_RECEIPT_UNAVAILABLE);
  return ids as string[];
}

export async function createDebtorShareLinkAction(
  friendId: string,
  _previousState: DebtorShareActionState,
  _formData: FormData,
): Promise<DebtorShareActionState> {
  void _previousState;
  const session = await requireSession();
  let replacementCommitted = false;
  try {
    const database = getDatabase();
    const selected = selectedReceiptIds(_formData);
    const link = selected.length > 0
      ? await createDebtorShareLink(database, session.user.id, friendId, selected)
      : await createDebtorShareLink(database, session.user.id, friendId);
    replacementCommitted = true;
    const { ledger } = await getAuthenticatedLedger(session);
    const statement = await ledger.getFriendDebtorStatement(friendId);
    revalidatePath(`/app/friends/${friendId}`);
    return {
      error: "",
      link: { token: link.token, expiresAt: link.expiresAt.toISOString() },
      statement: {
        friendName: statement.friendName,
        assignedAmount: statement.assignedAmount,
        repaidAmount: statement.repaidAmount,
        outstandingAmount: statement.outstandingAmount,
      },
      revoked: false,
      selectedReceiptIds: link.selectedReceiptIds ?? [],
    };
  } catch (error) {
    const result = error instanceof DebtorShareReceiptSelectionError
      ? { ...initialDebtorShareActionState, error: SHARED_RECEIPT_UNAVAILABLE }
      : { ...initialDebtorShareActionState, error: "This friend is no longer available." };
    return replacementCommitted ? { ...result, replacementCommitted: true } : result;
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
    return { error: "", link: null, statement: null, revoked: true };
  } catch {
    return { ...initialDebtorShareActionState, error: "Unable to revoke this balance link." };
  }
}

export async function updateDebtorShareReceiptSelectionAction(
  friendId: string,
  _previousState: DebtorShareActionState,
  formData: FormData,
): Promise<DebtorShareActionState> {
  void _previousState;
  const session = await requireSession();
  try {
    const selected = await updateDebtorShareReceiptSelection(getDatabase(), session.user.id, friendId, selectedReceiptIds(formData));
    revalidatePath(`/app/friends/${friendId}`);
    return { ...initialDebtorShareActionState, selectedReceiptIds: selected, selectionUpdated: true };
  } catch (error) {
    if (error instanceof DebtorShareReceiptSelectionError) return { ...initialDebtorShareActionState, error: SHARED_RECEIPT_UNAVAILABLE };
    return { ...initialDebtorShareActionState, error: "Unable to save receipt visibility." };
  }
}
