import Link from "next/link";
import { redirect } from "next/navigation";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { createLedgerRepository } from "@/domain/ledger-repository";
import { RepaymentForm } from "@/components/repayments/repayment-form";
import { RepaymentRow } from "@/components/repayments/repayment-row";
import { createRepaymentAction, loadRepaymentFriendContext, searchFriendFilterOptions, searchFriendOptions } from "./actions";
import { TaskPanel } from "@/components/app/task-panel";
import { LiveRecordFilters } from "@/components/records/live-record-filters";
import { RecordPagination } from "@/components/records/record-pagination";
import { groupRecordsByMonth, monthDisplayLabel, normalizeRepaymentFilters, normalizeTimezoneOffset, recordHref } from "@/domain/record-retrieval";
import { validateRepaymentReturnTarget } from "@/domain/repayment-return";

export const dynamic = "force-dynamic";

type RepaymentsPageProps = { searchParams?: Promise<{ [key: string]: string | string[] | undefined; create?: string | string[]; q?: string | string[]; friendId?: string | string[]; month?: string | string[]; allocation?: string | string[]; page?: string | string[] }> };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RepaymentsPage({ searchParams = Promise.resolve({}) }: RepaymentsPageProps = {}) {
  const params = await searchParams;
  const emptyParams = ["q", "friendId", "month", "allocation"].filter((name) => first(params?.[name]) === "");
  if (emptyParams.length) redirect(recordHref("/app/repayments", params, Object.fromEntries(emptyParams.map((name) => [name, undefined]))));
  const session = await requireSession();
  const openCreate = first(params?.create) === "1";
  const initialPaidAtUtc = openCreate ? new Date().toISOString() : undefined;
  const timezoneOffsetMinutes = normalizeTimezoneOffset(first(params?.tz));
  const filters = normalizeRepaymentFilters({ q: first(params?.q), friendId: first(params?.friendId), month: first(params?.month), allocation: first(params?.allocation), page: first(params?.page) });
  const repository = createLedgerRepository(getDatabase(), session.user.id);
  const [repaymentPage, friendRows] = await Promise.all([
    repository.listRepaymentRecords({ q: first(params?.q), friendId: filters.friendId, month: first(params?.month), allocation: first(params?.allocation), page: first(params?.page), timezoneOffsetMinutes }),
    repository.searchFriends({ selectedId: filters.friendId }),
  ]);
  const friendId = friendRows.some((friend) => friend.id === filters.friendId) ? filters.friendId : undefined;
  const friendOptions = friendRows.map((friend) => ({ id: friend.id, label: friend.name, archived: friend.archived }));
  const initialFriendId = friendId ?? friendOptions[0]?.id;
  const initialFriendContext = openCreate && initialFriendId ? await repository.getRepaymentFriendContext(initialFriendId, true) : undefined;
  const formContext = initialFriendContext ? { ...initialFriendContext, option: { id: initialFriendContext.option.id, label: initialFriendContext.option.name, archived: initialFriendContext.option.archived } } : undefined;
  const groups = groupRecordsByMonth(repaymentPage.items, (repayment) => repayment.paidAt, timezoneOffsetMinutes);
  const filtered = Boolean(filters.q || filters.month || filters.friendId || filters.allocation !== "all");
  const listHref = recordHref("/app/repayments", params);
  const repaymentReturnTarget = validateRepaymentReturnTarget(recordHref("/app/repayments", params, { create: "1" })) ?? "/app/repayments?create=1";

  return (
    <section className="app-page repayments-page" id="top">
      <div className="editorial-shell app-page__layout">
        <div className="app-page__header">
          <div>
            <p className="technical-label">Repayments · money returned</p>
            <h1>Repayments</h1>
            <p className="app-page__lede">Record money received and apply it to outstanding expense shares.</p>
          </div>
          <Link className="action-link action-link--primary" href={recordHref("/app/repayments", params, { create: "1" })} data-task-trigger="repayment-create">Add repayment</Link>
        </div>
        <LiveRecordFilters
          action="/app/repayments"
          search={{ label: "Search repayments", placeholder: "Friend or payment method", value: filters.q ?? "" }}
          selects={[{ name: "friendId", label: "Friend", value: friendId ?? "", options: [{ value: "", label: "All friends" }, ...friendOptions.map((friend) => ({ value: friend.id, label: `${friend.label}${friend.archived ? " (ARCHIVED)" : ""}` }))], search: searchFriendFilterOptions }, { name: "allocation", label: "Allocation", value: filters.allocation === "all" ? "" : filters.allocation, options: [{ value: "", label: "All allocation states" }, { value: "complete", label: "Fully allocated" }, { value: "needs", label: "Needs allocation" }] }]}
          month={{ label: "Month", value: filters.month ?? "" }}
          mobileDisclosure={{ activeCount: [friendId, filters.month, filters.allocation === "all" ? undefined : filters.allocation].filter(Boolean).length }}
          clearHref={filtered ? recordHref("/app/repayments", params, { q: undefined, friendId: undefined, month: undefined, allocation: undefined, page: undefined }) : undefined}
          resultStatus={`${repaymentPage.totalItems} repayment${repaymentPage.totalItems === 1 ? "" : "s"} found.`}
          preservedParams={params}
        />
        <div className="ledger-list" id="record-list">
          <div className="ledger-list__heading"><span className="technical-label">REPAYMENT RECORDS</span><span className="technical-label">{repaymentPage.totalItems} entries</span></div>
          {repaymentPage.items.length > 0 ? groups.map((group) => <div className="record-month-group" key={group.month}>
            <div className="record-month-divider"><span className="technical-label">{monthDisplayLabel(group.month).toUpperCase()}</span></div>
            {group.items.map((repayment) => <RepaymentRow key={repayment.id} repayment={repayment} />)}
          </div>) : (
            <div className="ledger-empty"><h2>{filtered ? "No matching repayments." : "No repayments yet."}</h2><p>{filtered ? "Try a different search or clear the filters." : "Record money received from a friend when it arrives; allocation follows on the record."}</p>{filtered ? null : <Link className="text-link" href={recordHref(friendOptions.length ? "/app/repayments" : "/app/friends", params, { create: "1" })} data-task-trigger={friendOptions.length ? "repayment-create" : "friend-create"}>{friendOptions.length ? "Add a repayment" : "Add a friend"} <span aria-hidden="true">→</span></Link>}</div>
          )}
          <RecordPagination page={repaymentPage.page} pageSize={repaymentPage.pageSize} totalItems={repaymentPage.totalItems} totalPages={repaymentPage.totalPages} href={listHref} />
        </div>
      </div>
      {openCreate ? <TaskPanel open title="Add a repayment" description="Record the money received and keep its eligible shares visible for allocation." triggerId="repayment-create">
        {friendOptions.length > 0 ? <RepaymentForm action={createRepaymentAction} friends={friendOptions} searchFriends={searchFriendOptions} initialPaidAtUtc={initialPaidAtUtc} initialValues={initialFriendId ? { friendId: initialFriendId, amountRupiah: "", paidAtLocal: "", timezoneOffsetMinutes: "", paymentMethod: "", notes: "" } : undefined} initialFriendContext={formContext} loadFriendContext={loadRepaymentFriendContext} /> : <div className="task-panel__empty"><p>Add a friend before recording money received.</p><Link className="action-link action-link--primary" href={`/app/friends?create=1&returnTo=${encodeURIComponent(repaymentReturnTarget)}`}>Add a friend and continue</Link></div>}
      </TaskPanel> : null}
    </section>
  );
}
