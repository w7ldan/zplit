import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { createLedgerRepository } from "@/domain/ledger-repository";
import { OutingForm } from "@/components/outings/outing-form";
import { OutingRow } from "@/components/outings/outing-row";
import { createOutingAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function OutingsPage() {
  const session = await requireSession();
  const outings = await createLedgerRepository(getDatabase(), session.user.id).listOutings();

  return (
    <section className="outings-page" id="top">
      <div className="editorial-grid editorial-shell outings-page__layout">
        <div className="outings-page__marker technical-label">08 / OUTINGS</div>
        <div className="outings-page__intro">
          <p className="technical-label">SHARED MOMENTS / OWNER RECORDS</p>
          <h1>Shared moments, clearly recorded.</h1>
          <p>Keep each outing dated and named before financial records are assigned in the next stage.</p>
        </div>

        <div className="outings-page__list" aria-live="polite">
          <div className="outings-page__list-heading">
            <span className="technical-label">ACTIVE RECORDS</span>
            <span className="technical-label">{outings.length.toString().padStart(2, "0")} ENTRIES</span>
          </div>
          {outings.length > 0 ? (
            outings.map((outing) => <OutingRow key={outing.id} outing={outing} />)
          ) : (
            <div className="outings-page__empty">
              <h2>No outings yet.</h2>
              <p>Record the first shared moment before adding expenses in a later stage.</p>
            </div>
          )}
        </div>

        <div className="outings-page__create">
          <p className="technical-label">NEW RECORD</p>
          <h2>Add an outing</h2>
          <OutingForm action={createOutingAction} />
        </div>
      </div>
    </section>
  );
}
