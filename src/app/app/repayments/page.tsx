import Link from "next/link";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { createLedgerRepository } from "@/domain/ledger-repository";
import { RepaymentForm } from "@/components/repayments/repayment-form";
import { RepaymentRow } from "@/components/repayments/repayment-row";
import { createRepaymentAction } from "./actions";
import { TaskPanel } from "@/components/app/task-panel";

export const dynamic = "force-dynamic";

type RepaymentsPageProps = { searchParams?: Promise<{ create?: string | string[] }> };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RepaymentsPage({ searchParams = Promise.resolve({}) }: RepaymentsPageProps = {}) {
  const session = await requireSession();
  const params = await searchParams;
  const openCreate = first(params?.create) === "1";
  const repository = createLedgerRepository(getDatabase(), session.user.id);
  const [repayments, activeFriends, archivedFriends, summary, openExpenseSharesByFriend] = await Promise.all([
    repository.listRepayments(),
    repository.listFriends(),
    repository.listFriends({ archived: true }),
    repository.getLedgerSummary(),
    repository.listOpenExpenseSharesByFriend(),
  ]);
  const friends = [...activeFriends, ...archivedFriends];
  const outstandingByFriend = Object.fromEntries(summary.friendBalances.map((balance) => [balance.friendId, balance.outstandingAmount]));

  return (
    <section className="app-page repayments-page" id="top">
      <div className="editorial-shell app-page__layout">
        <div className="app-page__header">
          <div>
            <p className="technical-label">Repayments · money returned</p>
            <h1>Repayments</h1>
            <p className="app-page__lede">Record money received and apply it to outstanding expense shares.</p>
          </div>
          <Link className="action-link action-link--primary" href="/app/repayments?create=1" data-task-trigger="repayment-create">Add repayment</Link>
        </div>
        <div className="ledger-list" aria-live="polite">
          <div className="ledger-list__heading"><span className="technical-label">REPAYMENT RECORDS</span><span className="technical-label">{repayments.length} entries</span></div>
          {repayments.length > 0 ? repayments.map((repayment) => <RepaymentRow key={repayment.id} repayment={repayment} />) : (
            <div className="ledger-empty"><h2>No repayments yet.</h2><p>Record money received from a friend when it arrives; allocation follows on the record.</p><Link className="text-link" href={friends.length ? "/app/repayments?create=1" : "/app/friends?create=1"} data-task-trigger={friends.length ? "repayment-create" : "friend-create"}>{friends.length ? "Add a repayment" : "Add a friend"} <span aria-hidden="true">→</span></Link></div>
          )}
        </div>
      </div>
      {openCreate ? <TaskPanel open title="Add a repayment" description="Record the money received and keep its eligible shares visible for allocation." triggerId="repayment-create">
        {friends.length > 0 ? <RepaymentForm action={createRepaymentAction} friends={friends} outstandingByFriend={outstandingByFriend} openExpenseSharesByFriend={openExpenseSharesByFriend} /> : <div className="task-panel__empty"><p>Add a friend before recording money received.</p><Link className="action-link action-link--primary" href="/app/friends?create=1">Add a friend</Link></div>}
      </TaskPanel> : null}
    </section>
  );
}
