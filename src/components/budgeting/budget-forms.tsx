"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { TaskPanelFooter } from "@/components/app/task-panel";
import type { BudgetFormState, BudgetPlanValues, BudgetSetupValues, BudgetTransactionValues } from "@/app/app/personal/budget/actions";

type SetupAction = (state: BudgetFormState<BudgetSetupValues>, formData: FormData) => Promise<BudgetFormState<BudgetSetupValues>>;
type PlanAction = (state: BudgetFormState<BudgetPlanValues>, formData: FormData) => Promise<BudgetFormState<BudgetPlanValues>>;
type TransactionAction = (state: BudgetFormState<BudgetTransactionValues>, formData: FormData) => Promise<BudgetFormState<BudgetTransactionValues>>;

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
