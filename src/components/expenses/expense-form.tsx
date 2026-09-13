"use client";

import { useActionState, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { ExpenseActionState } from "@/app/app/expenses/actions";
import type { ExpenseInputValues } from "@/domain/expense-input";
import {
  SearchableCombobox,
  type SearchableOption,
  type SearchableOptionAction,
} from "@/components/records/searchable-combobox";
import { useToast } from "@/components/feedback/toast";
import { useUnsavedChangesGuard } from "@/components/navigation/unsaved-changes";
import { formatRupiah, sameRupiah } from "@/domain/rupiah";
import { TaskPanelFooter } from "@/components/app/task-panel";

type ExpenseAction = (previousState: ExpenseActionState, formData: FormData) => Promise<ExpenseActionState>;

type ExpenseBudgetControl = {
  defaultIncluded: boolean;
  defaultCategoryId: string;
  categories: Array<{ id: string; name: string }>;
};

type ExpenseFormProps = {
  action: ExpenseAction;
  outings: SearchableOption[];
  searchOutings: SearchableOptionAction;
  initialValues?: ExpenseInputValues;
  mode?: "create" | "edit";
  budget?: ExpenseBudgetControl;
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
  return (
    <p className="expense-form__field-error" id={id}>
      {message || "\u00a0"}
    </p>
  );
}

/**
 * Compact creation-time Budget section. The parent remounts it after a
 * continued save so the next expense starts from the stored preference again.
 */
function ExpenseBudgetField({ budget, error }: { budget: ExpenseBudgetControl; error?: string }) {
  const [included, setIncluded] = useState(budget.defaultIncluded);
  const [categoryId, setCategoryId] = useState(budget.defaultCategoryId);
  return (
    <fieldset className="expense-form__budget">
      <legend>Budget</legend>
      <input type="hidden" name="budgetParticipation" value="1" />
      <label className="expense-form__budget-toggle" htmlFor="expense-budget-include">
        <input
          id="expense-budget-include"
          name="includeInBudget"
          type="checkbox"
          value="1"
          checked={included}
          onChange={(event) => setIncluded(event.target.checked)}
        />
        <span>Include this expense in Budget</span>
      </label>
      {included ? (
        <div className="expense-form__field">
          <label htmlFor="expense-budget-category">Category</label>
          <select
            id="expense-budget-category"
            name="budgetCategoryId"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby="expense-budget-category-error"
          >
            {budget.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
          <FieldError id="expense-budget-category-error" message={error} />
        </div>
      ) : null}
    </fieldset>
  );
}

export function ExpenseForm({
  action,
  outings: outingOptions,
  searchOutings,
  initialValues = emptyValues,
  mode = "create",
  budget,
}: ExpenseFormProps) {
  const submissionReleaseRef = useRef<(() => void) | null>(null);
  const submitAction = useCallback(
    async (previousState: ExpenseActionState, formData: FormData) => {
      const nextState = await action(previousState, formData);
      submissionReleaseRef.current?.();
      submissionReleaseRef.current = null;
      return nextState;
    },
    [action],
  );
  const [state, formAction] = useActionState(submitAction, {
    ...emptyActionState,
    values: initialValues,
  });
  const [initialDraft] = useState(() => ({
    ...initialValues,
    outingId: initialValues.outingId || outingOptions[0]?.id || "",
  }));
  const [draftValues, setDraftValues] = useState(initialDraft);
  const [selectedOutingId, setSelectedOutingId] = useState(initialDraft.outingId);
  const [selectedOuting, setSelectedOuting] = useState<SearchableOption | undefined>(
    () => outingOptions.find((outing) => outing.id === initialValues.outingId) ?? outingOptions[0],
  );
  const router = useRouter();
  const { showToast } = useToast();
  const descriptionRef = useRef<HTMLInputElement>(null);
  const handledExpenseId = useRef<string | undefined>(undefined);
  const previousActionStateRef = useRef(state);
  const options =
    selectedOuting && !outingOptions.some((outing) => outing.id === selectedOuting.id)
      ? [...outingOptions, selectedOuting]
      : outingOptions;
  const isDirty = draftValues.description !== initialDraft.description
    || !sameRupiah(draftValues.amountRupiah, initialDraft.amountRupiah)
    || draftValues.outingId !== initialDraft.outingId;

  const guard = useUnsavedChangesGuard(isDirty);

  useEffect(() => () => {
    submissionReleaseRef.current?.();
    submissionReleaseRef.current = null;
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (!guard || submissionReleaseRef.current) return;
    const release = guard.beginSubmission();
    if (!release) {
      event.preventDefault();
      return;
    }
    submissionReleaseRef.current = release;
  }

  useEffect(() => {
    if (previousActionStateRef.current === state) return;
    previousActionStateRef.current = state;
    const nextOutingId = state.values.outingId || outingOptions[0]?.id || "";
    setDraftValues({ ...state.values, outingId: nextOutingId });
    setSelectedOutingId(nextOutingId);
    setSelectedOuting((current) =>
      outingOptions.find((outing) => outing.id === nextOutingId) ??
      (current?.id === nextOutingId ? current : undefined),
    );
  }, [outingOptions, state]);

  useEffect(() => {
    if (mode !== "create" || !state.success || handledExpenseId.current === state.success.expenseId) return;
    handledExpenseId.current = state.success.expenseId;
    descriptionRef.current?.focus();
    showToast({ message: `Expense saved · ${formatRupiah(state.success.amount)}` });
    router.refresh();
  }, [mode, router, showToast, state.success]);

  return (
    <form
      className="expense-form"
      action={formAction}
      onSubmit={handleSubmit}
      noValidate
    >
      <div className="expense-form__field">
        <label htmlFor="expense-description">Description</label>
        <input
          ref={descriptionRef}
          id="expense-description"
          name="description"
          value={draftValues.description}
          onChange={(event) =>
            setDraftValues((current) => ({
              ...current,
              description: event.target.value,
            }))
          }
          aria-invalid={Boolean(state.fieldErrors.description)}
          aria-describedby="expense-description-error"
          autoComplete="off"
        />
        <FieldError id="expense-description-error" message={state.fieldErrors.description} />
      </div>
      <div className="expense-form__field">
        <label htmlFor="expense-amount">Amount in rupiah</label>
        <input
          id="expense-amount"
          name="amountRupiah"
          type="text"
          inputMode="numeric"
          value={draftValues.amountRupiah}
          onChange={(event) =>
            setDraftValues((current) => ({
              ...current,
              amountRupiah: event.target.value,
            }))
          }
          aria-invalid={Boolean(state.fieldErrors.amountRupiah)}
          aria-describedby="expense-amount-help expense-amount-error"
          autoComplete="off"
        />
        <p className="expense-form__help" id="expense-amount-help">Whole rupiah only. Examples: 84000 or 84.000.</p>
        <FieldError id="expense-amount-error" message={state.fieldErrors.amountRupiah} />
      </div>
      <div className="expense-form__field">
        <label id="expense-outing-label" htmlFor="expense-outing">Outing</label>
        <SearchableCombobox
          id="expense-outing"
          name="outingId"
          value={selectedOutingId}
          options={options}
          search={searchOutings}
          required
          searchLabel="Search outings"
          placeholder="Choose outing"
          ariaInvalid={Boolean(state.fieldErrors.outingId)}
          ariaDescribedBy="expense-outing-error"
          labelId="expense-outing-label"
          onValueChange={(outing) => {
            setSelectedOutingId(outing.id);
            setSelectedOuting(outing);
            setDraftValues((current) => ({
              ...current,
              outingId: outing.id,
            }));
          }}
        />
        <FieldError id="expense-outing-error" message={state.fieldErrors.outingId} />
      </div>
      {budget ? (
        <ExpenseBudgetField
          key={state.success?.expenseId ?? "budget-defaults"}
          budget={budget}
          error={state.fieldErrors.budgetCategoryId}
        />
      ) : null}
      <p
        className="expense-form__message"
        role={state.formError ? "alert" : undefined}
        aria-live="polite"
      >
        {state.formError || "\u00a0"}
      </p>
      <TaskPanelFooter className="expense-form__actions">
        <SubmitButton
          mode={mode}
          intent={mode === "create" ? "add" : undefined}
        />
        {mode === "create" ? (
          <SubmitButton mode={mode} intent="continue" />
        ) : null}
      </TaskPanelFooter>
    </form>
  );
}
