import Link from "next/link";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { formatSignedRupiah } from "@/domain/budgeting/amounts";
import { formatRupiah } from "@/domain/rupiah";
import { formatCalendarDate } from "@/components/editorial/calendar-date";
import { listBudgetPeriodHistory } from "@/server/budgeting/reporting";
import { BudgetSectionNav } from "@/components/budgeting/budget-section-nav";
import { BudgetCategoryList } from "@/components/budgeting/budget-category-list";

export const metadata = { title: "Period history" };
export const dynamic = "force-dynamic";

type BudgetPeriodHistory = Awaited<ReturnType<typeof listBudgetPeriodHistory>>[number];

function periodRange(period: BudgetPeriodHistory) {
  return `${formatCalendarDate(period.startsOn)} – ${formatCalendarDate(period.endsOn)}`;
}

function PeriodFigures({ period, order }: { period: BudgetPeriodHistory; order: "current" | "history" }) {
  const figures = order === "current"
    ? [
      { label: "Remaining", value: formatSignedRupiah(period.remaining) },
      { label: "Net spent", value: formatSignedRupiah(period.netSpent) },
      { label: "Total budget", value: formatRupiah(period.totalBudget) },
    ]
    : [
      { label: "Total budget", value: formatRupiah(period.totalBudget) },
      { label: "Net spent", value: formatSignedRupiah(period.netSpent) },
      { label: "Remaining", value: formatSignedRupiah(period.remaining) },
    ];
  return (
    <dl className="budget-period-figures">
      {figures.map((figure) => (
        <div key={figure.label}>
          <dt>{figure.label}</dt>
          <dd>{figure.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CategoryBreakdown({ period }: { period: BudgetPeriodHistory }) {
  if (period.categories.length === 0) return null;
  return (
    <section aria-labelledby={`budget-period-${period.id}-categories`}>
      <div className="budget-period-detail__heading">
        <h3 id={`budget-period-${period.id}-categories`}>Category breakdown</h3>
        <span className="technical-label">Allocated · Net spent · Remaining</span>
      </div>
      <BudgetCategoryList categories={period.categories} />
    </section>
  );
}

function CurrentPeriod({ period }: { period: BudgetPeriodHistory }) {
  return (
    <section className="ledger-section" aria-labelledby="budget-current-period-heading">
      <div className="ledger-section__heading">
        <div>
          <p className="technical-label">Current period</p>
          <h2 id="budget-current-period-heading">{period.name}</h2>
        </div>
        <span className="technical-label">Active</span>
      </div>
      <p className="budget-period-dates">{periodRange(period)}</p>
      <PeriodFigures order="current" period={period} />
      {period.categories.length > 0 ? (
        <details className="budget-period-detail">
          <summary className="text-link">View category breakdown</summary>
          <BudgetCategoryList categories={period.categories} />
        </details>
      ) : null}
    </section>
  );
}

function PreviousPeriod({ period }: { period: BudgetPeriodHistory }) {
  return (
    <details className="budget-period-history">
      <summary>
        <span><strong>{period.name}</strong><small>{periodRange(period)} · Closed</small></span>
        <span><strong>{formatSignedRupiah(period.netSpent)}</strong><small>Net spent · {formatSignedRupiah(period.remaining)} remaining</small></span>
      </summary>
      <div className="budget-period-detail">
        <section aria-labelledby={`budget-period-${period.id}-summary`}>
          <h3 id={`budget-period-${period.id}-summary`}>Summary</h3>
          <PeriodFigures order="history" period={period} />
        </section>
        <CategoryBreakdown period={period} />
      </div>
    </details>
  );
}

export default async function BudgetPeriodsPage() {
  const session = await requireSession();
  const periods = await listBudgetPeriodHistory(getDatabase(), session.user.id);
  const current = periods.find((period) => period.status === "active");
  const previous = periods.filter((period) => period.status !== "active");
  return (
    <section className="app-page budget-page budget-period-history-page" id="top">
      <div className="editorial-shell app-page__layout">
        <header className="app-page__header">
          <div>
            <p className="technical-label">Personal · budget</p>
            <h1>Period history</h1>
            <p className="app-page__lede">A read-only record of each Budget period.</p>
          </div>
        </header>
        <BudgetSectionNav current="periods" />
        {periods.length === 0 ? (
          <section className="ledger-section" aria-labelledby="budget-period-history-heading">
            <div className="ledger-section__heading"><h2 id="budget-period-history-heading">Period history</h2></div>
            <div className="ledger-empty"><p>No budget periods yet.</p><Link className="text-link" href="/app/personal/budget">Set up Budget <span aria-hidden="true">→</span></Link></div>
          </section>
        ) : (
          <>
            {current ? <CurrentPeriod period={current} /> : null}
            <section className="ledger-section" aria-labelledby="budget-previous-periods-heading">
              <div className="ledger-section__heading">
                <h2 id="budget-previous-periods-heading">Previous periods</h2>
                <span className="technical-label">{previous.length}</span>
              </div>
              {previous.length === 0
                ? <div className="ledger-empty"><p>No previous periods yet.</p></div>
                : (
                  <div className="budget-period-history-list">
                    {previous.map((period) => <PreviousPeriod key={period.id} period={period} />)}
                  </div>
                )}
            </section>
          </>
        )}
      </div>
    </section>
  );
}
