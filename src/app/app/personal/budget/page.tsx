import Link from "next/link";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { formatRupiah } from "@/domain/rupiah";
import { formatSignedRupiah } from "@/domain/budgeting/amounts";
import { formatCalendarDate } from "@/components/editorial/calendar-date";
import { TaskPanel } from "@/components/app/task-panel";
import { RecordConfirmation } from "@/components/app/record-confirmation";
import { BudgetSetupForm, BudgetPlanForm, BudgetTransactionForm, BudgetTransitionForm } from "@/components/budgeting/budget-forms";
import { SafeDaily } from "@/components/budgeting/safe-daily";
import { BudgetSectionNav } from "@/components/budgeting/budget-section-nav";
import { BudgetCategoryList } from "@/components/budgeting/budget-category-list";
import { SpreadControl } from "@/components/budgeting/spread-control";
import { summarizeBudgetCategories, type BudgetPeriodSummary, type BudgetTransactionView } from "@/domain/budgeting/types";
import type { BudgetRecurringDashboardSummary } from "@/server/budgeting/recurring";
import type { ClosedBudgetPeriodSeed } from "@/server/budgeting/periods";
import type { GroupBudgetObligation } from "@/server/budgeting/sources-group";
import { getBudgetDashboard } from "@/server/budgeting/reporting";
import { archiveActiveBudgetPeriodAction, changeGroupObligationBudgetCategoryAction, changeGroupExpenseBudgetCategoryAction, changePersonalExpenseBudgetCategoryAction, createBudgetSetupAction, createBudgetTransactionAction, importPersonalActivityAction, startBudgetPeriodFromPausedAction, startNextBudgetPeriodAction, updateBudgetPlanAction } from "./actions";
import { zplitVNextFont } from "@/app/fonts";

export const metadata = { title: "Budget" };
export const dynamic = "force-dynamic";

function transactionAmount(direction: "outflow" | "inflow", amount: number) {
  return direction === "inflow" ? `+${formatSignedRupiah(amount)}` : formatSignedRupiah(-amount);
}

function SetupState() {
  return (
    <section className="ledger-section budget-setup" aria-labelledby="budget-setup-heading">
      <p className="technical-label">First-time setup</p>
      <h2 id="budget-setup-heading">Set up your first budget period</h2>
      <p className="budget-copy">
        Budgeting is private to you and separate from your Personal ledger. Add a period and optional category plan to begin.
      </p>
      <BudgetSetupForm action={createBudgetSetupAction} />
    </section>
  );
}

function PageHeader({ period, importAvailable = false }: { period?: BudgetPeriodSummary; importAvailable?: boolean }) {
  return (
    <header className={`app-page__header${period ? " budget-page__header" : ""}`}>
      <div>
        <p className="technical-label">Personal · budget</p>
        <h1>Budget</h1>
        {period ? <p className="app-page__lede">{period.name} · {formatCalendarDate(period.startsOn)} – {formatCalendarDate(period.endsOn)}</p> : <p className="app-page__lede">Plan how your spending is absorbed over time.</p>}
      </div>
      {period ? (
        <div className="budget-page__actions">
          {importAvailable ? <form action={importPersonalActivityAction}><button className="vnext-button vnext-button--secondary action-link" type="submit">Import activity</button></form> : null}
          <Link className="vnext-button vnext-button--primary action-link" href="/app/personal/budget?create=transaction" data-task-trigger="budget-transaction">Add transaction</Link>
          <Link className="vnext-button vnext-button--secondary action-link" href="/app/personal/budget?create=plan" data-task-trigger="budget-plan">Manage plan</Link>
          <Link className="vnext-button vnext-button--secondary action-link" href="/app/personal/budget?create=period" data-task-trigger="budget-period">Start next period</Link>
        </div>
      ) : null}
    </header>
  );
}

function BudgetPausedState({ period }: { period: ClosedBudgetPeriodSeed }) {
  return (
    <section className="ledger-section budget-paused-state" aria-labelledby="budget-paused-heading">
      <p className="technical-label">Budget paused</p>
      <h2 id="budget-paused-heading">Budget is paused</h2>
      <p>Your previous periods and transactions are preserved. New Personal and Group ledger records continue normally.</p>
      <p>Start another Budget period whenever you want to resume planning.</p>
      <div className="budget-paused-state__actions">
        <Link className="vnext-button vnext-button--primary action-link" href="/app/personal/budget?create=period" data-task-trigger="budget-period">Start new period</Link>
        <Link className="text-link" href="/app/personal/budget/periods">Period history <span aria-hidden="true">→</span></Link>
      </div>
      <p className="budget-paused-state__last-period">Last period: <strong>{period.name}</strong> · {formatCalendarDate(period.startsOn)} – {formatCalendarDate(period.endsOn)}</p>
    </section>
  );
}

