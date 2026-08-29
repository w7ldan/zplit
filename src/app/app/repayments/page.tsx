import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { LedgerNotFoundError } from "@/domain/ledger-repository";
import { getAuthenticatedLedger } from "@/server/authenticated-ledger";
import { RepaymentForm } from "@/components/repayments/repayment-form";
import { RepaymentRow } from "@/components/repayments/repayment-row";
import { createRepaymentAction, loadRepaymentFriendContext, searchFriendFilterOptions, searchFriendOptions } from "./actions";
import { TaskPanel } from "@/components/app/task-panel";
import { LiveRecordFilters } from "@/components/records/live-record-filters";
import { RecordPagination } from "@/components/records/record-pagination";
import { groupRecordsByMonth, monthDisplayLabel, normalizeRepaymentFilters, normalizeTimezoneOffset, normalizeUuid, recordHref } from "@/domain/record-retrieval";
import { validateRepaymentReturnTarget } from "@/domain/repayment-return";
import type { RepaymentAllocationStrategy } from "@/domain/repayment-allocation-strategy";

export const dynamic = "force-dynamic";
export const metadata = { title: "Repayments" };

type RepaymentsPageProps = { searchParams?: Promise<{ [key: string]: string | string[] | undefined; create?: string | string[]; q?: string | string[]; friendId?: string | string[]; tripId?: string | string[]; expenseShareId?: string | string[]; amount?: string | string[]; strategy?: string | string[]; month?: string | string[]; allocation?: string | string[]; page?: string | string[] }> };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

type RepaymentLedger = Awaited<ReturnType<typeof getAuthenticatedLedger>>["ledger"];

async function loadTripContext(repository: RepaymentLedger, openCreate: boolean, friendId: string | undefined, tripId: string | undefined) {
  if (!openCreate || !friendId || !tripId) return undefined;
  try {
    const trip = await repository.getTrip(tripId);
    return { id: trip.id, name: trip.name };
  } catch (error) {
    if (!(error instanceof LedgerNotFoundError)) throw error;
    return undefined;
  }
}

function allocationStrategy(expenseShareId: string | undefined, requested: string | undefined, tripContext: { id: string; name: string } | undefined): RepaymentAllocationStrategy {
  if (expenseShareId) return "manual";
  if (requested === "oldest" || requested === "newest") return requested;
  return tripContext ? "oldest" : "manual";
}

async function loadRepaymentSelection(params: Awaited<NonNullable<RepaymentsPageProps["searchParams"]>>, repository: RepaymentLedger, openCreate: boolean, friendIdFilter: string | undefined) {
  const recentPaymentMethods = openCreate ? await repository.listRecentPaymentMethods() : [];
  const friendRows = await repository.searchFriends({ selectedId: friendIdFilter });
  const friendId = friendRows.some((friend) => friend.id === friendIdFilter) ? friendIdFilter : undefined;
  return {
    recentPaymentMethods,
    friendId,
    friendOptions: friendRows.map((friend) => ({ id: friend.id, label: friend.name, archived: friend.archived })),
    initialAmountRupiah: openCreate ? first(params.amount) ?? "" : "",
    requestedExpenseShareId: normalizeUuid(first(params.expenseShareId)),
  };
}

async function loadRepaymentContext(
  params: Awaited<NonNullable<RepaymentsPageProps["searchParams"]>>,
  repository: RepaymentLedger,
  openCreate: boolean,
  friendId: string | undefined,
  friendOptions: Array<{ id: string; label: string; archived: boolean }>,
  requestedExpenseShareId: string | undefined,
) {
  const initialFriendId = friendId ?? friendOptions[0]?.id;
  const tripContext = await loadTripContext(repository, openCreate, friendId, normalizeUuid(first(params.tripId)));
  const initialFriendContext = openCreate && initialFriendId
    ? tripContext ? await repository.getRepaymentFriendContext(initialFriendId, true, tripContext.id) : await repository.getRepaymentFriendContext(initialFriendId, true)
    : undefined;
  const expenseShareId = requestedExpenseShareId && initialFriendContext?.openExpenseShares.some((share) => share.id === requestedExpenseShareId && share.friendId === initialFriendId) ? requestedExpenseShareId : undefined;
  const initialAllocationStrategy = allocationStrategy(expenseShareId, first(params.strategy), tripContext);
  return {
    initialFriendId,
    tripContext,
    expenseShareId,
    initialAllocationStrategy,
    formContext: initialFriendContext ? { ...initialFriendContext, option: { id: initialFriendContext.option.id, label: initialFriendContext.option.name, archived: initialFriendContext.option.archived } } : undefined,
  };
}

