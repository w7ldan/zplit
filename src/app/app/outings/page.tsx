import Link from "next/link";
import { redirect } from "next/navigation";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { createLedgerRepository } from "@/domain/ledger-repository";
import { OutingForm } from "@/components/outings/outing-form";
import { OutingRow } from "@/components/outings/outing-row";
import { createOutingAction } from "./actions";
import { TaskPanel } from "@/components/app/task-panel";
import { RecordConfirmation } from "@/components/app/record-confirmation";
import { LiveRecordFilters } from "@/components/records/live-record-filters";
import { RecordPagination } from "@/components/records/record-pagination";
import { groupRecordsByMonth, monthDisplayLabel, normalizeOutingFilters, normalizeTimezoneOffset, recordHref } from "@/domain/record-retrieval";
import { validateExpenseReturnTarget } from "@/domain/expense-return";

export const dynamic = "force-dynamic";

type OutingsPageProps = { searchParams?: Promise<{ [key: string]: string | string[] | undefined; create?: string | string[]; created?: string | string[]; q?: string | string[]; month?: string | string[]; page?: string | string[] }> };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OutingsPage({ searchParams = Promise.resolve({}) }: OutingsPageProps = {}) {
  const params = await searchParams;
  const returnToInput = first(params?.returnTo);
  const returnTo = validateExpenseReturnTarget(returnToInput);
  if (returnToInput !== undefined && !returnTo) redirect(recordHref("/app/outings", params, { returnTo: undefined }));
  const emptyParams = ["q", "month"].filter((name) => first(params?.[name]) === "");
  if (emptyParams.length) redirect(recordHref("/app/outings", params, Object.fromEntries(emptyParams.map((name) => [name, undefined]))));
  const session = await requireSession();
  const created = first(params?.created);
  const openCreate = first(params?.create) === "1";
  const timezoneOffsetMinutes = normalizeTimezoneOffset(first(params?.tz));
  const filters = normalizeOutingFilters({ q: first(params?.q), month: first(params?.month), page: first(params?.page) });
  const repository = createLedgerRepository(getDatabase(), session.user.id);
  const outingPage = await repository.listOutingRecords({ q: first(params?.q), month: first(params?.month), page: first(params?.page), timezoneOffsetMinutes });
  const groups = groupRecordsByMonth(outingPage.items, (outing) => outing.occurredAt, timezoneOffsetMinutes);
  const filtered = Boolean(filters.q || filters.month);
  const listHref = recordHref("/app/outings", params);

  return (
    <section className="app-page outings-page" id="top">
      <div className="editorial-shell app-page__layout">
        <div className="app-page__header">
          <div>
            <p className="technical-label">Outings · shared events</p>
            <h1>Outings</h1>
            <p className="app-page__lede">Keep related expenses together under the event where they happened.</p>
          </div>
          <Link className="action-link action-link--primary" href={recordHref("/app/outings", params, { create: "1" })} data-task-trigger="outing-create">Add outing</Link>
        </div>
        {created ? <RecordConfirmation queryKey="created" message="Outing added." /> : null}
        <LiveRecordFilters action="/app/outings" search={{ label: "Search outings", placeholder: "Outing title", value: filters.q ?? "" }} month={{ label: "Month", value: filters.month ?? "" }} clearHref={filtered ? recordHref("/app/outings", params, { q: undefined, month: undefined, page: undefined }) : undefined} resultStatus={`${outingPage.totalItems} outing${outingPage.totalItems === 1 ? "" : "s"} found.`} preservedParams={params} />
        <div className="ledger-list" id="record-list">
          <div className="ledger-list__heading"><span className="technical-label">LATEST FIRST</span><span className="technical-label">{outingPage.totalItems} entries</span></div>
          {outingPage.items.length > 0 ? groups.map((group) => <div className="record-month-group" key={group.month}>
            <div className="record-month-divider"><span className="technical-label">{monthDisplayLabel(group.month).toUpperCase()}</span></div>
            {group.items.map((outing) => <OutingRow key={outing.id} outing={outing} expenseCount={outing.expenseCount} expenseTotal={outing.expenseTotal} emphasized={created === outing.id} />)}
          </div>) : (
            <div className="ledger-empty"><h2>{filtered ? "No matching outings." : "No outings yet."}</h2><p>{filtered ? "Try a different title or month." : "Record the first shared moment before adding an expense."}</p>{filtered ? null : <Link className="text-link" href={recordHref("/app/outings", params, { create: "1" })} data-task-trigger="outing-create">Add an outing <span aria-hidden="true">→</span></Link>}</div>
          )}
          <RecordPagination page={outingPage.page} pageSize={outingPage.pageSize} totalItems={outingPage.totalItems} totalPages={outingPage.totalPages} href={listHref} />
        </div>
      </div>
      {openCreate ? <TaskPanel open title="Add an outing" description="Give the shared moment a name and a local date before adding expenses." triggerId="outing-create"><OutingForm action={createOutingAction.bind(null, returnTo)} /></TaskPanel> : null}
    </section>
  );
}
