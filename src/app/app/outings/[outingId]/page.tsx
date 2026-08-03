import Link from "next/link";
import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { createLedgerRepository, LedgerNotFoundError } from "@/domain/ledger-repository";
import { OutingForm } from "@/components/outings/outing-form";
import { updateOutingAction } from "../actions";

export const dynamic = "force-dynamic";

function utcDateTimeLocal(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

export default async function OutingRecordPage({ params }: { params: Promise<{ outingId: string }> }) {
  const session = await requireSession();
  const { outingId } = await params;
  let outing;
  try {
    outing = await createLedgerRepository(getDatabase(), session.user.id).getOuting(outingId);
  } catch (error) {
    if (error instanceof LedgerNotFoundError) notFound();
    throw error;
  }

  const date = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(outing.createdAt);
  const occurred = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(outing.occurredAt);

  return (
    <section className="outing-record" id="top">
      <div className="editorial-grid editorial-shell outing-record__layout">
        <div className="outing-record__marker technical-label">08 / OUTING RECORD</div>
        <div className="outing-record__intro">
          <p className="technical-label">PRIVATE OUTING / EDITABLE RECORD</p>
          <h1>{outing.title}</h1>
          <Link className="outing-record__back" href="/app/outings">← Back to outings</Link>
        </div>
        <div className="outing-record__meta" aria-label="Outing metadata">
          <div><span className="technical-label">Occurred</span><time dateTime={outing.occurredAt.toISOString()}>{occurred}</time></div>
          <div><span className="technical-label">Created</span><time dateTime={outing.createdAt.toISOString()}>{date}</time></div>
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
          <p className="outing-record__next">Expense assignment arrives in the next product stage.</p>
        </div>
      </div>
    </section>
  );
}
