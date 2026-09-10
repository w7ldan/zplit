import Link from "next/link";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { formatRupiah } from "@/domain/rupiah";
import { formatCalendarDate } from "@/components/editorial/calendar-date";
import { TaskPanel } from "@/components/app/task-panel";
import { ConfirmationDialog } from "@/components/app/delete-confirmation-dialog";
import { budgetRecurringFrequencyLabel } from "@/domain/budgeting/recurrence";
import { listActiveBudgetPlanCategoryOptions } from "@/server/budgeting/categories";
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

export const metadata = { title: "Recurring" };
export const dynamic = "force-dynamic";

function spreadSummary(count: number) {
  return count === 1 ? "One period" : `Spread over ${count} periods`;
}

function TemplateRow({ template, categories }: { template: BudgetRecurringTemplateView; categories: Array<{ id: string; name: string }> }) {
  return (
    <div className="budget-recurring-row">
      <span className="technical-label">{budgetRecurringFrequencyLabel(template.frequency)}</span>
      <span>
        <strong>{template.name}</strong>
        <small>{template.categoryName} · {spreadSummary(template.spreadCount)} · from {formatCalendarDate(template.startsOn)}</small>
        <details className="budget-category-change">
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
        </details>
      </span>
      <span>
        <strong>{formatRupiah(template.amount)}</strong>
        <small>{template.nextDueOn ? `Next ${formatCalendarDate(template.nextDueOn)}` : "No upcoming occurrence"}</small>
      </span>
      <ConfirmationDialog
        title="Archive recurring expense?"
        entityName={template.name}
        confirmLabel="Archive recurring expense"
        pendingLabel="Archiving recurring expense…"
        triggerLabel="Archive"
        triggerAriaLabel={`Archive ${template.name} recurring expense`}
        description={`Archiving “${template.name}” removes it from recurring planning. Recorded transactions and past occurrences are unchanged.`}
        action={archiveBudgetRecurringTemplateAction.bind(null, template.id)}
      />
    </div>
  );
}

export default async function BudgetSubscriptionsPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ create?: string | string[] }> } = {}) {
  const session = await requireSession();
  const database = getDatabase();
  const [templates, dueOccurrences, categories, recurringSummary] = await Promise.all([
    listBudgetRecurringTemplates(database, session.user.id),
    listDueBudgetRecurringOccurrences(database, session.user.id),
    listActiveBudgetPlanCategoryOptions(database, session.user.id),
    getBudgetRecurringDashboardSummary(database, session.user.id),
  ]);
  const query = await searchParams;
  const createMode = Array.isArray(query.create) ? query.create[0] : query.create;
  const dueCountLabel = dueOccurrences.length < recurringSummary.dueCount
    ? `${recurringSummary.dueCount} due · showing first ${dueOccurrences.length}`
    : `${recurringSummary.dueCount} due`;
  return (
    <section className="app-page budget-page" id="top">
      <div className="editorial-shell app-page__layout">
        <header className="app-page__header">
          <div>
            <p className="technical-label">Personal · budget</p>
            <h1>Recurring</h1>
            <p className="app-page__lede">Expected recurring expenses. Nothing here affects spending until a payment is recorded.</p>
          </div>
          <div className="budget-page__actions">
            <Link className="action-link action-link--primary" href="/app/personal/budget/subscriptions?create=template" data-task-trigger="budget-recurring">Add recurring expense</Link>
          </div>
        </header>
        <BudgetSectionNav current="subscriptions" />
        <section className="ledger-section" aria-labelledby="budget-recurring-heading">
          <div className="ledger-section__heading"><h2 id="budget-recurring-heading">Active recurring</h2><span className="technical-label">Amount · next occurrence</span></div>
          {templates.length === 0
            ? <div className="ledger-empty"><p>No recurring expenses yet.</p><Link className="text-link" href="/app/personal/budget/subscriptions?create=template">Add recurring expense <span aria-hidden="true">→</span></Link></div>
            : <div className="budget-recurring-list">{templates.map((template) => <TemplateRow categories={categories} key={template.id} template={template} />)}</div>}
        </section>
        <section className="ledger-section" aria-labelledby="budget-recurring-due-heading">
          <div className="ledger-section__heading"><h2 id="budget-recurring-due-heading">Upcoming and due</h2><span className="technical-label">{dueCountLabel}</span></div>
          {dueOccurrences.length === 0
            ? (
              <div className="ledger-empty">
                <p>No recurring payments are due right now.</p>
                <Link className="text-link" href="/app/personal/budget/subscriptions?create=template">Add recurring expense <span aria-hidden="true">→</span></Link>
              </div>
            )
            : (
              <div className="budget-recurring-due-list">
                {dueOccurrences.map((occurrence) => (
                  <div className="budget-recurring-due-row" key={occurrence.id}>
                    <span className="technical-label">{formatCalendarDate(occurrence.scheduledOn)}</span>
                    <span>
                      <strong>{occurrence.templateName}</strong>
                      <small>{occurrence.categoryName} · {spreadSummary(occurrence.spreadCount)}</small>
                    </span>
                    <span><strong>{formatRupiah(occurrence.amount)}</strong><small>Expected</small></span>
                    <RecurringRecordForm action={recordBudgetRecurringOccurrenceAction} occurrenceId={occurrence.id} contextLabel={occurrence.templateName} />
                    <ConfirmationDialog
                      title="Skip occurrence?"
                      entityName={`${occurrence.templateName} on ${formatCalendarDate(occurrence.scheduledOn)}`}
                      confirmLabel="Skip occurrence"
                      pendingLabel="Skipping occurrence…"
                      triggerLabel="Skip"
                      triggerAriaLabel={`Skip ${occurrence.templateName} occurrence scheduled ${formatCalendarDate(occurrence.scheduledOn)}`}
                      description={`Skipping “${occurrence.templateName}” on ${formatCalendarDate(occurrence.scheduledOn)} marks this expected occurrence as skipped. No cash is recorded and Budget totals are unchanged.`}
                      action={skipBudgetRecurringOccurrenceAction.bind(null, occurrence.id)}
                    />
                  </div>
                ))}
              </div>
            )}
        </section>
      </div>
      {createMode === "template" ? (
        <TaskPanel open eyebrow="New recurring expense" title="Add recurring expense" description="Describe a future payment expectation. No cash is recorded until you record a payment." triggerId="budget-recurring">
          <RecurringTemplateForm action={createBudgetRecurringTemplateAction} categories={categories} />
        </TaskPanel>
      ) : null}
    </section>
  );
}
