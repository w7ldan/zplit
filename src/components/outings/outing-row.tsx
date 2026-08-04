import Link from "next/link";
import type { InferSelectModel } from "drizzle-orm";
import type { outings } from "@/db/schema";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { formatRupiah } from "@/domain/rupiah";

export function OutingRow({ outing, expenseCount, expenseTotal, emphasized = false }: { outing: InferSelectModel<typeof outings>; expenseCount: number; expenseTotal: number; emphasized?: boolean }) {
  return (
    <article className={`outing-row${emphasized ? " outing-row--created" : ""}`} data-record-id={outing.id}>
      <div className="outing-row__primary">
        <span className="technical-label">OUTING</span>
        <h2><Link href={`/app/outings/${outing.id}`}>{outing.title}</Link></h2>
      </div>
      <div className="outing-row__meta">
        <LocalDateTime iso={outing.occurredAt.toISOString()} />
        <span>{expenseCount} {expenseCount === 1 ? "expense" : "expenses"} · {formatRupiah(expenseTotal)}</span>
        <span className="technical-label">CREATED <LocalDateTime iso={outing.createdAt.toISOString()} mode="date" /></span>
        <Link className="outing-row__edit" href={`/app/outings/${outing.id}`}>Edit <span aria-hidden="true">→</span></Link>
      </div>
      <Link className="outing-row__add-expense" href={`/app/expenses?create=1&outing=${outing.id}`}>Add expense</Link>
    </article>
  );
}
