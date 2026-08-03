import Link from "next/link";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { createLedgerRepository } from "@/domain/ledger-repository";
import { formatRupiah } from "@/domain/rupiah";

export const dynamic = "force-dynamic";

export default async function AppPage() {
  const session = await requireSession();
  const summary = await createLedgerRepository(getDatabase(), session.user.id).getLedgerSummary();

  return (
    <section className="ledger-overview" id="top">
      <div className="editorial-grid editorial-shell ledger-overview__layout">
        <div className="ledger-overview__marker technical-label">06 / LEDGER OVERVIEW</div>
        <div className="ledger-overview__intro">
          <p className="technical-label">OWNER-SCOPED RECORD / WHOLE RUPIAH</p>
          <h1>What is still owed.</h1>
          <p>Only allocated repayments reduce outstanding debt; unallocated money remains received but open.</p>
        </div>

        <div className="ledger-overview__summary" aria-label="Ledger totals">
          <div className="ledger-overview__primary">
            <span className="technical-label">Outstanding</span>
            <strong>{formatRupiah(summary.totalOutstandingAmount)}</strong>
          </div>
          <div className="ledger-overview__metric"><span className="technical-label">Assigned to friends</span><strong>{formatRupiah(summary.totalAssignedAmount)}</strong></div>
          <div className="ledger-overview__metric"><span className="technical-label">Repaid toward shares</span><strong>{formatRupiah(summary.totalRepaidAmount)}</strong></div>
          <div className="ledger-overview__metric"><span className="technical-label">Received</span><strong>{formatRupiah(summary.totalReceivedAmount)}</strong></div>
          <div className="ledger-overview__metric"><span className="technical-label">Unallocated</span><strong>{formatRupiah(summary.totalUnallocatedRepaymentAmount)}</strong></div>
          <div className="ledger-overview__metric"><span className="technical-label">Your portion</span><strong>{formatRupiah(summary.ownerPortionAmount)}</strong></div>
          <div className="ledger-overview__metric"><span className="technical-label">Total paid out</span><strong>{formatRupiah(summary.totalExpenseAmount)}</strong></div>
        </div>

        <section className="ledger-overview__balances" aria-labelledby="friend-balances-heading">
          <div className="ledger-overview__balances-heading">
            <h2 id="friend-balances-heading">Friend balances</h2>
            <span className="technical-label">{summary.friendBalances.length.toString().padStart(2, "0")} FRIENDS</span>
          </div>

          {summary.friendBalances.length === 0 ? (
            <div className="ledger-overview__empty">
              <h3>No balances yet.</h3>
              <p>Balances appear after assigning friends to an expense.</p>
              <div className="ledger-overview__empty-links">
                <Link className="ledger-overview__link" href="/app/expenses">Expenses <span aria-hidden="true">→</span></Link>
                <Link className="ledger-overview__link" href="/app/friends">Friends <span aria-hidden="true">→</span></Link>
              </div>
            </div>
          ) : (
            summary.friendBalances.map((friend) => (
              <div className="ledger-overview__row" key={friend.friendId}>
                <div className="ledger-overview__friend">
                  <Link className="ledger-overview__friend-link" href={`/app/friends/${friend.friendId}`}>
                    <span>{friend.name}</span><span aria-hidden="true">→</span>
                  </Link>
                  <div className="ledger-overview__states">
                    {friend.archived ? <span className="technical-label">ARCHIVED</span> : null}
                    {friend.outstandingAmount === 0 ? <span className="technical-label">SETTLED</span> : null}
                  </div>
                </div>
                <div className="ledger-overview__amount"><span className="technical-label">Assigned</span><strong>{formatRupiah(friend.assignedAmount)}</strong></div>
                <div className="ledger-overview__amount"><span className="technical-label">Repaid</span><strong>{formatRupiah(friend.repaidAmount)}</strong></div>
                <div className="ledger-overview__amount"><span className="technical-label">Outstanding</span><strong>{formatRupiah(friend.outstandingAmount)}</strong></div>
              </div>
            ))
          )}
        </section>
      </div>
    </section>
  );
}
