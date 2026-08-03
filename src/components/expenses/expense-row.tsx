import Link from "next/link";
import type { InferSelectModel } from "drizzle-orm";
import type { expenses } from "@/db/schema";
import { LocalDateTime } from "@/components/editorial/local-date-time";

type ExpenseRecord = InferSelectModel<typeof expenses> & { outingTitle: string | null };

function formatRupiah(amount: number) {
  return `Rp ${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(amount)}`;
}

export function ExpenseRow({ expense }: { expense: ExpenseRecord }) {
  return (
    <article className="expense-row">
      <div className="expense-row__primary">
        <span className="technical-label">EXPENSE</span>
        <h2><Link href={`/app/expenses/${expense.id}`}>{expense.description}</Link></h2>
      </div>
      <div className="expense-row__meta">
        <strong>{formatRupiah(expense.amount)}</strong>
        <LocalDateTime iso={expense.occurredAt.toISOString()} />
        <span className="technical-label">{expense.outingTitle || "UNASSIGNED"}</span>
        <Link className="expense-row__edit" href={`/app/expenses/${expense.id}`}>Edit <span aria-hidden="true">→</span></Link>
      </div>
    </article>
  );
}
