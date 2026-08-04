import Link from "next/link";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { createLedgerRepository } from "@/domain/ledger-repository";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { ExpenseRow } from "@/components/expenses/expense-row";
import { createExpenseAction } from "./actions";
import { TaskPanel } from "@/components/app/task-panel";

export const dynamic = "force-dynamic";

type ExpensesPageProps = { searchParams?: Promise<{ create?: string | string[]; outing?: string | string[] }> };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ExpensesPage({ searchParams = Promise.resolve({}) }: ExpensesPageProps = {}) {
  const session = await requireSession();
  const params = await searchParams;
  const openCreate = first(params?.create) === "1";
  const selectedOutingId = first(params?.outing) ?? "";
  const repository = createLedgerRepository(getDatabase(), session.user.id);
  const [expenses, outings] = await Promise.all([repository.listExpenses(), repository.listOutings()]);
  const outingId = outings.some((outing) => outing.id === selectedOutingId) ? selectedOutingId : "";

  return (
    <section className="app-page expenses-page" id="top">
      <div className="editorial-shell app-page__layout">
        <div className="app-page__header">
          <div>
            <p className="technical-label">Expenses · chronological ledger</p>
            <h1>Every amount, accounted for.</h1>
            <p className="app-page__lede">Record the amount and event clearly, then assign the friends who owe a share.</p>
          </div>
          <Link className="action-link action-link--primary" href="/app/expenses?create=1" data-task-trigger="expense-create">Add expense</Link>
        </div>
        <div className="ledger-list" aria-live="polite">
          <div className="ledger-list__heading"><span className="technical-label">EXPENSE RECORDS</span><span className="technical-label">{expenses.length} entries</span></div>
          {expenses.length > 0 ? expenses.map((expense) => <ExpenseRow key={expense.id} expense={expense} />) : (
            <div className="ledger-empty"><h2>No expenses yet.</h2><p>Record the first amount when you are ready. Every expense belongs to an outing.</p><Link className="text-link" href={outings.length ? "/app/expenses?create=1" : "/app/outings?create=1"} data-task-trigger={outings.length ? "expense-create" : "outing-create"}>{outings.length ? "Add an expense" : "Create an outing"} <span aria-hidden="true">→</span></Link></div>
          )}
        </div>
      </div>
      {openCreate ? <TaskPanel open title="Add an expense" description="Choose the outing, record the whole-rupiah amount, and assign shares next." triggerId="expense-create">
        {outings.length > 0 ? <ExpenseForm action={createExpenseAction} outings={outings} initialValues={{ description: "", amountRupiah: "", outingId }} /> : <div className="task-panel__empty"><p>Create an outing before recording an expense.</p><Link className="action-link action-link--primary" href="/app/outings?create=1">Create an outing</Link></div>}
      </TaskPanel> : null}
    </section>
  );
}
