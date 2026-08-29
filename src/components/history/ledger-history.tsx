import Link from "next/link";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { formatRupiah } from "@/domain/rupiah";
import type { LedgerHistoryEvent, LedgerHistoryType } from "@/domain/ledger-history";

type LedgerHistoryProps = {
  items: readonly LedgerHistoryEvent[];
  type: LedgerHistoryType;
  nextCursor: string | null;
};

function filterHref(type: LedgerHistoryType) {
  return type === "all" ? "/app/history" : `/app/history?type=${type}`;
}
export function LedgerHistory({ items, type, nextCursor }: LedgerHistoryProps) {
  const emptyAction = type === "repayment" ? { href: "/app/repayments?create=1", label: "Record repayment" } : { href: "/app/expenses?create=1", label: "Add expense" };
  return (
    <>
      <nav className="history-filters" aria-label="History filters">
        {(["all", "expense", "repayment"] as const).map((value) => (
          <Link key={value} href={filterHref(value)} aria-current={type === value ? "page" : undefined} className={type === value ? "history-filters__link history-filters__link--selected" : "history-filters__link"}>
            {value === "all" ? "All" : value === "expense" ? "Expenses" : "Repayments"}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <div className="ledger-empty history-empty">
          <h2>No ledger history yet.</h2>
          <p>Expenses and repayments will appear here in chronological order.</p>
          <Link className="text-link" href={emptyAction.href}>{emptyAction.label} <span aria-hidden="true">→</span></Link>
        </div>
      ) : (
        <ol className="history-list" aria-label="Ledger history">
          {items.map((item) => item.type === "expense" ? (
            <li className="history-row" key={`expense-${item.id}`}>
              <Link href={`/app/expenses/${item.id}`} className="history-row__link">
                <span className="technical-label">EXPENSE</span>
                <span className="history-row__main"><strong>{item.description}</strong><span>{item.outingTitle} · <LocalDateTime iso={item.outingOccurredAt.toISOString()} mode="date" /></span></span>
                <span className="history-row__values">
                  <span>
                    <small>Total</small>
                    <strong>{formatRupiah(item.totalAmount)}</strong>
                  </span>
                  <span>
                    <small>Assigned</small>
                    <strong>{formatRupiah(item.assignedAmount)}</strong>
                  </span>
                  <span>
                    <small>Owner portion</small>
                    <strong>{formatRupiah(item.ownerPortionAmount)}</strong>
                  </span>
                </span>
              </Link>
            </li>
          ) : (
            <li className="history-row" key={`repayment-${item.id}`}>
              <Link href={`/app/repayments/${item.id}`} className="history-row__link">
                <span className="technical-label">REPAYMENT</span>
                <span className="history-row__main"><strong>{item.friendName}</strong><span><LocalDateTime iso={item.paidAt.toISOString()} mode="date" /></span></span>
                <span className="history-row__values">
                  <span>
                    <small>Received</small>
                    <strong>{formatRupiah(item.totalAmount)}</strong>
                  </span>
                  <span>
                    <small>Allocated</small>
                    <strong>{formatRupiah(item.allocatedAmount)}</strong>
                  </span>
                  <span>
                    <small>Unallocated</small>
                    <strong>{formatRupiah(item.unallocatedAmount)}</strong>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
      {nextCursor ? <Link className="history-next" href={`/app/history?type=${type}&cursor=${encodeURIComponent(nextCursor)}`}>Next page <span aria-hidden="true">→</span></Link> : null}
    </>
  );
}
