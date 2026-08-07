"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { TripDeleteActionState } from "@/app/app/trips/actions";

type TripDeleteAction = (previousState: TripDeleteActionState, formData: FormData) => Promise<TripDeleteActionState>;

function SubmitButton({ confirmed }: { confirmed: boolean }) {
  const { pending } = useFormStatus();
  return <button className="action-link trip-delete-form__submit" type="submit" disabled={!confirmed || pending} aria-busy={pending}>{pending ? "Deleting trip…" : "Delete trip"}</button>;
}

export function TripDeleteForm({ action }: { action: TripDeleteAction }) {
  const [state, formAction] = useActionState(action, { formError: "" });
  const [confirmed, setConfirmed] = useState(false);
  return (
    <section className="trip-delete-form" aria-labelledby="delete-trip-heading">
      <p className="technical-label">DELETE GROUPING</p>
      <h2 id="delete-trip-heading">Delete trip</h2>
      <p>Deleting the Trip removes only the grouping record. Linked outings remain and become <strong>No trip</strong>; no expenses or financial ledger data are deleted.</p>
      <form action={formAction}>
        <label className="trip-delete-form__confirm"><input type="checkbox" name="confirm" value="delete" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} aria-describedby="delete-trip-error" /><span>I understand this removes only the grouping.</span></label>
        <p className="trip-delete-form__message" id="delete-trip-error" role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
        <SubmitButton confirmed={confirmed} />
      </form>
    </section>
  );
}
