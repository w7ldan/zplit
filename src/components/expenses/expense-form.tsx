"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ExpenseActionState } from "@/app/app/expenses/actions";
import type { ExpenseInputValues } from "@/domain/expense-input";
import { SearchableCombobox, type SearchableOption, type SearchableOptionAction } from "@/components/records/searchable-combobox";

type ExpenseAction = (previousState: ExpenseActionState, formData: FormData) => Promise<ExpenseActionState>;

type ExpenseFormProps = {
  action: ExpenseAction;
  outings: SearchableOption[];
  searchOutings: SearchableOptionAction;
  initialValues?: ExpenseInputValues;
  mode?: "create" | "edit";
};

const emptyValues: ExpenseInputValues = { description: "", amountRupiah: "", outingId: "" };
const emptyActionState: ExpenseActionState = { fieldErrors: {}, formError: "", values: emptyValues };

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

export function ExpenseForm({ action, outings: outingOptions, searchOutings, initialValues = emptyValues, mode = "create" }: ExpenseFormProps) {
  const [state, formAction] = useActionState(action, { ...emptyActionState, values: initialValues });
  const [selectedOuting, setSelectedOuting] = useState<SearchableOption | undefined>(() => outingOptions.find((outing) => outing.id === initialValues.outingId) ?? outingOptions[0]);
  const outingId = state.values.outingId || selectedOuting?.id || outingOptions[0]?.id || "";
  const options = selectedOuting && !outingOptions.some((outing) => outing.id === selectedOuting.id) ? [...outingOptions, selectedOuting] : outingOptions;

  return (
    <form
      className="expense-form"
      action={formAction}
      noValidate
    >
      <div className="expense-form__field">
        <label htmlFor="expense-description">Description</label>
        <input key={state.values.description} id="expense-description" name="description" defaultValue={state.values.description} aria-invalid={Boolean(state.fieldErrors.description)} aria-describedby="expense-description-error" autoComplete="off" />
        <FieldError id="expense-description-error" message={state.fieldErrors.description} />
      </div>
      <div className="expense-form__field">
        <label htmlFor="expense-amount">Amount in rupiah</label>
        <input key={state.values.amountRupiah} id="expense-amount" name="amountRupiah" type="text" inputMode="numeric" defaultValue={state.values.amountRupiah} aria-invalid={Boolean(state.fieldErrors.amountRupiah)} aria-describedby="expense-amount-help expense-amount-error" autoComplete="off" />
        <p className="expense-form__help" id="expense-amount-help">Whole rupiah only. Examples: 84000 or 84.000.</p>
        <FieldError id="expense-amount-error" message={state.fieldErrors.amountRupiah} />
      </div>
      <div className="expense-form__field">
        <label id="expense-outing-label" htmlFor="expense-outing">Outing</label>
        <SearchableCombobox id="expense-outing" name="outingId" value={outingId} options={options} search={searchOutings} required ariaInvalid={Boolean(state.fieldErrors.outingId)} ariaDescribedBy="expense-outing-error" labelId="expense-outing-label" onValueChange={setSelectedOuting} />
        <FieldError id="expense-outing-error" message={state.fieldErrors.outingId} />
      </div>
      <p className="expense-form__message" role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
      <SubmitButton mode={mode} />
    </form>
  );
}
