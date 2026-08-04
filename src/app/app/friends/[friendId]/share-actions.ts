"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { createLedgerRepository } from "@/domain/ledger-repository";
import { createDebtorShareLink, revokeDebtorShareLink } from "@/server/debtor-share-links";

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
};

const initialDebtorShareActionState: DebtorShareActionState = {
  error: "",
  link: null,
  statement: null,
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
    const database = getDatabase();
    const link = await createDebtorShareLink(database, session.user.id, friendId);
    const statement = await createLedgerRepository(database, session.user.id).getFriendDebtorStatement(friendId);
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
    };
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
    return { error: "", link: null, statement: null, revoked: true };
  } catch {
    return { ...initialDebtorShareActionState, error: "Unable to revoke this balance link." };
  }
}
