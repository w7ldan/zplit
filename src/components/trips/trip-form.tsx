"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { TripActionState } from "@/app/app/trips/actions";
import type { TripInputValues } from "@/domain/trip-input";

type TripAction = (previousState: TripActionState, formData: FormData) => Promise<TripActionState>;

const emptyValues: TripInputValues = { name: "", startsOn: "", endsOn: "", notes: "" };
const emptyActionState: TripActionState = { fieldErrors: {}, formError: "", values: emptyValues };

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return <button className="action-link action-link--primary trip-form__submit" type="submit" disabled={pending} aria-busy={pending}>{pending ? (mode === "create" ? "Adding trip…" : "Saving changes…") : mode === "create" ? "Add trip" : "Save changes"}</button>;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return <p className="trip-form__field-error" id={id}>{message || "\u00a0"}</p>;
}

export function TripForm({ action, initialValues = emptyValues, mode = "create" }: { action: TripAction; initialValues?: TripInputValues; mode?: "create" | "edit" }) {
  const [state, formAction] = useActionState(action, { ...emptyActionState, values: initialValues });
  return (
    <form className="trip-form" action={formAction} key={`${state.values.name}\u0000${state.values.startsOn}\u0000${state.values.endsOn}\u0000${state.values.notes}`} noValidate>
      <div className="trip-form__field">
        <label htmlFor="trip-name">Name</label>
        <input id="trip-name" name="name" defaultValue={state.values.name} aria-invalid={Boolean(state.fieldErrors.name)} aria-describedby="trip-name-error" autoComplete="off" />
        <FieldError id="trip-name-error" message={state.fieldErrors.name} />
      </div>
      <div className="trip-form__dates">
        <div className="trip-form__field">
          <label htmlFor="trip-starts-on">Start date</label>
          <input id="trip-starts-on" name="startsOn" type="date" defaultValue={state.values.startsOn} aria-invalid={Boolean(state.fieldErrors.startsOn)} aria-describedby="trip-starts-on-error" />
          <FieldError id="trip-starts-on-error" message={state.fieldErrors.startsOn} />
        </div>
        <div className="trip-form__field">
          <label htmlFor="trip-ends-on">End date</label>
          <input id="trip-ends-on" name="endsOn" type="date" defaultValue={state.values.endsOn} aria-invalid={Boolean(state.fieldErrors.endsOn)} aria-describedby="trip-ends-on-error" />
          <FieldError id="trip-ends-on-error" message={state.fieldErrors.endsOn} />
        </div>
      </div>
      <div className="trip-form__field">
        <label htmlFor="trip-notes">Notes</label>
        <textarea id="trip-notes" name="notes" defaultValue={state.values.notes} aria-invalid={Boolean(state.fieldErrors.notes)} aria-describedby="trip-notes-error" rows={5} />
        <FieldError id="trip-notes-error" message={state.fieldErrors.notes} />
      </div>
      <p className="trip-form__message" role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
      <SubmitButton mode={mode} />
    </form>
  );
}
