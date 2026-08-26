import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { LedgerNotFoundError } from "@/domain/ledger-repository";
import { getAuthenticatedLedger } from "@/server/authenticated-ledger";
import { TripForm } from "@/components/trips/trip-form";
import { TripDeleteForm } from "@/components/trips/trip-delete-form";
import { OutingRow } from "@/components/outings/outing-row";
import { CalendarDateRange } from "@/components/editorial/local-date-time";
import { formatCalendarDate } from "@/components/editorial/calendar-date";
import { RecordConfirmation } from "@/components/app/record-confirmation";
import { RecordPagination } from "@/components/records/record-pagination";
import { formatRupiah } from "@/domain/rupiah";
import { TripSummaryCopy } from "@/components/trips/trip-summary-copy";
import { updateTripAction, deleteTripAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trip details" };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function tripDateSummary(startsOn: string | null, endsOn: string | null) {
  return startsOn && endsOn
    ? `${formatCalendarDate(startsOn)} – ${formatCalendarDate(endsOn)}`
    : startsOn
      ? `From ${formatCalendarDate(startsOn)}`
      : endsOn
        ? `Until ${formatCalendarDate(endsOn)}`
        : "Dates not set";
}

export default async function TripRecordPage({ params, searchParams }: { params: Promise<{ tripId: string }>; searchParams?: Promise<{ saved?: string | string[]; page?: string | string[] }> }) {
  const session = await requireSession();
  const { tripId } = await params;
  const query = await searchParams;
  let trip;
  let summary;
  let outingPage;
  try {
    const { ledger: repository } = await getAuthenticatedLedger(session);
    trip = await repository.getTrip(tripId);
    [summary, outingPage] = await Promise.all([
      repository.getTripSummary(trip.id),
      repository.listOutingRecords({ trip: trip.id, page: first(query?.page) }),
    ]);
  } catch (error) {
    if (error instanceof LedgerNotFoundError) notFound();
    throw error;
  }
  const friendSettlements = summary.friendSettlements ?? [];
  const copySummary = [`${trip.name} · ${tripDateSummary(trip.startsOn, trip.endsOn)}`, "", ...friendSettlements.map((friend) => friend.outstandingAmount > 0 ? `${friend.friendName}: ${formatRupiah(friend.outstandingAmount)} outstanding` : `${friend.friendName}: settled`)].join("\n");
  return (
    <section className="app-page trip-record" id="top">
        <div className="editorial-grid editorial-shell trip-record__layout">
          <div className="trip-record__intro">
            <div><p className="technical-label">Trip · editable grouping</p><h1>{trip.name}</h1></div>
            <div className="trip-record__actions"><TripSummaryCopy text={copySummary} /><Link className="action-link action-link--quiet" href={`/app/outings?create=1&trip=${trip.id}`}>Add outing</Link><Link className="trip-record__back" href="/app/trips">← Back to Trips</Link></div>
          </div>
          {query?.saved === "1" ? <RecordConfirmation queryKey="saved" message="Trip changes saved." /> : null}
          <section className="trip-record__summary" aria-label="Trip summary">
            <div className="trip-record__meta" aria-label="Trip metadata">
              <div><span className="technical-label">Dates</span><CalendarDateRange startsOn={trip.startsOn} endsOn={trip.endsOn} /></div>
              <div><span className="technical-label">Outings</span><strong>{summary.outingCount}</strong></div>
              <div><span className="technical-label">Expenses</span><strong>{summary.expenseCount}</strong></div>
            </div>
            <section className="trip-record__financials" aria-label="Trip financial summary">
              <div><span className="technical-label">Total spending</span><strong>{formatRupiah(summary.expenseTotal)}</strong></div>
              <div><span className="technical-label">Assigned to friends</span><strong>{formatRupiah(summary.totalAssignedAmount)}</strong></div>
              <div><span className="technical-label">Your portion</span><strong>{formatRupiah(summary.ownerPortionAmount)}</strong></div>
              <div><span className="technical-label">Outstanding</span><strong>{formatRupiah(summary.totalOutstandingAmount)}</strong></div>
            </section>
            <section className="trip-record__settlement" aria-labelledby="trip-settlement-heading">
              <div className="trip-record__section-heading"><div><p className="technical-label">SETTLE BALANCES</p><h2 id="trip-settlement-heading">Friend balances</h2></div></div>
              {friendSettlements.length > 0 ? <div className="trip-record__settlement-list">{friendSettlements.map((friend) => <div className="trip-record__settlement-row" key={friend.friendId}>
                <div><strong>{friend.friendName}</strong>{friend.outstandingAmount > 0 ? <span>{formatRupiah(friend.outstandingAmount)} outstanding</span> : <span className="technical-label">Settled</span>}</div>
                {friend.outstandingAmount > 0 ? <Link className="action-link action-link--quiet" href={`/app/repayments?create=1&friendId=${friend.friendId}&tripId=${trip.id}`}>Record repayment <span aria-hidden="true">→</span></Link> : null}
              </div>)}</div> : <div className="ledger-empty"><h3>No friend shares in this Trip yet.</h3><p>Settlement appears after an expense is shared with a friend.</p></div>}
            </section>
            {trip.notes ? <p className="trip-record__notes">{trip.notes}</p> : null}
          </section>
          <section className="trip-record__outings" aria-labelledby="trip-outings-heading">
            <div className="trip-record__section-heading"><div><p className="technical-label">GROUPED OUTINGS</p><h2 id="trip-outings-heading">Outings</h2></div><span className="technical-label">{outingPage.totalItems} entries</span></div>
            {outingPage.items.length > 0 ? outingPage.items.map((outing) => <OutingRow key={outing.id} outing={outing} expenseCount={outing.expenseCount} expenseTotal={outing.expenseTotal} showTripContext={false} />) : <div className="ledger-empty"><h3>No outings in this Trip yet.</h3><p>Add an outing to start grouping records.</p><Link className="text-link" href={`/app/outings?create=1&trip=${trip.id}`}>Add outing <span aria-hidden="true">→</span></Link></div>}
            <RecordPagination page={outingPage.page} pageSize={outingPage.pageSize} totalItems={outingPage.totalItems} totalPages={outingPage.totalPages} href={`/app/trips/${trip.id}`} />
          </section>
          <div className="trip-record__form"><p className="technical-label">EDIT GROUPING</p><TripForm action={updateTripAction.bind(null, trip.id)} mode="edit" initialValues={{ name: trip.name, startsOn: trip.startsOn ?? "", endsOn: trip.endsOn ?? "", notes: trip.notes ?? "" }} /></div>
          <TripDeleteForm action={deleteTripAction.bind(null, trip.id)} />
        </div>
    </section>
  );
}
