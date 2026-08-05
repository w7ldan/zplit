import Link from "next/link";
import { redirect } from "next/navigation";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { createLedgerRepository } from "@/domain/ledger-repository";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { ExpenseRow } from "@/components/expenses/expense-row";
import { createExpenseAction } from "./actions";
import { TaskPanel } from "@/components/app/task-panel";
import { LiveRecordFilters } from "@/components/records/live-record-filters";
import { RecordPagination } from "@/components/records/record-pagination";
import { groupRecordsByMonth, monthDisplayLabel, normalizeExpenseFilters, recordHref } from "@/domain/record-retrieval";
import { validateExpenseReturnTarget } from "@/domain/expense-return";

export const dynamic = "force-dynamic";

type ExpensesPageProps = { searchParams?: Promise<{ [key: string]: string | string[] | undefined; create?: string | string[]; outing?: string | string[]; q?: string | string[]; month?: string | string[]; assignment?: string | string[]; page?: string | string[] }> };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ExpensesPage({ searchParams = Promise.resolve({}) }: ExpensesPageProps = {}) {
  const params = await searchParams;
  const emptyParams = ["q", "outing", "month", "assignment"].filter((name) => first(params?.[name]) === "");
  if (emptyParams.length) redirect(recordHref("/app/expenses", params, Object.fromEntries(emptyParams.map((name) => [name, undefined]))));
  const session = await requireSession();
  const openCreate = first(params?.create) === "1";
  const repository = createLedgerRepository(getDatabase(), session.user.id);
  const outings = await repository.listOutings();
  const filters = normalizeExpenseFilters({ q: first(params?.q), outingId: first(params?.outing), month: first(params?.month), assignment: first(params?.assignment), page: first(params?.page) });
  const outingId = outings.some((outing) => outing.id === filters.outingId) ? filters.outingId : undefined;
  const expensePage = await repository.listExpenseRecords({ q: first(params?.q), outingId, month: first(params?.month), assignment: first(params?.assignment), page: first(params?.page) });
  const groups = groupRecordsByMonth(expensePage.items, (expense) => expense.outingOccurredAt);
  const filtered = Boolean(filters.q || filters.month || filters.outingId || filters.assignment !== "all");
  const listHref = recordHref("/app/expenses", params);
  const expenseReturnTarget = validateExpenseReturnTarget(recordHref("/app/expenses", params, { create: "1" })) ?? "/app/expenses?create=1";

  return (
    <section className="app-page expenses-page" id="top">
      <div className="editorial-shell app-page__layout">
        <div className="app-page__header">
          <div>
            <p className="technical-label">Expenses · money you paid</p>
            <h1>Expenses</h1>
            <p className="app-page__lede">Record shared spending and assign the amounts each friend owes.</p>
          </div>
          <Link className="action-link action-link--primary" href={recordHref("/app/expenses", params, { create: "1" })} data-task-trigger="expense-create">Add expense</Link>
        </div>
        <LiveRecordFilters
          action="/app/expenses"
          search={{ label: "Search expenses", placeholder: "Description or outing", value: filters.q ?? "" }}
          selects={[{ name: "outing", label: "Outing", value: outingId ?? "", options: [{ value: "", label: "All outings" }, ...outings.map((outing) => ({ value: outing.id, label: outing.title }))] }, { name: "assignment", label: "Assignment", value: filters.assignment === "all" ? "" : filters.assignment, options: [{ value: "", label: "All assignment states" }, { value: "assigned", label: "Assigned" }, { value: "unassigned", label: "Unassigned" }] }]}
          month={{ label: "Month", value: filters.month ?? "" }}
          mobileDisclosure={{ activeCount: [outingId, filters.month, filters.assignment === "all" ? undefined : filters.assignment].filter(Boolean).length }}
          clearHref={filtered ? recordHref("/app/expenses", params, { q: undefined, outing: undefined, month: undefined, assignment: undefined, page: undefined }) : undefined}
          resultStatus={`${expensePage.totalItems} expense${expensePage.totalItems === 1 ? "" : "s"} found.`}
          preservedParams={params}
        />
        <div className="ledger-list" id="record-list">
          <div className="ledger-list__heading"><span className="technical-label">EXPENSE RECORDS</span><span className="technical-label">{expensePage.totalItems} entries</span></div>
          {expensePage.items.length > 0 ? groups.map((group) => <div className="record-month-group" key={group.month}>
            <div className="record-month-divider"><span className="technical-label">{monthDisplayLabel(group.month).toUpperCase()}</span></div>
            {group.items.map((expense) => <ExpenseRow key={expense.id} expense={expense} />)}
          </div>) : (
            <div className="ledger-empty"><h2>{filtered ? "No matching expenses." : "No expenses yet."}</h2><p>{filtered ? "Try a different search or clear the filters." : "Record the first amount when you are ready. Every expense belongs to an outing."}</p>{filtered ? null : <Link className="text-link" href={outings.length ? "/app/expenses?create=1" : "/app/outings?create=1"} data-task-trigger={outings.length ? "expense-create" : "outing-create"}>{outings.length ? "Add an expense" : "Create an outing"} <span aria-hidden="true">→</span></Link>}</div>
          )}
          <RecordPagination page={expensePage.page} pageSize={expensePage.pageSize} totalItems={expensePage.totalItems} totalPages={expensePage.totalPages} href={listHref} />
        </div>
      </div>
      {openCreate ? <TaskPanel open title="Add an expense" description="Choose the outing, record the whole-rupiah amount, and assign shares next." triggerId="expense-create">
        {outings.length > 0 ? <ExpenseForm action={createExpenseAction} outings={outings} initialValues={{ description: "", amountRupiah: "", outingId: outingId ?? "" }} /> : <div className="task-panel__empty"><p>Create an outing before recording an expense.</p><Link className="action-link action-link--primary" href={`/app/outings?create=1&returnTo=${encodeURIComponent(expenseReturnTarget)}`} data-task-trigger="outing-create">Create an outing and continue</Link></div>}
      </TaskPanel> : null}
    </section>
  );
}
