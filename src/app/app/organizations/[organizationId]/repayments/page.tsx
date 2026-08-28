import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedOrganizationLedger } from "@/server/authenticated-ledger";
import { RepaymentForm } from "@/components/repayments/repayment-form";
import { RepaymentRow } from "@/components/repayments/repayment-row";
import { TaskPanel } from "@/components/app/task-panel";
import { LiveRecordFilters } from "@/components/records/live-record-filters";
import { RecordPagination } from "@/components/records/record-pagination";
import {
  groupRecordsByMonth,
  monthDisplayLabel,
  normalizeRepaymentFilters,
  normalizeTimezoneOffset,
  normalizeUuid,
  recordHref,
} from "@/domain/record-retrieval";
import type { RepaymentAllocationStrategy } from "@/domain/repayment-allocation-strategy";
import {
  createRepaymentAction,
  loadRepaymentFriendContext,
  searchFriendFilterOptions,
  searchFriendOptions,
} from "../ledger-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organization repayments" };
function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

type OrganizationLedgerAccess = Awaited<ReturnType<typeof getAuthenticatedOrganizationLedger>>;

async function loadOrganizationRepayments(
  query: Awaited<NonNullable<Parameters<typeof OrganizationRepaymentsPage>[0]["searchParams"]>>,
  access: OrganizationLedgerAccess,
) {
  const openCreate = first(query.create) === "1";
  const timezoneOffsetMinutes = normalizeTimezoneOffset(first(query.tz));
  const filters = normalizeRepaymentFilters({
    q: first(query.q),
    friendId: first(query.friendId),
    month: first(query.month),
    allocation: first(query.allocation),
    page: first(query.page),
  });
  const friendRows = await access.ledger.searchFriends({ selectedId: filters.friendId });
  const friendId = friendRows.some((friend) => friend.id === filters.friendId) ? filters.friendId : undefined;
  const page = await access.ledger.listRepaymentRecords({
    q: first(query.q),
    friendId,
    month: first(query.month),
    allocation: first(query.allocation),
    page: first(query.page),
    timezoneOffsetMinutes,
  });
  const friendOptions = friendRows.map((friend) => ({
    id: friend.id,
    label: friend.name,
    archived: friend.archived,
  }));
  const initialFriendId = friendId ?? friendRows[0]?.id;
  const selectedShareId = normalizeUuid(first(query.expenseShareId));
  const tripContext = await loadOrganizationTripContext(access, openCreate, first(query.tripId));
  const friendContext =
    openCreate && initialFriendId
      ? tripContext
        ? await access.ledger.getRepaymentFriendContext(initialFriendId, true, tripContext.id)
        : await access.ledger.getRepaymentFriendContext(initialFriendId, true)
      : undefined;
  const selectedShare =
    selectedShareId &&
    friendContext?.openExpenseShares.some(
      (share) => share.id === selectedShareId && share.friendId === initialFriendId,
    )
      ? selectedShareId
      : undefined;
  const requestedStrategy = first(query.strategy);
  const strategy: RepaymentAllocationStrategy = selectedShare
    ? "manual"
    : requestedStrategy === "oldest" || requestedStrategy === "newest"
      ? requestedStrategy
      : tripContext
        ? "oldest"
        : "manual";
  const canCreate = access.can("repayments.create");
  const recentPaymentMethods =
    canCreate && openCreate && friendOptions.length > 0
      ? await access.ledger.listRecentPaymentMethods()
      : [];
  return {
    openCreate,
    timezoneOffsetMinutes,
    filters,
    friendId,
    friendOptions,
    initialFriendId,
    page,
    tripContext,
    friendContext,
    selectedShare,
    strategy,
    recentPaymentMethods,
    canCreate,
    groups: groupRecordsByMonth(page.items, (repayment) => repayment.paidAt, timezoneOffsetMinutes),
  };
}

async function loadOrganizationTripContext(
  access: OrganizationLedgerAccess,
  openCreate: boolean,
  tripId: string | undefined,
) {
  if (!openCreate || !tripId) return undefined;
  try {
    const trip = await access.ledger.getTrip(tripId);
    return { id: trip.id, name: trip.name };
  } catch {
    return undefined;
  }
}

type OrganizationRepaymentData = Awaited<ReturnType<typeof loadOrganizationRepayments>>;

function OrganizationRepaymentList({
  data,
  base,
  query,
}: {
  data: OrganizationRepaymentData;
  base: string;
  query: Record<string, string | string[] | undefined>;
}) {
  const { page, groups, filters, friendId } = data;
  const filtered = Boolean(filters.q || filters.month || friendId || filters.allocation !== "all");
  return (
    <div className="ledger-list" id="record-list">
      <div className="ledger-list__heading">
        <span className="technical-label">REPAYMENT RECORDS</span>
        <span className="technical-label">{page.totalItems} entries</span>
      </div>
      {page.items.length ? (
        groups.map((group) => (
          <div className="record-month-group" key={group.month}>
            <div className="record-month-divider">
              <span className="technical-label">
                {monthDisplayLabel(group.month).toUpperCase()}
              </span>
            </div>
            {group.items.map((repayment) => (
              <RepaymentRow
                key={repayment.id}
                repayment={repayment}
                basePath={base + "/repayments"}
              />
            ))}
          </div>
        ))
      ) : (
        <div className="ledger-empty">
          <h2>{filtered ? "No matching repayments." : "No repayments yet."}</h2>
          <p>Record money received from a friend when it arrives.</p>
        </div>
      )}
      <RecordPagination
        page={page.page}
        pageSize={page.pageSize}
        totalItems={page.totalItems}
        totalPages={page.totalPages}
        href={recordHref(base + "/repayments", query)}
      />
    </div>
  );
}