function ArchivePeriodPrompt() {
  return (
    <section className="ledger-section budget-archive-prompt" aria-labelledby="budget-archive-heading">
      <div>
        <p className="technical-label">Period lifecycle</p>
        <h2 id="budget-archive-heading">Pause Budget planning</h2>
        <p>Archive this period when you want to close it and pause Budget until you start another period.</p>
      </div>
      <Link className="vnext-button vnext-button--secondary action-link" href="/app/personal/budget?archive=1" data-task-trigger="budget-archive">Archive period</Link>
    </section>
  );
}

type BudgetPageSearchParams = { create?: string | string[]; imported?: string | string[]; archive?: string | string[]; archived?: string | string[]; error?: string | string[] };
type BudgetDashboardData = Awaited<ReturnType<typeof getBudgetDashboard>>;
type ActiveBudgetDashboard = Extract<BudgetDashboardData, { configured: true; period: BudgetPeriodSummary }>;
type InactiveBudgetDashboard = Extract<BudgetDashboardData, { configured: true; period: null }>;

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function GroupObligationRows({ obligations, categories }: { obligations: GroupBudgetObligation[]; categories: BudgetCategoryOption[] }) {
  if (obligations.length === 0) return null;
  return (
    <details className="budget-group-obligations">
      <summary className="action-link action-link--quiet">View Group obligations</summary>
      <div className="budget-group-obligations__list">
        {obligations.map((obligation) => (
          <div className="budget-group-obligation" key={obligation.id}>
            <span className="budget-group-obligation__identity"><strong>{obligation.groupName}</strong><small>{obligation.description} · {obligation.categoryName}</small></span>
            <span className="budget-group-obligation__amount"><strong>{formatRupiah(obligation.amount)}</strong><small>You still owe</small></span>
            <details className="budget-category-change budget-group-obligation__action">
              <summary className="action-link action-link--quiet" aria-label={`Categorize ${obligation.description}`}>Categorize</summary>
              <form action={changeGroupObligationBudgetCategoryAction}>
                <input type="hidden" name="obligationId" value={obligation.id} />
                <label className="sr-only" htmlFor={`group-obligation-category-${obligation.id}`}>Budget category for {obligation.description}</label>
                <select id={`group-obligation-category-${obligation.id}`} name="categoryId" defaultValue={obligation.categoryId ?? categories[0]?.id}>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
                <button className="action-link action-link--quiet" type="submit" aria-label={`Save category for ${obligation.description}`}>Save category</button>
              </form>
            </details>
          </div>
        ))}
      </div>
    </details>
  );
}

function CurrentPeriodSummary({ period, recurring }: { period: BudgetPeriodSummary; recurring: BudgetRecurringDashboardSummary }) {
  return (
    <section aria-labelledby="budget-current-period-heading">
      <div className="ledger-section__heading">
        <div><p className="technical-label">Current period</p><h2 id="budget-current-period-heading">{period.name}</h2></div>
        <span className="technical-label">{formatCalendarDate(period.startsOn)} – {formatCalendarDate(period.endsOn)}</span>
      </div>
      <section className="overview-summary budget-workbench" aria-label="Current period summary">
        <div className="overview-summary__primary budget-summary__remaining">
          <span className="technical-label">Remaining</span>
          <strong>{formatSignedRupiah(period.remaining)}</strong>
          <span>Of {formatRupiah(period.totalBudget)} total budget</span>
        </div>
        <div className="budget-summary__metric">
          <span className="technical-label">Net spent</span>
          <strong>{formatSignedRupiah(period.netSpent)}</strong>
          <span>This period</span>
        </div>
        <div className="budget-summary__metric">
          <span className="technical-label">Safe daily</span>
          <strong><SafeDaily startsOn={period.startsOn} endsOn={period.endsOn} remaining={period.remaining} /></strong>
          <span>Through {formatCalendarDate(period.endsOn)}</span>
        </div>
        <div className="budget-summary__metric budget-summary__total">
          <span className="technical-label">Total budget</span>
          <strong>{formatRupiah(period.totalBudget)}</strong>
          <span>Planned for this period</span>
        </div>
      </section>
      {recurring.dueCount > 0 ? (
        <Link className="text-link budget-recurring-summary" href="/app/personal/budget/subscriptions">
          Recurring planning · {recurring.dueCount} due · {formatRupiah(recurring.expectedAmount)} expected <span aria-hidden="true">→</span>
        </Link>
      ) : null}
    </section>
  );
}

