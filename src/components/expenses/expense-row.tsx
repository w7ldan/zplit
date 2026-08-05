import Link from "next/link";
import type { InferSelectModel } from "drizzle-orm";
import type { expenses } from "@/db/schema";
import { formatRupiah } from "@/domain/rupiah";
import { LocalDateTime } from "@/components/editorial/local-date-time";

type ExpenseRecord = Omit<InferSelectModel<typeof expenses>, "occurredAt"> & { outingTitle: string; outingOccurredAt: Date };

export function ExpenseRow({ expense, emphasized = false }: { expense: ExpenseRecord; emphasized?: boolean }) {
  return (
    <article className={`expense-row${emphasized ? " expense-row--created" : ""}`} data-record-id={expense.id}>
      <div className="expense-row__primary">
        <span className="technical-label">EXPENSE</span>
        <h2><Link href={`/app/expenses/${expense.id}`}>{expense.description}</Link></h2>
      </div>
      <div className="expense-row__meta">
        <strong>{formatRupiah(expense.amount)}</strong>
        <LocalDateTime iso={expense.outingOccurredAt.toISOString()} />
        <span className="technical-label">{expense.outingTitle}</span>
        <Link className="expense-row__edit" href={`/app/expenses/${expense.id}`}>Edit <span aria-hidden="true">→</span></Link>
      </div>
    </article>
  );
}
