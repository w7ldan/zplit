import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthenticatedOrganizationLedger } from "@/server/authenticated-ledger";
import {
  LedgerNotFoundError,
  deletionImpactRevision,
} from "@/domain/ledger-repository";
import { OutingForm } from "@/components/outings/outing-form";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { RecordPagination } from "@/components/records/record-pagination";
import { DeleteRecordForm } from "@/components/app/delete-record-form";
import { formatRupiah } from "@/domain/rupiah";
import {
  updateOutingAction,
  deleteOutingAction,
  searchTripOptions,
} from "../../ledger-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organization outing details" };
function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
function utcDateTimeLocal(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

export default async function OrganizationOutingPage({
  params,
  searchParams = Promise.resolve({}),
}: {
  params: Promise<{ organizationId: string; outingId: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { organizationId, outingId } = await params;
  const query = await searchParams;
  const base = `/app/organizations/${organizationId}`;
  const access = await getAuthenticatedOrganizationLedger(
    organizationId,
    "ledger.view",
  );
  let outing;
  try {
    outing = await access.ledger.getOuting(outingId);
  } catch (error) {
    if (error instanceof LedgerNotFoundError) notFound();
    throw error;
  }
  const [impact, trip, expenses] = await Promise.all([
    access.ledger.getOutingDeletionImpact(outing.id),
    outing.tripId
      ? access.ledger.getTrip(outing.tripId).catch(() => null)
      : Promise.resolve(null),
    access.ledger.listExpenseRecords({
      outingId: outing.id,
      page: first(query.expensePage),
    }),
  ]);
  const canEdit = access.can("outings.manage");
  return (
    <section className="app-page outing-record" id="top">
      <div className="editorial-grid editorial-shell outing-record__layout">
        <div className="outing-record__intro">
          <p className="technical-label">
            Organization Outing · editable record
          </p>
          <h1>{outing.title}</h1>
          <div className="outing-record__actions">
            {access.can("expenses.create") ? (
              <Link
                className="action-link action-link--quiet"
                href={`${base}/expenses?create=1&outing=${outing.id}`}
              >
                Add expense
              </Link>
            ) : null}
            <Link className="outing-record__back" href={`${base}/outings`}>
              ← Back to outings
            </Link>
          </div>
        </div>
        <section className="outing-record__summary">
          <div className="outing-record__meta">
            <div>
              <span className="technical-label">Occurred</span>
              <LocalDateTime iso={outing.occurredAt.toISOString()} />
            </div>
            <div>
              <span className="technical-label">Trip</span>
              {trip ? (
                <Link href={`${base}/trips/${trip.id}`}>{trip.name} →</Link>
              ) : (
                <span>No trip</span>
              )}
            </div>
          </div>
          {outing.notes ? (
            <p className="outing-record__notes">{outing.notes}</p>
          ) : null}
        </section>
        {canEdit ? (
          <div className="outing-record__workspace">
            <div className="outing-record__form">
              <p className="technical-label">EDIT RECORD</p>
              <OutingForm
                action={updateOutingAction.bind(
                  null,
                  organizationId,
                  outing.id,
                )}
                mode="edit"
                trips={[
                  { id: "", label: "No trip" },
                  ...(trip ? [{ id: trip.id, label: trip.name }] : []),
                ]}
                searchTrips={searchTripOptions.bind(null, organizationId)}
                initialOccurredAtUtc={outing.occurredAt.toISOString()}
                initialValues={{
                  title: outing.title,
                  occurredAtLocal: utcDateTimeLocal(outing.occurredAt),
                  timezoneOffsetMinutes: "0",
                  notes: outing.notes ?? "",
                  tripId: trip?.id ?? "",
                }}
              />
            </div>
            <DeleteRecordForm
              action={deleteOutingAction.bind(null, organizationId, outing.id)}
              recordType="outing"
              impact={impact}
              impactRevision={deletionImpactRevision(impact)}
            />
          </div>
        ) : null}
        <section className="record-history ledger-section" id="outing-expenses">
          <div className="ledger-section__heading">
            <div>
              <p className="technical-label">EXPENSE HISTORY</p>
              <h2>Expenses</h2>
            </div>
            <span className="technical-label">
              {expenses.totalItems} entries
            </span>
          </div>
          {expenses.items.map((expense) => (
            <article className="record-history__row" key={expense.id}>
              <div className="record-history__primary">
                <span className="technical-label">EXPENSE</span>
                <h3>
                  <Link href={`${base}/expenses/${expense.id}`}>
                    {expense.description}
                  </Link>
                </h3>
              </div>
              <div className="record-history__value">
                <span className="technical-label">Amount</span>
                <strong>{formatRupiah(expense.amount)}</strong>
              </div>
            </article>
          ))}
          <RecordPagination
            page={expenses.page}
            pageSize={expenses.pageSize}
            totalItems={expenses.totalItems}
            totalPages={expenses.totalPages}
            href={`${base}/outings/${outing.id}`}
            anchor="outing-expenses"
            pageParam="expensePage"
          />
        </section>
      </div>
    </section>
  );
}
