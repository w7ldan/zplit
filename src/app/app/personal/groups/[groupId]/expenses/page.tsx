import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { GroupExpenseForm } from "@/components/groups/group-expense-form";
import { GroupExpenseRow } from "@/components/groups/group-expense-row";
import { TaskPanel } from "@/components/app/task-panel";
import { RecordPagination } from "@/components/records/record-pagination";
import { recordHref } from "@/domain/record-retrieval";
import { createGroupAccountingRepository, GroupAccountingError } from "@/server/group-accounting";
import { createGroupExpenseAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Group expenses" };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function GroupExpensesPage({ params, searchParams = Promise.resolve({}) }: { params: Promise<{ groupId: string }>; searchParams?: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const session = await requireSession();
  const { groupId } = await params;
  const query = await searchParams;
  const path = `/app/personal/groups/${groupId}/expenses`;
  const repository = createGroupAccountingRepository(getDatabase(), groupId);
  const search = first(query.q);
  const expenseState = first(query.state);
  let page;
  let participants;
  try {
    [page, participants] = await Promise.all([repository.listExpenses(session.user.id, first(query.page), { q: search, state: expenseState }), repository.getParticipantEligibility(session.user.id)]);
  } catch (error) {
    if (error instanceof GroupAccountingError && (error.code === "not_member" || error.code === "invalid_id")) notFound();
    throw error;
  }
  const defaultPayerId = participants.find((participant) => participant.userId === session.user.id && participant.canPay)?.id ?? "";
  const filtered = Boolean(search || expenseState === "pending" || expenseState === "confirmed");
  const listPath = recordHref(path, query);
  return <section className="app-page group-expenses-page" id="top"><div className="editorial-shell app-page__layout">
    <header className="app-page__header"><div><p className="technical-label">GROUP EXPENSES</p><h1>Expenses</h1><p className="app-page__lede">Shared spending recorded inside this Group. Confirmed expenses create participant-to-participant obligations.</p></div><Link className="action-link action-link--primary" href={recordHref(path, query, { create: "1" })} data-task-trigger="group-expense-create">Add expense</Link></header>
    <form className="group-expense-filters" method="get" action={path}><label htmlFor="group-expense-search">Search expenses</label><input id="group-expense-search" name="q" type="search" defaultValue={search ?? ""} placeholder="Description" /><label htmlFor="group-expense-state">State</label><select id="group-expense-state" name="state" defaultValue={expenseState === "pending" || expenseState === "confirmed" ? expenseState : ""}><option value="">All</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option></select><button className="action-link action-link--quiet" type="submit">Apply</button>{filtered ? <Link className="text-link" href={path}>Clear</Link> : null}</form>
    <div className="ledger-list" id="record-list"><div className="ledger-list__heading"><span className="technical-label">LATEST FIRST</span><span className="technical-label">{page.totalItems} entries</span></div>{page.items.length ? page.items.map((expense) => <GroupExpenseRow key={expense.id} expense={expense} viewerUserId={session.user.id} basePath={path} />) : <div className="ledger-empty"><h2>{filtered ? "No matching expenses." : "No expenses yet."}</h2><p>{filtered ? "Try a different description or state." : "Record the first shared expense inside this Group."}</p>{!filtered ? <Link className="text-link" href={`${path}?create=1`} data-task-trigger="group-expense-create">Add expense <span aria-hidden="true">→</span></Link> : null}</div>}<RecordPagination page={page.page} pageSize={page.pageSize} totalItems={page.totalItems} totalPages={page.totalPages} href={listPath} /></div>
  </div>{first(query.create) === "1" ? <TaskPanel open title="Add a Group expense" description="Record who paid, then allocate the complete amount across Group participants." triggerId="group-expense-create"><GroupExpenseForm action={createGroupExpenseAction.bind(null, groupId)} participants={participants} defaultPayerId={defaultPayerId} initialOccurredAtUtc={new Date().toISOString()} /></TaskPanel> : null}</section>;
}
