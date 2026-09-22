import { formatRupiah } from "@/domain/rupiah";
import { DEBTOR_STATEMENT_PAGE_SIZE, type DebtorStatement, type DebtorStatementPage } from "@/domain/debtor-statement";
import { LocalDateTime, SourceCalendarDate } from "@/components/editorial/local-date-time";
import { ReceiptPreview } from "@/components/records/receipt-preview";
import { destinationTypeLabel } from "@/domain/repayment-destination";
import { zplitVNextFont } from "@/app/fonts";
import { CopyRepaymentDestination } from "./copy-repayment-destination";

function pageHref(
  token: string,
  anchor: string,
  expensePage: number,
  repaymentPage: number,
  change: { expensePage?: number; repaymentPage?: number },
) {
  const query = new URLSearchParams();
  const nextExpensePage = change.expensePage ?? expensePage;
  const nextRepaymentPage = change.repaymentPage ?? repaymentPage;
  if (nextExpensePage > 1) query.set("expensePage", String(nextExpensePage));
  if (nextRepaymentPage > 1) query.set("repaymentPage", String(nextRepaymentPage));
  const search = query.toString();
  return `/share/${token}${search ? `?${search}` : ""}#${anchor}`;
}

function Pagination({
  label,
  anchor,
  token,
  page,
  totalPages,
  expensePage,
  repaymentPage,
}: {
  label: string;
  anchor: string;
  token: string;
  page: "expense" | "repayment";
  totalPages: number;
  expensePage: number;
  repaymentPage: number;
}) {
  if (totalPages <= 1) return null;
  const currentPage = page === "expense" ? expensePage : repaymentPage;
  const change = (nextPage: number) =>
    page === "expense" ? { expensePage: nextPage } : { repaymentPage: nextPage };
  return (
    <nav className="debtor-statement__pagination" aria-label={`${label} pagination`}>
      <span className="debtor-statement__pagination-summary">Page {currentPage} of {totalPages}</span>
      <span className="debtor-statement__pagination-links">
        {currentPage > 1 ? <a className="debtor-statement__pagination-control" href={pageHref(token, anchor, expensePage, repaymentPage, change(currentPage - 1))}>Previous</a> : <span className="debtor-statement__pagination-control" aria-disabled="true">Previous</span>}
        {currentPage < totalPages ? <a className="debtor-statement__pagination-control" href={pageHref(token, anchor, expensePage, repaymentPage, change(currentPage + 1))}>Next</a> : <span className="debtor-statement__pagination-control" aria-disabled="true">Next</span>}
      </span>
    </nav>
  );
}