function SharedMoneySection({ expectedBack, stillOwe, groupObligations, categories }: { expectedBack: number; stillOwe: number; groupObligations: GroupBudgetObligation[]; categories: BudgetCategoryOption[] }) {
  return (
    <section className="ledger-section budget-shared-money" aria-labelledby="budget-shared-money-heading">
      <div className="ledger-section__heading">
        <div>
          <p className="technical-label">Separate from your Budget</p>
          <h2 id="budget-shared-money-heading">Shared Money</h2>
        </div>
      </div>
      <div className="budget-shared-money__values">
        <div><span>Expected back</span><strong>{formatRupiah(expectedBack)}</strong></div>
        <div><span>You still owe</span><strong>{formatRupiah(stillOwe)}</strong></div>
      </div>
      <GroupObligationRows obligations={groupObligations} categories={categories} />
    </section>
  );
}

function CategorySection({ period }: { period: BudgetPeriodSummary }) {
  return (
    <section className="ledger-section budget-category-section" aria-labelledby="budget-category-heading">
      <div className="ledger-section__heading">
        <div>
          <p className="technical-label">Allocated · Net spent · Remaining</p>
          <h2 id="budget-category-heading">Category plan</h2>
        </div>
        <Link className="text-link" href="/app/personal/budget?create=plan" data-task-trigger="budget-plan">Manage plan <span aria-hidden="true">→</span></Link>
      </div>
      <dl className="budget-plan-summary">
        <div><dt>Allocated</dt><dd>{formatRupiah(period.totalAllocated)}</dd></div>
        <div><dt>Unallocated</dt><dd>{formatRupiah(period.unallocatedBudget)}</dd></div>
      </dl>
      <BudgetCategoryList
        categories={period.categories.map((category) => ({
          ...category,
          note: category.systemKey === "uncategorized" ? "System category" : null,
        }))}
      />
    </section>
  );
}

type BudgetCategoryOption = { id: string; name: string };

function ChangeCategoryForm({ transaction, categories }: { transaction: BudgetTransactionView; categories: BudgetCategoryOption[] }) {
  if ((transaction.sourceType !== "personal_expense" && transaction.sourceType !== "group_expense") || transaction.status !== "posted") return null;
  const action = transaction.sourceType === "group_expense" ? changeGroupExpenseBudgetCategoryAction : changePersonalExpenseBudgetCategoryAction;
  return (
    <details className="budget-category-change">
      <summary className="action-link action-link--quiet" aria-label={`Change budget category for ${transaction.description}`}>Change budget category</summary>
      <form action={action}>
        <input type="hidden" name={transaction.sourceType === "group_expense" ? "groupExpenseId" : "expenseId"} value={transaction.sourceId ?? ""} />
        <label className="sr-only" htmlFor={`budget-category-${transaction.id}`}>Budget category for {transaction.description}</label>
        <select id={`budget-category-${transaction.id}`} name="categoryId" defaultValue={transaction.categoryId ?? categories[0]?.id}>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <button className="action-link action-link--quiet" type="submit" aria-label={`Save category for ${transaction.description}`}>Save category</button>
      </form>
    </details>
  );
}

