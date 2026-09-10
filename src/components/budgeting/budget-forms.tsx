"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { TaskPanelFooter } from "@/components/app/task-panel";
import { formatCalendarDate } from "@/components/editorial/calendar-date";
import { formatRupiah } from "@/domain/rupiah";
import { budgetRecurringFrequencyLabel, buildRecurringCandidates, recurringCandidateKey, type BudgetRecurringTemplateRule } from "@/domain/budgeting/recurrence";
import type { BudgetFormState, BudgetPlanValues, BudgetSetupValues, BudgetSpreadValues, BudgetTransactionValues, BudgetTransitionValues } from "@/app/app/personal/budget/actions";

type SetupAction = (state: BudgetFormState<BudgetSetupValues>, formData: FormData) => Promise<BudgetFormState<BudgetSetupValues>>;
type PlanAction = (state: BudgetFormState<BudgetPlanValues>, formData: FormData) => Promise<BudgetFormState<BudgetPlanValues>>;
type TransactionAction = (state: BudgetFormState<BudgetTransactionValues>, formData: FormData) => Promise<BudgetFormState<BudgetTransactionValues>>;
type TransitionAction = (state: BudgetFormState<BudgetTransitionValues>, formData: FormData) => Promise<BudgetFormState<BudgetTransitionValues>>;
type SpreadAction = (state: BudgetFormState<BudgetSpreadValues>, formData: FormData) => Promise<BudgetFormState<BudgetSpreadValues>>;

function ErrorText({ id, message }: { id: string; message?: string }) {
  return <p className="budget-form__error" id={id}>{message || "\u00a0"}</p>;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button className="action-link action-link--primary" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : label}</button>;
}

function Field({ label, id, error, children }: { label: string; id: string; error?: string; children: ReactNode }) {
  return <div className="budget-form__field"><label htmlFor={id}>{label}</label>{children}<ErrorText id={`${id}-error`} message={error} /></div>;
}

const emptySetup: BudgetSetupValues = { periodName: "", startsOn: "", endsOn: "", totalBudget: "", categories: Array.from({ length: 3 }, () => ({ name: "", allocation: "" })) };

export function BudgetSetupForm({ action, initialValues = emptySetup }: { action: SetupAction; initialValues?: BudgetSetupValues }) {
  const [state, formAction] = useActionState(action, { fieldErrors: {}, formError: "", values: initialValues });
  return <form className="budget-form" action={formAction} noValidate>
    <div className="budget-form__grid">
      <Field label="Period name" id="budget-setup-period-name" error={state.fieldErrors.periodName}><input id="budget-setup-period-name" name="periodName" defaultValue={state.values.periodName} aria-invalid={Boolean(state.fieldErrors.periodName)} /></Field>
      <Field label="Total budget" id="budget-setup-total-budget" error={state.fieldErrors.totalBudget}><input id="budget-setup-total-budget" name="totalBudget" inputMode="numeric" placeholder="1.000.000" defaultValue={state.values.totalBudget} aria-invalid={Boolean(state.fieldErrors.totalBudget)} /></Field>
      <Field label="Starts on" id="budget-setup-starts-on" error={state.fieldErrors.startsOn}><input id="budget-setup-starts-on" name="startsOn" type="date" defaultValue={state.values.startsOn} aria-invalid={Boolean(state.fieldErrors.startsOn)} /></Field>
      <Field label="Ends on" id="budget-setup-ends-on" error={state.fieldErrors.endsOn}><input id="budget-setup-ends-on" name="endsOn" type="date" defaultValue={state.values.endsOn} aria-invalid={Boolean(state.fieldErrors.endsOn)} /></Field>
    </div>
    <fieldset className="budget-form__categories">
      <legend>Optional categories</legend>
      <p className="budget-form__hint">Uncategorized is always available. Add up to three custom categories now, or leave these rows blank.</p>
      {state.values.categories.map((category, index) => (
        <div className="budget-form__category-row" key={index}>
          <div>
            <label htmlFor={`budget-setup-category-name-${index}`}>Category {index + 1}</label>
            <input
              id={`budget-setup-category-name-${index}`}
              name="categoryName"
              defaultValue={category.name}
              placeholder="e.g. Food"
              aria-describedby={`budget-setup-category-name-${index}-error`}
            />
            <ErrorText id={`budget-setup-category-name-${index}-error`} message={state.fieldErrors[`categoryName${index}`]} />
          </div>
          <div>
            <label htmlFor={`budget-setup-category-allocation-${index}`}>Allocation</label>
            <input
              id={`budget-setup-category-allocation-${index}`}
              name="categoryAllocation"
              inputMode="numeric"
              defaultValue={category.allocation}
              placeholder="0"
              aria-describedby={`budget-setup-category-allocation-${index}-error`}
            />
            <ErrorText id={`budget-setup-category-allocation-${index}-error`} message={state.fieldErrors[`categoryAllocation${index}`]} />
          </div>
        </div>
      ))}
      <ErrorText id="budget-setup-categories-error" message={state.fieldErrors.categories} />
    </fieldset>
    <p className="budget-form__message" role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
    <TaskPanelFooter className="budget-form__actions"><SubmitButton label="Start budgeting" /></TaskPanelFooter>
  </form>;
}

