import Link from "next/link";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { formatRupiah } from "@/domain/rupiah";
import { formatCalendarDate } from "@/components/editorial/calendar-date";
import { TaskPanel } from "@/components/app/task-panel";
import { ConfirmationDialog } from "@/components/app/delete-confirmation-dialog";
import { budgetRecurringFrequencyLabel } from "@/domain/budgeting/recurrence";
import { listActiveBudgetPlanCategoryOptions } from "@/server/budgeting/categories";
import { getLatestClosedBudgetPeriod } from "@/server/budgeting/periods";
import { getBudgetRecurringDashboardSummary, listBudgetRecurringTemplates, listDueBudgetRecurringOccurrences, type BudgetRecurringTemplateView } from "@/server/budgeting/recurring";
import { RecurringRecordForm, RecurringTemplateForm } from "@/components/budgeting/recurring-forms";
import { BudgetSectionNav } from "@/components/budgeting/budget-section-nav";
import {
  archiveBudgetRecurringTemplateAction,
  createBudgetRecurringTemplateAction,
  recordBudgetRecurringOccurrenceAction,
  skipBudgetRecurringOccurrenceAction,
  updateBudgetRecurringTemplateAction,
} from "../actions";
import { zplitVNextFont } from "@/app/fonts";

export const metadata = { title: "Recurring" };
export const dynamic = "force-dynamic";

function spreadSummary(count: number) {
  return count === 1 ? "One period" : `Spread over ${count} periods`;
}

function TemplateRow({ template, categories, canUseActivePeriod }: { template: BudgetRecurringTemplateView; categories: Array<{ id: string; name: string }>; canUseActivePeriod: boolean }) {
  return (
    <div className="budget-recurring-row">
      <span className="technical-label budget-recurring-row__frequency">{budgetRecurringFrequencyLabel(template.frequency)}</span>
      <span className="budget-recurring-row__identity">
        <strong>{template.name}</strong>
        <small>{template.categoryName} · {spreadSummary(template.spreadCount)} · from {formatCalendarDate(template.startsOn)}</small>
        {canUseActivePeriod ? <details className="budget-category-change">
          <summary className="action-link action-link--quiet" aria-label={`Edit ${template.name} recurring expense`}>Edit</summary>
          <RecurringTemplateForm
            action={updateBudgetRecurringTemplateAction}
            categories={categories}
            submitLabel="Save recurring expense"
            contextLabel={template.name}
            template={{
              templateId: template.id,
              name: template.name,
              amount: String(template.amount),
              categoryId: template.categoryId,
              frequency: template.frequency,
              startsOn: template.startsOn,
              spreadCount: String(template.spreadCount),
            }}
          />
        </details> : null}
      </span>
      <span className="budget-recurring-row__amount">
        <strong>{formatRupiah(template.amount)}</strong>
        <small>{template.nextDueOn ? `Next ${formatCalendarDate(template.nextDueOn)}` : "No upcoming occurrence"}</small>
      </span>
      <div className="budget-recurring-row__action"><ConfirmationDialog
        title="Archive recurring expense?"
        entityName={template.name}
        confirmLabel="Archive recurring expense"
        pendingLabel="Archiving recurring expense…"
        triggerLabel="Archive"
        triggerAriaLabel={`Archive ${template.name} recurring expense`}
        description={`Archiving “${template.name}” removes it from recurring planning. Recorded transactions and past occurrences are unchanged.`}
        action={archiveBudgetRecurringTemplateAction.bind(null, template.id)}
      /></div>
    </div>
  );
}

