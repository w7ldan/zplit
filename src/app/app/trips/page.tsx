import Link from "next/link";
import { redirect } from "next/navigation";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { createLedgerRepository } from "@/domain/ledger-repository";
import { createTripAction } from "./actions";
import { TripForm } from "@/components/trips/trip-form";
import { TripRow } from "@/components/trips/trip-row";
import { TaskPanel } from "@/components/app/task-panel";
import { RecordConfirmation } from "@/components/app/record-confirmation";
import { LiveRecordFilters } from "@/components/records/live-record-filters";
import { RecordPagination } from "@/components/records/record-pagination";
import { normalizeTripFilters, recordHref } from "@/domain/record-retrieval";
import { OutingsTripsSwitch } from "@/components/outings/outings-trips-switch";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trips" };

type TripsPageProps = { searchParams?: Promise<{ [key: string]: string | string[] | undefined; create?: string | string[]; created?: string | string[]; deleted?: string | string[]; q?: string | string[]; page?: string | string[] }> };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function TripsPage({ searchParams = Promise.resolve({}) }: TripsPageProps = {}) {
  const params = await searchParams;
  if (first(params.q) === "") redirect(recordHref("/app/trips", params, { q: undefined }));
  const session = await requireSession();
  const filters = normalizeTripFilters({ q: first(params.q), page: first(params.page) });
  const repository = createLedgerRepository(getDatabase(), session.user.id);
  const tripPage = await repository.listTripRecords({ q: first(params.q), page: first(params.page) });
  const filtered = Boolean(filters.q);
  const openCreate = first(params.create) === "1";

  return (
    <section className="app-page trips-page" id="top">
      <div className="editorial-shell app-page__layout">
        <div className="app-page__header">
          <div>
            <p className="technical-label">Trips · grouped outings</p>
            <h1>Trips</h1>
            <p className="app-page__lede">Group related outings without changing expense totals or ledger calculations.</p>
          </div>
          <Link className="action-link action-link--primary" href={recordHref("/app/trips", params, { create: "1" })} data-task-trigger="trip-create">Add trip</Link>
        </div>
        <div className="records-workspace">
          <div className="records-workspace__toolbar">
            <OutingsTripsSwitch current="trips" />
            {first(params.created) ? <RecordConfirmation queryKey="created" message="Trip added." /> : null}
            <LiveRecordFilters action="/app/trips" search={{ label: "Search trips", placeholder: "Trip name", value: filters.q ?? "" }} clearHref={filtered ? recordHref("/app/trips", params, { q: undefined, page: undefined }) : undefined} resultStatus={`${tripPage.totalItems} trip${tripPage.totalItems === 1 ? "" : "s"} found.`} preservedParams={params} />
          </div>
          <div className="ledger-list" id="record-list">
            <div className="ledger-list__heading"><span className="technical-label">LATEST FIRST</span><span className="technical-label">{tripPage.totalItems} entries</span></div>
            {tripPage.items.length > 0 ? tripPage.items.map((trip) => <TripRow key={trip.id} trip={trip} emphasized={first(params.created) === trip.id} />) : (
              <div className="ledger-empty"><h2>{filtered ? "No matching Trips." : "No Trips yet."}</h2><p>{filtered ? "Try a different Trip name." : "Group your first related outings before adding more ledger records."}</p>{filtered ? null : <Link className="text-link" href={recordHref("/app/trips", params, { create: "1" })} data-task-trigger="trip-create">Add trip <span aria-hidden="true">→</span></Link>}</div>
            )}
            <RecordPagination page={tripPage.page} pageSize={tripPage.pageSize} totalItems={tripPage.totalItems} totalPages={tripPage.totalPages} href={recordHref("/app/trips", params)} />
          </div>
        </div>
      </div>
      {openCreate ? <TaskPanel open title="Add a Trip" description="Group related outings without changing their financial records." triggerId="trip-create"><TripForm action={createTripAction} /></TaskPanel> : null}
    </section>
  );
}
