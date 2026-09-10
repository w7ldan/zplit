import Link from "next/link";
import { formatSignedRupiah } from "@/domain/budgeting/amounts";
import type { BudgetOverviewSnapshot } from "@/domain/budgeting/types";
import { formatRupiah } from "@/domain/rupiah";
import { formatCalendarDate } from "@/components/editorial/calendar-date";
import { SafeDaily } from "./safe-daily";

const budgetHref = "/app/personal/budget";
const budgetPeriodsHref = "/app/personal/budget/periods";

function SectionHeading() {
  return (
    <div className="ledger-section__heading">
      <div>
        <p className="technical-label">Personal · private budget</p>
        <h2 id="budget-overview-heading">Budget</h2>
      </div>
      <Link className="text-link overview-section__link" href={budgetHref}>
        Open Budget <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}

export function BudgetOverviewSection({ snapshot }: { snapshot: BudgetOverviewSnapshot }) {
  return (
    <section className="overview-budget" aria-labelledby="budget-overview-heading">
      <SectionHeading />
      {snapshot.configured === false ? (
        <div className="ledger-empty">
          <p>Set up a private budget period to see how your spending absorbs over time.</p>
          <Link className="text-link" href={budgetHref}>Set up Budget <span aria-hidden="true">→</span></Link>
        </div>
      ) : snapshot.period === null ? (
        <div className="ledger-empty">
          <p>Budgeting is configured, but its active period needs attention.</p>
          <Link className="text-link" href={budgetPeriodsHref}>Review period history <span aria-hidden="true">→</span></Link>
        </div>
      ) : (
        <>
          <section className="overview-summary" aria-label="Budget summary">
            <div className="overview-summary__primary">
              <span className="technical-label">Remaining</span>
              <strong>{formatSignedRupiah(snapshot.period.remaining)}</strong>
              <span>
                {snapshot.period.name} · {formatCalendarDate(snapshot.period.startsOn)} – {formatCalendarDate(snapshot.period.endsOn)}
              </span>
            </div>
            <div>
              <span className="technical-label">Safe daily</span>
              <strong>
                <SafeDaily
                  endsOn={snapshot.period.endsOn}
                  remaining={snapshot.period.remaining}
                  startsOn={snapshot.period.startsOn}
                />
              </strong>
              <span>Through {formatCalendarDate(snapshot.period.endsOn)}</span>
            </div>
            <div>
              <span className="technical-label">Net spent</span>
              <strong>{formatSignedRupiah(snapshot.period.netSpent)}</strong>
              <span>Of {formatRupiah(snapshot.period.totalBudget)} total budget</span>
            </div>
          </section>
          {snapshot.recurring.dueCount > 0 ? (
            <Link className="text-link overview-budget__recurring" href={`${budgetHref}/subscriptions`}>
              Recurring planning · {snapshot.recurring.dueCount} due · {formatRupiah(snapshot.recurring.expectedAmount)} expected <span aria-hidden="true">→</span>
            </Link>
          ) : null}
        </>
      )}
    </section>
  );
}
