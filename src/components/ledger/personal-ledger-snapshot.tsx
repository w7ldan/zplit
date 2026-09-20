import type { LedgerOverviewSummary } from "@/domain/ledger/types";
import { AnimatedMoney } from "@/components/vnext/animated-money";

export function PersonalLedgerSnapshot({ summary }: { summary: LedgerOverviewSummary }) {
  return (
    <section className="overview-summary personal-vnext-summary" aria-label="Personal ledger summary">
      <div className="overview-summary__primary">
        <span className="technical-label">Still owed to you</span>
        <AnimatedMoney amount={summary.totalOutstandingAmount} label="Still owed to you" tone={summary.totalOutstandingAmount > 0 ? "debt" : "settled"} />
        <span>Open balances across your friends.</span>
      </div>
      <div className={summary.totalUnallocatedRepaymentAmount > 0 ? "overview-summary__attention" : undefined}>
        <span className="technical-label">Needs allocation</span>
        <AnimatedMoney amount={summary.totalUnallocatedRepaymentAmount} label="Needs allocation" tone={summary.totalUnallocatedRepaymentAmount > 0 ? "debt" : "settled"} />
        <span>
          {summary.totalUnallocatedRepaymentAmount > 0
            ? "Received money still needs an expense."
            : "All received money is applied to shares."}
        </span>
      </div>
      <div>
        <span className="technical-label">Total spending</span>
        <AnimatedMoney amount={summary.totalExpenseAmount} label="Total spending" />
        <span>All expenses recorded in this ledger.</span>
      </div>
    </section>
  );
}
