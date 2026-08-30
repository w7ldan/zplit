import type { LedgerOverviewSummary } from "@/domain/ledger/types";
import { formatRupiah } from "@/domain/rupiah";

export function PersonalLedgerSnapshot({ summary }: { summary: LedgerOverviewSummary }) {
  return (
    <section className="overview-summary" aria-label="Personal ledger summary">
      <div className="overview-summary__primary">
        <span className="technical-label">Still owed to you</span>
        <strong>{formatRupiah(summary.totalOutstandingAmount)}</strong>
        <span>Open balances across your friends.</span>
      </div>
      <div className={summary.totalUnallocatedRepaymentAmount > 0 ? "overview-summary__attention" : undefined}>
        <span className="technical-label">Needs allocation</span>
        <strong>{formatRupiah(summary.totalUnallocatedRepaymentAmount)}</strong>
        <span>
          {summary.totalUnallocatedRepaymentAmount > 0
            ? "Received money still needs an expense."
            : "All received money is applied to shares."}
        </span>
      </div>
      <div>
        <span className="technical-label">Total spending</span>
        <strong>{formatRupiah(summary.totalExpenseAmount)}</strong>
        <span>All expenses recorded in this ledger.</span>
      </div>
    </section>
  );
}
