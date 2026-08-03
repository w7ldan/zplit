import Link from "next/link";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { createLedgerRepository } from "@/domain/ledger-repository";
import { RepaymentForm } from "@/components/repayments/repayment-form";
import { RepaymentRow } from "@/components/repayments/repayment-row";
import { createRepaymentAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function RepaymentsPage() {
  const session = await requireSession();
  const repository = createLedgerRepository(getDatabase(), session.user.id);
  const [repayments, activeFriends, archivedFriends] = await Promise.all([
    repository.listRepayments(),
    repository.listFriends(),
    repository.listFriends({ archived: true }),
  ]);
  const friends = [...activeFriends, ...archivedFriends];

  return (
    <section className="repayments-page" id="top">
      <div className="editorial-grid editorial-shell repayments-page__layout">
        <div className="repayments-page__marker technical-label">10 / REPAYMENTS</div>
        <div className="repayments-page__intro">
          <p className="technical-label">MONEY RECEIVED / OWNER RECORDS</p>
          <h1>Money received, recorded.</h1>
          <p>Record what arrived from a friend. Only allocated money reduces an outstanding share.</p>
        </div>

        <div className="repayments-page__list" aria-live="polite">
          <div className="repayments-page__list-heading">
            <span className="technical-label">REPAYMENT RECORDS</span>
            <span className="technical-label">{repayments.length.toString().padStart(2, "0")} ENTRIES</span>
          </div>
          {repayments.length > 0 ? (
            repayments.map((repayment) => <RepaymentRow key={repayment.id} repayment={repayment} />)
          ) : (
            <div className="repayments-page__empty">
              <h2>No repayments yet.</h2>
              <p>Record money received from a friend when it arrives. Allocation can be managed in the next checkpoint.</p>
            </div>
          )}
        </div>

        <div className="repayments-page__create">
          <p className="technical-label">NEW RECORD</p>
          <h2>Record a repayment</h2>
          {friends.length > 0 ? (
            <RepaymentForm action={createRepaymentAction} friends={friends} />
          ) : (
            <div className="repayments-page__empty">
              <p>Add a friend before recording money received.</p>
              <Link className="action-link" href="/app/friends">Add a friend <span aria-hidden="true">→</span></Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