async function loadRepaymentsPageData(params: Awaited<NonNullable<RepaymentsPageProps["searchParams"]>>, repository: RepaymentLedger) {
  const openCreate = first(params.create) === "1";
  const initialPaidAtUtc = openCreate ? new Date().toISOString() : undefined;
  const timezoneOffsetMinutes = normalizeTimezoneOffset(first(params.tz));
  const filters = normalizeRepaymentFilters({ q: first(params.q), friendId: first(params.friendId), month: first(params.month), allocation: first(params.allocation), page: first(params.page) });
  const selection = await loadRepaymentSelection(params, repository, openCreate, filters.friendId);
  const repaymentPage = await repository.listRepaymentRecords({ q: first(params.q), friendId: selection.friendId, month: first(params.month), allocation: first(params.allocation), page: first(params.page), timezoneOffsetMinutes });
  const context = await loadRepaymentContext(params, repository, openCreate, selection.friendId, selection.friendOptions, selection.requestedExpenseShareId);
  const effectiveParams = { ...params, friendId: selection.friendId, tripId: context.tripContext?.id, expenseShareId: context.expenseShareId, amount: openCreate ? selection.initialAmountRupiah || undefined : undefined, strategy: openCreate && context.initialAllocationStrategy !== "manual" ? context.initialAllocationStrategy : undefined };
  return {
    openCreate,
    initialPaidAtUtc,
    filters,
    ...selection,
    ...context,
    repaymentPage,
    groups: groupRecordsByMonth(repaymentPage.items, (repayment) => repayment.paidAt, timezoneOffsetMinutes),
    filtered: Boolean(filters.q || filters.month || selection.friendId || filters.allocation !== "all"),
    effectiveParams,
    listHref: recordHref("/app/repayments", effectiveParams),
    repaymentReturnTarget: validateRepaymentReturnTarget(recordHref("/app/repayments", effectiveParams, { create: "1" })) ?? "/app/repayments?create=1",
  };
}

type RepaymentsPageData = Awaited<ReturnType<typeof loadRepaymentsPageData>>;

function RepaymentRecordList({ data }: { data: RepaymentsPageData }) {
  const { repaymentPage, groups, filtered, effectiveParams, friendOptions, listHref } = data;
  return (
    <div className="ledger-list" id="record-list">
      <div className="ledger-list__heading"><span className="technical-label">REPAYMENT RECORDS</span><span className="technical-label">{repaymentPage.totalItems} entries</span></div>
      {repaymentPage.items.length > 0 ? groups.map((group) => <div className="record-month-group" key={group.month}>
        <div className="record-month-divider"><span className="technical-label">{monthDisplayLabel(group.month).toUpperCase()}</span></div>
        {group.items.map((repayment) => <RepaymentRow key={repayment.id} repayment={repayment} />)}
      </div>) : (
        <div className="ledger-empty"><h2>{filtered ? "No matching repayments." : "No repayments yet."}</h2><p>{filtered ? "Try a different search or clear the filters." : "Record money received from a friend when it arrives; allocation follows on the record."}</p>{filtered ? null : <Link className="text-link" href={recordHref(friendOptions.length ? "/app/repayments" : "/app/friends", effectiveParams, { create: "1" })} data-task-trigger={friendOptions.length ? "repayment-create" : "friend-create"}>{friendOptions.length ? "Record repayment" : "Add a friend"} <span aria-hidden="true">→</span></Link>}</div>
      )}
      <RecordPagination page={repaymentPage.page} pageSize={repaymentPage.pageSize} totalItems={repaymentPage.totalItems} totalPages={repaymentPage.totalPages} href={listHref} />
    </div>
  );
}

