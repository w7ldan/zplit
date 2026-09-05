import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthenticatedOrganizationLedger } from "@/server/authenticated-ledger";
import { LedgerNotFoundError } from "@/domain/ledger-repository";
import { TripForm } from "@/components/trips/trip-form";
import { TripDeleteForm } from "@/components/trips/trip-delete-form";
import { OutingRow } from "@/components/outings/outing-row";
import { CalendarDateRange } from "@/components/editorial/local-date-time";
import { RecordPagination } from "@/components/records/record-pagination";
import { formatRupiah } from "@/domain/rupiah";
import { TripSummaryCopy } from "@/components/trips/trip-summary-copy";
import { updateTripAction, deleteTripAction } from "../../ledger-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organization trip details" };
function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OrganizationTripPage({
  params,
  searchParams = Promise.resolve({}),
}: {
  params: Promise<{ organizationId: string; tripId: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { organizationId, tripId } = await params;
  const query = await searchParams;
  const base = `/app/organizations/${organizationId}`;
  const access = await getAuthenticatedOrganizationLedger(
    organizationId,
    "ledger.view",
  );
  let trip;
  try {
    trip = await access.ledger.getTrip(tripId);
  } catch (error) {
    if (error instanceof LedgerNotFoundError) notFound();
    throw error;
  }
  const [summary, outings] = await Promise.all([
    access.ledger.getTripSummary(trip.id),
    access.ledger.listOutingRecords({ trip: trip.id, page: first(query.page) }),
  ]);
  const canEdit = access.can("trips.manage") && !access.archivedAt;
  const copy = [
    `${trip.name}`,
    "",
    ...(summary.friendSettlements ?? []).map(
      (friend) =>
        `${friend.friendName}: ${formatRupiah(friend.outstandingAmount)} outstanding`,
    ),
  ].join("\n");
  return (
    <section className="app-page trip-record" id="top">
      <div className="editorial-grid editorial-shell trip-record__layout">
        <div className="trip-record__intro">
          <div>
            <p className="technical-label">
              Organization Trip · editable grouping
            </p>
            <h1>{trip.name}</h1>
          </div>
          <div className="trip-record__actions">
            <TripSummaryCopy text={copy} />
            {access.can("outings.manage") && !access.archivedAt ? (
              <Link
                className="action-link action-link--quiet"
                href={`${base}/outings?create=1&trip=${trip.id}`}
              >
                Add outing
              </Link>
            ) : null}
            <Link className="trip-record__back" href={`${base}/trips`}>
              ← Back to Trips
            </Link>
          </div>
        </div>
        <section className="trip-record__summary" aria-label="Trip summary">
          <div className="trip-record__meta">
            <div>
              <span className="technical-label">Dates</span>
              <CalendarDateRange
                startsOn={trip.startsOn}
                endsOn={trip.endsOn}
              />
            </div>
            <div>
              <span className="technical-label">Outings</span>
              <strong>{summary.outingCount}</strong>
            </div>
            <div>
              <span className="technical-label">Expenses</span>
              <strong>{summary.expenseCount}</strong>
            </div>
          </div>
          <section className="trip-record__financials">
            <div>
              <span className="technical-label">Total spending</span>
              <strong>{formatRupiah(summary.expenseTotal)}</strong>
            </div>
            <div>
              <span className="technical-label">Assigned</span>
              <strong>{formatRupiah(summary.totalAssignedAmount)}</strong>
            </div>
            <div>
              <span className="technical-label">Outstanding</span>
              <strong>{formatRupiah(summary.totalOutstandingAmount)}</strong>
            </div>
          </section>
        </section>
        <section className="trip-record__outings">
          <div className="trip-record__section-heading">
            <div>
              <p className="technical-label">GROUPED OUTINGS</p>
              <h2>Outings</h2>
            </div>
            <span className="technical-label">
              {outings.totalItems} entries
            </span>
          </div>
          {outings.items.map((outing) => (
            <OutingRow
              key={outing.id}
              outing={outing}
              expenseCount={outing.expenseCount}
              expenseTotal={outing.expenseTotal}
              showTripContext={false}
              basePath={base}
            />
          ))}
          <RecordPagination
            page={outings.page}
            pageSize={outings.pageSize}
            totalItems={outings.totalItems}
            totalPages={outings.totalPages}
            href={`${base}/trips/${trip.id}`}
          />
        </section>
        {canEdit ? (
          <>
            <div className="trip-record__form">
              <p className="technical-label">EDIT GROUPING</p>
              <TripForm
                action={updateTripAction.bind(null, organizationId, trip.id)}
                mode="edit"
                initialValues={{
                  name: trip.name,
                  startsOn: trip.startsOn ?? "",
                  endsOn: trip.endsOn ?? "",
                  notes: trip.notes ?? "",
                }}
              />
            </div>
            <TripDeleteForm
              action={deleteTripAction.bind(null, organizationId, trip.id)}
            />
          </>
        ) : null}
      </div>
    </section>
  );
}
