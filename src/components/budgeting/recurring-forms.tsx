"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";
import { localCalendarDate } from "@/domain/budgeting/dates";
import { TaskPanelFooter } from "@/components/app/task-panel";
import type { BudgetFormState, BudgetRecurringRecordValues, BudgetRecurringTemplateValues } from "@/app/app/personal/budget/actions";

type RecurringTemplateAction = (state: BudgetFormState<BudgetRecurringTemplateValues>, formData: FormData) => Promise<BudgetFormState<BudgetRecurringTemplateValues>>;
type RecurringRecordAction = (state: BudgetFormState<BudgetRecurringRecordValues>, formData: FormData) => Promise<BudgetFormState<BudgetRecurringRecordValues>>;

type CategoryOption = { id: string; name: string };

function ErrorText({ message }: { message?: string }) {
  return <p className="budget-form__error">{message || "\u00a0"}</p>;
}

function SubmitButton({ label, quiet = false }: { label: string; quiet?: boolean }) {
  const { pending } = useFormStatus();
  return <button className={quiet ? "action-link action-link--quiet" : "action-link action-link--primary"} type="submit" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : label}</button>;
}

const emptyTemplate: BudgetRecurringTemplateValues = {
  templateId: "",
  name: "",
  amount: "",
  categoryId: "",
  frequency: "every_budget_period",
  startsOn: "",
  spreadCount: "1",
};

export function RecurringTemplateForm({ action, categories, template = emptyTemplate, submitLabel = "Add recurring expense" }: {
  action: RecurringTemplateAction;
  categories: CategoryOption[];
  template?: BudgetRecurringTemplateValues;
  submitLabel?: string;
}) {
  const [state, formAction] = useActionState(action, { fieldErrors: {}, formError: "", values: template });
  return (
    <form className="budget-form" action={formAction} noValidate>
      {state.values.templateId ? <input type="hidden" name="templateId" value={state.values.templateId} /> : null}
      <div className="budget-form__grid">
        <div className="budget-form__field">
          <label htmlFor={`recurring-name-${state.values.templateId || "new"}`}>Name</label>
          <input id={`recurring-name-${state.values.templateId || "new"}`} name="name" defaultValue={state.values.name} aria-invalid={Boolean(state.fieldErrors.name)} />
          <ErrorText message={state.fieldErrors.name} />
        </div>
        <div className="budget-form__field">
          <label htmlFor={`recurring-amount-${state.values.templateId || "new"}`}>Amount</label>
          <input id={`recurring-amount-${state.values.templateId || "new"}`} name="amount" inputMode="numeric" placeholder="300.000" defaultValue={state.values.amount} aria-invalid={Boolean(state.fieldErrors.amount)} />
          <ErrorText message={state.fieldErrors.amount} />
        </div>
        <div className="budget-form__field">
          <label htmlFor={`recurring-category-${state.values.templateId || "new"}`}>Category</label>
          <select id={`recurring-category-${state.values.templateId || "new"}`} name="categoryId" defaultValue={state.values.categoryId} aria-invalid={Boolean(state.fieldErrors.categoryId)}>
            <option value="">Choose a category</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
          <ErrorText message={state.fieldErrors.categoryId} />
        </div>
        <div className="budget-form__field">
          <label htmlFor={`recurring-frequency-${state.values.templateId || "new"}`}>Frequency</label>
          <select id={`recurring-frequency-${state.values.templateId || "new"}`} name="frequency" defaultValue={state.values.frequency} aria-invalid={Boolean(state.fieldErrors.frequency)}>
            <option value="every_budget_period">Every budget period</option>
            <option value="monthly">Monthly</option>
          </select>
          <ErrorText message={state.fieldErrors.frequency} />
        </div>
        <div className="budget-form__field">
          <label htmlFor={`recurring-starts-${state.values.templateId || "new"}`}>Starts on</label>
          <input id={`recurring-starts-${state.values.templateId || "new"}`} name="startsOn" type="date" defaultValue={state.values.startsOn} aria-invalid={Boolean(state.fieldErrors.startsOn)} />
          <ErrorText message={state.fieldErrors.startsOn} />
        </div>
        <div className="budget-form__field">
          <label htmlFor={`recurring-spread-${state.values.templateId || "new"}`}>Spread over periods</label>
          <input id={`recurring-spread-${state.values.templateId || "new"}`} name="spreadCount" type="number" min="1" max="24" step="1" defaultValue={state.values.spreadCount} aria-invalid={Boolean(state.fieldErrors.spreadCount)} />
          <ErrorText message={state.fieldErrors.spreadCount} />
        </div>
      </div>
      <p className="budget-form__hint">Recurring templates describe expected future payments. Recording a payment creates the actual Budget transaction.</p>
      <p className="budget-form__message" role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
      <TaskPanelFooter className="budget-form__actions"><SubmitButton label={submitLabel} /></TaskPanelFooter>
    </form>
  );
}

export function RecurringRecordForm({ action, occurrenceId, label = "Record" }: { action: RecurringRecordAction; occurrenceId: string; label?: string }) {
  const [state, formAction] = useActionState(action, { fieldErrors: {}, formError: "", values: { occurrenceId, occurredOn: "" } });
  const browserLocalDate = useSyncExternalStore(() => () => {}, () => localCalendarDate(new Date()), () => "");
  const [editedDate, setEditedDate] = useState<string | null>(null);
  const occurredOn = editedDate ?? browserLocalDate;
  return (
    <form className="budget-recurring-record" action={formAction}>
      <input type="hidden" name="occurrenceId" value={state.values.occurrenceId} />
      <label>
        <span className="sr-only">Payment date</span>
        <input name="occurredOn" type="date" value={occurredOn} onChange={(event) => setEditedDate(event.target.value)} aria-invalid={Boolean(state.fieldErrors.occurredOn)} aria-label="Payment date" />
      </label>
      <SubmitButton label={label} quiet />
      <ErrorText message={state.fieldErrors.occurredOn || state.formError} />
    </form>
  );
}
