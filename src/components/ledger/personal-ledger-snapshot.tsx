import type { LedgerOverviewSummary } from "@/domain/ledger/types";
import { AnimatedMoney } from "@/components/vnext/animated-money";

export function PersonalLedgerSnapshot({ summary }: { summary: LedgerOverviewSummary }) {
  return (
    <section className="personal-ledger-summary" aria-label="Personal ledger summary">
      <div className="personal-ledger-summary__primary">
        <span className="technical-label">Still owed to you</span>
        <AnimatedMoney amount={summary.totalOutstandingAmount} label="Still owed to you" tone={summary.totalOutstandingAmount > 0 ? "debt" : "settled"} />
        <span className="personal-ledger-summary__description">Open balances across your friends.</span>
      </div>
      <div className={`personal-ledger-summary__attention${summary.totalUnallocatedRepaymentAmount > 0 ? " personal-ledger-summary__attention--active" : ""}`}>
        <span className="technical-label">Needs allocation</span>
        <AnimatedMoney amount={summary.totalUnallocatedRepaymentAmount} label="Needs allocation" tone={summary.totalUnallocatedRepaymentAmount > 0 ? "debt" : "settled"} />
        <span className="personal-ledger-summary__description">
          {summary.totalUnallocatedRepaymentAmount > 0
            ? "Received money still needs an expense."
            : "All received money is applied to shares."}
        </span>
      </div>
      <div className="personal-ledger-summary__spending">
        <span className="technical-label">Total spending</span>
        <AnimatedMoney amount={summary.totalExpenseAmount} label="Total spending" />
        <span className="personal-ledger-summary__description">All expenses recorded in this ledger.</span>
      </div>
    </section>
  );
}