function RepaymentCreatePanel({ data }: { data: RepaymentsPageData }) {
  if (!data.openCreate) return null;
  const { friendOptions, initialFriendId, initialAmountRupiah, initialPaidAtUtc, initialAllocationStrategy, formContext, tripContext, repaymentReturnTarget } = data;
  return (
    <TaskPanel open title="Add a repayment" description="Record the money received and keep its eligible shares visible for allocation." triggerId="repayment-create">
      {friendOptions.length > 0 ? <RepaymentForm action={createRepaymentAction} friends={friendOptions} searchFriends={searchFriendOptions} recentPaymentMethods={data.recentPaymentMethods} initialPaidAtUtc={initialPaidAtUtc} initialValues={initialFriendId ? { friendId: initialFriendId, amountRupiah: initialAmountRupiah, paidAtLocal: "", timezoneOffsetMinutes: "", paymentMethod: "", notes: "" } : undefined} initialAllocationIds={data.expenseShareId ? [data.expenseShareId] : undefined} initialAllocationStrategy={initialAllocationStrategy} initialFriendContext={formContext} loadFriendContext={loadRepaymentFriendContext} tripContext={tripContext} tripContextId={tripContext?.id} /> : <div className="task-panel__empty"><p>Add a friend before recording money received.</p><Link className="action-link action-link--primary" href={"/app/friends?create=1&returnTo=" + encodeURIComponent(repaymentReturnTarget)}>Add a friend and continue</Link></div>}
    </TaskPanel>
  );
}

function RepaymentsPageContent({ data }: { data: RepaymentsPageData }) {
  const { filters, friendId, friendOptions, repaymentPage, effectiveParams, filtered } = data;
  return (
    <section className="app-page repayments-page" id="top">
      <div className="editorial-shell app-page__layout">
        <div className="app-page__header">
          <div>
            <p className="technical-label">Repayments · money returned</p>
            <h1>Repayments</h1>
            <p className="app-page__lede">Record money received and apply it to outstanding expense shares.</p>
          </div>
          <Link className="action-link action-link--primary" href={recordHref("/app/repayments", effectiveParams, { create: "1" })} data-task-trigger="repayment-create">Add repayment</Link>
        </div>
        <LiveRecordFilters
          action="/app/repayments"
          search={{ label: "Search repayments", placeholder: "Friend or payment method", value: filters.q ?? "" }}
          selects={[
            {
              name: "friendId",
              label: "Friend",
              value: friendId ?? "",
              options: [
                { value: "", label: "All friends" },
                ...friendOptions.map((friend) => ({
                  value: friend.id,
                  label:
                    friend.label +
                    (friend.archived ? " (ARCHIVED)" : ""),
                })),
              ],
              search: searchFriendFilterOptions,
            },
            {
              name: "allocation",
              label: "Allocation",
              value:
                filters.allocation === "all" ? "" : filters.allocation,
              options: [
                { value: "", label: "All allocation states" },
                { value: "complete", label: "Fully allocated" },
                { value: "needs", label: "Needs allocation" },
              ],
            },
          ]}
          month={{ label: "Month", value: filters.month ?? "" }}
          mobileDisclosure={{ activeCount: [friendId, filters.month, filters.allocation === "all" ? undefined : filters.allocation].filter(Boolean).length }}
          clearHref={filtered ? recordHref("/app/repayments", effectiveParams, { q: undefined, friendId: undefined, month: undefined, allocation: undefined, page: undefined }) : undefined}
          resultStatus={repaymentPage.totalItems + " repayment" + (repaymentPage.totalItems === 1 ? "" : "s") + " found."}
          preservedParams={effectiveParams}
        />
        <RepaymentRecordList data={data} />
      </div>
      <RepaymentCreatePanel data={data} />
    </section>
  );
}

export default async function RepaymentsPage({ searchParams = Promise.resolve({}) }: RepaymentsPageProps = {}) {
  const params = await searchParams;
  const emptyParams = ["q", "friendId", "month", "allocation"].filter((name) => first(params?.[name]) === "");
  if (emptyParams.length) redirect(recordHref("/app/repayments", params, Object.fromEntries(emptyParams.map((name) => [name, undefined]))));
  const session = await requireSession();
  const { ledger: repository } = await getAuthenticatedLedger(session);
  const data = await loadRepaymentsPageData(params ?? {}, repository);

  return <RepaymentsPageContent data={data} />;
}
