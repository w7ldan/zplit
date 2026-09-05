import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedOrganizationLedger } from "@/server/authenticated-ledger";
import { FriendForm } from "@/components/friends/friend-form";
import { FriendRow } from "@/components/friends/friend-row";
import { TaskPanel } from "@/components/app/task-panel";
import { LiveRecordFilters } from "@/components/records/live-record-filters";
import { RecordPagination } from "@/components/records/record-pagination";
import { normalizeFriendFilters, recordHref } from "@/domain/record-retrieval";
import { createFriendAction } from "../ledger-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organization expense contacts" };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OrganizationFriendsPage({
  params,
  searchParams = Promise.resolve({}),
}: {
  params: Promise<{ organizationId: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { organizationId } = await params;
  const query = await searchParams;
  const base = `/app/organizations/${organizationId}/friends`;
  if (first(query.q) === "") redirect(recordHref(base, query, { q: undefined }));
  const access = await getAuthenticatedOrganizationLedger(organizationId, "ledger.view");
  const view = first(query.view) === "archived" ? "archived" : "active";
  const filters = normalizeFriendFilters({ archived: view === "archived", q: first(query.q), page: first(query.page) });
  const friendPage = await access.ledger.listFriendRecords({
    archived: view === "archived",
    q: first(query.q),
    page: first(query.page),
  });
  const balances = new Map(
    (
      friendPage.items.length
        ? await access.ledger.getFriendBalances(friendPage.items.map((friend) => friend.id))
        : []
    ).map((balance) => [balance.friendId, balance]),
  );
  const canManage = access.can("friends.manage") && !access.archivedAt;
  const openCreate = canManage && first(query.create) === "1";
  return (
    <section className="app-page friends-page" id="top">
      <div className="editorial-shell app-page__layout">
        <div className="app-page__header">
          <div>
            <p className="technical-label">Organization expense contacts</p>
            <h1>Expense contacts</h1>
            <p className="app-page__lede">
              People available when recording Organization expenses.
            </p>
          </div>
          {canManage ? (
            <Link
              className="action-link action-link--primary"
              href={recordHref(base, query, { create: "1" })}
            >
              Add expense contact
            </Link>
          ) : null}
        </div>
        <div className="friends-toolbar">
          <LiveRecordFilters
            action={base}
            search={{
              label: "Search expense contacts",
              placeholder: "Name or phone number",
              value: filters.q ?? "",
            }}
            clearHref={
              filters.q ? recordHref(base, query, { q: undefined, page: undefined }) : undefined
            }
            resultStatus={`${friendPage.totalItems} contact${friendPage.totalItems === 1 ? "" : "s"} found.`}
            preservedParams={query}
          />
          <nav className="friends-page__views" aria-label="Expense contact record views">
            <Link
              className={
                view === "active"
                  ? "friends-page__view friends-page__view--selected"
                  : "friends-page__view"
              }
              href={recordHref(base, query, { view: "active", page: undefined })}
            >
              Active
            </Link>
            <Link
              className={
                view === "archived"
                  ? "friends-page__view friends-page__view--selected"
                  : "friends-page__view"
              }
              href={recordHref(base, query, { view: "archived", page: undefined })}
            >
              Archived
            </Link>
          </nav>
        </div>
        <div className="ledger-list" id="record-list">
          <div className="ledger-list__heading">
            <span className="technical-label">
              {view === "active" ? "ACTIVE RECORDS" : "ARCHIVED RECORDS"}
            </span>
            <span className="technical-label">{friendPage.totalItems} entries</span>
          </div>
          {friendPage.items.length ? (
            friendPage.items.map((friend) => (
              <FriendRow
                key={friend.id}
                friend={friend}
                balance={balances.get(friend.id)}
                basePath={base}
              />
            ))
          ) : (
            <div className="ledger-empty">
              <h2>
                {filters.q
                  ? "No matching expense contacts."
                  : view === "active"
                    ? "No active expense contacts yet."
                    : "No archived expense contacts yet."}
              </h2>
              <p>
                Expense contacts are scoped to this Organization and are not Zplit mutual friendships.
              </p>
            </div>
          )}
          <RecordPagination
            page={friendPage.page}
            pageSize={friendPage.pageSize}
            totalItems={friendPage.totalItems}
            totalPages={friendPage.totalPages}
            href={recordHref(base, query)}
          />
        </div>
      </div>
      {openCreate ? (
        <TaskPanel
          open
          title="Add an expense contact"
          description="Keep the person’s details beside this Organization’s records."
          triggerId="friend-create"
        >
          <FriendForm action={createFriendAction.bind(null, organizationId, undefined)} />
        </TaskPanel>
      ) : null}
    </section>
  );
}
