import Link from "next/link";
import type { TripListRecord } from "@/domain/ledger-repository";
import { CalendarDateRange } from "@/components/editorial/local-date-time";
import { formatRupiah } from "@/domain/rupiah";

export function TripRow({ trip, emphasized = false }: { trip: TripListRecord; emphasized?: boolean }) {
  return (
    <article className={`trip-row${emphasized ? " trip-row--created" : ""}`} data-record-id={trip.id}>
      <div className="trip-row__primary"><span className="technical-label">TRIP</span><h2><Link href={`/app/trips/${trip.id}`}>{trip.name}</Link></h2></div>
      <div className="trip-row__meta">
        <span><span className="technical-label">Dates</span><CalendarDateRange startsOn={trip.startsOn} endsOn={trip.endsOn} /></span>
        <span><span className="technical-label">Outings</span>{trip.outingCount}</span>
        <span><span className="technical-label">Expenses</span>{trip.expenseCount}</span>
        <span><span className="technical-label">Total</span>{formatRupiah(trip.expenseTotal)}</span>
        <span className="trip-row__actions"><Link className="trip-row__edit" href={`/app/trips/${trip.id}`}>Open <span aria-hidden="true">→</span></Link></span>
      </div>
    </article>
  );
}
