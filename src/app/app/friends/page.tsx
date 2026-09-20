import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { zplitVNextFont } from "@/app/fonts";
import { getAuthenticatedLedger } from "@/server/authenticated-ledger";
import { createFriendAction } from "./actions";
import { FriendForm } from "@/components/friends/friend-form";
import { FriendRow } from "@/components/friends/friend-row";
import { OpenTile } from "@/components/vnext/open-tile";
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

type FriendsLedger = Awaited<ReturnType<typeof getAuthenticatedLedger>>["ledger"];

async function loadFriendsPageData(repository: FriendsLedger, params: FriendsSearchParams, view: "active" | "archived") {
  const filters = normalizeFriendFilters({ archived: view === "archived", q: first(params.q), page: first(params.page) });
  const friendPage = await repository.listFriendsExperience({ archived: view === "archived", q: first(params.q), page: first(params.page) });
  const localFriends = friendPage.items.flatMap((entry) => entry.type === "local" ? [entry.friend] : []);
  const balances = new Map((localFriends.length > 0 ? await repository.getFriendBalances(localFriends.map((friend) => friend.id)) : []).map((balance) => [balance.friendId, balance]));
  return {
    friendPage,
    balances,
    view,
    created: first(params.created),
    openCreate: first(params.create) === "1",
    filtered: Boolean(filters.q),
    listHref: recordHref("/app/friends", params),
  };
}

type FriendsPageData = Awaited<ReturnType<typeof loadFriendsPageData>>;

function FriendRecordList({ data, params }: { data: FriendsPageData; params: FriendsSearchParams }) {
  const { view, friendPage, balances, created, filtered } = data;
  return (
    <div className="ledger-list personal-vnext__list personal-vnext__responsive-list personal-vnext__motion-reveal" id="record-list" data-motion="enter">
      <div className="ledger-list__heading personal-vnext__list-heading personal-vnext__motion-reveal">
        <span className="technical-label">
          {view === "active" ? "ACTIVE RECORDS" : "ARCHIVED RECORDS"}
        </span>
        <span className="technical-label">
          {friendPage.totalItems} entries
        </span>
      </div>
      {friendPage.items.length > 0 ? (
        <div className="personal-vnext__row-list" data-motion="list">
          {friendPage.items.map((entry) =>
            entry.type === "local" ? (
              <FriendRow
                key={entry.friend.id}
                friend={entry.friend}
                balance={balances.get(entry.friend.id)}
                emphasized={created === entry.friend.id}
                vnext
              />
            ) : (
              <FriendRow
                key={"connection-" + entry.connection.id}
                friend={entry.connection}
                vnext
              />
            ),
          )}
        </div>
      ) : (
        <div className="ledger-empty personal-vnext__empty personal-vnext__motion-reveal">
          <h2>
            {filtered
              ? "No matching friends."
              : view === "active"
                ? "No active friends yet."
                : "No archived friends yet."}
          </h2>
          <p>
            {filtered
              ? "Try a different name or phone number."
              : view === "active"
                ? "Add the first person to begin your private record."
                : "Archived records remain available here when you need them."}
          </p>
          {filtered || view === "archived" ? null : (
            <Link
              className="text-link vnext-link personal-vnext__text-action"
              href={recordHref("/app/friends", params, { create: "1" })}
              data-task-trigger="friend-create"
            >
              Add friend <OpenTile />
            </Link>
          )}
        </div>
      )}
      <div className="personal-vnext__pagination personal-vnext__motion-reveal">
        <RecordPagination page={friendPage.page} pageSize={friendPage.pageSize} totalItems={friendPage.totalItems} totalPages={friendPage.totalPages} href={data.listHref} />
      </div>
    </div>
  );
}

function FriendsPageContent({ data, params, returnTo }: { data: FriendsPageData; params: FriendsSearchParams; returnTo: string | undefined }) {
  const { view, friendPage, filtered, openCreate, created } = data;
  return (
    <section className={["app-page", "page-content", "zplit-vnext", "personal-vnext", "friends-page", zplitVNextFont.variable].filter(Boolean).join(" ")} id="top">
      <div className="editorial-shell app-page__layout personal-vnext__layout">
        <div className="app-page__header personal-vnext__header personal-vnext__motion-reveal" data-motion="enter">
          <div>
            <Link className="personal-parent-link vnext-link personal-vnext__parent-link" href="/app/personal">← Personal</Link>
            <p className="technical-label personal-vnext__eyebrow">Friends · people you split with</p>
            <h1 className="personal-vnext__title">Friends</h1>
            <p className="app-page__lede personal-vnext__lede">Find people connected to your shared expenses and review what remains open.</p>
          </div>
          <Link className="action-link action-link--primary vnext-button vnext-button--primary personal-vnext__primary-action" href={recordHref("/app/friends", params, { create: "1" })} data-task-trigger="friend-create">Add friend</Link>
        </div>
        {created ? <RecordConfirmation queryKey="created" message="Friend added." /> : null}
        <div className="friends-toolbar personal-vnext__toolbar personal-vnext__responsive-stack">
          <LiveRecordFilters
            action="/app/friends"
            search={{
              label: "Search friends",
              placeholder: "Name, phone number, or username",
              value: first(params.q) ?? "",
            }}
            clearHref={
              filtered
                ? recordHref("/app/friends", params, {
                    q: undefined,
                    page: undefined,
                  })
                : undefined
            }
            resultStatus={
              friendPage.totalItems +
              " friend" +
              (friendPage.totalItems === 1 ? "" : "s") +
              " found."
            }
            preservedParams={params}
          />
          <nav className="friends-page__views personal-vnext__views" aria-label="Friend record views">
            <Link className={view === "active" ? "friends-page__view friends-page__view--selected vnext-link" : "friends-page__view vnext-link"} href={viewHref("active", params)} aria-current={view === "active" ? "page" : undefined}>Active</Link>
            <Link className={view === "archived" ? "friends-page__view friends-page__view--selected vnext-link" : "friends-page__view vnext-link"} href={viewHref("archived", params)} aria-current={view === "archived" ? "page" : undefined}>Archived</Link>
          </nav>
        </div>
        <FriendRecordList data={data} params={params} />
      </div>
      {openCreate ? (
        <TaskPanel
          open
          eyebrow="NEW FRIEND"
          title="Add a friend"
          description="Keep the person’s details beside the records they support."
          triggerId="friend-create"
          className="personal-task-panel"
        >
          <FriendForm action={createFriendAction.bind(null, returnTo)} />
        </TaskPanel>
      ) : null}
    </section>
  );
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
  const { ledger: repository } = await getAuthenticatedLedger(session);
  const data = await loadFriendsPageData(repository, params, view);

  return <FriendsPageContent data={data} params={params ?? {}} returnTo={returnTo} />;
}
