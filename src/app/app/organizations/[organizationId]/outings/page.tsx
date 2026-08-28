import Link from "next/link";
import { getAuthenticatedOrganizationLedger } from "@/server/authenticated-ledger";
import { OutingForm } from "@/components/outings/outing-form";
import { OutingRow } from "@/components/outings/outing-row";
import { OutingsTripsSwitch } from "@/components/outings/outings-trips-switch";
import { TaskPanel } from "@/components/app/task-panel";
import { LiveRecordFilters } from "@/components/records/live-record-filters";
import { RecordPagination } from "@/components/records/record-pagination";
import { groupRecordsByMonth, monthDisplayLabel, normalizeOutingFilters, normalizeTimezoneOffset, recordHref } from "@/domain/record-retrieval";
import { createOutingAction, searchTripFilterOptions, searchTripOptions } from "../ledger-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organization outings" };
function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

type OrganizationOutingsAccess = Awaited<ReturnType<typeof getAuthenticatedOrganizationLedger>>;

async function loadOrganizationOutings(query: Record<string, string | string[] | undefined>, access: OrganizationOutingsAccess) {
  const trip = first(query.trip);
  const timezoneOffsetMinutes = normalizeTimezoneOffset(first(query.tz));
  const tripFilter = trip === "unassigned" ? "unassigned" : trip || undefined;
  const filters = normalizeOutingFilters({ q: first(query.q), month: first(query.month), trip: tripFilter, page: first(query.page) });
  const selectedTrip = tripFilter && tripFilter !== "unassigned" ? await access.ledger.getTrip(tripFilter).catch(() => undefined) : undefined;
  const page = await access.ledger.listOutingRecords({ q: first(query.q), month: first(query.month), page: first(query.page), timezoneOffsetMinutes, ...(tripFilter ? { trip: tripFilter } : {}) });
  return {
    tripFilter,
    filters,
    selectedTrip,
    page,
    canManage: access.can("outings.manage"),
    openCreate: first(query.create) === "1",
    groups: groupRecordsByMonth(page.items, (outing) => outing.occurredAt, timezoneOffsetMinutes),
    outingOptions: [{ value: "", label: "All trips" }, { value: "unassigned", label: "No trip" }, ...(selectedTrip ? [{ value: selectedTrip.id, label: selectedTrip.name }] : [])],
    filtered: Boolean(filters.q || filters.month || filters.trip),
  };
}

type OrganizationOutingsData = Awaited<ReturnType<typeof loadOrganizationOutings>>;

function OrganizationOutingList({ data, base, path, query }: { data: OrganizationOutingsData; base: string; path: string; query: Record<string, string | string[] | undefined> }) {
  const { page, groups, filtered } = data;
  return <div className="ledger-list" id="record-list"><div className="ledger-list__heading"><span className="technical-label">LATEST FIRST</span><span className="technical-label">{page.totalItems} entries</span></div>{page.items.length ? groups.map((group) => <div className="record-month-group" key={group.month}><div className="record-month-divider"><span className="technical-label">{monthDisplayLabel(group.month).toUpperCase()}</span></div>{group.items.map((outing) => <OutingRow key={outing.id} outing={outing} expenseCount={outing.expenseCount} expenseTotal={outing.expenseTotal} basePath={base} />)}</div>) : <div className="ledger-empty"><h2>{filtered ? "No matching outings." : "No outings yet."}</h2><p>Record the first shared moment before adding an expense.</p></div>}<RecordPagination page={page.page} pageSize={page.pageSize} totalItems={page.totalItems} totalPages={page.totalPages} href={recordHref(path, query)} /></div>;
}

function OrganizationOutingCreatePanel({ data, organizationId }: { data: OrganizationOutingsData; organizationId: string }) {
  if (!data.canManage || !data.openCreate) return null;
  const { selectedTrip } = data;
  return <TaskPanel open title="Add an outing" description="Give the shared moment a name and date." triggerId="outing-create"><OutingForm action={createOutingAction.bind(null, organizationId, undefined)} initialOccurredAtUtc={new Date().toISOString()} trips={[{ id: "", label: "No trip" }, ...(selectedTrip ? [{ id: selectedTrip.id, label: selectedTrip.name }] : [])]} searchTrips={searchTripOptions.bind(null, organizationId)} initialValues={{ title: "", occurredAtLocal: "", timezoneOffsetMinutes: "", notes: "", tripId: selectedTrip?.id ?? "" }} /></TaskPanel>;
}

function OrganizationOutingsContent({ data, organizationId, base, path, query }: { data: OrganizationOutingsData; organizationId: string; base: string; path: string; query: Record<string, string | string[] | undefined> }) {
  const { page, filters, tripFilter, outingOptions, canManage, filtered } = data;
  return <section className="app-page outings-page" id="top"><div className="editorial-shell app-page__layout"><div className="app-page__header"><div><p className="technical-label">Organization outings · shared events</p><h1>Outings</h1><p className="app-page__lede">Keep related expenses together under the event where they happened.</p></div>{canManage ? <Link className="action-link action-link--primary" href={recordHref(path, query, { create: "1" })}>Add outing</Link> : null}</div><div className="records-workspace"><div className="records-workspace__toolbar"><OutingsTripsSwitch current="outings" basePath={base} /><LiveRecordFilters action={path} search={{ label: "Search outings", placeholder: "Outing title", value: filters.q ?? "" }} selects={[{ name: "trip", label: "Trip", value: tripFilter ?? "", options: outingOptions, search: searchTripFilterOptions.bind(null, organizationId) }]} month={{ label: "Month", value: filters.month ?? "" }} clearHref={filtered ? recordHref(path, query, { q: undefined, month: undefined, trip: undefined, page: undefined }) : undefined} resultStatus={page.totalItems + " outing" + (page.totalItems === 1 ? "" : "s") + " found."} preservedParams={query} /></div><OrganizationOutingList data={data} base={base} path={path} query={query} /></div></div><OrganizationOutingCreatePanel data={data} organizationId={organizationId} /></section>;
}

export default async function OrganizationOutingsPage({ params, searchParams = Promise.resolve({}) }: { params: Promise<{ organizationId: string }>; searchParams?: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { organizationId } = await params;
  const query = await searchParams;
  const base = `/app/organizations/${organizationId}`;
  const path = `${base}/outings`;
  const access = await getAuthenticatedOrganizationLedger(organizationId, "ledger.view");
  const data = await loadOrganizationOutings(query, access);
  return <OrganizationOutingsContent data={data} organizationId={organizationId} base={base} path={path} query={query} />;
}
