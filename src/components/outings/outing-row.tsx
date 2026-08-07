import Link from "next/link";
import type { InferSelectModel } from "drizzle-orm";
import type { outings } from "@/db/schema";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { formatRupiah } from "@/domain/rupiah";

type OutingRowOuting = Omit<InferSelectModel<typeof outings>, "tripId"> & { tripId?: string | null; tripName?: string | null };

export function OutingRow({ outing, expenseCount, expenseTotal, emphasized = false, showTripContext = true }: { outing: OutingRowOuting; expenseCount: number; expenseTotal: number; emphasized?: boolean; showTripContext?: boolean }) {
  return (
    <article className={`outing-row${emphasized ? " outing-row--created" : ""}`} data-record-id={outing.id}>
      <div className="outing-row__primary">
        <span className="technical-label">OUTING</span>
        <h2><Link href={`/app/outings/${outing.id}`}>{outing.title}</Link></h2>
      </div>
      <div className="outing-row__meta">
        <span className="outing-row__date"><span className="technical-label">Date</span><LocalDateTime iso={outing.occurredAt.toISOString()} /></span>
        {showTripContext ? <span className="outing-row__trip"><span className="technical-label">Trip</span>{outing.tripId && outing.tripName ? <Link href={`/app/trips/${outing.tripId}`}>{outing.tripName}</Link> : "—"}</span> : null}
        <span className="outing-row__expenses"><span className="technical-label">Expenses</span>{expenseCount} {expenseCount === 1 ? "expense" : "expenses"} · {formatRupiah(expenseTotal)}</span>
        <span className="outing-row__actions">
          <Link className="outing-row__edit" href={`/app/outings/${outing.id}`}>Edit <span aria-hidden="true">→</span></Link>
          <Link className="outing-row__add-expense" href={`/app/expenses?create=1&outing=${outing.id}`}>Add expense</Link>
        </span>
      </div>
    </article>
  );
}