function OrganizationRepaymentCreatePanel({
  data,
  organizationId,
  base,
  amountRupiah,
}: {
  data: OrganizationRepaymentData;
  organizationId: string;
  base: string;
  amountRupiah: string | undefined;
}) {
  if (!data.canCreate || !data.openCreate) return null;
  const { friendOptions, initialFriendId, tripContext, friendContext, selectedShare, strategy } = data;
  return (
    <TaskPanel
      open
      title="Add a repayment"
      description="Record money received and keep eligible shares visible for allocation."
      triggerId="repayment-create"
    >
      {friendOptions.length ? (
        <RepaymentForm
          action={createRepaymentAction.bind(null, organizationId)}
          friends={friendOptions}
          searchFriends={searchFriendOptions.bind(null, organizationId)}
          recentPaymentMethods={data.recentPaymentMethods}
          initialPaidAtUtc={new Date().toISOString()}
          initialValues={
            initialFriendId
              ? {
                  friendId: initialFriendId,
                  amountRupiah: amountRupiah ?? "",
                  paidAtLocal: "",
                  timezoneOffsetMinutes: "",
                  paymentMethod: "",
                  notes: "",
                }
              : undefined
          }
          initialAllocationIds={selectedShare ? [selectedShare] : undefined}
          initialAllocationStrategy={strategy}
          initialFriendContext={
            friendContext
              ? {
                  ...friendContext,
                  option: {
                    id: friendContext.option.id,
                    label: friendContext.option.name,
                    archived: friendContext.option.archived,
                  },
                }
              : undefined
          }
          loadFriendContext={loadRepaymentFriendContext.bind(null, organizationId)}
          tripContext={tripContext}
          tripContextId={tripContext?.id}
        />
      ) : (
        <div className="task-panel__empty">
          <p>Add a friend before recording money received.</p>
          <Link
            className="action-link action-link--primary"
            href={base + "/friends?create=1"}
          >
            Add a friend and continue
          </Link>
        </div>
      )}
    </TaskPanel>
  );
}

function OrganizationRepaymentsContent({
  data,
  organizationId,
  base,
  path,
  query,
}: {
  data: OrganizationRepaymentData;
  organizationId: string;
  base: string;
  path: string;
  query: Record<string, string | string[] | undefined>;
}) {
  const { page, filters, friendId, friendOptions, canCreate } = data;
  const filtered = Boolean(filters.q || filters.month || friendId || filters.allocation !== "all");
  return (
    <section className="app-page repayments-page" id="top">
      <div className="editorial-shell app-page__layout">
        <div className="app-page__header">
          <div>
            <p className="technical-label">Organization repayments · money returned</p>
            <h1>Repayments</h1>
            <p className="app-page__lede">
              Record money received and apply it to outstanding expense shares.
            </p>
          </div>
          {canCreate ? (
            <Link
              className="action-link action-link--primary"
              href={recordHref(path, query, { create: "1" })}
            >
              Add repayment
            </Link>
          ) : null}
        </div>
        <LiveRecordFilters
          action={path}
          search={{
            label: "Search repayments",
            placeholder: "Friend or payment method",
            value: filters.q ?? "",
          }}
          selects={[
            {
              name: "friendId",
              label: "Friend",
              value: friendId ?? "",
              options: [
                { value: "", label: "All friends" },
                ...friendOptions.map((friend) => ({
                  value: friend.id,
                  label: friend.label + (friend.archived ? " (ARCHIVED)" : ""),
                })),
              ],
              search: searchFriendFilterOptions.bind(null, organizationId),
            },
            {
              name: "allocation",
              label: "Allocation",
              value: filters.allocation === "all" ? "" : filters.allocation,
              options: [
                { value: "", label: "All allocation states" },
                { value: "complete", label: "Fully allocated" },
                { value: "needs", label: "Needs allocation" },
              ],
            },
          ]}
          month={{ label: "Month", value: filters.month ?? "" }}
          clearHref={
            filtered
              ? recordHref(path, query, {
                  q: undefined,
                  friendId: undefined,
                  month: undefined,
                  allocation: undefined,
                  page: undefined,
                })
              : undefined
          }
          resultStatus={
            page.totalItems + " repayment" + (page.totalItems === 1 ? "" : "s") + " found."
          }
          preservedParams={query}
        />
        <OrganizationRepaymentList
          data={data}
          base={base}
          query={query}
        />
      </div>
      <OrganizationRepaymentCreatePanel
        data={data}
        organizationId={organizationId}
        base={base}
        amountRupiah={first(query.amount)}
      />
    </section>
  );
}

export default async function OrganizationRepaymentsPage({
  params,
  searchParams = Promise.resolve({}),
}: {
  params: Promise<{ organizationId: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { organizationId } = await params;
  const query = await searchParams;
  const base = `/app/organizations/${organizationId}`;
  const path = `${base}/repayments`;
  const empty = ["q", "friendId", "month", "allocation"].filter((name) => first(query[name]) === "");
  if (empty.length) redirect(recordHref(path, query, Object.fromEntries(empty.map((name) => [name, undefined]))));
  const access = await getAuthenticatedOrganizationLedger(organizationId, "ledger.view");
  const data = await loadOrganizationRepayments(query, access);
  return (
    <OrganizationRepaymentsContent
      data={data}
      organizationId={organizationId}
      base={base}
      path={path}
      query={query}
    />
  );
}
