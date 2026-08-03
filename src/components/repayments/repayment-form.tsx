"use client";

import type { InferSelectModel } from "drizzle-orm";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { RepaymentActionState } from "@/app/app/repayments/actions";
import type { friends } from "@/db/schema";
import type { RepaymentInputValues } from "@/domain/repayment-input";

type RepaymentAction = (previousState: RepaymentActionState, formData: FormData) => Promise<RepaymentActionState>;

type RepaymentFormProps = {
  action: RepaymentAction;
  friends: Array<InferSelectModel<typeof friends>>;
  initialValues?: RepaymentInputValues;
  initialPaidAtUtc?: string;
  mode?: "create" | "edit";
};

const emptyValues: RepaymentInputValues = {
  friendId: "",
  amountRupiah: "",
  paidAtLocal: "",
  timezoneOffsetMinutes: "",
  paymentMethod: "",
  notes: "",
};
const emptyActionState: RepaymentActionState = { fieldErrors: {}, formError: "", values: emptyValues };

function localValueFromUtc(utc: string) {
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <button className="action-link action-link--primary repayment-form__submit" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? (mode === "create" ? "Recording repayment…" : "Saving repayment…") : mode === "create" ? "Record repayment" : "Save changes"}
    </button>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return <p className="repayment-form__field-error" id={id}>{message || "\u00a0"}</p>;
}

export function RepaymentForm({ action, friends: friendOptions, initialValues = emptyValues, initialPaidAtUtc, mode = "create" }: RepaymentFormProps) {
  const [state, formAction] = useActionState(action, { ...emptyActionState, values: initialValues });
  const formRef = useRef<HTMLFormElement>(null);
  const timezoneOffsetRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (timezoneOffsetRef.current) timezoneOffsetRef.current.value = new Date().getTimezoneOffset().toString();
    if (!initializedRef.current && initialPaidAtUtc && !initialValues.paidAtLocal) {
      initializedRef.current = true;
      const localValue = localValueFromUtc(initialPaidAtUtc);
      const paidAtInput = formRef.current?.elements.namedItem("paidAtLocal");
      if (paidAtInput instanceof HTMLInputElement && localValue) paidAtInput.value = localValue;
    }
  }, [initialPaidAtUtc, initialValues.paidAtLocal]);

  function setCurrentTimezoneOffset() {
    if (timezoneOffsetRef.current) timezoneOffsetRef.current.value = new Date().getTimezoneOffset().toString();
  }

  return (
    <form
      ref={formRef}
      key={`${state.values.friendId}\u0000${state.values.amountRupiah}\u0000${state.values.paidAtLocal}\u0000${state.values.timezoneOffsetMinutes}\u0000${state.values.paymentMethod}\u0000${state.values.notes}`}
      className="repayment-form"
      action={formAction}
      noValidate
      onSubmit={setCurrentTimezoneOffset}
    >
      <div className="repayment-form__field">
        <label htmlFor="repayment-friend">Friend</label>
        <select id="repayment-friend" name="friendId" required defaultValue={state.values.friendId || friendOptions[0]?.id || ""} aria-invalid={Boolean(state.fieldErrors.friendId)} aria-describedby="repayment-friend-error">
          {friendOptions.map((friend) => <option key={friend.id} value={friend.id}>{friend.name}{friend.archivedAt ? " (ARCHIVED)" : ""}</option>)}
        </select>
        <FieldError id="repayment-friend-error" message={state.fieldErrors.friendId} />
      </div>
      <div className="repayment-form__field">
        <label htmlFor="repayment-amount">Amount in rupiah</label>
        <input id="repayment-amount" name="amountRupiah" type="text" inputMode="numeric" required defaultValue={state.values.amountRupiah} aria-invalid={Boolean(state.fieldErrors.amountRupiah)} aria-describedby="repayment-amount-help repayment-amount-error" autoComplete="off" />
        <p className="repayment-form__help" id="repayment-amount-help">Whole rupiah only. Examples: 84000 or 84.000.</p>
        <FieldError id="repayment-amount-error" message={state.fieldErrors.amountRupiah} />
      </div>
      <div className="repayment-form__field">
        <label htmlFor="repayment-paid-at">Payment date and time</label>
        <input id="repayment-paid-at" name="paidAtLocal" type="datetime-local" required defaultValue={state.values.paidAtLocal} aria-invalid={Boolean(state.fieldErrors.paidAtLocal)} aria-describedby="repayment-paid-at-error" />
        <FieldError id="repayment-paid-at-error" message={state.fieldErrors.paidAtLocal} />
      </div>
      <input ref={timezoneOffsetRef} type="hidden" name="timezoneOffsetMinutes" defaultValue={state.values.timezoneOffsetMinutes} />
      <div className="repayment-form__field">
        <label htmlFor="repayment-payment-method">Payment method</label>
        <input id="repayment-payment-method" name="paymentMethod" maxLength={40} defaultValue={state.values.paymentMethod} aria-invalid={Boolean(state.fieldErrors.paymentMethod)} aria-describedby="repayment-payment-method-error" autoComplete="off" />
        <FieldError id="repayment-payment-method-error" message={state.fieldErrors.paymentMethod} />
      </div>
      <div className="repayment-form__field">
        <label htmlFor="repayment-notes">Notes</label>
        <textarea id="repayment-notes" name="notes" maxLength={4000} defaultValue={state.values.notes} aria-invalid={Boolean(state.fieldErrors.notes)} aria-describedby="repayment-notes-error" rows={5} />
        <FieldError id="repayment-notes-error" message={state.fieldErrors.notes} />
      </div>
      <p className="repayment-form__message" role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
      <SubmitButton mode={mode} />
    </form>
  );
}
