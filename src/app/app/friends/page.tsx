import Link from "next/link";
import { redirect } from "next/navigation";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { createLedgerRepository } from "@/domain/ledger-repository";
import { createFriendAction } from "./actions";
import { FriendForm } from "@/components/friends/friend-form";
import { FriendRow } from "@/components/friends/friend-row";
import { TaskPanel } from "@/components/app/task-panel";
import { RecordConfirmation } from "@/components/app/record-confirmation";
import { LiveRecordFilters } from "@/components/records/live-record-filters";
import { RecordPagination } from "@/components/records/record-pagination";
import { normalizeFriendFilters, recordHref } from "@/domain/record-retrieval";
import { validateRepaymentReturnTarget } from "@/domain/repayment-return";

export const dynamic = "force-dynamic";
export const metadata = { title: "Friends" };

type FriendsPageProps = {
  searchParams?: Promise<FriendsSearchParams>;
};

type FriendsSearchParams = {
  [key: string]: string | string[] | undefined;
  view?: string | string[];
  q?: string | string[];
  create?: string | string[];
  created?: string | string[];
  returnTo?: string | string[];
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function viewHref(view: "active" | "archived", params: FriendsSearchParams) {
  return recordHref("/app/friends", params, { view, page: undefined });
}

export default async function FriendsPage({ searchParams = Promise.resolve({}) }: FriendsPageProps = {}) {
  const params = await searchParams;
  const returnToInput = first(params?.returnTo);
  const returnTo = validateRepaymentReturnTarget(returnToInput);
  if (returnToInput !== undefined && !returnTo) redirect(recordHref("/app/friends", params, { returnTo: undefined }));
  const emptyParams = ["q"].filter((name) => first(params?.[name]) === "");
  if (emptyParams.length) redirect(recordHref("/app/friends", params, Object.fromEntries(emptyParams.map((name) => [name, undefined]))));
  const session = await requireSession();
  const view = first(params?.view) === "archived" ? "archived" : "active";
  const filters = normalizeFriendFilters({ archived: view === "archived", q: first(params?.q), page: first(params?.page) });
  const created = first(params?.created);
  const openCreate = first(params?.create) === "1";
  const repository = createLedgerRepository(getDatabase(), session.user.id);
  const friendPage = await repository.listFriendRecords({ archived: view === "archived", q: first(params?.q), page: first(params?.page) });
  const friends = friendPage.items;
  const balances = new Map((await repository.getFriendBalances(friends.map((friend) => friend.id))).map((balance) => [balance.friendId, balance]));
  const filtered = Boolean(filters.q);
  const listHref = recordHref("/app/friends", params);

  return (
    <section className="app-page friends-page" id="top">
      <div className="editorial-shell app-page__layout">
        <div className="app-page__header">
          <div>
            <p className="technical-label">Friends · people you split with</p>
            <h1>Friends</h1>
            <p className="app-page__lede">Find people connected to your shared expenses and review what remains open.</p>
          </div>
          <Link className="action-link action-link--primary" href={recordHref("/app/friends", params, { create: "1" })} data-task-trigger="friend-create">Add friend</Link>
        </div>
        {created ? <RecordConfirmation queryKey="created" message="Friend added." /> : null}
        <div className="friends-toolbar">
          <LiveRecordFilters action="/app/friends" search={{ label: "Search friends", placeholder: "Name or phone number", value: filters.q ?? "" }} clearHref={filtered ? recordHref("/app/friends", params, { q: undefined, page: undefined }) : undefined} resultStatus={`${friendPage.totalItems} friend${friendPage.totalItems === 1 ? "" : "s"} found.`} preservedParams={params} />
          <nav className="friends-page__views" aria-label="Friend record views">
            <Link className={view === "active" ? "friends-page__view friends-page__view--selected" : "friends-page__view"} href={viewHref("active", params)} aria-current={view === "active" ? "page" : undefined}>Active</Link>
            <Link className={view === "archived" ? "friends-page__view friends-page__view--selected" : "friends-page__view"} href={viewHref("archived", params)} aria-current={view === "archived" ? "page" : undefined}>Archived</Link>
          </nav>
        </div>
        <div className="ledger-list" id="record-list">
          <div className="ledger-list__heading"><span className="technical-label">{view === "active" ? "ACTIVE RECORDS" : "ARCHIVED RECORDS"}</span><span className="technical-label">{friendPage.totalItems} entries</span></div>
          {friends.length > 0 ? friends.map((friend) => <FriendRow key={friend.id} friend={friend} balance={balances.get(friend.id)} emphasized={created === friend.id} />) : (
            <div className="ledger-empty"><h2>{filtered ? "No matching friends." : view === "active" ? "No active friends yet." : "No archived friends yet."}</h2><p>{filtered ? "Try a different name or phone number." : view === "active" ? "Add the first person to begin your private record." : "Archived records remain available here when you need them."}</p>{filtered || view === "archived" ? null : <Link className="text-link" href={recordHref("/app/friends", params, { create: "1" })} data-task-trigger="friend-create">Add friend <span aria-hidden="true">→</span></Link>}</div>
          )}
          <RecordPagination page={friendPage.page} pageSize={friendPage.pageSize} totalItems={friendPage.totalItems} totalPages={friendPage.totalPages} href={listHref} />
        </div>
      </div>
      {openCreate ? <TaskPanel open title="Add a friend" description="Keep the person’s details beside the records they support." triggerId="friend-create"><FriendForm action={createFriendAction.bind(null, returnTo)} /></TaskPanel> : null}
    </section>
  );
}