export function DebtorStatementView({ statement, expiresAt, token = "" }: { statement: DebtorStatement; expiresAt: Date; token?: string }) {
  const expensePage: DebtorStatementPage<DebtorStatement["items"][number]> = statement.expensePage ?? {
    items: statement.items,
    page: 1,
    pageSize: DEBTOR_STATEMENT_PAGE_SIZE,
    totalItems: statement.items.length,
    totalPages: 1,
  };
  const repaymentItems = statement.repayments ?? [];
  const repaymentPage: DebtorStatementPage<typeof repaymentItems[number]> = statement.repaymentPage ?? {
    items: repaymentItems,
    page: 1,
    pageSize: DEBTOR_STATEMENT_PAGE_SIZE,
    totalItems: repaymentItems.length,
    totalPages: 1,
  };
  return (
    <main className={`debtor-statement zplit-vnext ${zplitVNextFont.variable}`} id="top">
      <div className="debtor-statement__field" aria-hidden="true" />
      <div className="editorial-shell debtor-statement__shell">
        <header className="debtor-statement__header">
          <p className="technical-label">READ-ONLY BALANCE</p>
          <p className="debtor-statement__brand">Zplit</p>
        </header>
        <section className="debtor-statement__intro">
          <div>
            <p className="technical-label">BALANCE STATEMENT</p>
            <h1>{statement.friendName}</h1>
          </div>
          <p className="debtor-statement__lede">A temporary, read-only record of assigned shares and repayments.</p>
          <p className="debtor-statement__intro-note">No Zplit account is needed to view this link.</p>
        </section>
        <section className="debtor-statement__summary" aria-label="Balance summary">
          <div className="debtor-statement__primary">
            <span className="technical-label">Outstanding</span>
            <strong>{formatRupiah(statement.outstandingAmount)}</strong>
            <p>Current balance remaining</p>
          </div>
          <dl className="debtor-statement__summary-support">
            <div className="debtor-statement__metric debtor-statement__metric--assigned">
              <dt>Assigned</dt>
              <dd>{formatRupiah(statement.assignedAmount)}</dd>
            </div>
            <div className="debtor-statement__metric debtor-statement__metric--repaid">
              <dt>Repaid</dt>
              <dd>{formatRupiah(statement.repaidAmount)}</dd>
            </div>
          </dl>
        </section>
        <div className={`debtor-statement__workspace${statement.repaymentDestinations?.length ? " debtor-statement__workspace--with-destinations" : ""}`}>
          {statement.repaymentDestinations?.length ? (
            <section
              className="debtor-statement__destinations"
              id="repay-to"
              aria-labelledby="debtor-destinations-heading"
              aria-describedby="debtor-destinations-note"
            >
              <div className="debtor-statement__section-heading">
                <div>
                  <p className="technical-label">OPTIONAL INSTRUCTIONS</p>
                  <h2 id="debtor-destinations-heading">Repay to</h2>
                </div>
                <span className="technical-label">{statement.repaymentDestinations.length} shared</span>
              </div>
              <p id="debtor-destinations-note" className="debtor-statement__section-note">Only destinations intentionally shared by the ledger owner appear here. Zplit does not process the repayment.</p>
              <div className="debtor-statement__destination-list">
                {statement.repaymentDestinations.map((destination, index) => (
                  <article className="debtor-statement__destination" key={`${destination.name}-${index}`}>
                    <div className="debtor-statement__destination-heading">
                      <div className="debtor-statement__destination-identity">
                        <h3>{destination.name}</h3>
                        <p>{destinationTypeLabel(destination.type)}</p>
                      </div>
                      {destination.accountName ? <p className="debtor-statement__destination-account">{destination.accountName}</p> : null}
                    </div>
                    <CopyRepaymentDestination identifier={destination.identifier} name={destination.name} />
                    {destination.note ? <p className="debtor-statement__destination-note">{destination.note}</p> : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          <div className="debtor-statement__history">
            <section className="debtor-statement__items" id="expense-shares" aria-labelledby="debtor-items-heading">
              <div className="debtor-statement__section-heading">
                <div>
                  <p className="technical-label">WHAT MAKES UP THE BALANCE</p>
                  <h2 id="debtor-items-heading">Expense shares</h2>
                </div>
                <span className="technical-label">{expensePage.totalItems} items</span>
              </div>
              {expensePage.items.length ? <div className="debtor-statement__list">{expensePage.items.map((item, index) => (
                <article className="debtor-statement__item" key={`${item.expenseDescription}-${item.outingOccurredAt.toISOString()}-${index}`}>
                  <div className="debtor-statement__item-heading">
                    <div className="debtor-statement__item-identity">
                      <h3>{item.expenseDescription}</h3>
                      <p>{item.outingTitle} · <SourceCalendarDate canonicalDate={item.outingOccurredOn} timestamp={item.outingOccurredAt.toISOString()} /></p>
                    </div>
                    <strong className={`debtor-statement__state debtor-statement__state--${item.state}`}>{item.state === "open" ? "OPEN" : "SETTLED"}</strong>
                  </div>
                  <dl className="debtor-statement__item-values">
                    <div className="debtor-statement__metric debtor-statement__metric--assigned"><dt>Assigned</dt><dd>{formatRupiah(item.assignedAmount)}</dd></div>
                    <div className="debtor-statement__metric debtor-statement__metric--allocated"><dt>Allocated repayments</dt><dd>{formatRupiah(item.repaidAmount)}</dd></div>
                    <div className="debtor-statement__metric debtor-statement__metric--remaining"><dt>Remaining</dt><dd>{formatRupiah(item.remainingAmount)}</dd></div>
                  </dl>
                  {item.sharedReceipts?.length ? (
                    <section className="debtor-statement__shared-receipts" aria-label="Shared receipts">
                      <div className="debtor-statement__shared-receipts-heading">
                        <h4>Shared receipts</h4>
                        <p>Selected by the ledger owner</p>
                      </div>
                      <ul>
                        {item.sharedReceipts.map((receipt) => <li key={receipt.publicId}><ReceiptPreview href={`/share/${token}/receipts/${receipt.publicId}`} filename={receipt.label} mediaType={receipt.mediaType} triggerLabel={receipt.label} /></li>)}
                      </ul>
                    </section>
                  ) : null}
                </article>
              ))}</div> : <p className="debtor-statement__empty">No assigned expense shares are recorded.</p>}
              <Pagination label="Expense shares" anchor="expense-shares" token={token} page="expense" totalPages={expensePage.totalPages} expensePage={expensePage.page} repaymentPage={repaymentPage.page} />
            </section>
            <section className="debtor-statement__items debtor-statement__repayments" id="repayment-history" aria-labelledby="repayment-history-heading">
              <div className="debtor-statement__section-heading">
                <div>
                  <p className="technical-label">MONEY RECORDED AS PAID</p>
                  <h2 id="repayment-history-heading">Repayment history</h2>
                </div>
                <span className="technical-label">{repaymentPage.totalItems} items</span>
              </div>
              {repaymentPage.items.length ? <div className="debtor-statement__list">{repaymentPage.items.map((repayment, index) => (
                <article className="debtor-statement__repayment" key={`${repayment.paidAt.toISOString()}-${index}`}>
                  <div className="debtor-statement__repayment-heading">
                    <div>
                      <p className="technical-label">PAYMENT RECORD</p>
                      <h3>Paid <SourceCalendarDate canonicalDate={repayment.paidOn} timestamp={repayment.paidAt.toISOString()} /></h3>
                    </div>
                    <span className="debtor-statement__repayment-marker">Recorded repayment</span>
                  </div>
                  <dl className="debtor-statement__item-values debtor-statement__repayment-values">
                    <div className="debtor-statement__metric debtor-statement__metric--amount"><dt>Repayment amount</dt><dd>{formatRupiah(repayment.amount)}</dd></div>
                    <div className="debtor-statement__metric debtor-statement__metric--allocated"><dt>Allocated</dt><dd>{formatRupiah(repayment.allocatedAmount)}</dd></div>
                    <div className="debtor-statement__metric debtor-statement__metric--unallocated"><dt>Unallocated</dt><dd>{formatRupiah(repayment.unallocatedAmount)}</dd></div>
                    <div className="debtor-statement__metric debtor-statement__metric--method"><dt>Payment method</dt><dd>{repayment.paymentMethod ?? "—"}</dd></div>
                  </dl>
                  {repayment.allocations.length ? (
                    <section className="debtor-statement__allocations" aria-label="Allocation targets">
                      <h4>Allocated to</h4>
                      <ul>
                        {repayment.allocations.map((allocation, allocationIndex) => (
                          <li key={`${allocation.expenseDescription}-${allocationIndex}`}>
                            <span>{allocation.expenseDescription} · {allocation.outingTitle}</span>
                            <strong>{formatRupiah(allocation.amount)}</strong>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </article>
              ))}</div> : <p className="debtor-statement__empty">No repayments are recorded.</p>}
              <Pagination label="Repayment history" anchor="repayment-history" token={token} page="repayment" totalPages={repaymentPage.totalPages} expensePage={expensePage.page} repaymentPage={repaymentPage.page} />
            </section>
          </div>
        </div>
        <footer className="debtor-statement__footer">
          <p><strong>Temporary link.</strong> Expires <LocalDateTime iso={expiresAt.toISOString()} mode="date" />.</p>
          <p>The ledger owner controls the records shown here. This page is read-only.</p>
          <p className="technical-label">Generated <LocalDateTime iso={statement.generatedAt.toISOString()} mode="date" /></p>
        </footer>
      </div>
    </main>
  );
}
