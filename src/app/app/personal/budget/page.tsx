import Link from "next/link";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { formatRupiah } from "@/domain/rupiah";
import { formatSignedRupiah } from "@/domain/budgeting/amounts";
import { formatCalendarDate } from "@/components/editorial/calendar-date";
import { TaskPanel } from "@/components/app/task-panel";
import { BudgetSetupForm, BudgetPlanForm, BudgetTransactionForm } from "@/components/budgeting/budget-forms";
import { SafeDaily } from "@/components/budgeting/safe-daily";
import type { BudgetPeriodSummary, BudgetTransactionView } from "@/domain/budgeting/types";
import { getBudgetDashboard } from "@/server/budgeting/reporting";
import { changePersonalExpenseBudgetCategoryAction, createBudgetSetupAction, createBudgetTransactionAction, importPersonalActivityAction, updateBudgetPlanAction } from "./actions";

export const metadata = { title: "Budget" };
export const dynamic = "force-dynamic";

function transactionAmount(direction: "outflow" | "inflow", amount: number) {
  return `${direction === "outflow" ? "−" : "+"}${formatRupiah(amount)}`;
}

function SetupState() {
  return (
    <section className="ledger-section budget-setup" aria-labelledby="budget-setup-heading">
      <p className="technical-label">FIRST-TIME SETUP</p>
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
          {importAvailable ? <form action={importPersonalActivityAction}><button className="action-link action-link--quiet" type="submit">Import activity</button></form> : null}
          <Link className="action-link action-link--primary" href="/app/personal/budget?create=transaction" data-task-trigger="budget-transaction">Add transaction</Link>
          <Link className="action-link action-link--quiet" href="/app/personal/budget?create=plan" data-task-trigger="budget-plan">Manage plan</Link>
        </div>
      ) : null}
    </header>
  );
}

function BudgetSummary({ period, expectedBack }: { period: BudgetPeriodSummary; expectedBack: number }) {
  return (
    <section className="budget-summary" aria-labelledby="budget-summary-heading">
      <div className="ledger-section__heading">
        <div><p className="technical-label">CURRENT PERIOD</p><h2 id="budget-summary-heading">{period.name}</h2></div>
        <span className="technical-label">IDR</span>
      </div>
      <div className="budget-summary__grid">
        <div><span>Total budget</span><strong>{formatRupiah(period.totalBudget)}</strong></div>
        <div><span>Net spent</span><strong>{formatSignedRupiah(period.netSpent)}</strong></div>
        <div><span>Remaining</span><strong>{formatSignedRupiah(period.remaining)}</strong></div>
        <div><span>Expected back</span><strong>{formatRupiah(expectedBack)}</strong></div>
        <div><span>Safe daily</span><SafeDaily startsOn={period.startsOn} endsOn={period.endsOn} remaining={period.remaining} /></div>
      </div>
      <dl className="budget-plan-summary">
        <div><dt>Allocated</dt><dd>{formatRupiah(period.totalAllocated)}</dd></div>
        <div><dt>Unallocated</dt><dd>{formatRupiah(period.unallocatedBudget)}</dd></div>
      </dl>
    </section>
  );
}

