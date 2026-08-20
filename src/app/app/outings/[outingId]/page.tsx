import Link from "next/link";
import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { createLedgerRepository, deletionImpactRevision, LedgerNotFoundError } from "@/domain/ledger-repository";
import { OutingForm } from "@/components/outings/outing-form";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { searchTripOptions, updateOutingAction } from "../actions";
import { RecordConfirmation } from "@/components/app/record-confirmation";
import { DeleteRecordForm } from "@/components/app/delete-record-form";
import { deleteOutingAction } from "../actions";
import { formatRupiah } from "@/domain/rupiah";
import { recordHref } from "@/domain/record-retrieval";
import { RecordPagination } from "@/components/records/record-pagination";

export const dynamic = "force-dynamic";

type OutingSearchParams = { [key: string]: string | string[] | undefined };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function utcDateTimeLocal(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

export default async function OutingRecordPage({ params, searchParams }: { params: Promise<{ outingId: string }>; searchParams?: Promise<OutingSearchParams> }) {
  const session = await requireSession();
  const { outingId } = await params;
  const query = await searchParams;
  let outing;
  let deletionImpact;
  let trip: { id: string; name: string } | null = null;
  let expensePage;
  try {
    const repository = createLedgerRepository(getDatabase(), session.user.id);
    outing = await repository.getOuting(outingId);
    [deletionImpact, trip, expensePage] = await Promise.all([
      repository.getOutingDeletionImpact(outingId),
      outing.tripId ? repository.getTrip(outing.tripId) : Promise.resolve(null),
      repository.listExpenseRecords({ outingId: outing.id, page: first(query?.expensePage) }),
    ]);
  } catch (error) {
    if (error instanceof LedgerNotFoundError) notFound();
    throw error;
  }
  const currentImpactRevision = deletionImpactRevision(deletionImpact);
  const expenseHref = recordHref(`/app/outings/${outing.id}`, query ?? {}, { saved: undefined });

  return (
    <section className="app-page outing-record" id="top">
      <div className="editorial-grid editorial-shell outing-record__layout">
        <div className="outing-record__intro">
          <p className="technical-label">Outing · editable record</p>
          <h1>{outing.title}</h1>
          <div className="outing-record__actions">
            <Link className="action-link action-link--quiet" href={`/app/expenses?create=1&outing=${outing.id}`}>Add expense</Link>
            <Link className="outing-record__back" href="/app/outings">← Back to outings</Link>
          </div>
        </div>
        {query?.saved === "1" ? <RecordConfirmation queryKey="saved" message="Outing changes saved." /> : null}
        <div className="outing-record__meta" aria-label="Outing metadata">
          <div><span className="technical-label">Occurred</span><LocalDateTime iso={outing.occurredAt.toISOString()} /></div>
          <div><span className="technical-label">Trip</span>{trip ? <Link href={`/app/trips/${trip.id}`}>{trip.name} →</Link> : <span>No trip</span>}</div>
          <div><span className="technical-label">Created</span><LocalDateTime iso={outing.createdAt.toISOString()} mode="date" /></div>
        </div>
        {outing.notes ? <p className="outing-record__notes">{outing.notes}</p> : null}
        <div className="outing-record__form">
          <p className="technical-label">EDIT RECORD</p>
          <OutingForm
            action={updateOutingAction.bind(null, outing.id)}
            mode="edit"
            trips={[{ id: "", label: "No trip" }, ...(trip ? [{ id: trip.id, label: trip.name }] : [])]}
            searchTrips={searchTripOptions}
            initialOccurredAtUtc={outing.occurredAt.toISOString()}
            initialValues={{ title: outing.title, occurredAtLocal: utcDateTimeLocal(outing.occurredAt), timezoneOffsetMinutes: "0", notes: outing.notes ?? "", tripId: trip?.id ?? "" }}
          />
          <p className="outing-record__next">Expenses recorded under this outing keep its occurrence timestamp. Trip grouping does not change ledger calculations.</p>
        </div>
        <DeleteRecordForm action={deleteOutingAction.bind(null, outing.id)} recordType="outing" impact={deletionImpact} impactRevision={currentImpactRevision} />
        <section className="record-history ledger-section" id="outing-expenses" aria-labelledby="outing-expenses-heading">
          <div className="ledger-section__heading"><div><p className="technical-label">EXPENSE HISTORY</p><h2 id="outing-expenses-heading">Expenses</h2></div><span className="technical-label">{expensePage.totalItems} entries</span></div>
          {expensePage.items.length > 0 ? <div className="record-history__rows">{expensePage.items.map((expense) => <article className="record-history__row" key={expense.id}>
            <div className="record-history__primary"><span className="technical-label">EXPENSE</span><h3><Link href={`/app/expenses/${expense.id}`}>{expense.description}</Link></h3></div>
            <div className="record-history__value"><span className="technical-label">Amount</span><strong>{formatRupiah(expense.amount)}</strong></div>
            <Link className="record-history__link" href={`/app/expenses/${expense.id}`}>Open expense <span aria-hidden="true">→</span></Link>
          </article>)}</div> : <div className="ledger-empty"><h3>No expenses recorded for this outing yet.</h3><p>Add the first expense for this outing.</p><Link className="text-link" href={`/app/expenses?create=1&outing=${encodeURIComponent(outing.id)}`} data-task-trigger="expense-create">Add expense <span aria-hidden="true">→</span></Link></div>}
          <RecordPagination page={expensePage.page} pageSize={expensePage.pageSize} totalItems={expensePage.totalItems} totalPages={expensePage.totalPages} href={expenseHref} anchor="outing-expenses" pageParam="expensePage" />
        </section>
      </div>
    </section>
  );
}
