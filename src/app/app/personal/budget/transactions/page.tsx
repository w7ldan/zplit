import Link from "next/link";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { formatRupiah } from "@/domain/rupiah";
import { formatCalendarDate } from "@/components/editorial/calendar-date";
import type { BudgetTransactionView } from "@/domain/budgeting/types";
import { listBudgetTransactions } from "@/server/budgeting/transactions";
import { listBudgetCategoryOptions } from "@/server/budgeting/categories";
import { changePersonalExpenseBudgetCategoryAction, voidBudgetTransactionAction } from "../actions";

export const metadata = { title: "Budget transactions" };
export const dynamic = "force-dynamic";

type BudgetCategoryOption = { id: string; name: string };

function ChangeCategoryForm({ transaction, categories }: { transaction: BudgetTransactionView; categories: BudgetCategoryOption[] }) {
  if (transaction.sourceType !== "personal_expense" || transaction.status !== "posted") return null;
  return (
    <form action={changePersonalExpenseBudgetCategoryAction}>
      <input type="hidden" name="transactionId" value={transaction.id} />
      <label className="sr-only" htmlFor={`budget-history-category-${transaction.id}`}>Budget category</label>
      <select id={`budget-history-category-${transaction.id}`} name="categoryId" defaultValue={transaction.categoryId ?? categories[0]?.id}>
        {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
      </select>
      <button className="action-link action-link--quiet" type="submit">Change category</button>
    </form>
  );
}

function TransactionHistoryRow({ transaction, categories }: { transaction: BudgetTransactionView; categories: BudgetCategoryOption[] }) {
  const amount = `${transaction.direction === "outflow" ? "−" : "+"}${formatRupiah(transaction.amount)}`;
  const sourceLabel = transaction.sourceType === "personal_expense" ? "Personal expense" : transaction.sourceType === "personal_repayment" ? "Personal repayment" : transaction.direction === "outflow" ? "Expense" : "Credit / refund";
  const categoryLabel = transaction.categoryNames.length ? transaction.categoryNames.join(" + ") : "Not absorbed";
  return (
    <div className={`budget-history-row${transaction.status === "voided" ? " budget-history-row--voided" : ""}`}>
      <span className="technical-label">{sourceLabel}</span>
      <span>
        <strong>{transaction.description}</strong>
        <small>{categoryLabel} · {formatCalendarDate(transaction.occurredOn)}</small>
        <ChangeCategoryForm transaction={transaction} categories={categories} />
      </span>
      <span><strong>{amount}</strong><small>{transaction.status === "voided" ? "Voided" : "Posted"}</small></span>
      {transaction.status === "posted" && transaction.origin === "manual" ? <form action={voidBudgetTransactionAction.bind(null, transaction.id)}><button className="action-link action-link--quiet" type="submit">Void</button></form> : <span />}
    </div>
  );
}

function HistoryContent({ transactions, categories }: { transactions: BudgetTransactionView[]; categories: Array<{ id: string; name: string }> }) {
  if (!transactions.length) {
    return <div className="ledger-empty"><p>No budget transactions yet.</p><Link className="text-link" href="/app/personal/budget">Return to Budget <span aria-hidden="true">→</span></Link></div>;
  }
  return <div className="budget-transaction-list">{transactions.map((transaction) => <TransactionHistoryRow transaction={transaction} categories={categories} key={transaction.id} />)}</div>;
}

export default async function BudgetTransactionsPage() {
  const session = await requireSession();
  const database = getDatabase();
  const [transactions, categories] = await Promise.all([listBudgetTransactions(database, session.user.id), listBudgetCategoryOptions(database, session.user.id)]);
  return (
    <section className="app-page budget-page budget-history-page" id="top">
      <div className="editorial-shell app-page__layout">
        <header className="app-page__header">
          <div><p className="technical-label">Personal · budget</p><h1>Transaction history</h1><p className="app-page__lede">Manual and linked budget records, including voided history.</p></div>
          <Link className="action-link action-link--primary" href="/app/personal/budget?create=transaction" data-task-trigger="budget-transaction">Add transaction</Link>
        </header>
        <section className="ledger-section" aria-labelledby="budget-history-heading">
          <div className="ledger-section__heading"><h2 id="budget-history-heading">All transactions</h2><Link className="text-link" href="/app/personal/budget">Back to Budget <span aria-hidden="true">→</span></Link></div>
          <HistoryContent transactions={transactions} categories={categories} />
        </section>
      </div>
    </section>
  );
}
