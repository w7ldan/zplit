import Link from "next/link";
import { formatRupiah } from "@/domain/rupiah";
import type { ExpenseListRecord } from "@/domain/ledger/types";
import { LocalDateTime } from "@/components/editorial/local-date-time";

export function ExpenseRow({ expense, emphasized = false }: { expense: ExpenseListRecord; emphasized?: boolean }) {
  return (
    <article className={`expense-row${emphasized ? " expense-row--created" : ""}`} data-record-id={expense.id}>
      <div className="expense-row__primary">
        <span className="technical-label">EXPENSE</span>
        <h2><Link href={`/app/expenses/${expense.id}`}>{expense.description}</Link></h2>
      </div>
      <div className="expense-row__meta">
        <span className="expense-row__amount"><span className="technical-label">Amount</span><strong aria-label={`Expense amount ${formatRupiah(expense.amount)}`}>{formatRupiah(expense.amount)}</strong></span>
        <span className="expense-row__date"><span className="technical-label">Date</span><LocalDateTime iso={expense.outingOccurredAt.toISOString()} /></span>
        <span className="expense-row__outing"><span className="technical-label">Outing</span><span>{expense.outingTitle}</span></span>
        <Link className="expense-row__edit" href={`/app/expenses/${expense.id}`}>Edit <span aria-hidden="true">→</span></Link>
      </div>
    </article>
  );
}
