import Link from "next/link";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { createLedgerRepository } from "@/domain/ledger-repository";
import { createFriendAction } from "./actions";
import { FriendForm } from "@/components/friends/friend-form";
import { FriendRow } from "@/components/friends/friend-row";

export const dynamic = "force-dynamic";

type FriendsPageProps = {
  searchParams?: Promise<{ view?: string | string[] }>;
};

export default async function FriendsPage({ searchParams }: FriendsPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const view = params?.view === "archived" || (Array.isArray(params?.view) && params.view.includes("archived")) ? "archived" : "active";
  const friends = await createLedgerRepository(getDatabase(), session.user.id).listFriends({ archived: view === "archived" });

  return (
    <section className="friends-page" id="top">
      <div className="editorial-grid editorial-shell friends-page__layout">
        <div className="friends-page__marker technical-label">07 / FRIENDS</div>
        <div className="friends-page__intro">
          <p className="technical-label">PEOPLE / OWNER RECORDS</p>
          <h1>People in your ledger.</h1>
          <p>Keep the people connected to your shared records clear, current, and easy to find.</p>
        </div>

        <nav className="friends-page__views" aria-label="Friend record views">
          <Link className={view === "active" ? "friends-page__view friends-page__view--selected" : "friends-page__view"} href="/app/friends?view=active" aria-current={view === "active" ? "page" : undefined}>Active <span aria-hidden="true">→</span></Link>
          <Link className={view === "archived" ? "friends-page__view friends-page__view--selected" : "friends-page__view"} href="/app/friends?view=archived" aria-current={view === "archived" ? "page" : undefined}>Archived <span aria-hidden="true">→</span></Link>
        </nav>

        <div className="friends-page__list" aria-live="polite">
          <div className="friends-page__list-heading">
            <span className="technical-label">{view === "active" ? "ACTIVE RECORDS" : "ARCHIVED RECORDS"}</span>
            <span className="technical-label">{friends.length.toString().padStart(2, "0")} ENTRIES</span>
          </div>
          {friends.length > 0 ? (
            friends.map((friend) => <FriendRow key={friend.id} friend={friend} />)
          ) : (
            <div className="friends-page__empty">
              <h2>{view === "active" ? "No active friends yet." : "No archived friends yet."}</h2>
              <p>{view === "active" ? "Add the first person to begin your private record." : "Archived records will remain available here when you need them."}</p>
            </div>
          )}
        </div>

        <div className="friends-page__create">
          <p className="technical-label">NEW RECORD</p>
          <h2>Add a friend</h2>
          <FriendForm action={createFriendAction} />
        </div>
      </div>
    </section>
  );
}
