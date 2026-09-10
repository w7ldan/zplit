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
    <section className="ledger-section overview-budget" aria-labelledby="budget-overview-heading">
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
          <div className="overview-budget__metrics">
            <div>
              <span className="overview-budget__label">Remaining</span>
              <strong>{formatSignedRupiah(snapshot.period.remaining)}</strong>
              <small>{snapshot.period.name}</small>
            </div>
            <div>
              <span className="overview-budget__label">Net spent</span>
              <strong>{formatSignedRupiah(snapshot.period.netSpent)}</strong>
            </div>
            <div>
              <span className="overview-budget__label">Safe daily</span>
              <SafeDaily
                endsOn={snapshot.period.endsOn}
                remaining={snapshot.period.remaining}
                startsOn={snapshot.period.startsOn}
              />
            </div>
          </div>
          <p className="overview-budget__note">
            <span>{formatCalendarDate(snapshot.period.startsOn)} – {formatCalendarDate(snapshot.period.endsOn)}</span>
            <span>Private to you · separate from Shared Money</span>
          </p>
          {snapshot.recurring.dueCount > 0 ? (
            <Link className="text-link overview-budget__recurring" href={`${budgetHref}/subscriptions`}>
              Recurring planning · {snapshot.recurring.dueCount} due · {formatRupiah(snapshot.recurring.expectedAmount)} expected
            </Link>
          ) : null}
        </>
      )}
    </section>
  );
}
