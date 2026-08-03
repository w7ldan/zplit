import Link from "next/link";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { createLedgerRepository } from "@/domain/ledger-repository";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { ExpenseRow } from "@/components/expenses/expense-row";
import { createExpenseAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const session = await requireSession();
  const repository = createLedgerRepository(getDatabase(), session.user.id);
  const expenses = await repository.listExpenses();
  const outings = await repository.listOutings();

  return (
    <section className="expenses-page" id="top">
      <div className="editorial-grid editorial-shell expenses-page__layout">
        <div className="expenses-page__marker technical-label">09 / EXPENSES</div>
        <div className="expenses-page__intro">
          <p className="technical-label">PRIVATE AMOUNTS / OWNER RECORDS</p>
          <h1>Every amount, accounted for.</h1>
          <p>Record each expense in whole rupiah and connect it to an outing when the context is clear.</p>
        </div>

        <div className="expenses-page__list" aria-live="polite">
          <div className="expenses-page__list-heading">
            <span className="technical-label">EXPENSE RECORDS</span>
            <span className="technical-label">{expenses.length.toString().padStart(2, "0")} ENTRIES</span>
          </div>
          {expenses.length > 0 ? (
            expenses.map((expense) => <ExpenseRow key={expense.id} expense={expense} />)
          ) : (
            <div className="expenses-page__empty">
              <h2>No expenses yet.</h2>
              <p>Record the first amount when you are ready. Shares and settlement arrive in later stages.</p>
            </div>
          )}
        </div>

        <div className="expenses-page__create">
          <p className="technical-label">NEW RECORD</p>
          <h2>Add an expense</h2>
          {outings.length > 0 ? (
            <ExpenseForm action={createExpenseAction} outings={outings} />
          ) : (
            <div className="expenses-page__empty">
              <p>Create an outing before recording an expense.</p>
              <Link className="action-link" href="/app/outings">Create an outing <span aria-hidden="true">→</span></Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
