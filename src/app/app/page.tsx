import Link from "next/link";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { createLedgerRepository } from "@/domain/ledger-repository";
import { formatRupiah } from "@/domain/rupiah";
import { LocalDateTime } from "@/components/editorial/local-date-time";

export const dynamic = "force-dynamic";

export default async function AppPage() {
  const session = await requireSession();
  const repository = createLedgerRepository(getDatabase(), session.user.id);
  const [summary, expenses, repayments] = await Promise.all([
    repository.getLedgerSummary(),
    repository.listExpenses(),
    repository.listRepayments(),
  ]);
  const activity = [
    ...expenses.map((expense) => ({
      kind: "Expense" as const,
      title: expense.description,
      detail: expense.outingTitle,
      amount: expense.amount,
      date: expense.outingOccurredAt,
      href: `/app/expenses/${expense.id}`,
    })),
    ...repayments.map((repayment) => ({
      kind: "Repayment" as const,
      title: repayment.friendName,
      detail: repayment.unallocatedAmount > 0 ? "Money received · unallocated remains open" : "Money received",
      amount: repayment.amount,
      date: repayment.paidAt,
      href: `/app/repayments/${repayment.id}`,
    })),
  ].sort((left, right) => right.date.getTime() - left.date.getTime()).slice(0, 6);

  return (
    <section className="app-page overview-page" id="top">
      <div className="editorial-shell app-page__layout">
        <div className="app-page__header">
          <div>
            <p className="technical-label">Overview · your balances</p>
            <h1>Overview</h1>
            <p className="app-page__lede">See what friends still owe, what needs allocation, and your latest activity.</p>
          </div>
          <div className="app-page__actions">
            <Link className="action-link action-link--primary" href="/app/expenses?create=1" data-task-trigger="expense-create">Add expense</Link>
            <Link className="action-link action-link--quiet" href="/app/repayments?create=1" data-task-trigger="repayment-create">Record repayment</Link>
          </div>
        </div>
        <section className="overview-summary" aria-label="Primary ledger summary">
          <div className="overview-summary__primary"><span className="technical-label">Still owed to you</span><strong>{formatRupiah(summary.totalOutstandingAmount)}</strong><span>Open balances across your friends.</span></div>
          <div className={summary.totalUnallocatedRepaymentAmount > 0 ? "overview-summary__attention" : undefined}><span className="technical-label">Needs allocation</span><strong>{formatRupiah(summary.totalUnallocatedRepaymentAmount)}</strong><span>{summary.totalUnallocatedRepaymentAmount > 0 ? "Received money still needs an expense." : "All received money is assigned."}</span></div>
          <div><span className="technical-label">Total spending</span><strong>{formatRupiah(summary.totalExpenseAmount)}</strong><span>All expenses recorded in this ledger.</span></div>
        </section>

        <div className="app-page__columns">
          <section className="ledger-section" aria-labelledby="balances-heading">
            <div className="ledger-section__heading"><h2 id="balances-heading">Friend balances</h2><span className="technical-label">{summary.friendBalances.length} with assigned shares</span></div>
            {summary.friendBalances.length === 0 ? (
              <div className="ledger-empty"><h3>No balances yet.</h3><p>Balances appear after assigning friends to an expense.</p><Link className="text-link" href="/app/friends">Add a friend <span aria-hidden="true">→</span></Link></div>
            ) : summary.friendBalances.map((friend) => (
              <div className="balance-row" key={friend.friendId}>
                <Link href={`/app/friends/${friend.friendId}`}><strong>{friend.name}</strong><span aria-hidden="true">→</span></Link>
                <span><span className="technical-label">Outstanding</span><strong>{formatRupiah(friend.outstandingAmount)}</strong></span>
              </div>
            ))}
          </section>
          <section className="ledger-section" aria-labelledby="activity-heading">
            <div className="ledger-section__heading"><h2 id="activity-heading">Recent activity</h2><span className="technical-label">Latest records</span></div>
            {activity.length === 0 ? <div className="ledger-empty"><p>No expenses or repayments yet.</p></div> : activity.map((item) => (
              <Link className="activity-row" href={item.href} key={`${item.kind}-${item.href}`}>
                <span className="technical-label">{item.kind}</span>
                <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                <span><strong>{formatRupiah(item.amount)}</strong><LocalDateTime iso={item.date.toISOString()} mode="date" /></span>
              </Link>
            ))}
          </section>
        </div>
        <details className="overview-ledger-totals">
          <summary>Ledger totals</summary>
          <div className="overview-ledger-totals__grid">
            <div><span className="technical-label">Assigned</span><strong>{formatRupiah(summary.totalAssignedAmount)}</strong></div>
            <div><span className="technical-label">Repaid</span><strong>{formatRupiah(summary.totalRepaidAmount)}</strong></div>
            <div><span className="technical-label">Received</span><strong>{formatRupiah(summary.totalReceivedAmount)}</strong></div>
            <div><span className="technical-label">Your portion</span><strong>{formatRupiah(summary.ownerPortionAmount)}</strong></div>
          </div>
        </details>
        {summary.totalUnallocatedRepaymentAmount > 0 ? <p className="overview-attention" role="status">{formatRupiah(summary.totalUnallocatedRepaymentAmount)} received remains unallocated. Review repayments to apply it to eligible shares.</p> : null}
      </div>
    </section>
  );
}
