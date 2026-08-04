import { formatRupiah } from "@/domain/rupiah";
import type { DebtorStatement } from "@/domain/debtor-statement";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(value);
}

export function DebtorStatementView({ statement, expiresAt }: { statement: DebtorStatement; expiresAt: Date }) {
  return (
    <main className="debtor-statement" id="top">
      <div className="debtor-statement__field" aria-hidden="true" />
      <div className="editorial-shell debtor-statement__shell">
        <header className="debtor-statement__header">
          <p className="technical-label">READ-ONLY BALANCE</p>
          <p className="debtor-statement__brand">Zplit</p>
        </header>
        <section className="debtor-statement__intro">
          <p className="technical-label">BALANCE STATEMENT</p>
          <h1>{statement.friendName}</h1>
          <p className="debtor-statement__lede">A clear record of assigned shares and repayments allocated to them.</p>
        </section>
        <section className="debtor-statement__summary" aria-label="Balance summary">
          <div className="debtor-statement__primary"><span className="technical-label">Outstanding</span><strong>{formatRupiah(statement.outstandingAmount)}</strong></div>
          <div><span className="technical-label">Assigned</span><strong>{formatRupiah(statement.assignedAmount)}</strong></div>
          <div><span className="technical-label">Repaid</span><strong>{formatRupiah(statement.repaidAmount)}</strong></div>
        </section>
        <section className="debtor-statement__items" aria-labelledby="debtor-items-heading">
          <div className="debtor-statement__items-heading"><h2 id="debtor-items-heading">Expense shares</h2><span className="technical-label">{statement.items.length} items</span></div>
          {statement.items.length ? <div className="debtor-statement__list">{statement.items.map((item, index) => (
            <article className="debtor-statement__item" key={`${item.expenseDescription}-${item.outingOccurredAt.toISOString()}-${index}`}>
              <div className="debtor-statement__item-heading"><div><h3>{item.expenseDescription}</h3><p>{item.outingTitle} · <time dateTime={item.outingOccurredAt.toISOString()}>{formatDate(item.outingOccurredAt)}</time></p></div><strong className={`debtor-statement__state debtor-statement__state--${item.state}`}>{item.state === "open" ? "OPEN" : "SETTLED"}</strong></div>
              <dl className="debtor-statement__item-values">
                <div><dt>Assigned</dt><dd>{formatRupiah(item.assignedAmount)}</dd></div>
                <div><dt>Allocated repayments</dt><dd>{formatRupiah(item.repaidAmount)}</dd></div>
                <div><dt>Remaining</dt><dd>{formatRupiah(item.remainingAmount)}</dd></div>
              </dl>
            </article>
          ))}</div> : <p className="debtor-statement__empty">No assigned expense shares are recorded.</p>}
        </section>
        <footer className="debtor-statement__footer">
          <p>Link expires <time dateTime={expiresAt.toISOString()}>{formatDate(expiresAt)}</time>.</p>
          <p>The ledger owner controls the records shown here. This page is read-only.</p>
          <p className="technical-label">Generated {formatDate(statement.generatedAt)}</p>
        </footer>
      </div>
    </main>
  );
}