function TransactionRow({ transaction, categories }: { transaction: BudgetTransactionView; categories: BudgetCategoryOption[] }) {
  const sourceLabel = transaction.sourceType === "personal_expense"
    ? "Personal expense"
    : transaction.sourceType === "recurring"
      ? "Recurring expense"
    : transaction.sourceType === "personal_repayment"
      ? "Personal repayment"
      : transaction.sourceType === "group_expense"
        ? "Group expense"
        : transaction.sourceType === "group_payment_sent"
          ? "Group payment sent"
          : transaction.sourceType === "group_payment_received"
            ? "Group payment received"
            : transaction.direction === "outflow" ? "Expense" : "Credit / refund";
  const categoryLabel = summarizeBudgetCategories(transaction.categoryNames);
  return (
    <div className={`budget-transaction-row${transaction.status === "voided" ? " budget-transaction-row--voided" : ""}`}>
      <span className="technical-label budget-transaction-row__type">{sourceLabel}</span>
      <span className="budget-transaction-row__identity">
        <strong>{transaction.description}</strong>
        <small>{categoryLabel} · {formatCalendarDate(transaction.occurredOn)}</small>
        <ChangeCategoryForm transaction={transaction} categories={categories} />
        <SpreadControl transaction={transaction} />
      </span>
      <span className="budget-transaction-row__amount"><strong>{transactionAmount(transaction.direction, transaction.amount)}</strong><small>{transaction.status === "voided" ? "Voided" : "Posted"}</small></span>
    </div>
  );
}

