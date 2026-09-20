import Link from "next/link";
import { redirect } from "next/navigation";
import { zplitVNextFont } from "@/app/fonts";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { getAuthenticatedLedger } from "@/server/authenticated-ledger";
import { getExpenseBudgetControl, type ExpenseBudgetControlOptions } from "@/server/budgeting/profiles";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { ExpenseRow } from "@/components/expenses/expense-row";
import { createExpenseAction, searchOutingFilterOptions, searchOutingOptions } from "./actions";
import { TaskPanel } from "@/components/app/task-panel";
import { LiveRecordFilters } from "@/components/records/live-record-filters";
import { RecordPagination } from "@/components/records/record-pagination";
import { financialMonthKey, groupRecordsByMonth, monthDisplayLabel, normalizeExpenseFilters, normalizeTimezoneOffset, recordHref } from "@/domain/record-retrieval";
import { validateExpenseReturnTarget } from "@/domain/expense-return";

export const dynamic = "force-dynamic";
export const metadata = { title: "Expenses" };

type ExpensesPageProps = {
  searchParams?: Promise<{
    [key: string]: string | string[] | undefined;
    create?: string | string[];
    outing?: string | string[];
    q?: string | string[];
    month?: string | string[];
    assignment?: string | string[];
    page?: string | string[];
  }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

type ExpensesLedger = Awaited<ReturnType<typeof getAuthenticatedLedger>>["ledger"];

async function loadExpensesPageData(params: Awaited<NonNullable<ExpensesPageProps["searchParams"]>>, repository: ExpensesLedger) {
  const openCreate = first(params.create) === "1";
  const timezoneOffsetMinutes = normalizeTimezoneOffset(first(params.tz));
  const filters = normalizeExpenseFilters({ q: first(params.q), outingId: first(params.outing), month: first(params.month), assignment: first(params.assignment), page: first(params.page) });
  const outingRows = await repository.searchOutings({ selectedId: filters.outingId });
  const outingId = outingRows.some((outing) => outing.id === filters.outingId) ? filters.outingId : undefined;
  const outingOptions = outingRows.map((outing) => ({ id: outing.id, label: outing.title, group: outing.recent ? "Recent" : undefined }));
  const expensePage = await repository.listExpenseRecords({ q: first(params.q), outingId, month: first(params.month), assignment: first(params.assignment), page: first(params.page), timezoneOffsetMinutes });
  return {
    openCreate,
    filters,
    outingId,
    outingOptions,
    expensePage,
    groups: groupRecordsByMonth(expensePage.items, (expense) => financialMonthKey({ canonicalDate: expense.outingOccurredOn, timestamp: expense.outingOccurredAt, timezoneOffsetMinutes })),
    filtered: Boolean(filters.q || filters.month || outingId || filters.assignment !== "all"),
    listHref: recordHref("/app/expenses", params),
    expenseReturnTarget: validateExpenseReturnTarget(recordHref("/app/expenses", params, { create: "1" })) ?? "/app/expenses?create=1",
  };
}

type ExpensesPageData = Awaited<ReturnType<typeof loadExpensesPageData>>;

function ExpenseRecordList({ data, params }: { data: ExpensesPageData; params: Awaited<NonNullable<ExpensesPageProps["searchParams"]>> }) {
  const { expensePage, groups, filtered, outingOptions, listHref } = data;
  return (
    <div className="ledger-list expense-list personal-vnext__list personal-vnext__responsive-list" id="record-list" data-motion="list">
      <div className="ledger-list__heading expense-list__heading personal-vnext__list-heading personal-vnext__motion-reveal"><span className="technical-label" id="expense-records-heading">EXPENSE RECORDS</span><span className="technical-label">{expensePage.totalItems} entries</span></div>
      {expensePage.items.length > 0 ? (
        groups.map((group) => (
          <section className="record-month-group expense-list__month personal-vnext__month-group personal-vnext__motion-stagger" aria-labelledby={`expense-month-${group.month}`} data-motion="list" key={group.month}>
            <div className="record-month-divider personal-vnext__month-divider">
              <span className="technical-label" id={`expense-month-${group.month}`}>
                {monthDisplayLabel(group.month).toUpperCase()}
              </span>
            </div>
            {group.items.map((expense) => (
              <ExpenseRow key={expense.id} expense={expense} vnext />
            ))}
          </section>
        ))
      ) : (
        <div className="ledger-empty vnext-surface--warm personal-vnext__empty personal-vnext__motion-reveal">
          <h2>{filtered ? "No matching expenses." : "No expenses yet."}</h2>
          <p>
            {filtered
              ? "Try a different search or clear the filters."
              : "Record the first amount when you are ready. Every expense belongs to an outing."}
          </p>
          {filtered ? null : (
            <Link
              className="text-link vnext-link"
              href={recordHref(
                outingOptions.length ? "/app/expenses" : "/app/outings",
                params,
                { create: "1" },
              )}
              data-task-trigger={
                outingOptions.length ? "expense-create" : "outing-create"
              }
            >
              {outingOptions.length ? "Add expense" : "Create an outing"} <span aria-hidden="true">→</span>
            </Link>
          )}
        </div>
      )}
      <div className="personal-vnext__pagination personal-vnext__motion-reveal">
        <RecordPagination page={expensePage.page} pageSize={expensePage.pageSize} totalItems={expensePage.totalItems} totalPages={expensePage.totalPages} href={listHref} />
      </div>
    </div>
  );
}

function ExpenseCreatePanel({ data, outingId, budget }: { data: ExpensesPageData; outingId: string | undefined; budget: ExpenseBudgetControlOptions | undefined }) {
  if (!data.openCreate) return null;
  const { outingOptions, expenseReturnTarget } = data;
  return (
    <TaskPanel className="personal-task-panel" open eyebrow="NEW EXPENSE" title="Add an expense" description="Choose the outing, record the whole-rupiah amount, and assign shares next." triggerId="expense-create">
      {outingOptions.length > 0 ? (
        <ExpenseForm
          action={createExpenseAction}
          outings={outingOptions}
          searchOutings={searchOutingOptions}
          initialValues={{
            description: "",
            amountRupiah: "",
            outingId: outingId ?? "",
          }}
          budget={budget}
        />
      ) : (
        <div className="task-panel__empty">
          <p>Create an outing before recording an expense.</p>
          <Link
            className="action-link action-link--primary vnext-button vnext-button--primary personal-vnext__primary-action"
            href={
              "/app/outings?create=1&returnTo=" +
              encodeURIComponent(expenseReturnTarget)
            }
            data-task-trigger="outing-create"
          >
            Create an outing and continue
          </Link>
        </div>
      )}
    </TaskPanel>
  );
}

function ExpensesPageContent({ data, params, budget }: { data: ExpensesPageData; params: Awaited<NonNullable<ExpensesPageProps["searchParams"]>>; budget: ExpenseBudgetControlOptions | undefined }) {
  const { filters, outingId, outingOptions, expensePage, filtered } = data;
  return (
    <section className={`app-page page-content zplit-vnext personal-vnext expenses-page ${zplitVNextFont.variable}`} id="top">
      <div className="editorial-shell app-page__layout personal-vnext__layout">
        <header className="app-page__header personal-vnext__hero personal-vnext__motion-reveal" data-motion="enter">
          <div>
            <Link className="personal-parent-link vnext-link personal-vnext__parent-link" href="/app/personal">← Personal</Link>
            <p className="technical-label">Expenses · money you paid</p>
            <h1>Expenses</h1>
            <p className="app-page__lede">Record shared spending and assign the amounts each friend owes.</p>
          </div>
          <Link className="action-link action-link--primary vnext-button vnext-button--primary personal-vnext__primary-action" href={recordHref("/app/expenses", params, { create: "1" })} data-task-trigger="expense-create">Add expense</Link>
        </header>
        <div className="records-workspace personal-vnext__workspace vnext-surface personal-vnext__responsive-workspace" data-motion="enter">
          <div className="records-workspace__toolbar personal-vnext__toolbar personal-vnext__motion-stagger">
            <div className="personal-vnext__filters personal-vnext__responsive-filters">
              <LiveRecordFilters
                action="/app/expenses"
                search={{ label: "Search expenses", placeholder: "Description or outing", value: filters.q ?? "" }}
                selects={[
                  {
                    name: "outing",
                    label: "Outing",
                    value: outingId ?? "",
                    options: [
                      { value: "", label: "All outings" },
                      ...outingOptions.map((outing) => ({
                        value: outing.id,
                        label: outing.label,
                      })),
                    ],
                    search: searchOutingFilterOptions,
                  },
                  {
                    name: "assignment",
                    label: "Assignment",
                    value: filters.assignment === "all" ? "" : filters.assignment,
                    options: [
                      { value: "", label: "All assignment states" },
                      { value: "assigned", label: "Assigned" },
                      { value: "unassigned", label: "Unassigned" },
                    ],
                  },
                ]}
                month={{ label: "Month", value: filters.month ?? "" }}
                mobileDisclosure={{ activeCount: [outingId, filters.month, filters.assignment === "all" ? undefined : filters.assignment].filter(Boolean).length }}
                clearHref={filtered ? recordHref("/app/expenses", params, { q: undefined, outing: undefined, month: undefined, assignment: undefined, page: undefined }) : undefined}
                resultStatus={expensePage.totalItems + " expense" + (expensePage.totalItems === 1 ? "" : "s") + " found."}
                preservedParams={params}
              />
            </div>
          </div>
          <ExpenseRecordList data={data} params={params} />
        </div>
      </div>
      <ExpenseCreatePanel data={data} outingId={outingId} budget={budget} />
    </section>
  );
}

export default async function ExpensesPage({ searchParams = Promise.resolve({}) }: ExpensesPageProps = {}) {
  const params = await searchParams;
  const emptyParams = ["q", "outing", "month", "assignment"].filter((name) => first(params?.[name]) === "");
  if (emptyParams.length) redirect(recordHref("/app/expenses", params, Object.fromEntries(emptyParams.map((name) => [name, undefined]))));
  const session = await requireSession();
  const { ledger: repository } = await getAuthenticatedLedger(session);
  const data = await loadExpensesPageData(params ?? {}, repository);
  const budget = data.openCreate ? await getExpenseBudgetControl(getDatabase(), session.user.id) : undefined;

  return <ExpensesPageContent data={data} params={params ?? {}} budget={budget} />;
}
