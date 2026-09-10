import Link from "next/link";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { formatSignedRupiah } from "@/domain/budgeting/amounts";
import { formatRupiah } from "@/domain/rupiah";
import { formatCalendarDate } from "@/components/editorial/calendar-date";
import { listBudgetPeriodHistory } from "@/server/budgeting/reporting";

export const metadata = { title: "Budget periods" };
export const dynamic = "force-dynamic";

type BudgetPeriodHistory = Awaited<ReturnType<typeof listBudgetPeriodHistory>>[number];

function PeriodCategoryRow({ category }: { category: BudgetPeriodHistory["categories"][number] }) {
  return (
    <div>
      <span>{category.name}</span>
      <span>{formatRupiah(category.allocatedAmount)} allocated</span>
      <strong>{formatSignedRupiah(category.netSpent)}</strong>
      <span>{formatSignedRupiah(category.remaining)} remaining</span>
    </div>
  );
}

function PeriodHistoryRow({ period }: { period: BudgetPeriodHistory }) {
  return (
    <details className="budget-period-history" key={period.id} open={period.status === "active"}>
      <summary>
        <span><strong>{period.name}</strong><small>{formatCalendarDate(period.startsOn)} – {formatCalendarDate(period.endsOn)} · {period.status === "active" ? "Active" : "Closed"}</small></span>
        <span><strong>{formatSignedRupiah(period.netSpent)}</strong><small>Net spent · {formatSignedRupiah(period.remaining)} remaining</small></span>
      </summary>
      <div className="budget-period-history__meta"><span>Total budget <strong>{formatRupiah(period.totalBudget)}</strong></span><span>Ordinal <strong>{period.ordinal}</strong></span></div>
      {period.categories.length > 0 ? <div className="budget-period-history__categories">{period.categories.map((category) => <PeriodCategoryRow category={category} key={category.id} />)}</div> : null}
    </details>
  );
}

export default async function BudgetPeriodsPage() {
  const session = await requireSession();
  const periods = await listBudgetPeriodHistory(getDatabase(), session.user.id);
  return (
    <section className="app-page budget-page budget-period-history-page" id="top">
      <div className="editorial-shell app-page__layout">
        <header className="app-page__header">
          <div>
            <p className="technical-label">Personal · budget</p>
            <h1>Budget periods</h1>
            <p className="app-page__lede">Read-only history of how each period absorbed posted cash.</p>
          </div>
          <Link className="text-link" href="/app/personal/budget">Back to Budget <span aria-hidden="true">→</span></Link>
        </header>
        <section className="ledger-section" aria-labelledby="budget-period-history-heading">
          <div className="ledger-section__heading"><h2 id="budget-period-history-heading">All periods</h2></div>
          {periods.length === 0 ? <div className="ledger-empty"><p>No budget periods yet.</p></div> : <div className="budget-period-history-list">{periods.map((period) => <PeriodHistoryRow key={period.id} period={period} />)}</div>}
        </section>
      </div>
    </section>
  );
}
