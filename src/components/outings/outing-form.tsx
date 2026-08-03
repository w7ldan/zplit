"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { OutingActionState } from "@/app/app/outings/actions";
import type { OutingInputValues } from "@/domain/outing-input";

type OutingAction = (previousState: OutingActionState, formData: FormData) => Promise<OutingActionState>;

type OutingFormProps = {
  action: OutingAction;
  initialValues?: OutingInputValues;
  initialOccurredAtUtc?: string;
  mode?: "create" | "edit";
};

const emptyValues: OutingInputValues = { title: "", occurredAtLocal: "", timezoneOffsetMinutes: "", notes: "" };
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

export function OutingForm({ action, initialValues = emptyValues, initialOccurredAtUtc, mode = "create" }: OutingFormProps) {
  const [state, formAction] = useActionState(action, { ...emptyActionState, values: initialValues });
  const formRef = useRef<HTMLFormElement>(null);
  const timezoneOffsetRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    const offset = new Date().getTimezoneOffset().toString();
    if (timezoneOffsetRef.current) timezoneOffsetRef.current.value = offset;
    if (!initializedRef.current && initialOccurredAtUtc) {
      initializedRef.current = true;
      const localValue = localValueFromUtc(initialOccurredAtUtc);
      const occurredAtInput = formRef.current?.elements.namedItem("occurredAtLocal");
      if (occurredAtInput instanceof HTMLInputElement && localValue) occurredAtInput.value = localValue;
    }
  }, [initialOccurredAtUtc]);

  function setCurrentTimezoneOffset() {
    if (timezoneOffsetRef.current) timezoneOffsetRef.current.value = new Date().getTimezoneOffset().toString();
  }

  return (
    <form
      ref={formRef}
      key={`${state.values.title}\u0000${state.values.occurredAtLocal}\u0000${state.values.timezoneOffsetMinutes}\u0000${state.values.notes}`}
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
      <div className="outing-form__field">
        <label htmlFor="outing-notes">Notes</label>
        <textarea id="outing-notes" name="notes" defaultValue={state.values.notes} aria-invalid={Boolean(state.fieldErrors.notes)} aria-describedby="outing-notes-error" rows={5} />
        <FieldError id="outing-notes-error" message={state.fieldErrors.notes} />
      </div>
      <p className="outing-form__message" role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
      <SubmitButton mode={mode} />
    </form>
  );
}
