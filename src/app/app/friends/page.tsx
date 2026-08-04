import Link from "next/link";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { createLedgerRepository } from "@/domain/ledger-repository";
import { createFriendAction } from "./actions";
import { FriendForm } from "@/components/friends/friend-form";
import { FriendRow } from "@/components/friends/friend-row";
import { TaskPanel } from "@/components/app/task-panel";
import { RecordConfirmation } from "@/components/app/record-confirmation";

export const dynamic = "force-dynamic";

type FriendsPageProps = {
  searchParams?: Promise<{ view?: string | string[]; q?: string | string[]; create?: string | string[]; created?: string | string[] }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function FriendsPage({ searchParams = Promise.resolve({}) }: FriendsPageProps = {}) {
  const session = await requireSession();
  const params = await searchParams;
  const view = first(params?.view) === "archived" ? "archived" : "active";
  const query = first(params?.q)?.trim() ?? "";
  const created = first(params?.created);
  const openCreate = first(params?.create) === "1";
  const repository = createLedgerRepository(getDatabase(), session.user.id);
  const [listedFriends, summary] = await Promise.all([
    repository.listFriends({ archived: view === "archived" }),
    repository.getLedgerSummary(),
  ]);
  const friends = query
    ? listedFriends.filter((friend) => `${friend.name} ${friend.phoneNumber ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    : listedFriends;
  const balances = new Map(summary.friendBalances.map((balance) => [balance.friendId, balance]));

  return (
    <section className="app-page friends-page" id="top">
      <div className="editorial-shell app-page__layout">
        <div className="app-page__header">
          <div>
            <p className="technical-label">Friends · owner records</p>
            <h1>People in your ledger.</h1>
            <p className="app-page__lede">Find the people connected to your shared records and see what remains open.</p>
          </div>
          <Link className="action-link action-link--primary" href="/app/friends?create=1" data-task-trigger="friend-create">Add friend</Link>
        </div>
        {created ? <RecordConfirmation queryKey="created" message="Friend added." /> : null}
        <div className="friends-toolbar">
          <form className="search-form" action="/app/friends" role="search">
            <label htmlFor="friend-search">Search friends</label>
            <input id="friend-search" name="q" type="search" defaultValue={query} placeholder="Name or phone number" />
            <input type="hidden" name="view" value={view} />
            <button className="action-link action-link--quiet" type="submit">Search</button>
          </form>
          <nav className="friends-page__views" aria-label="Friend record views">
            <Link className={view === "active" ? "friends-page__view friends-page__view--selected" : "friends-page__view"} href={query ? `/app/friends?view=active&q=${encodeURIComponent(query)}` : "/app/friends?view=active"} aria-current={view === "active" ? "page" : undefined}>Active</Link>
            <Link className={view === "archived" ? "friends-page__view friends-page__view--selected" : "friends-page__view"} href={query ? `/app/friends?view=archived&q=${encodeURIComponent(query)}` : "/app/friends?view=archived"} aria-current={view === "archived" ? "page" : undefined}>Archived</Link>
          </nav>
        </div>
        <div className="ledger-list" aria-live="polite">
          <div className="ledger-list__heading"><span className="technical-label">{view === "active" ? "ACTIVE RECORDS" : "ARCHIVED RECORDS"}</span><span className="technical-label">{friends.length} entries</span></div>
          {friends.length > 0 ? friends.map((friend) => <FriendRow key={friend.id} friend={friend} balance={balances.get(friend.id)} emphasized={created === friend.id} />) : (
            <div className="ledger-empty"><h2>{query ? "No matching friends." : view === "active" ? "No active friends yet." : "No archived friends yet."}</h2><p>{query ? "Try a different name or phone number." : view === "active" ? "Add the first person to begin your private record." : "Archived records remain available here when you need them."}</p></div>
          )}
        </div>
      </div>
      {openCreate ? <TaskPanel open title="Add a friend" description="Keep the person’s details beside the records they support." triggerId="friend-create"><FriendForm action={createFriendAction} /></TaskPanel> : null}
    </section>
  );
}
