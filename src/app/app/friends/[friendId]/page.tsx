import Link from "next/link";
import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { createLedgerRepository, LedgerNotFoundError } from "@/domain/ledger-repository";
import { FriendArchiveForm, FriendForm } from "@/components/friends/friend-form";
import { RecordConfirmation } from "@/components/app/record-confirmation";
import { archiveFriendAction, restoreFriendAction, updateFriendAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function FriendRecordPage({ params, searchParams }: { params: Promise<{ friendId: string }>; searchParams?: Promise<{ saved?: string | string[] }> }) {
  const session = await requireSession();
  const { friendId } = await params;
  const query = await searchParams;
  let friend;
  try {
    friend = await createLedgerRepository(getDatabase(), session.user.id).getFriend(friendId);
  } catch (error) {
    if (error instanceof LedgerNotFoundError) notFound();
    throw error;
  }

  const archived = friend.archivedAt !== null;
  const date = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(friend.createdAt);

  return (
    <section className="app-page friend-record" id="top">
      <div className="editorial-grid editorial-shell friend-record__layout">
        <div className="friend-record__intro">
          <p className="technical-label">Friend · editable record</p>
          <h1>{friend.name}</h1>
          <Link className="friend-record__back" href="/app/friends">← Back to friends</Link>
        </div>
        {query?.saved === "1" ? <RecordConfirmation queryKey="saved" message="Friend changes saved." /> : null}
        <div className="friend-record__meta" aria-label="Friend metadata">
          <div><span className="technical-label">Record state</span><strong>{archived ? "ARCHIVED" : "ACTIVE"}</strong></div>
          <div><span className="technical-label">Created</span><time dateTime={friend.createdAt.toISOString()}>{date}</time></div>
        </div>
        <div className="friend-record__form">
          <p className="technical-label">EDIT RECORD</p>
          <FriendForm
            action={updateFriendAction.bind(null, friend.id)}
            mode="edit"
            initialValues={{ name: friend.name, phoneNumber: friend.phoneNumber ?? "", notes: friend.notes ?? "" }}
          />
          <FriendArchiveForm action={(archived ? restoreFriendAction : archiveFriendAction).bind(null, friend.id)} archived={archived} />
        </div>
      </div>
    </section>
  );
}
