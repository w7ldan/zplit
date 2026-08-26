import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedOrganizationLedger } from "@/server/authenticated-ledger";
import { RepaymentForm } from "@/components/repayments/repayment-form";
import { RepaymentRow } from "@/components/repayments/repayment-row";
import { TaskPanel } from "@/components/app/task-panel";
import { LiveRecordFilters } from "@/components/records/live-record-filters";
import { RecordPagination } from "@/components/records/record-pagination";
import { groupRecordsByMonth, monthDisplayLabel, normalizeRepaymentFilters, normalizeTimezoneOffset, normalizeUuid, recordHref } from "@/domain/record-retrieval";
import type { RepaymentAllocationStrategy } from "@/domain/repayment-allocation-strategy";
import { createRepaymentAction, loadRepaymentFriendContext, searchFriendFilterOptions, searchFriendOptions } from "../ledger-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organization repayments" };
function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

export default async function OrganizationRepaymentsPage({ params, searchParams = Promise.resolve({}) }: { params: Promise<{ organizationId: string }>; searchParams?: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { organizationId } = await params;
  const query = await searchParams;
  const base = `/app/organizations/${organizationId}`;
  const path = `${base}/repayments`;
  const empty = ["q", "friendId", "month", "allocation"].filter((name) => first(query[name]) === "");
  if (empty.length) redirect(recordHref(path, query, Object.fromEntries(empty.map((name) => [name, undefined]))));
  const access = await getAuthenticatedOrganizationLedger(organizationId, "ledger.view");
  const openCreate = first(query.create) === "1";
  const timezoneOffsetMinutes = normalizeTimezoneOffset(first(query.tz));
  const filters = normalizeRepaymentFilters({ q: first(query.q), friendId: first(query.friendId), month: first(query.month), allocation: first(query.allocation), page: first(query.page) });
  const friendRows = await access.ledger.searchFriends({ selectedId: filters.friendId });
  const friendId = friendRows.some((friend) => friend.id === filters.friendId) ? filters.friendId : undefined;
  const page = await access.ledger.listRepaymentRecords({ q: first(query.q), friendId, month: first(query.month), allocation: first(query.allocation), page: first(query.page), timezoneOffsetMinutes });
  const requestedTripId = normalizeUuid(first(query.tripId));
  let tripContext: { id: string; name: string } | undefined;
  if (openCreate && requestedTripId) { try { const trip = await access.ledger.getTrip(requestedTripId); tripContext = { id: trip.id, name: trip.name }; } catch { /* stale trip context is ignored */ } }
  const initialFriendId = friendId ?? friendRows[0]?.id;
  const friendContext = openCreate && initialFriendId ? tripContext ? await access.ledger.getRepaymentFriendContext(initialFriendId, true, tripContext.id) : await access.ledger.getRepaymentFriendContext(initialFriendId, true) : undefined;
  const expenseShareId = normalizeUuid(first(query.expenseShareId));
  const selectedShare = expenseShareId && friendContext?.openExpenseShares.some((share) => share.id === expenseShareId && share.friendId === initialFriendId) ? expenseShareId : undefined;
  const requestedStrategy = first(query.strategy);
  const strategy: RepaymentAllocationStrategy = selectedShare ? "manual" : requestedStrategy === "oldest" || requestedStrategy === "newest" ? requestedStrategy : tripContext ? "oldest" : "manual";
  const friendOptions = friendRows.map((friend) => ({ id: friend.id, label: friend.name, archived: friend.archived }));
  const groups = groupRecordsByMonth(page.items, (repayment) => repayment.paidAt, timezoneOffsetMinutes);
  const canCreate = access.can("repayments.create");
  return <section className="app-page repayments-page" id="top"><div className="editorial-shell app-page__layout"><div className="app-page__header"><div><p className="technical-label">Organization repayments · money returned</p><h1>Repayments</h1><p className="app-page__lede">Record money received and apply it to outstanding expense shares.</p></div>{canCreate ? <Link className="action-link action-link--primary" href={recordHref(path, query, { create: "1" })}>Add repayment</Link> : null}</div><LiveRecordFilters action={path} search={{ label: "Search repayments", placeholder: "Friend or payment method", value: filters.q ?? "" }} selects={[{ name: "friendId", label: "Friend", value: friendId ?? "", options: [{ value: "", label: "All friends" }, ...friendOptions.map((friend) => ({ value: friend.id, label: `${friend.label}${friend.archived ? " (ARCHIVED)" : ""}` }))], search: searchFriendFilterOptions.bind(null, organizationId) }, { name: "allocation", label: "Allocation", value: filters.allocation === "all" ? "" : filters.allocation, options: [{ value: "", label: "All allocation states" }, { value: "complete", label: "Fully allocated" }, { value: "needs", label: "Needs allocation" }] }]} month={{ label: "Month", value: filters.month ?? "" }} clearHref={filters.q || filters.month || friendId || filters.allocation !== "all" ? recordHref(path, query, { q: undefined, friendId: undefined, month: undefined, allocation: undefined, page: undefined }) : undefined} resultStatus={`${page.totalItems} repayment${page.totalItems === 1 ? "" : "s"} found.`} preservedParams={query} /><div className="ledger-list" id="record-list"><div className="ledger-list__heading"><span className="technical-label">REPAYMENT RECORDS</span><span className="technical-label">{page.totalItems} entries</span></div>{page.items.length ? groups.map((group) => <div className="record-month-group" key={group.month}><div className="record-month-divider"><span className="technical-label">{monthDisplayLabel(group.month).toUpperCase()}</span></div>{group.items.map((repayment) => <RepaymentRow key={repayment.id} repayment={repayment} basePath={`${base}/repayments`} />)}</div>) : <div className="ledger-empty"><h2>{filters.q || filters.month || friendId || filters.allocation !== "all" ? "No matching repayments." : "No repayments yet."}</h2><p>Record money received from a friend when it arrives.</p></div>}<RecordPagination page={page.page} pageSize={page.pageSize} totalItems={page.totalItems} totalPages={page.totalPages} href={recordHref(path, query)} /></div></div>{canCreate && openCreate ? <TaskPanel open title="Add a repayment" description="Record money received and keep eligible shares visible for allocation." triggerId="repayment-create">{friendOptions.length ? <RepaymentForm action={createRepaymentAction.bind(null, organizationId)} friends={friendOptions} searchFriends={searchFriendOptions.bind(null, organizationId)} recentPaymentMethods={await access.ledger.listRecentPaymentMethods()} initialPaidAtUtc={new Date().toISOString()} initialValues={initialFriendId ? { friendId: initialFriendId, amountRupiah: first(query.amount) ?? "", paidAtLocal: "", timezoneOffsetMinutes: "", paymentMethod: "", notes: "" } : undefined} initialAllocationIds={selectedShare ? [selectedShare] : undefined} initialAllocationStrategy={strategy} initialFriendContext={friendContext ? { ...friendContext, option: { id: friendContext.option.id, label: friendContext.option.name, archived: friendContext.option.archived } } : undefined} loadFriendContext={loadRepaymentFriendContext.bind(null, organizationId)} tripContext={tripContext} tripContextId={tripContext?.id} /> : <div className="task-panel__empty"><p>Add a friend before recording money received.</p><Link className="action-link action-link--primary" href={`${base}/friends?create=1`}>Add a friend and continue</Link></div>}</TaskPanel> : null}</section>;
}
