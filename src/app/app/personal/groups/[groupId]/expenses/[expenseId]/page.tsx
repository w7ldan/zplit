import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { RecordConfirmation } from "@/components/app/record-confirmation";
import { ExpenseReceipts } from "@/components/expenses/expense-receipts";
import { GroupExpenseConfirmation, GroupExpenseVoid } from "@/components/groups/group-expense-confirmation";
import { GroupParticipantLabel } from "@/components/groups/group-expense-row";
import { GroupExpenseLiveRefresh } from "@/components/realtime/group-expense-live-refresh";
import { formatRupiah } from "@/domain/rupiah";
import { createGroupAccountingRepository, GroupAccountingError, type GroupExpenseDetail } from "@/server/group-accounting";
import { confirmGroupExpenseAction, rejectGroupExpenseAction, voidGroupExpenseAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Group expense details" };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const stateLabels = { pending: "Pending confirmation", confirmed: "Confirmed", rejected: "Rejected", voided: "Voided" } as const;
const lifecycleLabels = { created: "Created by", payer_confirmed: "Confirmed by", payer_rejected: "Rejected by", voided: "Voided by" } as const;

function lifecycleActor(expense: Pick<GroupExpenseDetail, "creator" | "payer" | "shares">, actorUserId: string) {
  return [expense.creator, expense.payer, ...expense.shares.map((share) => share.participant)].find((participant) => participant.userId === actorUserId)?.displayName ?? "Group member";
}

function statusCopy(expense: GroupExpenseDetail, activePayer: boolean) {
  if (expense.state === "pending") return activePayer ? "You are the claimed payer. Confirm that you paid this expense, or reject the claim that you paid it." : expense.payer.status === "active" ? `Waiting for ${expense.payer.displayName} to confirm that they paid this expense.` : `The claimed payer ${expense.payer.displayName} is no longer an active Group member, so this claim has no current balance effect.`;
  if (expense.state === "confirmed") return "This expense is confirmed and contributes to current Group balances.";
  if (expense.state === "rejected") return "The claimed payer rejected this expense. It remains in history without a current balance effect.";
  return "This expense remains in history. Its previous balance effect was reversed and it no longer contributes to current balances.";
}

function GroupExpenseStatus({ expense, activePayer, groupId }: { expense: GroupExpenseDetail; activePayer: boolean; groupId: string }) {
  return <section className={`group-expense__status group-expense__status--${expense.state}`} id="group-expense-status" tabIndex={-1} aria-labelledby="group-expense-status-heading"><div><p className="technical-label">STATE</p><h2 id="group-expense-status-heading">{stateLabels[expense.state]}</h2></div><p>{statusCopy(expense, activePayer)}</p>{expense.state === "pending" && activePayer ? <GroupExpenseConfirmation confirmAction={confirmGroupExpenseAction.bind(null, groupId, expense.id)} rejectAction={rejectGroupExpenseAction.bind(null, groupId, expense.id)} /> : null}{expense.state === "confirmed" && activePayer ? <GroupExpenseVoid action={voidGroupExpenseAction.bind(null, groupId, expense.id)} /> : null}</section>;
}

function GroupExpenseObligations({ expense }: { expense: GroupExpenseDetail }) {
  const historical = expense.state === "voided";
  const canShow = expense.state === "confirmed" || historical;
  const emptyCopy = expense.state === "confirmed" ? "No participant owes the payer from this expense." : historical ? "No current obligations. The previous balance effect was reversed." : expense.state === "rejected" ? "No obligations were created because the payer rejected the claim." : `No obligations yet. This expense becomes authoritative after ${expense.payer.displayName} confirms that they paid.`;
  return <section className="group-expense__section" aria-labelledby="group-expense-obligations-heading"><div className="group-section-heading"><div><p className="technical-label">{historical ? "HISTORICAL OBLIGATIONS" : "OBLIGATIONS"}</p><h2 id="group-expense-obligations-heading">{historical ? "Previous participant debt" : "Participant-to-participant debt"}</h2></div></div>{canShow && expense.obligations.length ? <div className={`group-expense__obligation-list${historical ? " group-expense__obligation-list--historical" : ""}`}>{expense.obligations.map((obligation) => <div className="group-expense__obligation-row" key={obligation.id}><span><GroupParticipantLabel participant={obligation.debtor} /> owes <GroupParticipantLabel participant={obligation.creditor} /></span><span><strong>{formatRupiah(obligation.originalAmount)}</strong>{historical ? <small>Reversed</small> : null}</span></div>)}</div> : <p className="group-expense__supporting-copy">{emptyCopy}</p>}</section>;
}

function GroupExpenseHistory({ expense }: { expense: GroupExpenseDetail }) {
  const events = expense.lifecycleEvents ?? [];
  return <section className="group-expense__section group-expense__history" aria-labelledby="group-expense-history-heading"><div className="group-section-heading"><div><p className="technical-label">HISTORY</p><h2 id="group-expense-history-heading">Lifecycle history</h2></div></div>{events.length ? <ol className="group-expense__history-list">{events.map((event) => <li key={event.id}><span>{lifecycleLabels[event.eventType]} {lifecycleActor(expense, event.actorUserId)}</span><LocalDateTime iso={event.createdAt.toISOString()} /></li>)}</ol> : <p className="group-expense__supporting-copy">No lifecycle history is available for this record.</p>}</section>;
}

function GroupExpenseSidebar({ expense }: { expense: GroupExpenseDetail }) {
  return <aside className="group-expense-record__sidebar"><dl className="group-expense__meta"><div><dt>State</dt><dd>{stateLabels[expense.state]}</dd></div><div><dt>Total</dt><dd>{formatRupiah(expense.totalAmount)}</dd></div><div><dt>Occurred</dt><dd><LocalDateTime iso={expense.occurredAt.toISOString()} /></dd></div><div><dt>Created by</dt><dd><GroupParticipantLabel participant={expense.creator} /></dd></div><div><dt>Paid by</dt><dd><GroupParticipantLabel participant={expense.payer} /></dd></div>{expense.confirmedAt ? <div><dt>Confirmed</dt><dd><LocalDateTime iso={expense.confirmedAt.toISOString()} /></dd></div> : null}</dl></aside>;
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
  const canEditReceipts = expense.state === "pending" && expense.creator.status === "active" && expense.creator.userId === session.user.id;
  const activePayer = expense.payer.status === "active" && expense.payer.userId === session.user.id;
  const query = await searchParams;
  return <section className="app-page group-expense-record" id="top"><div className="editorial-shell app-page__layout">
    <GroupExpenseLiveRefresh groupId={groupId} expenseId={expense.id} />
    <header className="group-expense-record__header"><div><p className="technical-label">GROUP EXPENSE · RECORD</p><h1>{expense.description}</h1></div><Link className="group-expense-record__back" href={path}>← Back to Group expenses</Link></header>
    {first(query.created) === "1" ? <RecordConfirmation queryKey="created" message={`Expense saved · ${expense.state === "confirmed" ? "Confirmed" : "Pending confirmation"}`} focusTargetId="group-expense-status" /> : null}
    <div className="group-expense-record__workspace">
      <main className="group-expense-record__main">
        <GroupExpenseStatus expense={expense} activePayer={activePayer} groupId={groupId} />
        <section className="group-expense__section" aria-labelledby="group-expense-shares-heading"><div className="group-section-heading"><div><p className="technical-label">SPLIT</p><h2 id="group-expense-shares-heading">Shares</h2></div><strong>{formatRupiah(expense.totalAmount)}</strong></div><div className="group-expense__share-list">{expense.shares.map((share) => <div className="group-expense__share-row" key={share.id}><span><GroupParticipantLabel participant={share.participant} /></span><strong>{formatRupiah(share.amount)}</strong></div>)}</div></section>
        <GroupExpenseObligations expense={expense} />
        <GroupExpenseHistory expense={expense} />
        <ExpenseReceipts expenseId={expense.id} initialReceipts={expense.receipts.map((receipt) => ({ ...receipt, createdAt: receipt.createdAt.toISOString() }))} basePath={path} canEdit={canEditReceipts} readOnlyMessage={expense.state === "pending" ? "Only the creator can change receipts while this expense is pending." : "Receipts are read-only after an expense leaves pending state."} />
      </main>
      <GroupExpenseSidebar expense={expense} />
    </div>
  </div></section>;
}