function CategorySection({ period }: { period: BudgetPeriodSummary }) {
  return (
    <section className="ledger-section budget-category-section" aria-labelledby="budget-category-heading">
      <div className="ledger-section__heading">
        <h2 id="budget-category-heading">Category plan</h2>
        <span className="technical-label">Allocated · Net spent · Remaining</span>
      </div>
      <div className="budget-category-list">
        {period.categories.map((category) => (
          <div className="budget-category-row" key={category.id}>
            <div><strong>{category.name}</strong>{category.systemKey === "uncategorized" ? <small>System category</small> : null}</div>
            <span>{formatRupiah(category.allocatedAmount)}</span>
            <span>{formatSignedRupiah(category.netSpent)}</span>
            <strong>{formatSignedRupiah(category.remaining)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

type BudgetCategoryOption = { id: string; name: string };

function ChangeCategoryForm({ transaction, categories }: { transaction: BudgetTransactionView; categories: BudgetCategoryOption[] }) {
  if (transaction.sourceType !== "personal_expense" || transaction.status !== "posted") return null;
  return (
    <form action={changePersonalExpenseBudgetCategoryAction}>
      <input type="hidden" name="transactionId" value={transaction.id} />
      <label className="sr-only" htmlFor={`budget-category-${transaction.id}`}>Budget category</label>
      <select id={`budget-category-${transaction.id}`} name="categoryId" defaultValue={transaction.categoryId ?? categories[0]?.id}>
        {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
      </select>
      <button className="action-link action-link--quiet" type="submit">Change category</button>
    </form>
  );
}

function TransactionRow({ transaction, categories }: { transaction: BudgetTransactionView; categories: BudgetCategoryOption[] }) {
  const sourceLabel = transaction.sourceType === "personal_expense" ? "Personal expense" : transaction.sourceType === "personal_repayment" ? "Personal repayment" : transaction.direction === "outflow" ? "Expense" : "Credit / refund";
  const categoryLabel = transaction.categoryNames.length ? transaction.categoryNames.join(" + ") : "Not absorbed";
  return (
    <div className={`budget-transaction-row${transaction.status === "voided" ? " budget-transaction-row--voided" : ""}`}>
      <span className="technical-label">{sourceLabel}</span>
      <span>
        <strong>{transaction.description}</strong>
        <small>{categoryLabel} · {formatCalendarDate(transaction.occurredOn)}</small>
        <ChangeCategoryForm transaction={transaction} categories={categories} />
      </span>
      <span><strong>{transactionAmount(transaction.direction, transaction.amount)}</strong><small>{transaction.status === "voided" ? "Voided" : "Posted"}</small></span>
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
      {content}
    </section>
  );
}

export default async function BudgetPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ create?: string | string[] }> } = {}) {
  const session = await requireSession();
  const dashboard = await getBudgetDashboard(getDatabase(), session.user.id);
  if (!dashboard.configured) return <section className="app-page budget-page" id="top"><div className="editorial-shell app-page__layout"><PageHeader /><SetupState /></div></section>;
  if (!dashboard.period) return <section className="app-page budget-page" id="top"><div className="editorial-shell app-page__layout"><PageHeader /><section className="ledger-empty budget-invariant"><h2>No active budget period is available.</h2><p>Budgeting is configured, but its active period needs recovery.</p></section></div></section>;
  const period = dashboard.period;
  const query = await searchParams;
  const createMode = Array.isArray(query.create) ? query.create[0] : query.create;
  const openCreate = createMode === "transaction";
  const openManage = createMode === "plan";
  return (
    <section className="app-page budget-page" id="top">
      <div className="editorial-shell app-page__layout">
        <PageHeader period={period} importAvailable={dashboard.importAvailable} />
        <BudgetSummary period={period} expectedBack={dashboard.expectedBack ?? 0} />
        <CategorySection period={period} />
        <RecentSection transactions={dashboard.recentTransactions} categories={period.categories.map(({ id, name }) => ({ id, name }))} />
      </div>
      {openCreate ? <TaskPanel open eyebrow="NEW BUDGET RECORD" title="Add transaction" description="Record a manual expense or credit/refund in the active period." triggerId="budget-transaction"><BudgetTransactionForm action={createBudgetTransactionAction} categories={period.categories.map(({ id, name }) => ({ id, name }))} /></TaskPanel> : null}
      {openManage ? <TaskPanel open eyebrow="ACTIVE PLAN" title="Manage plan" description="Adjust this period and its category allocations." triggerId="budget-plan"><BudgetPlanForm action={updateBudgetPlanAction} period={period} categories={period.categories.map(({ id, name, allocatedAmount, systemKey }) => ({ id, name, allocatedAmount, systemKey }))} /></TaskPanel> : null}
    </section>
  );
}
