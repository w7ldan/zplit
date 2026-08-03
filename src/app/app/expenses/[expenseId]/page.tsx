import Link from "next/link";
import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { createLedgerRepository, LedgerNotFoundError } from "@/domain/ledger-repository";
import { updateExpenseAction } from "../actions";

export const dynamic = "force-dynamic";

function formatRupiah(amount: number) {
  return `Rp ${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(amount)}`;
}

export default async function ExpenseRecordPage({ params }: { params: Promise<{ expenseId: string }> }) {
  const session = await requireSession();
  const { expenseId } = await params;
  const repository = createLedgerRepository(getDatabase(), session.user.id);
  let expense;
  try {
    expense = await repository.getExpense(expenseId);
  } catch (error) {
    if (error instanceof LedgerNotFoundError) notFound();
    throw error;
  }
  const outings = await repository.listOutings();

  return (
    <section className="expense-record" id="top">
      <div className="editorial-grid editorial-shell expense-record__layout">
        <div className="expense-record__marker technical-label">09 / EXPENSE RECORD</div>
        <div className="expense-record__intro">
          <p className="technical-label">PRIVATE EXPENSE / EDITABLE RECORD</p>
          <h1>{expense.description}</h1>
          <Link className="expense-record__back" href="/app/expenses">← Back to expenses</Link>
        </div>
        <div className="expense-record__meta" aria-label="Expense metadata">
          <div><span className="technical-label">Amount</span><strong>{formatRupiah(expense.amount)}</strong></div>
          <div><span className="technical-label">Outing</span><span>{expense.outingTitle}</span></div>
          <div><span className="technical-label">Outing date</span><LocalDateTime iso={expense.outingOccurredAt.toISOString()} /></div>
          <div><span className="technical-label">Created</span><LocalDateTime iso={expense.createdAt.toISOString()} mode="date" /></div>
        </div>
        <div className="expense-record__form">
          <p className="technical-label">EDIT RECORD</p>
          <ExpenseForm
            action={updateExpenseAction.bind(null, expense.id)}
            outings={outings}
            mode="edit"
            initialValues={{ description: expense.description, amountRupiah: expense.amount.toString(), outingId: expense.outingId }}
          />
          <p className="expense-record__next">Friend-share assignment arrives in the next product stage.</p>
        </div>
      </div>
    </section>
  );
}
