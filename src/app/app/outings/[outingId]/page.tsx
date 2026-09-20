import Link from "next/link";
import { notFound } from "next/navigation";
import { zplitVNextFont } from "@/app/fonts";
import { requireSession } from "@/auth/require-session";
import { deletionImpactRevision, LedgerNotFoundError } from "@/domain/ledger-repository";
import { getAuthenticatedLedger } from "@/server/authenticated-ledger";
import { OutingForm } from "@/components/outings/outing-form";
import { LocalDateTime, SourceCalendarDate } from "@/components/editorial/local-date-time";
import { searchTripOptions, updateOutingAction } from "../actions";
import { RecordConfirmation } from "@/components/app/record-confirmation";
import { DeleteRecordForm } from "@/components/app/delete-record-form";
import { deleteOutingAction } from "../actions";
import { formatRupiah } from "@/domain/rupiah";
import { recordHref } from "@/domain/record-retrieval";
import { RecordPagination } from "@/components/records/record-pagination";
import { OpenTile } from "@/components/vnext/open-tile";

export const dynamic = "force-dynamic";
export const metadata = { title: "Outing details" };

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
    const { ledger: repository } = await getAuthenticatedLedger(session);
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
    <section className={["app-page", "page-content", "zplit-vnext", "personal-vnext", "outing-record", zplitVNextFont.variable].filter(Boolean).join(" ")} id="top">
      <div className="editorial-grid editorial-shell outing-record__layout personal-vnext__detail-layout">
        <header className="outing-record__intro personal-vnext__detail-intro personal-vnext__motion-reveal" data-motion="enter">
          <p className="technical-label">Outing · editable record</p>
          <h1>{outing.title}</h1>
          <div className="outing-record__actions">
            <Link className="action-link action-link--quiet vnext-button vnext-button--secondary personal-vnext__secondary-action" href={`/app/expenses?create=1&outing=${outing.id}`}>Add expense</Link>
            <Link className="outing-record__back vnext-link personal-vnext__secondary-action" href="/app/outings">← Outings</Link>
          </div>
        </header>
        {query?.saved === "1" ? <RecordConfirmation queryKey="saved" message="Outing changes saved." /> : null}
        <section className="outing-record__summary personal-vnext__summary vnext-surface vnext-surface--strong personal-vnext__motion-reveal" aria-label="Outing summary" data-motion="enter">
          <div className="outing-record__meta personal-vnext__metadata" aria-label="Outing metadata">
            <div><span className="technical-label">Financial date</span><SourceCalendarDate canonicalDate={outing.occurredOn} timestamp={outing.occurredAt.toISOString()} /></div>
            <div><span className="technical-label">Exact time</span><LocalDateTime iso={outing.occurredAt.toISOString()} /></div>
            <div><span className="technical-label">Trip</span>{trip ? <Link className="vnext-link" href={`/app/trips/${trip.id}`}>{trip.name} →</Link> : <span>No trip</span>}</div>
            <div><span className="technical-label">Created</span><LocalDateTime iso={outing.createdAt.toISOString()} mode="date" /></div>
          </div>
          {outing.notes ? <p className="outing-record__notes">{outing.notes}</p> : null}
        </section>
        <div className="outing-record__workspace personal-vnext__responsive-detail personal-vnext__motion-stagger" data-motion="enter">
          <div className="outing-record__form personal-vnext__edit-surface vnext-surface">
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
          <div className="personal-vnext__delete-section personal-vnext__motion-item">
            <DeleteRecordForm action={deleteOutingAction.bind(null, outing.id)} recordType="outing" impact={deletionImpact} impactRevision={currentImpactRevision} />
          </div>
        </div>
        <section className="record-history ledger-section personal-vnext__history vnext-surface personal-vnext__motion-reveal" id="outing-expenses" aria-labelledby="outing-expenses-heading" data-motion="enter">
          <div className="ledger-section__heading personal-vnext__section-heading"><div><p className="technical-label">EXPENSE HISTORY</p><h2 id="outing-expenses-heading">Expenses</h2></div><span className="technical-label">{expensePage.totalItems} entries</span></div>
          {expensePage.items.length > 0 ? (
            <div className="record-history__rows" data-motion="list">
              {expensePage.items.map((expense) => (
                <article className="personal-vnext__history-item personal-vnext__motion-item" key={expense.id}>
                  <Link className="record-history__row vnext-row personal-vnext__single-destination-row" href={`/app/expenses/${expense.id}`} aria-label={`Open expense: ${expense.description}`}>
                    <div className="record-history__primary">
                      <span className="technical-label">EXPENSE</span>
                      <h3>{expense.description}</h3>
                    </div>
                    <div className="record-history__value">
                      <span className="technical-label">Amount</span>
                      <strong className="vnext-money">{formatRupiah(expense.amount)}</strong>
                    </div>
                    <span className="record-history__link">
                      Open expense <OpenTile />
                    </span>
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <div className="ledger-empty personal-vnext__empty personal-vnext__motion-reveal">
              <h3>No expenses recorded for this outing yet.</h3>
              <p>Add the first expense for this outing.</p>
              <Link
                className="text-link"
                href={`/app/expenses?create=1&outing=${encodeURIComponent(outing.id)}`}
                data-task-trigger="expense-create"
              >
                Add expense <span aria-hidden="true">→</span>
              </Link>
            </div>
          )}
          <div className="personal-vnext__pagination personal-vnext__motion-reveal">
            <RecordPagination page={expensePage.page} pageSize={expensePage.pageSize} totalItems={expensePage.totalItems} totalPages={expensePage.totalPages} href={expenseHref} anchor="outing-expenses" pageParam="expensePage" />
          </div>
        </section>
      </div>
    </section>
  );
}
