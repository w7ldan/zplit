import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { RecordConfirmation } from "@/components/app/record-confirmation";
import { ExpenseReceipts } from "@/components/expenses/expense-receipts";
import { GroupExpenseConfirmation } from "@/components/groups/group-expense-confirmation";
import { GroupParticipantLabel } from "@/components/groups/group-expense-row";
import { formatRupiah } from "@/domain/rupiah";
import { createGroupAccountingRepository, GroupAccountingError } from "@/server/group-accounting";
import { confirmGroupExpenseAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Group expense details" };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function GroupExpenseDetailPage({ params, searchParams = Promise.resolve({}) }: { params: Promise<{ groupId: string; expenseId: string }>; searchParams?: Promise<{ created?: string | string[] }> }) {
  const session = await requireSession();
  const { groupId, expenseId } = await params;
  const path = `/app/personal/groups/${groupId}/expenses`;
  let expense;
  try {
    expense = await createGroupAccountingRepository(getDatabase(), groupId).getExpense(expenseId, session.user.id);
  } catch (error) {
    if (error instanceof GroupAccountingError && ["not_found", "not_member", "invalid_id"].includes(error.code)) notFound();
    throw error;
  }
  const canEditReceipts = expense.state === "pending" && expense.creator.userId === session.user.id;
  const query = await searchParams;
  return <section className="app-page group-expense-record" id="top"><div className="editorial-shell app-page__layout">
    <header className="group-expense-record__header"><div><p className="technical-label">GROUP EXPENSE · READ-ONLY RECORD</p><h1>{expense.description}</h1></div><Link className="group-expense-record__back" href={path}>← Back to Group expenses</Link></header>
    {first(query.created) === "1" ? <RecordConfirmation queryKey="created" message={`Expense saved · ${expense.state === "confirmed" ? "Confirmed" : "Pending confirmation"}`} focusTargetId="group-expense-status" /> : null}
    <div className="group-expense-record__workspace">
      <main className="group-expense-record__main">
        <section className={`group-expense__status group-expense__status--${expense.state}`} id="group-expense-status" tabIndex={-1} aria-labelledby="group-expense-status-heading"><div><p className="technical-label">STATE</p><h2 id="group-expense-status-heading">{expense.state === "confirmed" ? "Confirmed" : "Pending confirmation"}</h2></div>{expense.state === "pending" ? <p>{expense.payer.userId === session.user.id ? "You are the claimed payer. Confirming creates the expense’s participant-to-participant obligations." : `Waiting for ${expense.payer.displayName} to confirm that they paid this expense.`}</p> : <p>Participant-to-participant obligations were created from these shares.</p>}{expense.state === "pending" && expense.payer.userId === session.user.id ? <GroupExpenseConfirmation action={confirmGroupExpenseAction.bind(null, groupId, expense.id)} /> : null}</section>
        <section className="group-expense__section" aria-labelledby="group-expense-shares-heading"><div className="group-section-heading"><div><p className="technical-label">SPLIT</p><h2 id="group-expense-shares-heading">Shares</h2></div><strong>{formatRupiah(expense.totalAmount)}</strong></div><div className="group-expense__share-list">{expense.shares.map((share) => <div className="group-expense__share-row" key={share.id}><span><GroupParticipantLabel participant={share.participant} /></span><strong>{formatRupiah(share.amount)}</strong></div>)}</div></section>
        <section className="group-expense__section" aria-labelledby="group-expense-obligations-heading"><div className="group-section-heading"><div><p className="technical-label">OBLIGATIONS</p><h2 id="group-expense-obligations-heading">Participant-to-participant debt</h2></div></div>{expense.state === "confirmed" && expense.obligations.length ? <div className="group-expense__obligation-list">{expense.obligations.map((obligation) => <div className="group-expense__obligation-row" key={obligation.id}><span><GroupParticipantLabel participant={obligation.debtor} /> owes <GroupParticipantLabel participant={obligation.creditor} /></span><strong>{formatRupiah(obligation.originalAmount)}</strong></div>)}</div> : <p className="group-expense__supporting-copy">{expense.state === "confirmed" ? "No participant owes the payer from this expense." : `No obligations yet. This expense becomes authoritative after ${expense.payer.displayName} confirms that they paid.`}</p>}</section>
        <ExpenseReceipts expenseId={expense.id} initialReceipts={expense.receipts} basePath={path} canEdit={canEditReceipts} />
      </main>
      <aside className="group-expense-record__sidebar"><dl className="group-expense__meta"><div><dt>Total</dt><dd>{formatRupiah(expense.totalAmount)}</dd></div><div><dt>Occurred</dt><dd><LocalDateTime iso={expense.occurredAt.toISOString()} /></dd></div><div><dt>Created by</dt><dd><GroupParticipantLabel participant={expense.creator} /></dd></div><div><dt>Paid by</dt><dd><GroupParticipantLabel participant={expense.payer} /></dd></div>{expense.confirmedAt ? <div><dt>Confirmed</dt><dd><LocalDateTime iso={expense.confirmedAt.toISOString()} /></dd></div> : null}</dl></aside>
    </div>
  </div></section>;
}
