import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedOrganizationLedger } from "@/server/authenticated-ledger";
import { TripForm } from "@/components/trips/trip-form";
import { TripRow } from "@/components/trips/trip-row";
import { TaskPanel } from "@/components/app/task-panel";
import { LiveRecordFilters } from "@/components/records/live-record-filters";
import { RecordPagination } from "@/components/records/record-pagination";
import { normalizeTripFilters, recordHref } from "@/domain/record-retrieval";
import { createTripAction } from "../ledger-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organization trips" };
function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

export default async function OrganizationTripsPage({ params, searchParams = Promise.resolve({}) }: { params: Promise<{ organizationId: string }>; searchParams?: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { organizationId } = await params;
  const query = await searchParams;
  const base = `/app/organizations/${organizationId}`;
  const path = `${base}/trips`;
  if (first(query.q) === "") redirect(recordHref(path, query, { q: undefined }));
  const access = await getAuthenticatedOrganizationLedger(organizationId, "ledger.view");
  const filters = normalizeTripFilters({ q: first(query.q), page: first(query.page) });
  const page = await access.ledger.listTripRecords({ q: first(query.q), page: first(query.page) });
  const canManage = access.can("trips.manage");
  return <section className="app-page trips-page" id="top"><div className="editorial-shell app-page__layout"><div className="app-page__header"><div><p className="technical-label">Organization trips · grouped outings</p><h1>Trips</h1><p className="app-page__lede">Group related outings without changing ledger calculations.</p></div>{canManage ? <Link className="action-link action-link--primary" href={recordHref(path, query, { create: "1" })}>Add trip</Link> : null}</div><div className="records-workspace"><div className="records-workspace__toolbar"><LiveRecordFilters action={path} search={{ label: "Search trips", placeholder: "Trip name", value: filters.q ?? "" }} clearHref={filters.q ? recordHref(path, query, { q: undefined, page: undefined }) : undefined} resultStatus={`${page.totalItems} trip${page.totalItems === 1 ? "" : "s"} found.`} preservedParams={query} /></div><div className="ledger-list" id="record-list"><div className="ledger-list__heading"><span className="technical-label">LATEST FIRST</span><span className="technical-label">{page.totalItems} entries</span></div>{page.items.length ? page.items.map((trip) => <TripRow key={trip.id} trip={trip} basePath={`${base}/trips`} />) : <div className="ledger-empty"><h2>{filters.q ? "No matching Trips." : "No Trips yet."}</h2><p>Group related outings before adding ledger records.</p></div>}<RecordPagination page={page.page} pageSize={page.pageSize} totalItems={page.totalItems} totalPages={page.totalPages} href={recordHref(path, query)} /></div></div></div>{canManage && first(query.create) === "1" ? <TaskPanel open title="Add a Trip" description="Group related outings without changing financial records." triggerId="trip-create"><TripForm action={createTripAction.bind(null, organizationId)} /></TaskPanel> : null}</section>;
}
