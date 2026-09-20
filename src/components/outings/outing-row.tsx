import Link from "next/link";
import { SourceCalendarDate } from "@/components/editorial/local-date-time";
import type { OutingListRecord } from "@/domain/ledger/types";
import { formatRupiah } from "@/domain/rupiah";

export function OutingRow({ outing, expenseCount, expenseTotal, emphasized = false, showTripContext = true, basePath = "/app" }: { outing: OutingListRecord; expenseCount: number; expenseTotal: number; emphasized?: boolean; showTripContext?: boolean; basePath?: string }) {
  return (
    <article className={`outing-row personal-vnext__outing-row personal-vnext__multi-action-row personal-vnext__motion-item${emphasized ? " outing-row--created" : ""}`} data-record-id={outing.id}>
      <div className="outing-row__primary personal-vnext__row-primary">
        <span className="technical-label">OUTING</span>
        <h2><Link className="vnext-link" href={`${basePath}/outings/${outing.id}`}>{outing.title}</Link></h2>
      </div>
      <div className="outing-row__meta personal-vnext__row-meta">
        <span className="outing-row__date"><span className="technical-label">Date</span><SourceCalendarDate canonicalDate={outing.occurredOn} timestamp={outing.occurredAt.toISOString()} /></span>
        {showTripContext ? <span className="outing-row__trip"><span className="technical-label">Trip</span>{outing.tripId && outing.tripName ? <Link className="vnext-link" href={`${basePath}/trips/${outing.tripId}`}>{outing.tripName}</Link> : "—"}</span> : null}
        <span className="outing-row__expenses"><span className="technical-label">Expenses</span>{expenseCount} {expenseCount === 1 ? "expense" : "expenses"} · <span className="vnext-money">{formatRupiah(expenseTotal)}</span></span>
        <span className="outing-row__actions">
          <Link className="outing-row__edit vnext-link personal-vnext__secondary-action" href={`${basePath}/outings/${outing.id}`}>Edit</Link>
          <Link className="outing-row__add-expense vnext-button vnext-button--secondary personal-vnext__secondary-action" href={`${basePath}/expenses?create=1&outing=${outing.id}`}>Add expense</Link>
        </span>
      </div>
    </article>
  );
}
