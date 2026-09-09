import Link from "next/link";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { formatRupiah } from "@/domain/rupiah";
import { formatCalendarDate } from "@/components/editorial/calendar-date";
import type { BudgetTransactionView } from "@/domain/budgeting/types";
import { listBudgetTransactions } from "@/server/budgeting/transactions";
import { voidBudgetTransactionAction } from "../actions";

export const metadata = { title: "Budget transactions" };
export const dynamic = "force-dynamic";

function TransactionHistoryRow({ transaction }: { transaction: BudgetTransactionView }) {
  const amount = `${transaction.direction === "outflow" ? "−" : "+"}${formatRupiah(transaction.amount)}`;
  return (
    <div className={`budget-history-row${transaction.status === "voided" ? " budget-history-row--voided" : ""}`}>
      <span className="technical-label">{transaction.direction === "outflow" ? "Expense" : "Credit / refund"}</span>
      <span><strong>{transaction.description}</strong><small>{transaction.categoryName} · {formatCalendarDate(transaction.occurredOn)}</small></span>
      <span><strong>{amount}</strong><small>{transaction.status === "voided" ? "Voided" : "Posted"}</small></span>
      {transaction.status === "posted" && transaction.origin === "manual" ? <form action={voidBudgetTransactionAction.bind(null, transaction.id)}><button className="action-link action-link--quiet" type="submit">Void</button></form> : <span />}
    </div>
  );
}

function HistoryContent({ transactions }: { transactions: BudgetTransactionView[] }) {
  if (!transactions.length) {
    return <div className="ledger-empty"><p>No budget transactions yet.</p><Link className="text-link" href="/app/personal/budget">Return to Budget <span aria-hidden="true">→</span></Link></div>;
  }
  return <div className="budget-transaction-list">{transactions.map((transaction) => <TransactionHistoryRow transaction={transaction} key={transaction.id} />)}</div>;
}

export default async function BudgetTransactionsPage() {
  const session = await requireSession();
  const transactions = await listBudgetTransactions(getDatabase(), session.user.id);
  return (
    <section className="app-page budget-page budget-history-page" id="top">
      <div className="editorial-shell app-page__layout">
        <header className="app-page__header">
          <div><p className="technical-label">Personal · budget</p><h1>Transaction history</h1><p className="app-page__lede">Manual budget records, including voided history.</p></div>
          <Link className="action-link action-link--primary" href="/app/personal/budget?create=1" data-task-trigger="budget-transaction">Add transaction</Link>
        </header>
        <section className="ledger-section" aria-labelledby="budget-history-heading">
          <div className="ledger-section__heading"><h2 id="budget-history-heading">All transactions</h2><Link className="text-link" href="/app/personal/budget">Back to Budget <span aria-hidden="true">→</span></Link></div>
          <HistoryContent transactions={transactions} />
        </section>
      </div>
    </section>
  );
}