export type BudgetPlanCategory = { id: string; name: string; allocatedAmount: number; systemKey: string | null };

export function BudgetPlanForm({ action, period, categories }: { action: PlanAction; period: { name: string; startsOn: string; endsOn: string; updatedAt: string; totalBudget: number }; categories: BudgetPlanCategory[] }) {
  const initialValues: BudgetPlanValues = {
    periodName: period.name,
    startsOn: period.startsOn,
    endsOn: period.endsOn,
    periodUpdatedAt: period.updatedAt,
    totalBudget: String(period.totalBudget),
    categories: categories.map((category) => ({ id: category.id, name: category.name, allocation: String(category.allocatedAmount), systemKey: category.systemKey })),
    newCategoryName: "",
    newCategoryAllocation: "",
  };
  const [state, formAction] = useActionState(action, { fieldErrors: {}, formError: "", values: initialValues });
  return <form className="budget-form" action={formAction} noValidate>
    <div className="budget-form__grid">
      <input type="hidden" name="periodUpdatedAt" value={state.values.periodUpdatedAt} />
      <Field label="Period name" id="budget-plan-period-name" error={state.fieldErrors.periodName}><input id="budget-plan-period-name" name="periodName" defaultValue={state.values.periodName} /></Field>
      <Field label="Total budget" id="budget-plan-total-budget" error={state.fieldErrors.totalBudget}><input id="budget-plan-total-budget" name="totalBudget" inputMode="numeric" defaultValue={state.values.totalBudget} /></Field>
      <Field label="Starts on" id="budget-plan-starts-on" error={state.fieldErrors.startsOn}><input id="budget-plan-starts-on" name="startsOn" type="date" defaultValue={state.values.startsOn} /></Field>
      <Field label="Ends on" id="budget-plan-ends-on" error={state.fieldErrors.endsOn}><input id="budget-plan-ends-on" name="endsOn" type="date" defaultValue={state.values.endsOn} /></Field>
    </div>
    <fieldset className="budget-form__categories"><legend>Category plan</legend>
      {state.values.categories.map((category, index) => (
        <div className="budget-form__category-row" key={category.id}>
          <div>
            <label htmlFor={`budget-plan-category-name-${index}`}>
              {category.systemKey === "uncategorized" ? "Uncategorized" : "Category name"}
            </label>
            <input
              id={`budget-plan-category-name-${index}`}
              name="categoryName"
              defaultValue={category.name}
              readOnly={category.systemKey === "uncategorized"}
            />
            <input type="hidden" name="categoryId" value={category.id} />
            <input type="hidden" name={`categorySystemKey${index}`} value={category.systemKey ?? ""} readOnly />
          </div>
          <div>
            <label htmlFor={`budget-plan-category-allocation-${index}`}>Allocation</label>
            <input
              id={`budget-plan-category-allocation-${index}`}
              name="categoryAllocation"
              inputMode="numeric"
              defaultValue={category.allocation}
              aria-describedby={`budget-plan-category-allocation-${index}-error`}
            />
            <ErrorText id={`budget-plan-category-allocation-${index}-error`} message={state.fieldErrors[`categoryAllocation${index}`]} />
          </div>
        </div>
      ))}
      <ErrorText id="budget-plan-categories-error" message={state.fieldErrors.categories} />
    </fieldset>
    <fieldset className="budget-form__categories">
      <legend>Add a category</legend>
      <div className="budget-form__category-row">
        <div>
          <label htmlFor="budget-plan-new-category-name">New category name</label>
          <input id="budget-plan-new-category-name" name="newCategoryName" defaultValue={state.values.newCategoryName} />
          <ErrorText id="budget-plan-new-category-name-error" message={state.fieldErrors.newCategoryName} />
        </div>
        <div>
          <label htmlFor="budget-plan-new-category-allocation">Allocation</label>
          <input id="budget-plan-new-category-allocation" name="newCategoryAllocation" inputMode="numeric" defaultValue={state.values.newCategoryAllocation} placeholder="0" />
        </div>
      </div>
    </fieldset>
    <p className="budget-form__message" role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
    <TaskPanelFooter className="budget-form__actions"><SubmitButton label="Save plan" /></TaskPanelFooter>
  </form>;
}