function RecentSection({ transactions, categories }: { transactions: BudgetTransactionView[]; categories: Array<{ id: string; name: string }> }) {
  const content = transactions.length ? (
    <div className="budget-transaction-list">
      {transactions.map((transaction) => <TransactionRow transaction={transaction} categories={categories} key={transaction.id} />)}
    </div>
  ) : (
    <div className="ledger-empty">
      <p>No budget transactions yet.</p>
      <Link className="text-link" href="/app/personal/budget?create=transaction" data-task-trigger="budget-transaction">
        Add your first transaction <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
  return (
    <section className="ledger-section budget-recent-section" aria-labelledby="budget-recent-heading">
      <div className="ledger-section__heading">
        <h2 id="budget-recent-heading">Recent transactions</h2>
        <Link className="text-link" href="/app/personal/budget/transactions">View transaction history <span aria-hidden="true">→</span></Link>
      </div>
      {transactions.length ? (
        <>
          <div className="budget-ledger-header budget-transaction-list__header" aria-hidden="true">
            <span>Source</span>
            <span>Description / category</span>
            <span>Amount</span>
          </div>
          {content}
        </>
      ) : content}
    </section>
  );
}

function PausedBudgetPage({ dashboard, query }: { dashboard: InactiveBudgetDashboard; query: BudgetPageSearchParams }) {
  const period = dashboard.pausedPeriod;
  const openNewPeriod = firstQueryValue(query.create) === "period";
  return (
    <section className={`app-page page-content zplit-vnext budget-page ${zplitVNextFont.variable}`} id="top">
      <div className="editorial-shell app-page__layout">
        <PageHeader />
        <BudgetSectionNav current="dashboard" />
        {firstQueryValue(query.archived) ? <RecordConfirmation queryKey="archived" message="Period archived. Budget is paused; its history is preserved." /> : null}
        {period ? <BudgetPausedState period={period} /> : (
          <section className="ledger-empty budget-invariant">
            <h2>No active budget period is available.</h2>
            <p>Budgeting is configured, but there is no active or closed period to resume from. Review period history to confirm the latest state.</p>
            <Link className="text-link" href="/app/personal/budget/periods">Review period history <span aria-hidden="true">→</span></Link>
          </section>
        )}
      </div>
      {openNewPeriod && period ? (
        <TaskPanel open eyebrow="Resume Budget" title="Start new period" description="Choose the next dates and confirm the full plan. Your closed period and pending activity remain preserved." triggerId="budget-period">
          <BudgetTransitionForm
            action={startBudgetPeriodFromPausedAction}
            period={period}
            categories={period.categories.map(({ id, name, allocatedAmount }) => ({ id, name, allocation: String(allocatedAmount) }))}
            pending={dashboard.pendingNextPeriod ?? []}
            recurringTemplates={dashboard.recurringTemplates ?? []}
            uncategorizedCategoryId={period.categories.find((category) => category.systemKey === "uncategorized")?.id ?? ""}
            fromPaused
          />
        </TaskPanel>
      ) : null}
    </section>
  );
}

function ActiveBudgetPage({ dashboard, query }: { dashboard: ActiveBudgetDashboard; query: BudgetPageSearchParams }) {
  const period = dashboard.period;
  const createMode = firstQueryValue(query.create);
  const imported = firstQueryValue(query.imported) === "1";
  const openCreate = createMode === "transaction";
  const openManage = createMode === "plan";
  const openNext = createMode === "period";
  const openArchive = firstQueryValue(query.archive) === "1";
  return (
    <section className={`app-page page-content zplit-vnext budget-page ${zplitVNextFont.variable}`} id="top">
      <div className="editorial-shell app-page__layout">
        <PageHeader period={period} importAvailable={dashboard.importAvailable} />
        {imported ? <RecordConfirmation queryKey="imported" message="Eligible activity imported into Budget." /> : null}
        <BudgetSectionNav current="dashboard" />
        <CurrentPeriodSummary period={period} recurring={dashboard.recurringSummary ?? { dueCount: 0, expectedAmount: 0, nextDueOn: null }} />
        <ArchivePeriodPrompt />
        <CategorySection period={period} />
        <RecentSection transactions={dashboard.recentTransactions} categories={period.categories.map(({ id, name }) => ({ id, name }))} />
        <SharedMoneySection
          expectedBack={dashboard.expectedBack ?? 0}
          groupObligations={dashboard.groupObligations ?? []}
          stillOwe={dashboard.stillOwe ?? 0}
          categories={period.categories.map(({ id, name }) => ({ id, name }))}
        />
      </div>
      {firstQueryValue(query.archived) ? <RecordConfirmation queryKey="archived" message="Period archived. Budget is paused; its history is preserved." /> : null}
      {openCreate ? <TaskPanel open eyebrow="New budget record" title="Add transaction" description="Record a manual expense or credit/refund in the active period." triggerId="budget-transaction"><BudgetTransactionForm action={createBudgetTransactionAction} categories={period.categories.map(({ id, name }) => ({ id, name }))} /></TaskPanel> : null}
      {openManage ? <TaskPanel open eyebrow="Active plan" title="Manage plan" description="Adjust this period and its category allocations." triggerId="budget-plan"><BudgetPlanForm action={updateBudgetPlanAction} period={period} categories={period.categories.map(({ id, name, allocatedAmount, systemKey }) => ({ id, name, allocatedAmount, systemKey }))} /></TaskPanel> : null}
      {openNext ? (
        <TaskPanel
          open
          eyebrow="Period transition"
          title="Start next period"
          description="This closes the active period immediately. Enter the next period and its complete category plan."
          triggerId="budget-period"
        >
          <BudgetTransitionForm
            action={startNextBudgetPeriodAction}
            period={period}
            categories={period.categories.map(({ id, name, allocatedAmount }) => ({ id, name, allocation: String(allocatedAmount) }))}
            pending={dashboard.pendingNextPeriod ?? []}
            recurringTemplates={dashboard.recurringTemplates ?? []}
            uncategorizedCategoryId={period.categories.find((category) => category.systemKey === "uncategorized")?.id ?? ""}
          />
        </TaskPanel>
      ) : null}
      {openArchive ? (
        <TaskPanel open eyebrow="Close current period" title="Archive period" description="Review what this will do before confirming." triggerId="budget-archive">
          <div className="budget-archive-confirmation">
            <p><strong>{period.name}</strong></p>
            <p>{formatCalendarDate(period.startsOn)} – {formatCalendarDate(period.endsOn)}</p>
            <ul>
              <li>This period, plan, transactions, impacts, categories, and history stay available.</li>
              <li>Budget planning pauses until you start another period.</li>
              <li>Personal and Group ledger records continue normally.</li>
              <li>You can start a new Budget period later using the existing categories and history.</li>
            </ul>
            <form action={archiveActiveBudgetPeriodAction}>
              <input type="hidden" name="expectedActivePeriodId" value={period.id} />
              <button className="vnext-button vnext-button--secondary action-link" type="submit">Archive period</button>
            </form>
          </div>
        </TaskPanel>
      ) : null}
    </section>
  );
}

export default async function BudgetPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<BudgetPageSearchParams> } = {}) {
  const session = await requireSession();
  const dashboard = await getBudgetDashboard(getDatabase(), session.user.id);
  if (!dashboard.configured) return <section className={`app-page page-content zplit-vnext budget-page ${zplitVNextFont.variable}`} id="top"><div className="editorial-shell app-page__layout"><PageHeader /><BudgetSectionNav current="dashboard" /><SetupState /></div></section>;
  const query = await searchParams;
  return dashboard.period
    ? <ActiveBudgetPage dashboard={dashboard} query={query} />
    : <PausedBudgetPage dashboard={dashboard} query={query} />;
}
