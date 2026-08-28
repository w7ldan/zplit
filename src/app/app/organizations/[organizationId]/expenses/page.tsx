import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedOrganizationLedger } from "@/server/authenticated-ledger";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { ExpenseRow } from "@/components/expenses/expense-row";
import { TaskPanel } from "@/components/app/task-panel";
import { LiveRecordFilters } from "@/components/records/live-record-filters";
import { RecordPagination } from "@/components/records/record-pagination";
import { groupRecordsByMonth, monthDisplayLabel, normalizeExpenseFilters, normalizeTimezoneOffset, recordHref } from "@/domain/record-retrieval";
import { createExpenseAction, searchOutingFilterOptions, searchOutingOptions } from "../ledger-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organization expenses" };
function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

type OrganizationExpensesAccess = Awaited<ReturnType<typeof getAuthenticatedOrganizationLedger>>;

async function loadOrganizationExpenses(query: Record<string, string | string[] | undefined>, access: OrganizationExpensesAccess) {
  const timezoneOffsetMinutes = normalizeTimezoneOffset(first(query.tz));
  const filters = normalizeExpenseFilters({ q: first(query.q), outingId: first(query.outing), month: first(query.month), assignment: first(query.assignment), page: first(query.page) });
  const outingRows = await access.ledger.searchOutings({ selectedId: filters.outingId });
  const outingId = outingRows.some((outing) => outing.id === filters.outingId) ? filters.outingId : undefined;
  const outingOptions = outingRows.map((outing) => ({ id: outing.id, label: outing.title, group: outing.recent ? "Recent" : undefined }));
  const page = await access.ledger.listExpenseRecords({ q: first(query.q), outingId, month: first(query.month), assignment: first(query.assignment), page: first(query.page), timezoneOffsetMinutes });
  return {
    filters,
    outingId,
    outingOptions,
    page,
    canCreate: access.can("expenses.create"),
    openCreate: first(query.create) === "1",
    groups: groupRecordsByMonth(page.items, (expense) => expense.outingOccurredAt, timezoneOffsetMinutes),
    filtered: Boolean(filters.q || filters.month || filters.outingId || filters.assignment !== "all"),
  };
}

type OrganizationExpensesData = Awaited<ReturnType<typeof loadOrganizationExpenses>>;

function OrganizationExpenseList({ data, base, path, query }: { data: OrganizationExpensesData; base: string; path: string; query: Record<string, string | string[] | undefined> }) {
  const { page, groups, filtered } = data;
  return <div className="ledger-list" id="record-list"><div className="ledger-list__heading"><span className="technical-label">EXPENSE RECORDS</span><span className="technical-label">{page.totalItems} entries</span></div>{page.items.length ? groups.map((group) => <div className="record-month-group" key={group.month}><div className="record-month-divider"><span className="technical-label">{monthDisplayLabel(group.month).toUpperCase()}</span></div>{group.items.map((expense) => <ExpenseRow key={expense.id} expense={expense} basePath={base + "/expenses"} />)}</div>) : <div className="ledger-empty"><h2>{filtered ? "No matching expenses." : "No expenses yet."}</h2><p>{filtered ? "Try a different search or clear the filters." : "Every expense belongs to an outing."}</p></div>}<RecordPagination page={page.page} pageSize={page.pageSize} totalItems={page.totalItems} totalPages={page.totalPages} href={recordHref(path, query)} /></div>;
}

function OrganizationExpenseCreatePanel({ data, organizationId, base }: { data: OrganizationExpensesData; organizationId: string; base: string }) {
  if (!data.canCreate || !data.openCreate) return null;
  const { outingOptions, outingId } = data;
  return <TaskPanel open title="Add an expense" description="Choose the outing, record the amount, and assign shares next." triggerId="expense-create">{outingOptions.length ? <ExpenseForm action={createExpenseAction.bind(null, organizationId)} outings={outingOptions} searchOutings={searchOutingOptions.bind(null, organizationId)} initialValues={{ description: "", amountRupiah: "", outingId: outingId ?? "" }} /> : <div className="task-panel__empty"><p>Create an outing before recording an expense.</p><Link className="action-link action-link--primary" href={base + "/outings?create=1"}>Create an outing and continue</Link></div>}</TaskPanel>;
}

function OrganizationExpensesContent({ data, organizationId, base, path, query }: { data: OrganizationExpensesData; organizationId: string; base: string; path: string; query: Record<string, string | string[] | undefined> }) {
  const { filters, outingId, outingOptions, page, canCreate, filtered } = data;
  return <section className="app-page expenses-page" id="top"><div className="editorial-shell app-page__layout"><div className="app-page__header"><div><p className="technical-label">Organization expenses · money paid</p><h1>Expenses</h1><p className="app-page__lede">Record shared spending and assign what each friend owes.</p></div>{canCreate ? <Link className="action-link action-link--primary" href={recordHref(path, query, { create: "1" })}>Add expense</Link> : null}</div><LiveRecordFilters action={path} search={{ label: "Search expenses", placeholder: "Description or outing", value: filters.q ?? "" }} selects={[{ name: "outing", label: "Outing", value: outingId ?? "", options: [{ value: "", label: "All outings" }, ...outingOptions.map((outing) => ({ value: outing.id, label: outing.label }))], search: searchOutingFilterOptions.bind(null, organizationId) }, { name: "assignment", label: "Assignment", value: filters.assignment === "all" ? "" : filters.assignment, options: [{ value: "", label: "All assignment states" }, { value: "assigned", label: "Assigned" }, { value: "unassigned", label: "Unassigned" }] }]} month={{ label: "Month", value: filters.month ?? "" }} clearHref={filtered ? recordHref(path, query, { q: undefined, outing: undefined, month: undefined, assignment: undefined, page: undefined }) : undefined} resultStatus={page.totalItems + " expense" + (page.totalItems === 1 ? "" : "s") + " found."} preservedParams={query} /><OrganizationExpenseList data={data} base={base} path={path} query={query} /></div><OrganizationExpenseCreatePanel data={data} organizationId={organizationId} base={base} /></section>;
}

export default async function OrganizationExpensesPage({ params, searchParams = Promise.resolve({}) }: { params: Promise<{ organizationId: string }>; searchParams?: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { organizationId } = await params;
  const query = await searchParams;
  const base = `/app/organizations/${organizationId}`;
  const path = `${base}/expenses`;
  const empty = ["q", "outing", "month", "assignment"].filter((name) => first(query[name]) === "");
  if (empty.length) redirect(recordHref(path, query, Object.fromEntries(empty.map((name) => [name, undefined]))));
  const access = await getAuthenticatedOrganizationLedger(organizationId, "ledger.view");
  const data = await loadOrganizationExpenses(query, access);
  return <OrganizationExpensesContent data={data} organizationId={organizationId} base={base} path={path} query={query} />;
}
