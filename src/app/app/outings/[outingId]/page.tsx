import Link from "next/link";
import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { createLedgerRepository, deletionImpactRevision, LedgerNotFoundError } from "@/domain/ledger-repository";
import { OutingForm } from "@/components/outings/outing-form";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { updateOutingAction } from "../actions";
import { RecordConfirmation } from "@/components/app/record-confirmation";
import { DeleteRecordForm } from "@/components/app/delete-record-form";
import { deleteOutingAction } from "../actions";

export const dynamic = "force-dynamic";

function utcDateTimeLocal(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

export default async function OutingRecordPage({ params, searchParams }: { params: Promise<{ outingId: string }>; searchParams?: Promise<{ saved?: string | string[] }> }) {
  const session = await requireSession();
  const { outingId } = await params;
  const query = await searchParams;
  let outing;
  let deletionImpact;
  try {
    const repository = createLedgerRepository(getDatabase(), session.user.id);
    outing = await repository.getOuting(outingId);
    deletionImpact = await repository.getOutingDeletionImpact(outingId);
  } catch (error) {
    if (error instanceof LedgerNotFoundError) notFound();
    throw error;
  }
  const currentImpactRevision = deletionImpactRevision(deletionImpact);

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
          <div><span className="technical-label">Created</span><LocalDateTime iso={outing.createdAt.toISOString()} mode="date" /></div>
        </div>
        {outing.notes ? <p className="outing-record__notes">{outing.notes}</p> : null}
        <div className="outing-record__form">
          <p className="technical-label">EDIT RECORD</p>
          <OutingForm
            action={updateOutingAction.bind(null, outing.id)}
            mode="edit"
            initialOccurredAtUtc={outing.occurredAt.toISOString()}
            initialValues={{ title: outing.title, occurredAtLocal: utcDateTimeLocal(outing.occurredAt), timezoneOffsetMinutes: "0", notes: outing.notes ?? "" }}
          />
          <p className="outing-record__next">Expenses recorded under this outing inherit its date and time. Friend-share assignment arrives in the next stage.</p>
        </div>
        <DeleteRecordForm action={deleteOutingAction.bind(null, outing.id)} recordType="outing" impact={deletionImpact} impactRevision={currentImpactRevision} />
      </div>
    </section>
  );
}
