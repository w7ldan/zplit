"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { RepaymentDestinationActionState } from "@/app/app/settings/actions";
import { destinationTypeLabel, identifierLabel, REPAYMENT_DESTINATION_TYPES, type RepaymentDestinationFormValues } from "@/domain/repayment-destination";

type DestinationAction = (previousState: RepaymentDestinationActionState, formData: FormData) => Promise<RepaymentDestinationActionState>;

const emptyValues: RepaymentDestinationFormValues = {
  type: "bank_account",
  name: "",
  identifier: "",
  accountName: "",
  note: "",
  shareOnBalanceLinks: false,
};

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return <button className="action-link action-link--primary" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : mode === "create" ? "Add destination" : "Save destination"}</button>;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return <p className="repayment-destination-form__field-error" id={id}>{message || "\u00a0"}</p>;
}

export function RepaymentDestinationForm({ action, initialValues = emptyValues, mode = "create", idPrefix = "repayment-destination" }: { action: DestinationAction; initialValues?: RepaymentDestinationFormValues; mode?: "create" | "edit"; idPrefix?: string }) {
  const [state, formAction] = useActionState(action, { fieldErrors: {}, formError: "", values: initialValues });
  const [type, setType] = useState(state.values.type);
  const identifierHelp = identifierLabel(type);
  const formKey = `${state.values.type}\u0000${state.values.name}\u0000${state.values.identifier}\u0000${state.values.accountName}\u0000${state.values.note}\u0000${state.values.shareOnBalanceLinks}`;
  return (
    <form key={formKey} className="repayment-destination-form" action={formAction} noValidate>
      <div className="repayment-destination-form__field">
        <label htmlFor={`${idPrefix}-type`}>Type</label>
        <select id={`${idPrefix}-type`} name="type" defaultValue={state.values.type} onChange={(event) => setType(event.currentTarget.value)} aria-invalid={Boolean(state.fieldErrors.type)} aria-describedby={`${idPrefix}-type-error`}>
          {REPAYMENT_DESTINATION_TYPES.map((option) => <option key={option} value={option}>{destinationTypeLabel(option)}</option>)}
        </select>
        <FieldError id={`${idPrefix}-type-error`} message={state.fieldErrors.type} />
      </div>
      <div className="repayment-destination-form__field">
        <label htmlFor={`${idPrefix}-name`}>Name</label>
        <input id={`${idPrefix}-name`} name="name" defaultValue={state.values.name} aria-invalid={Boolean(state.fieldErrors.name)} aria-describedby={`${idPrefix}-name-error`} />
        <FieldError id={`${idPrefix}-name-error`} message={state.fieldErrors.name} />
      </div>
      <div className="repayment-destination-form__field">
        <label htmlFor={`${idPrefix}-identifier`}>{identifierHelp}</label>
        <textarea id={`${idPrefix}-identifier`} name="identifier" defaultValue={state.values.identifier} rows={2} aria-invalid={Boolean(state.fieldErrors.identifier)} aria-describedby={`${idPrefix}-identifier-error`} />
        <FieldError id={`${idPrefix}-identifier-error`} message={state.fieldErrors.identifier} />
      </div>
      <div className="repayment-destination-form__field">
        <label htmlFor={`${idPrefix}-account-name`}>Account holder <span>(optional)</span></label>
        <input id={`${idPrefix}-account-name`} name="accountName" defaultValue={state.values.accountName} aria-invalid={Boolean(state.fieldErrors.accountName)} aria-describedby={`${idPrefix}-account-name-error`} />
        <FieldError id={`${idPrefix}-account-name-error`} message={state.fieldErrors.accountName} />
      </div>
      <div className="repayment-destination-form__field">
        <label htmlFor={`${idPrefix}-note`}>Note <span>(optional)</span></label>
        <textarea id={`${idPrefix}-note`} name="note" defaultValue={state.values.note} rows={3} aria-invalid={Boolean(state.fieldErrors.note)} aria-describedby={`${idPrefix}-note-error`} />
        <FieldError id={`${idPrefix}-note-error`} message={state.fieldErrors.note} />
      </div>
      <label className="repayment-destination-form__checkbox" htmlFor={`${idPrefix}-share`}>
        <input id={`${idPrefix}-share`} name="shareOnBalanceLinks" type="checkbox" defaultChecked={state.values.shareOnBalanceLinks} />
        <span><strong>Show on balance links</strong><small>Anyone with an active balance link can see these details.</small></span>
      </label>
      <p className="repayment-destination-form__message" role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
      <SubmitButton mode={mode} />
    </form>
  );
}
