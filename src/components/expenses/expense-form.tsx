"use client";

import type { InferSelectModel } from "drizzle-orm";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ExpenseActionState } from "@/app/app/expenses/actions";
import type { outings } from "@/db/schema";
import type { ExpenseInputValues } from "@/domain/expense-input";

type ExpenseAction = (previousState: ExpenseActionState, formData: FormData) => Promise<ExpenseActionState>;

type ExpenseFormProps = {
  action: ExpenseAction;
  outings: Array<InferSelectModel<typeof outings>>;
  initialValues?: ExpenseInputValues;
  initialOccurredAtUtc?: string;
  mode?: "create" | "edit";
};

const emptyValues: ExpenseInputValues = { description: "", amountRupiah: "", occurredAtLocal: "", timezoneOffsetMinutes: "", outingId: "" };
const emptyActionState: ExpenseActionState = { fieldErrors: {}, formError: "", values: emptyValues };

function localValueFromUtc(utc: string) {
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <button className="action-link action-link--primary expense-form__submit" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? (mode === "create" ? "Adding expense…" : "Saving changes…") : mode === "create" ? "Add expense" : "Save changes"}
    </button>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return <p className="expense-form__field-error" id={id}>{message || "\u00a0"}</p>;
}

export function ExpenseForm({ action, outings: outingOptions, initialValues = emptyValues, initialOccurredAtUtc, mode = "create" }: ExpenseFormProps) {
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
      key={`${state.values.description}\u0000${state.values.amountRupiah}\u0000${state.values.occurredAtLocal}\u0000${state.values.timezoneOffsetMinutes}\u0000${state.values.outingId}`}
      className="expense-form"
      action={formAction}
      noValidate
      onSubmit={setCurrentTimezoneOffset}
    >
      <div className="expense-form__field">
        <label htmlFor="expense-description">Description</label>
        <input id="expense-description" name="description" defaultValue={state.values.description} aria-invalid={Boolean(state.fieldErrors.description)} aria-describedby="expense-description-error" autoComplete="off" />
        <FieldError id="expense-description-error" message={state.fieldErrors.description} />
      </div>
      <div className="expense-form__field">
        <label htmlFor="expense-amount">Amount in rupiah</label>
        <input id="expense-amount" name="amountRupiah" type="text" inputMode="numeric" defaultValue={state.values.amountRupiah} aria-invalid={Boolean(state.fieldErrors.amountRupiah)} aria-describedby="expense-amount-help expense-amount-error" autoComplete="off" />
        <p className="expense-form__help" id="expense-amount-help">Whole rupiah only. Examples: 84000 or 84.000.</p>
        <FieldError id="expense-amount-error" message={state.fieldErrors.amountRupiah} />
      </div>
      <div className="expense-form__field">
        <label htmlFor="expense-occurred-at">Date and time</label>
        <input id="expense-occurred-at" name="occurredAtLocal" type="datetime-local" defaultValue={state.values.occurredAtLocal} aria-invalid={Boolean(state.fieldErrors.occurredAtLocal)} aria-describedby="expense-occurred-at-error" />
        <FieldError id="expense-occurred-at-error" message={state.fieldErrors.occurredAtLocal} />
      </div>
      <input ref={timezoneOffsetRef} type="hidden" name="timezoneOffsetMinutes" defaultValue={state.values.timezoneOffsetMinutes} />
      <div className="expense-form__field">
        <label htmlFor="expense-outing">Outing</label>
        <select id="expense-outing" name="outingId" defaultValue={state.values.outingId} aria-invalid={Boolean(state.fieldErrors.outingId)} aria-describedby="expense-outing-error">
          <option value="">No outing</option>
          {outingOptions.map((outing) => <option key={outing.id} value={outing.id}>{outing.title}</option>)}
        </select>
        <FieldError id="expense-outing-error" message={state.fieldErrors.outingId} />
      </div>
      <p className="expense-form__message" role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
      <SubmitButton mode={mode} />
    </form>
  );
}
