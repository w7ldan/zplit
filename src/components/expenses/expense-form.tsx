"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { ExpenseActionState } from "@/app/app/expenses/actions";
import type { ExpenseInputValues } from "@/domain/expense-input";
import { SearchableCombobox, type SearchableOption, type SearchableOptionAction } from "@/components/records/searchable-combobox";
import { useToast } from "@/components/feedback/toast";

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

function SubmitButton({ mode, intent }: { mode: "create" | "edit"; intent?: "add" | "continue" }) {
  const { pending, data } = useFormStatus();
  const selectedIntent = data?.get("intent");
  const label = intent === "continue" ? "Save & add another" : mode === "create" ? "Add expense" : "Save changes";
  const pendingLabel = selectedIntent === "continue" ? "Adding and continuing…" : mode === "create" ? "Adding expense…" : "Saving changes…";
  const isSelected = pending && (intent ?? "add") === (selectedIntent === "continue" ? "continue" : "add");
  return (
    <button
      className={`action-link ${intent === "continue" ? "action-link--quiet" : "action-link--primary"} expense-form__submit`}
      type="submit"
      name={intent ? "intent" : undefined}
      value={intent}
      disabled={pending}
      aria-busy={pending}
    >
      {isSelected ? pendingLabel : label}
    </button>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return <p className="expense-form__field-error" id={id}>{message || "\u00a0"}</p>;
}

export function ExpenseForm({ action, outings: outingOptions, searchOutings, initialValues = emptyValues, mode = "create" }: ExpenseFormProps) {
  const [state, formAction] = useActionState(action, { ...emptyActionState, values: initialValues });
  const [selectedOuting, setSelectedOuting] = useState<SearchableOption | undefined>(() => outingOptions.find((outing) => outing.id === initialValues.outingId) ?? outingOptions[0]);
  const router = useRouter();
  const { showToast } = useToast();
  const descriptionRef = useRef<HTMLInputElement>(null);
  const handledExpenseId = useRef<string | undefined>(undefined);
  const outingId = state.values.outingId || selectedOuting?.id || outingOptions[0]?.id || "";
  const options = selectedOuting && !outingOptions.some((outing) => outing.id === selectedOuting.id) ? [...outingOptions, selectedOuting] : outingOptions;

  useEffect(() => {
    if (mode !== "create" || !state.success || handledExpenseId.current === state.success.expenseId) return;
    handledExpenseId.current = state.success.expenseId;
    descriptionRef.current?.focus();
    showToast({ message: "Expense added" });
    router.refresh();
  }, [mode, router, showToast, state.success]);

  return (
    <form
      className="expense-form"
      action={formAction}
      noValidate
    >
      <div className="expense-form__field">
        <label htmlFor="expense-description">Description</label>
        <input key={`${state.values.description}\u0000${state.success?.expenseId ?? ""}`} ref={descriptionRef} id="expense-description" name="description" defaultValue={state.values.description} aria-invalid={Boolean(state.fieldErrors.description)} aria-describedby="expense-description-error" autoComplete="off" />
        <FieldError id="expense-description-error" message={state.fieldErrors.description} />
      </div>
      <div className="expense-form__field">
        <label htmlFor="expense-amount">Amount in rupiah</label>
        <input key={`${state.values.amountRupiah}\u0000${state.success?.expenseId ?? ""}`} id="expense-amount" name="amountRupiah" type="text" inputMode="numeric" defaultValue={state.values.amountRupiah} aria-invalid={Boolean(state.fieldErrors.amountRupiah)} aria-describedby="expense-amount-help expense-amount-error" autoComplete="off" />
        <p className="expense-form__help" id="expense-amount-help">Whole rupiah only. Examples: 84000 or 84.000.</p>
        <FieldError id="expense-amount-error" message={state.fieldErrors.amountRupiah} />
      </div>
      <div className="expense-form__field">
        <label id="expense-outing-label" htmlFor="expense-outing">Outing</label>
        <SearchableCombobox id="expense-outing" name="outingId" value={outingId} options={options} search={searchOutings} required ariaInvalid={Boolean(state.fieldErrors.outingId)} ariaDescribedBy="expense-outing-error" labelId="expense-outing-label" onValueChange={setSelectedOuting} />
        <FieldError id="expense-outing-error" message={state.fieldErrors.outingId} />
      </div>
      <p className="expense-form__message" role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
      <div className="expense-form__actions">
        <SubmitButton mode={mode} intent={mode === "create" ? "add" : undefined} />
        {mode === "create" ? <SubmitButton mode={mode} intent="continue" /> : null}
      </div>
    </form>
  );
}
