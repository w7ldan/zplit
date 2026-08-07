"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { OutingActionState } from "@/app/app/outings/actions";
import type { OutingInputValues } from "@/domain/outing-input";
import { SearchableCombobox, type SearchableOption, type SearchableOptionAction } from "@/components/records/searchable-combobox";

type OutingAction = (previousState: OutingActionState, formData: FormData) => Promise<OutingActionState>;

type OutingFormProps = {
  action: OutingAction;
  initialValues?: OutingInputValues;
  initialOccurredAtUtc?: string;
  trips?: SearchableOption[];
  searchTrips?: SearchableOptionAction;
  mode?: "create" | "edit";
};

const emptyValues: OutingInputValues = { title: "", occurredAtLocal: "", timezoneOffsetMinutes: "", notes: "", tripId: "" };
const emptyActionState: OutingActionState = { fieldErrors: {}, formError: "", values: emptyValues };

function localValueFromUtc(utc: string) {
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <button className="action-link action-link--primary outing-form__submit" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? (mode === "create" ? "Adding outing…" : "Saving changes…") : mode === "create" ? "Add outing" : "Save changes"}
    </button>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return <p className="outing-form__field-error" id={id}>{message || "\u00a0"}</p>;
}

export function OutingForm({ action, initialValues = emptyValues, initialOccurredAtUtc, trips = [{ id: "", label: "No trip" }], searchTrips = async () => trips, mode = "create" }: OutingFormProps) {
  const [state, formAction] = useActionState(action, { ...emptyActionState, values: initialValues });
  const [selectedTripId, setSelectedTripId] = useState(initialValues.tripId ?? "");
  const [selectedTrip, setSelectedTrip] = useState<SearchableOption | undefined>(() => trips.find((trip) => trip.id === initialValues.tripId));
  const formRef = useRef<HTMLFormElement>(null);
  const timezoneOffsetRef = useRef<HTMLInputElement>(null);
  const detailsDisclosureRef = useRef<HTMLDetailsElement>(null);
  const initializedRef = useRef(false);
  const previousActionStateRef = useRef(state);
  const contextualTrip = mode === "create" && Boolean(initialValues.tripId);
  const detailsDisclosureOpen = (mode === "edit" && Boolean(state.values.tripId || state.values.notes)) || Boolean(state.values.notes || state.fieldErrors.tripId || state.fieldErrors.notes);

  useEffect(() => {
    const offset = new Date().getTimezoneOffset().toString();
    if (timezoneOffsetRef.current) timezoneOffsetRef.current.value = offset;
    if (!initializedRef.current && initialOccurredAtUtc && (mode === "edit" || !initialValues.occurredAtLocal)) {
      initializedRef.current = true;
      const localValue = localValueFromUtc(initialOccurredAtUtc);
      const occurredAtInput = formRef.current?.elements.namedItem("occurredAtLocal");
      if (occurredAtInput instanceof HTMLInputElement && localValue) occurredAtInput.value = localValue;
    }
  }, [initialOccurredAtUtc, initialValues.occurredAtLocal, mode]);

  useEffect(() => {
    if (previousActionStateRef.current === state) return;
    previousActionStateRef.current = state;
    setSelectedTripId(state.values.tripId ?? "");
    setSelectedTrip((current) => trips.find((trip) => trip.id === state.values.tripId) ?? (current?.id === state.values.tripId ? current : undefined));
    if (detailsDisclosureOpen) detailsDisclosureRef.current?.setAttribute("open", "");
    const form = formRef.current;
    if (!form) return;
    for (const [name, value] of Object.entries({
      title: state.values.title,
      occurredAtLocal: state.values.occurredAtLocal,
      timezoneOffsetMinutes: state.values.timezoneOffsetMinutes,
      notes: state.values.notes,
    })) {
      const field = form.elements.namedItem(name);
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.value = value;
    }
  }, [detailsDisclosureOpen, state, trips]);

  function setCurrentTimezoneOffset() {
    if (timezoneOffsetRef.current) timezoneOffsetRef.current.value = new Date().getTimezoneOffset().toString();
  }

  return (
    <form
      ref={formRef}
      className="outing-form"
      action={formAction}
      noValidate
      onSubmit={setCurrentTimezoneOffset}
    >
      <div className="outing-form__field">
        <label htmlFor="outing-title">Title</label>
        <input id="outing-title" name="title" defaultValue={state.values.title} aria-invalid={Boolean(state.fieldErrors.title)} aria-describedby="outing-title-error" autoComplete="off" />
        <FieldError id="outing-title-error" message={state.fieldErrors.title} />
      </div>
      <div className="outing-form__field">
        <label htmlFor="outing-occurred-at">Date and time</label>
        <input id="outing-occurred-at" name="occurredAtLocal" type="datetime-local" defaultValue={state.values.occurredAtLocal} aria-invalid={Boolean(state.fieldErrors.occurredAtLocal)} aria-describedby="outing-occurred-at-error" />
      <FieldError id="outing-occurred-at-error" message={state.fieldErrors.occurredAtLocal} />
      </div>
      <input ref={timezoneOffsetRef} type="hidden" name="timezoneOffsetMinutes" defaultValue={state.values.timezoneOffsetMinutes} />
      {contextualTrip ? <div className="outing-form__trip-context" aria-label="Selected Trip">
        <span className="technical-label">TRIP</span>
        <strong className="outing-form__trip-context-name">{selectedTripId ? selectedTrip?.label ?? trips.find((trip) => trip.id === selectedTripId)?.label ?? "Selected trip" : "No trip"}</strong>
        <button className="outing-form__trip-context-change" type="button" onClick={() => detailsDisclosureRef.current?.setAttribute("open", "")}>Change</button>
      </div> : null}
      <details ref={detailsDisclosureRef} open={detailsDisclosureOpen || undefined} className="outing-form__disclosure">
        <summary>Optional details</summary>
        <div className="outing-form__field">
          <label id="outing-trip-label" htmlFor="outing-trip">Trip</label>
          <SearchableCombobox id="outing-trip" name="tripId" value={selectedTripId} options={trips} search={searchTrips} labelId="outing-trip-label" ariaInvalid={Boolean(state.fieldErrors.tripId)} ariaDescribedBy="outing-trip-error" onValueChange={(trip) => { setSelectedTripId(trip.id); setSelectedTrip(trip); }} />
          <FieldError id="outing-trip-error" message={state.fieldErrors.tripId} />
        </div>
        <div className="outing-form__field">
          <label htmlFor="outing-notes">Notes</label>
          <textarea id="outing-notes" name="notes" defaultValue={state.values.notes} aria-invalid={Boolean(state.fieldErrors.notes)} aria-describedby="outing-notes-error" rows={5} />
          <FieldError id="outing-notes-error" message={state.fieldErrors.notes} />
        </div>
      </details>
      <p className="outing-form__message" role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
      <SubmitButton mode={mode} />
    </form>
  );
}
