import Link from "next/link";
import { redirect } from "next/navigation";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { createLedgerRepository, LedgerNotFoundError } from "@/domain/ledger-repository";
import { OutingForm } from "@/components/outings/outing-form";
import { OutingRow } from "@/components/outings/outing-row";
import { createOutingAction, searchTripFilterOptions, searchTripOptions } from "./actions";
import { TaskPanel } from "@/components/app/task-panel";
import { RecordConfirmation } from "@/components/app/record-confirmation";
import { LiveRecordFilters } from "@/components/records/live-record-filters";
import { RecordPagination } from "@/components/records/record-pagination";
import { groupRecordsByMonth, monthDisplayLabel, normalizeOutingFilters, normalizeTimezoneOffset, normalizeUuid, recordHref } from "@/domain/record-retrieval";
import { validateExpenseReturnTarget } from "@/domain/expense-return";
import { OutingsTripsSwitch } from "@/components/outings/outings-trips-switch";

export const dynamic = "force-dynamic";

type OutingsPageProps = { searchParams?: Promise<{ [key: string]: string | string[] | undefined; create?: string | string[]; created?: string | string[]; q?: string | string[]; month?: string | string[]; trip?: string | string[]; page?: string | string[] }> };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OutingsPage({ searchParams = Promise.resolve({}) }: OutingsPageProps = {}) {
  const params = await searchParams;
  const returnToInput = first(params?.returnTo);
  const returnTo = validateExpenseReturnTarget(returnToInput);
  if (returnToInput !== undefined && !returnTo) redirect(recordHref("/app/outings", params, { returnTo: undefined }));
  const requestedTrip = first(params?.trip);
  if (requestedTrip !== undefined && requestedTrip !== "unassigned" && requestedTrip !== "" && !normalizeUuid(requestedTrip)) redirect(recordHref("/app/outings", params, { trip: undefined, page: undefined }));
  const emptyParams = ["q", "month", "trip"].filter((name) => first(params?.[name]) === "");
  if (emptyParams.length) redirect(recordHref("/app/outings", params, Object.fromEntries(emptyParams.map((name) => [name, undefined]))));
  const session = await requireSession();
  const created = first(params?.created);
  const openCreate = first(params?.create) === "1";
  const initialOccurredAtUtc = openCreate ? new Date().toISOString() : undefined;
  const timezoneOffsetMinutes = normalizeTimezoneOffset(first(params?.tz));
  const repository = createLedgerRepository(getDatabase(), session.user.id);
  let selectedTrip;
  if (requestedTrip && requestedTrip !== "unassigned") {
    try {
      selectedTrip = await repository.getTrip(requestedTrip);
    } catch (error) {
      if (error instanceof LedgerNotFoundError) redirect(recordHref("/app/outings", params, { trip: undefined, page: undefined }));
      throw error;
    }
  }
  const tripFilter = requestedTrip === "unassigned" ? "unassigned" : selectedTrip?.id;
  const filters = normalizeOutingFilters({ q: first(params?.q), month: first(params?.month), trip: tripFilter, page: first(params?.page) });
  const outingOptions = [{ value: "", label: "All trips" }, { value: "unassigned", label: "No trip" }, ...(selectedTrip ? [{ value: selectedTrip.id, label: selectedTrip.name }] : [])];
  const outingListOptions = { q: first(params?.q), month: first(params?.month), page: first(params?.page), timezoneOffsetMinutes, ...(tripFilter ? { trip: tripFilter } : {}) };
  const outingPage = await repository.listOutingRecords(outingListOptions);
  const groups = groupRecordsByMonth(outingPage.items, (outing) => outing.occurredAt, timezoneOffsetMinutes);
  const filtered = Boolean(filters.q || filters.month || filters.trip);
  const effectiveParams = tripFilter ? { ...params, trip: tripFilter } : params;
  const listHref = recordHref("/app/outings", effectiveParams);

  return (
    <section className="app-page outings-page" id="top">
      <div className="editorial-shell app-page__layout">
        <div className="app-page__header">
          <div>
            <p className="technical-label">Outings · shared events</p>
            <h1>Outings</h1>
            <p className="app-page__lede">Keep related expenses together under the event where they happened.</p>
          </div>
          <Link className="action-link action-link--primary" href={recordHref("/app/outings", effectiveParams, { create: "1" })} data-task-trigger="outing-create">Add outing</Link>
        </div>
        <OutingsTripsSwitch current="outings" />
        {created ? <RecordConfirmation queryKey="created" message="Outing added." /> : null}
        <LiveRecordFilters action="/app/outings" search={{ label: "Search outings", placeholder: "Outing title", value: filters.q ?? "" }} selects={[{ name: "trip", label: "Trip", value: tripFilter ?? "", options: outingOptions, search: searchTripFilterOptions }]} month={{ label: "Month", value: filters.month ?? "" }} mobileDisclosure={{ activeCount: [tripFilter, filters.month].filter(Boolean).length }} clearHref={filtered ? recordHref("/app/outings", effectiveParams, { q: undefined, month: undefined, trip: undefined, page: undefined }) : undefined} resultStatus={`${outingPage.totalItems} outing${outingPage.totalItems === 1 ? "" : "s"} found.`} preservedParams={effectiveParams} />
        <div className="ledger-list" id="record-list">
          <div className="ledger-list__heading"><span className="technical-label">LATEST FIRST</span><span className="technical-label">{outingPage.totalItems} entries</span></div>
          {outingPage.items.length > 0 ? groups.map((group) => <div className="record-month-group" key={group.month}>
            <div className="record-month-divider"><span className="technical-label">{monthDisplayLabel(group.month).toUpperCase()}</span></div>
            {group.items.map((outing) => <OutingRow key={outing.id} outing={outing} expenseCount={outing.expenseCount} expenseTotal={outing.expenseTotal} emphasized={created === outing.id} />)}
          </div>) : (
            <div className="ledger-empty"><h2>{filtered ? "No matching outings." : "No outings yet."}</h2><p>{filtered ? "Try a different title, Trip, or month." : "Record the first shared moment before adding an expense."}</p>{filtered ? null : <Link className="text-link" href={recordHref("/app/outings", effectiveParams, { create: "1" })} data-task-trigger="outing-create">Add outing <span aria-hidden="true">→</span></Link>}</div>
          )}
          <RecordPagination page={outingPage.page} pageSize={outingPage.pageSize} totalItems={outingPage.totalItems} totalPages={outingPage.totalPages} href={listHref} />
        </div>
      </div>
      {openCreate ? <TaskPanel open title="Add an outing" description="Give the shared moment a name and a local date before adding expenses." triggerId="outing-create"><OutingForm action={createOutingAction.bind(null, returnTo)} initialOccurredAtUtc={initialOccurredAtUtc} trips={[{ id: "", label: "No trip" }, ...(selectedTrip ? [{ id: selectedTrip.id, label: selectedTrip.name }] : [])]} searchTrips={searchTripOptions} initialValues={{ title: "", occurredAtLocal: "", timezoneOffsetMinutes: "", notes: "", tripId: selectedTrip?.id ?? "" }} /></TaskPanel> : null}
    </section>
  );
}