export default async function BudgetSubscriptionsPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ create?: string | string[] }> } = {}) {
  const session = await requireSession();
  const database = getDatabase();
  const [templates, dueOccurrences, categories, recurringSummary, latestClosedPeriod] = await Promise.all([
    listBudgetRecurringTemplates(database, session.user.id),
    listDueBudgetRecurringOccurrences(database, session.user.id),
    listActiveBudgetPlanCategoryOptions(database, session.user.id),
    getBudgetRecurringDashboardSummary(database, session.user.id),
    getLatestClosedBudgetPeriod(database, session.user.id),
  ]);
  const query = await searchParams;
  const createMode = Array.isArray(query.create) ? query.create[0] : query.create;
  const dueCountLabel = dueOccurrences.length < recurringSummary.dueCount
    ? `${recurringSummary.dueCount} due · showing first ${dueOccurrences.length}`
    : `${recurringSummary.dueCount} due`;
  const canUseActivePeriod = categories.length > 0;
  const isPaused = !canUseActivePeriod && latestClosedPeriod !== null;
  return (
    <section className={`app-page page-content zplit-vnext budget-page ${zplitVNextFont.variable}`} id="top">
      <div className="editorial-shell app-page__layout">
        <header className="app-page__header">
          <div>
            <p className="technical-label">Personal · budget</p>
            <h1>Recurring</h1>
            <p className="app-page__lede">Expected recurring expenses. Nothing here affects spending until a payment is recorded.</p>
          </div>
          <div className="budget-page__actions">
            {canUseActivePeriod
              ? <Link className="vnext-button vnext-button--primary action-link" href="/app/personal/budget/subscriptions?create=template" data-task-trigger="budget-recurring">Add recurring expense</Link>
              : isPaused
                ? <Link className="vnext-button vnext-button--primary action-link" href="/app/personal/budget?create=period" data-task-trigger="budget-period">Start new period</Link>
                : <Link className="vnext-button vnext-button--secondary action-link" href="/app/personal/budget">Open Budget</Link>}
          </div>
        </header>
        <BudgetSectionNav current="subscriptions" />
        {isPaused ? (
          <section className="ledger-section budget-paused-state" aria-labelledby="recurring-paused-heading">
            <p className="technical-label">Budget paused</p>
            <h2 id="recurring-paused-heading">Budget is paused</h2>
            <p>Review recurring plans here, then start a new period to edit plans or record payments.</p>
          </section>
        ) : null}
        <section className="ledger-section" aria-labelledby="budget-recurring-heading">
          <div className="ledger-section__heading"><h2 id="budget-recurring-heading">Active recurring</h2><span className="technical-label">Amount · next occurrence</span></div>
          {templates.length === 0
            ? (
              <div className="ledger-empty">
                <p>No recurring expenses yet.</p>
                {canUseActivePeriod
                  ? <Link className="text-link" href="/app/personal/budget/subscriptions?create=template">Add recurring expense <span aria-hidden="true">→</span></Link>
                  : <p>Start a Budget period to add recurring plans.</p>}
              </div>
            )
            : (
              <>
                <div className="budget-ledger-header budget-recurring-list__header" aria-hidden="true">
                  <span>Frequency</span>
                  <span>Rule</span>
                  <span>Amount</span>
                  <span>Actions</span>
                </div>
                <div className="budget-recurring-list">{templates.map((template) => <TemplateRow categories={categories} canUseActivePeriod={canUseActivePeriod} key={template.id} template={template} />)}</div>
              </>
            )}
        </section>
        <section className="ledger-section" aria-labelledby="budget-recurring-due-heading">
          <div className="ledger-section__heading"><h2 id="budget-recurring-due-heading">Upcoming and due</h2><span className="technical-label">{dueCountLabel}</span></div>
          {dueOccurrences.length === 0
            ? (
              <div className="ledger-empty">
                <p>No recurring payments are due right now.</p>
                {canUseActivePeriod
                  ? <Link className="text-link" href="/app/personal/budget/subscriptions?create=template">Add recurring expense <span aria-hidden="true">→</span></Link>
                  : <p>Recurring payments can be recorded when a Budget period is active.</p>}
              </div>
            )
            : (
              <>
                <div className="budget-ledger-header budget-recurring-due-list__header" aria-hidden="true">
                  <span>Due</span>
                  <span>Rule</span>
                  <span>Amount</span>
                  <span>Record</span>
                  <span>Actions</span>
                </div>
                <div className="budget-recurring-due-list">
                {dueOccurrences.map((occurrence) => (
                  <div className="budget-recurring-due-row" key={occurrence.id}>
                    <span className="technical-label budget-recurring-due-row__date">{formatCalendarDate(occurrence.scheduledOn)}</span>
                    <span className="budget-recurring-due-row__identity">
                      <strong>{occurrence.templateName}</strong>
                      <small>{occurrence.categoryName} · {spreadSummary(occurrence.spreadCount)}</small>
                    </span>
                    <span className="budget-recurring-due-row__amount"><strong>{formatRupiah(occurrence.amount)}</strong><small>Expected</small></span>
                    <div className="budget-recurring-due-row__record">{canUseActivePeriod ? <RecurringRecordForm action={recordBudgetRecurringOccurrenceAction} occurrenceId={occurrence.id} contextLabel={occurrence.templateName} /> : <span>Start a period to record</span>}</div>
                    <div className="budget-recurring-due-row__action"><ConfirmationDialog
                      title="Skip occurrence?"
                      entityName={`${occurrence.templateName} on ${formatCalendarDate(occurrence.scheduledOn)}`}
                      confirmLabel="Skip occurrence"
                      pendingLabel="Skipping occurrence…"
                      triggerLabel="Skip"
                      triggerAriaLabel={`Skip ${occurrence.templateName} occurrence scheduled ${formatCalendarDate(occurrence.scheduledOn)}`}
                      description={`Skipping “${occurrence.templateName}” on ${formatCalendarDate(occurrence.scheduledOn)} marks this expected occurrence as skipped. No cash is recorded and Budget totals are unchanged.`}
                      action={skipBudgetRecurringOccurrenceAction.bind(null, occurrence.id)}
                    /></div>
                  </div>
                ))}
                </div>
              </>
            )}
        </section>
      </div>
      {createMode === "template" && canUseActivePeriod ? (
        <TaskPanel open eyebrow="New recurring expense" title="Add recurring expense" description="Describe a future payment expectation. No cash is recorded until you record a payment." triggerId="budget-recurring">
          <RecurringTemplateForm action={createBudgetRecurringTemplateAction} categories={categories} />
        </TaskPanel>
      ) : null}
    </section>
  );
}
