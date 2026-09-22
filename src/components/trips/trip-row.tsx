import Link from "next/link";
import type { TripListRecord } from "@/domain/ledger-repository";
import { CalendarDateRange } from "@/components/editorial/local-date-time";
import { formatRupiah } from "@/domain/rupiah";
import { OpenTile } from "@/components/vnext/open-tile";

export function TripRow({ trip, emphasized = false, basePath = "/app/trips", vnext = false }: { trip: TripListRecord; emphasized?: boolean; basePath?: string; vnext?: boolean }) {
  if (vnext) {
    return (
      <Link className={`trip-row vnext-row personal-vnext__trip-row${emphasized ? " trip-row--created" : ""}`} data-record-id={trip.id} href={`${basePath}/${trip.id}`} aria-label={trip.name}>
        <div className="trip-row__primary"><span className="technical-label">TRIP</span><h2>{trip.name}</h2></div>
        <div className="trip-row__dates"><span className="technical-label">Dates</span><CalendarDateRange startsOn={trip.startsOn} endsOn={trip.endsOn} /></div>
        <div className="trip-row__outings"><span className="technical-label">Outings</span>{trip.outingCount}</div>
        <div className="trip-row__expenses"><span className="technical-label">Expenses</span>{trip.expenseCount}</div>
        <div className="trip-row__total"><span className="technical-label">Total</span><strong className="vnext-money">{formatRupiah(trip.expenseTotal)}</strong></div>
        <OpenTile className="trip-row__open-tile" />
      </Link>
    );
  }
  return (
    <article className={`trip-row${emphasized ? " trip-row--created" : ""}`} data-record-id={trip.id}>
      <div className="trip-row__primary"><span className="technical-label">TRIP</span><h2><Link href={`${basePath}/${trip.id}`}>{trip.name}</Link></h2></div>
      <div className="trip-row__meta">
        <span><span className="technical-label">Dates</span><CalendarDateRange startsOn={trip.startsOn} endsOn={trip.endsOn} /></span>
        <span><span className="technical-label">Outings</span>{trip.outingCount}</span>
        <span><span className="technical-label">Expenses</span>{trip.expenseCount}</span>
        <span><span className="technical-label">Total</span>{formatRupiah(trip.expenseTotal)}</span>
        <span className="trip-row__actions"><Link className="trip-row__edit" href={`${basePath}/${trip.id}`}>Open <span aria-hidden="true">→</span></Link></span>
      </div>
    </article>
  );
}
