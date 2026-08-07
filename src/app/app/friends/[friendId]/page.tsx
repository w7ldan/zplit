import Link from "next/link";
import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { createLedgerRepository, LedgerNotFoundError } from "@/domain/ledger-repository";
import { FriendArchiveForm, FriendForm } from "@/components/friends/friend-form";
import { FriendShareLink } from "@/components/friends/friend-share-link";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { RecordConfirmation } from "@/components/app/record-confirmation";
import { archiveFriendAction, restoreFriendAction, undoFriendArchiveAction, updateFriendAction } from "../actions";
import { createDebtorShareLinkAction, revokeDebtorShareLinkAction, updateDebtorShareReceiptSelectionAction } from "./share-actions";
import { getDebtorShareLinkStatus, getDebtorShareReceiptSelection } from "@/server/debtor-share-links";

export const dynamic = "force-dynamic";

export default async function FriendRecordPage({ params, searchParams }: { params: Promise<{ friendId: string }>; searchParams?: Promise<{ saved?: string | string[] }> }) {
  const session = await requireSession();
  const { friendId } = await params;
  const query = await searchParams;
  let friend;
  let shareStatus;
  let eligibleReceipts;
  let selectedReceiptIds;
  try {
    const database = getDatabase();
    const repository = createLedgerRepository(database, session.user.id);
    friend = await repository.getFriend(friendId);
    [shareStatus, eligibleReceipts, selectedReceiptIds] = await Promise.all([
      getDebtorShareLinkStatus(database, session.user.id, friendId),
      repository.listEligibleDebtorShareReceipts(friendId),
      getDebtorShareReceiptSelection(database, session.user.id, friendId),
    ]);
  } catch (error) {
    if (error instanceof LedgerNotFoundError) notFound();
    throw error;
  }

  const archived = friend.archivedAt !== null;
  return (
    <section className="app-page friend-record" id="top">
      <div className="editorial-grid editorial-shell friend-record__layout">
        <div className="friend-record__intro">
          <p className="technical-label">Friend · editable record</p>
          <h1>{friend.name}</h1>
          <div className="friend-record__actions">
            <Link className="action-link action-link--quiet" href={`/app/repayments?create=1&friendId=${friend.id}`}>Record repayment</Link>
            <Link className="friend-record__back" href="/app/friends">← Back to friends</Link>
          </div>
        </div>
        {query?.saved === "1" ? <RecordConfirmation queryKey="saved" message="Friend changes saved." /> : null}
        <div className="friend-record__meta" aria-label="Friend metadata">
          <div><span className="technical-label">Record state</span><strong>{archived ? "ARCHIVED" : "ACTIVE"}</strong></div>
          <div><span className="technical-label">Created</span><LocalDateTime iso={friend.createdAt.toISOString()} mode="date" /></div>
        </div>
        <div className="friend-record__form">
          <p className="technical-label">EDIT RECORD</p>
          <FriendForm
            action={updateFriendAction.bind(null, friend.id)}
            mode="edit"
            initialValues={{ name: friend.name, phoneNumber: friend.phoneNumber ?? "", notes: friend.notes ?? "" }}
          />
          <FriendArchiveForm action={(archived ? restoreFriendAction : archiveFriendAction).bind(null, friend.id)} archived={archived} undoAction={undoFriendArchiveAction} />
        </div>
        <FriendShareLink
          status={{ status: shareStatus.status, expiresAt: shareStatus.expiresAt?.toISOString() ?? null }}
          phoneNumber={friend.phoneNumber}
          createAction={createDebtorShareLinkAction.bind(null, friend.id)}
          revokeAction={revokeDebtorShareLinkAction.bind(null, friend.id)}
          updateSelectionAction={updateDebtorShareReceiptSelectionAction.bind(null, friend.id)}
          eligibleReceipts={eligibleReceipts}
          selectedReceiptIds={selectedReceiptIds}
        />
      </div>
    </section>
  );
}
