import Link from "next/link";
import { formatRupiah } from "@/domain/rupiah";
import type { ExpenseListRecord } from "@/domain/ledger/types";
import { SourceCalendarDate } from "@/components/editorial/local-date-time";
import { OpenTile } from "@/components/vnext/open-tile";

export function ExpenseRow({ expense, emphasized = false, basePath = "/app/expenses", vnext = false }: { expense: ExpenseListRecord; emphasized?: boolean; basePath?: string; vnext?: boolean }) {
  if (!vnext) {
    return (
      <article className={`expense-row${emphasized ? " expense-row--created" : ""}`} data-record-id={expense.id}>
        <div className="expense-row__primary">
          <span className="technical-label">EXPENSE</span>
          <h2><Link href={`${basePath}/${expense.id}`}>{expense.description}</Link></h2>
        </div>
        <div className="expense-row__meta">
          <span className="expense-row__amount"><span className="technical-label">Amount</span><strong aria-label={`Expense amount ${formatRupiah(expense.amount)}`}>{formatRupiah(expense.amount)}</strong></span>
          <div className="expense-row__context">
            <span className="expense-row__date"><span className="technical-label">Date</span><SourceCalendarDate canonicalDate={expense.outingOccurredOn} timestamp={expense.outingOccurredAt.toISOString()} /></span>
            <span className="expense-row__outing"><span className="technical-label">Outing</span><span>{expense.outingTitle}</span></span>
          </div>
          <Link className="expense-row__edit" href={`${basePath}/${expense.id}`}>Edit <span aria-hidden="true">→</span></Link>
        </div>
      </article>
    );
  }
  return (
    <Link className={`expense-row vnext-row personal-vnext__record-row${emphasized ? " expense-row--created" : ""}`} data-record-id={expense.id} href={`${basePath}/${expense.id}`} aria-label={expense.description} aria-describedby={`expense-row-${expense.id}-summary`}>
      <span className="sr-only" id={`expense-row-${expense.id}-summary`}>Expense amount {formatRupiah(expense.amount)}, outing {expense.outingTitle}</span>
      <div className="expense-row__primary">
        <span className="technical-label">EXPENSE</span>
        <h2>{expense.description}</h2>
      </div>
      <div className="expense-row__outing"><span className="technical-label">Outing</span><span>{expense.outingTitle}</span></div>
      <div className="expense-row__date"><span className="technical-label">Date</span><SourceCalendarDate canonicalDate={expense.outingOccurredOn} timestamp={expense.outingOccurredAt.toISOString()} /></div>
      <div className="expense-row__amount"><span className="technical-label">Amount</span><strong className="vnext-money" aria-label={`Expense amount ${formatRupiah(expense.amount)}`}>{formatRupiah(expense.amount)}</strong></div>
      <OpenTile className="expense-row__open-tile" />
    </Link>
  );
}
