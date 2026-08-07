import Link from "next/link";
import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { createLedgerRepository, LedgerNotFoundError } from "@/domain/ledger-repository";
import { TripForm } from "@/components/trips/trip-form";
import { TripDeleteForm } from "@/components/trips/trip-delete-form";
import { OutingRow } from "@/components/outings/outing-row";
import { CalendarDateRange } from "@/components/editorial/local-date-time";
import { RecordConfirmation } from "@/components/app/record-confirmation";
import { RecordPagination } from "@/components/records/record-pagination";
import { formatRupiah } from "@/domain/rupiah";
import { updateTripAction, deleteTripAction } from "../actions";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function TripRecordPage({ params, searchParams }: { params: Promise<{ tripId: string }>; searchParams?: Promise<{ saved?: string | string[]; page?: string | string[] }> }) {
  const session = await requireSession();
  const { tripId } = await params;
  const query = await searchParams;
  let trip;
  let summary;
  let outingPage;
  try {
    const repository = createLedgerRepository(getDatabase(), session.user.id);
    trip = await repository.getTrip(tripId);
    [summary, outingPage] = await Promise.all([
      repository.getTripSummary(trip.id),
      repository.listOutingRecords({ trip: trip.id, page: first(query?.page) }),
    ]);
  } catch (error) {
    if (error instanceof LedgerNotFoundError) notFound();
    throw error;
  }
  return (
    <section className="app-page trip-record" id="top">
        <div className="editorial-grid editorial-shell trip-record__layout">
          <div className="trip-record__intro">
            <div><p className="technical-label">Trip · editable grouping</p><h1>{trip.name}</h1></div>
            <div className="trip-record__actions"><Link className="action-link action-link--quiet" href={`/app/outings?create=1&trip=${trip.id}`}>Add outing</Link><Link className="trip-record__back" href="/app/trips">← Back to Trips</Link></div>
          </div>
          {query?.saved === "1" ? <RecordConfirmation queryKey="saved" message="Trip changes saved." /> : null}
          <div className="trip-record__meta" aria-label="Trip metadata">
            <div><span className="technical-label">Dates</span><CalendarDateRange startsOn={trip.startsOn} endsOn={trip.endsOn} /></div>
            <div><span className="technical-label">Outings</span><strong>{summary.outingCount}</strong></div>
            <div><span className="technical-label">Expenses</span><strong>{summary.expenseCount}</strong></div>
            <div><span className="technical-label">Total</span><strong>{formatRupiah(summary.expenseTotal)}</strong></div>
          </div>
          {trip.notes ? <p className="trip-record__notes">{trip.notes}</p> : null}
          <section className="trip-record__outings" aria-labelledby="trip-outings-heading">
            <div className="trip-record__section-heading"><div><p className="technical-label">GROUPED OUTINGS</p><h2 id="trip-outings-heading">Outings</h2></div><span className="technical-label">{outingPage.totalItems} entries</span></div>
            {outingPage.items.length > 0 ? outingPage.items.map((outing) => <OutingRow key={outing.id} outing={outing} expenseCount={outing.expenseCount} expenseTotal={outing.expenseTotal} showTripContext={false} />) : <div className="ledger-empty"><h3>No outings in this Trip yet.</h3><p>Add an outing to start grouping records.</p><Link className="text-link" href={`/app/outings?create=1&trip=${trip.id}`}>Add an outing <span aria-hidden="true">→</span></Link></div>}
            <RecordPagination page={outingPage.page} pageSize={outingPage.pageSize} totalItems={outingPage.totalItems} totalPages={outingPage.totalPages} href={`/app/trips/${trip.id}`} />
          </section>
          <div className="trip-record__form"><p className="technical-label">EDIT GROUPING</p><TripForm action={updateTripAction.bind(null, trip.id)} mode="edit" initialValues={{ name: trip.name, startsOn: trip.startsOn ?? "", endsOn: trip.endsOn ?? "", notes: trip.notes ?? "" }} /></div>
          <TripDeleteForm action={deleteTripAction.bind(null, trip.id)} />
        </div>
    </section>
  );
}