const emptyTransaction: BudgetTransactionValues = { direction: "outflow", amount: "", description: "", occurredOn: "", categoryId: "" };

export function BudgetTransactionForm({ action, categories, initialValues = emptyTransaction }: { action: TransactionAction; categories: Array<{ id: string; name: string }>; initialValues?: BudgetTransactionValues }) {
  const [state, formAction] = useActionState(action, { fieldErrors: {}, formError: "", values: initialValues });
  return <form className="budget-form" action={formAction} noValidate>
    <fieldset className="budget-form__direction">
      <legend>Type</legend>
      <label><input type="radio" name="direction" value="outflow" defaultChecked={state.values.direction === "outflow"} /> Expense</label>
      <label><input type="radio" name="direction" value="inflow" defaultChecked={state.values.direction === "inflow"} /> Credit / refund</label>
    </fieldset>
    <Field label="Amount" id="budget-transaction-amount" error={state.fieldErrors.amount}><input id="budget-transaction-amount" name="amount" inputMode="numeric" placeholder="100.000" defaultValue={state.values.amount} aria-invalid={Boolean(state.fieldErrors.amount)} /></Field>
    <Field label="Description" id="budget-transaction-description" error={state.fieldErrors.description}><input id="budget-transaction-description" name="description" defaultValue={state.values.description} aria-invalid={Boolean(state.fieldErrors.description)} /></Field>
    <Field label="Date" id="budget-transaction-date" error={state.fieldErrors.occurredOn}><input id="budget-transaction-date" name="occurredOn" type="date" defaultValue={state.values.occurredOn} aria-invalid={Boolean(state.fieldErrors.occurredOn)} /></Field>
    <Field label="Category" id="budget-transaction-category" error={state.fieldErrors.categoryId}>
      <select id="budget-transaction-category" name="categoryId" defaultValue={state.values.categoryId} aria-invalid={Boolean(state.fieldErrors.categoryId)}>
        <option value="">Choose a category</option>
        {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
      </select>
    </Field>
    <p className="budget-form__message" role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
    <TaskPanelFooter className="budget-form__actions"><SubmitButton label="Add transaction" /></TaskPanelFooter>
  </form>;
}

export function BudgetSpreadForm({ action, transactionId, amount, initialCount = "1" }: { action: SpreadAction; transactionId: string; amount: number; initialCount?: string }) {
  const initialValues: BudgetSpreadValues = { transactionId, count: initialCount };
  const [state, formAction] = useActionState(action, { fieldErrors: {}, formError: "", values: initialValues });
  return <form className="budget-spread-form" action={formAction} noValidate>
    <input type="hidden" name="transactionId" value={state.values.transactionId} />
    <label htmlFor={`budget-spread-count-${transactionId}`}>Periods</label>
    <input id={`budget-spread-count-${transactionId}`} name="count" type="number" min="1" max={Math.min(24, amount)} step="1" defaultValue={state.values.count} aria-describedby={`budget-spread-count-${transactionId}-error`} />
    <button className="action-link action-link--quiet" type="submit">Save spread</button>
    <small>Rp {amount.toLocaleString("id-ID")} is divided into positive whole Rupiah slices.</small>
    <ErrorText id={`budget-spread-count-${transactionId}-error`} message={state.fieldErrors.count} />
    <p className="budget-form__message" role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
  </form>;
}

export type BudgetTransitionCategory = { id: string; name: string; allocation: string };

function TransitionCategoryRow({ category, index, errors }: { category: BudgetTransitionCategory; index: number; errors: Record<string, string> }) {
  return (
    <div className="budget-form__category-row">
      <div>
        <label htmlFor={`budget-next-category-name-${index}`}>Category</label>
        <input id={`budget-next-category-name-${index}`} name="categoryName" value={category.name} readOnly />
        <input type="hidden" name="categoryId" value={category.id} />
      </div>
      <div>
        <label htmlFor={`budget-next-category-allocation-${index}`}>Allocation</label>
        <input id={`budget-next-category-allocation-${index}`} name="categoryAllocation" inputMode="numeric" defaultValue={category.allocation} aria-describedby={`budget-next-category-allocation-${index}-error`} />
        <ErrorText id={`budget-next-category-allocation-${index}-error`} message={errors[`categoryAllocation${index}`]} />
      </div>
    </div>
  );
}

function PendingPreview({ pending }: { pending: Array<{ categoryId: string; categoryName: string; amount: number }> }) {
  if (pending.length === 0) return null;
  return (
    <section className="budget-pending-preview" aria-labelledby="budget-pending-preview-heading">
      <p className="technical-label" id="budget-pending-preview-heading">COMING INTO THIS PERIOD</p>
      {pending.map((item) => <div key={item.categoryId}><span>{item.categoryName}</span><strong>{formatRupiah(item.amount)}</strong></div>)}
    </section>
  );
}

function RecurringCandidatePreview({ candidates, categories, uncategorizedCategoryId, skipped, toggle }: {
  candidates: ReturnType<typeof buildRecurringCandidates>;
  categories: BudgetTransitionCategory[];
  uncategorizedCategoryId: string;
  skipped: ReadonlySet<string>;
  toggle: (key: string, selected: boolean) => void;
}) {
  if (candidates.length === 0) return null;
  const planCategoryIds = new Set(categories.map((category) => category.id));
  return (
    <fieldset className="budget-form__categories budget-recurring-preview">
      <legend>Recurring occurrences</legend>
      <p className="budget-form__hint">Expected payments for the proposed dates. Uncheck any occurrence you want to skip.</p>
      {candidates.map((candidate) => {
        const key = recurringCandidateKey(candidate.templateId, candidate.scheduledOn);
        const selected = !skipped.has(key);
        const defaultCategoryId = planCategoryIds.has(candidate.categoryId) ? candidate.categoryId : uncategorizedCategoryId;
        return (
          <div className="budget-recurring-candidate" key={key}>
            <label className="budget-recurring-candidate__toggle">
              <input type="checkbox" name="recurrenceSelected" value={key} checked={selected} onChange={(event) => toggle(key, event.target.checked)} />
              <span><strong>{candidate.name}</strong><small>{formatCalendarDate(candidate.scheduledOn)} · {budgetRecurringFrequencyLabel(candidate.frequency)}</small></span>
            </label>
            <input type="hidden" name="recurrenceTemplateId" value={candidate.templateId} />
            <input type="hidden" name="recurrenceScheduledOn" value={candidate.scheduledOn} />
            <span className="budget-recurring-candidate__amount">{formatRupiah(candidate.amount)}</span>
            <label className="budget-recurring-candidate__category">
              <span className="sr-only">Category for {candidate.name} on {candidate.scheduledOn}</span>
              <select name="recurrenceCategoryId" defaultValue={defaultCategoryId}>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <small>{candidate.spreadCount === 1 ? "One period" : `Spread over ${candidate.spreadCount} periods`}</small>
          </div>
        );
      })}
    </fieldset>
  );
}

type BudgetTransitionFormProps = {
  action: TransitionAction;
  period: { id: string; name: string; startsOn: string; endsOn: string; totalBudget: number };
  categories: BudgetTransitionCategory[];
  pending: Array<{ categoryId: string; categoryName: string; amount: number }>;
  recurringTemplates?: BudgetRecurringTemplateRule[];
  uncategorizedCategoryId?: string;
};

export function BudgetTransitionForm({ action, period, categories, pending, recurringTemplates = [], uncategorizedCategoryId = "" }: BudgetTransitionFormProps) {
  const initialValues: BudgetTransitionValues = {
    expectedActivePeriodId: period.id,
    name: "",
    startsOn: "",
    endsOn: "",
    totalBudget: String(period.totalBudget),
    categories,
    recurrence: [],
  };
  const [state, formAction] = useActionState(action, { fieldErrors: {}, formError: "", values: initialValues });
  const [startsOn, setStartsOn] = useState(state.values.startsOn);
  const [endsOn, setEndsOn] = useState(state.values.endsOn);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const candidates = useMemo(() => buildRecurringCandidates(recurringTemplates, { startsOn, endsOn }), [recurringTemplates, startsOn, endsOn]);
  function toggleCandidate(key: string, selected: boolean) {
    setSkipped((current) => {
      const next = new Set(current);
      if (selected) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  return <form className="budget-form" action={formAction} noValidate>
    <input type="hidden" name="expectedActivePeriodId" value={state.values.expectedActivePeriodId} />
    <p className="budget-form__warning">Starting the next period closes <strong>{period.name}</strong> immediately. This cannot be undone.</p>
    <div className="budget-form__grid">
      <Field label="Period name" id="budget-next-period-name" error={state.fieldErrors.periodName}><input id="budget-next-period-name" name="periodName" defaultValue={state.values.name} aria-invalid={Boolean(state.fieldErrors.periodName)} /></Field>
      <Field label="Total budget" id="budget-next-period-total" error={state.fieldErrors.totalBudget}><input id="budget-next-period-total" name="totalBudget" inputMode="numeric" defaultValue={state.values.totalBudget} aria-invalid={Boolean(state.fieldErrors.totalBudget)} /></Field>
      <Field label="Starts on" id="budget-next-period-starts" error={state.fieldErrors.startsOn}><input id="budget-next-period-starts" name="startsOn" type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} aria-invalid={Boolean(state.fieldErrors.startsOn)} /></Field>
      <Field label="Ends on" id="budget-next-period-ends" error={state.fieldErrors.endsOn}><input id="budget-next-period-ends" name="endsOn" type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} aria-invalid={Boolean(state.fieldErrors.endsOn)} /></Field>
    </div>
    <fieldset className="budget-form__categories"><legend>Next category plan</legend>
      <p className="budget-form__hint">Categories and their order stay the same. Allocations are copied for convenience; submitted values are explicit.</p>
      {state.values.categories.map((category, index) => <TransitionCategoryRow category={category} errors={state.fieldErrors} index={index} key={category.id} />)}
      <ErrorText id="budget-next-categories-error" message={state.fieldErrors.categories} />
    </fieldset>
    <PendingPreview pending={pending} />
    <RecurringCandidatePreview candidates={candidates} categories={categories} uncategorizedCategoryId={uncategorizedCategoryId} skipped={skipped} toggle={toggleCandidate} />
    <p className="budget-form__message" role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
    <TaskPanelFooter className="budget-form__actions"><SubmitButton label="Start next period" /></TaskPanelFooter>
  </form>;
}
