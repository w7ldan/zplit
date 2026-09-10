"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";
import { localCalendarDate } from "@/domain/budgeting/dates";
import { TaskPanelFooter } from "@/components/app/task-panel";
import { ErrorText, Field } from "./budget-forms";
import type { BudgetFormState, BudgetRecurringRecordValues, BudgetRecurringTemplateValues } from "@/app/app/personal/budget/actions";

type RecurringTemplateAction = (state: BudgetFormState<BudgetRecurringTemplateValues>, formData: FormData) => Promise<BudgetFormState<BudgetRecurringTemplateValues>>;
type RecurringRecordAction = (state: BudgetFormState<BudgetRecurringRecordValues>, formData: FormData) => Promise<BudgetFormState<BudgetRecurringRecordValues>>;

type CategoryOption = { id: string; name: string };

function SubmitButton({ label, quiet = false, ariaLabel }: { label: string; quiet?: boolean; ariaLabel?: string }) {
  const { pending } = useFormStatus();
  return <button className={quiet ? "action-link action-link--quiet" : "action-link action-link--primary"} type="submit" disabled={pending} aria-busy={pending} aria-label={ariaLabel}>{pending ? "Saving…" : label}</button>;
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

export function RecurringTemplateForm({ action, categories, template = emptyTemplate, submitLabel = "Add recurring expense", contextLabel }: {
  action: RecurringTemplateAction;
  categories: CategoryOption[];
  template?: BudgetRecurringTemplateValues;
  submitLabel?: string;
  contextLabel?: string;
}) {
  const [state, formAction] = useActionState(action, { fieldErrors: {}, formError: "", values: template });
  const key = state.values.templateId || "new";
  const nameId = `recurring-name-${key}`;
  const amountId = `recurring-amount-${key}`;
  const categoryId = `recurring-category-${key}`;
  const frequencyId = `recurring-frequency-${key}`;
  const startsOnId = `recurring-starts-${key}`;
  const spreadId = `recurring-spread-${key}`;
  return (
    <form className="budget-form" action={formAction} noValidate>
      {state.values.templateId ? <input type="hidden" name="templateId" value={state.values.templateId} /> : null}
      <div className="budget-form__grid">
        <Field label="Name" id={nameId} error={state.fieldErrors.name}><input id={nameId} name="name" defaultValue={state.values.name} aria-invalid={Boolean(state.fieldErrors.name)} /></Field>
        <Field label="Amount" id={amountId} error={state.fieldErrors.amount}><input id={amountId} name="amount" inputMode="numeric" placeholder="300.000" defaultValue={state.values.amount} aria-invalid={Boolean(state.fieldErrors.amount)} /></Field>
        <Field label="Category" id={categoryId} error={state.fieldErrors.categoryId}>
          <select id={categoryId} name="categoryId" defaultValue={state.values.categoryId} aria-invalid={Boolean(state.fieldErrors.categoryId)} aria-label={contextLabel ? `Category for ${contextLabel}` : undefined}>
            <option value="">Choose a category</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </Field>
        <Field label="Frequency" id={frequencyId} error={state.fieldErrors.frequency}>
          <select id={frequencyId} name="frequency" defaultValue={state.values.frequency} aria-invalid={Boolean(state.fieldErrors.frequency)}>
            <option value="every_budget_period">Every budget period</option>
            <option value="monthly">Monthly</option>
          </select>
        </Field>
        <Field label="Starts on" id={startsOnId} error={state.fieldErrors.startsOn}><input id={startsOnId} name="startsOn" type="date" defaultValue={state.values.startsOn} aria-invalid={Boolean(state.fieldErrors.startsOn)} /></Field>
        <Field label="Spread over periods" id={spreadId} error={state.fieldErrors.spreadCount}><input id={spreadId} name="spreadCount" type="number" min="1" max="24" step="1" defaultValue={state.values.spreadCount} aria-invalid={Boolean(state.fieldErrors.spreadCount)} /></Field>
      </div>
      <p className="budget-form__hint">Recurring templates describe expected future payments. Recording a payment creates the actual Budget transaction.</p>
      <p className="budget-form__message" role={state.formError ? "alert" : undefined}>{state.formError || "\u00a0"}</p>
      <TaskPanelFooter className="budget-form__actions"><SubmitButton label={submitLabel} /></TaskPanelFooter>
    </form>
  );
}

export function RecurringRecordForm({ action, occurrenceId, label = "Record", contextLabel }: { action: RecurringRecordAction; occurrenceId: string; label?: string; contextLabel?: string }) {
  const [state, formAction] = useActionState(action, { fieldErrors: {}, formError: "", values: { occurrenceId, occurredOn: "" } });
  const browserLocalDate = useSyncExternalStore(() => () => {}, () => localCalendarDate(new Date()), () => "");
  const [editedDate, setEditedDate] = useState<string | null>(null);
  const occurredOn = editedDate ?? browserLocalDate;
  const errorId = `recurring-record-${occurrenceId}-error`;
  const dateLabel = contextLabel ? `Payment date for ${contextLabel}` : "Payment date";
  return (
    <form className="budget-recurring-record" action={formAction}>
      <input type="hidden" name="occurrenceId" value={state.values.occurrenceId} />
      <label>
        <span className="sr-only">{dateLabel}</span>
        <input name="occurredOn" type="date" value={occurredOn} onChange={(event) => setEditedDate(event.target.value)} aria-invalid={Boolean(state.fieldErrors.occurredOn)} aria-describedby={errorId} />
      </label>
      <SubmitButton label={label} quiet ariaLabel={contextLabel ? `Record ${contextLabel} payment` : undefined} />
      <ErrorText id={errorId} message={state.fieldErrors.occurredOn || state.formError} />
    </form>
  );
}
