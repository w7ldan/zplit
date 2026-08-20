import Link from "next/link";
import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { createLedgerRepository, LedgerNotFoundError } from "@/domain/ledger-repository";
import { FriendArchiveForm, FriendForm } from "@/components/friends/friend-form";
import { FriendShareLink } from "@/components/friends/friend-share-link";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { RecordConfirmation } from "@/components/app/record-confirmation";
import { formatRupiah } from "@/domain/rupiah";
import { recordHref } from "@/domain/record-retrieval";
import { RecordPagination } from "@/components/records/record-pagination";
import { archiveFriendAction, restoreFriendAction, undoFriendArchiveAction, updateFriendAction } from "../actions";
import { createDebtorShareLinkAction, revokeDebtorShareLinkAction, updateDebtorShareReceiptSelectionAction } from "./share-actions";
import { getDebtorShareLinkStatus, getDebtorShareReceiptSelection } from "@/server/debtor-share-links";

export const dynamic = "force-dynamic";
export const metadata = { title: "Friend details" };

type FriendSearchParams = { [key: string]: string | string[] | undefined };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function FriendRecordPage({ params, searchParams }: { params: Promise<{ friendId: string }>; searchParams?: Promise<FriendSearchParams> }) {
  const session = await requireSession();
  const { friendId } = await params;
  const query = await searchParams;
  let friend;
  let shareStatus;
  let eligibleReceipts;
  let selectedReceiptIds;
  let balance = { assignedAmount: 0, repaidAmount: 0, outstandingAmount: 0 };
  let expenseSharePage;
  let repaymentPage;
  try {
    const database = getDatabase();
    const repository = createLedgerRepository(database, session.user.id);
    friend = await repository.getFriend(friendId);
    const [friendBalances, nextShareStatus, nextEligibleReceipts, nextSelectedReceiptIds, nextExpenseSharePage, nextRepaymentPage] = await Promise.all([
      repository.getFriendBalances([friend.id]),
      getDebtorShareLinkStatus(database, session.user.id, friendId),
      repository.listEligibleDebtorShareReceipts(friendId),
      getDebtorShareReceiptSelection(database, session.user.id, friendId),
      repository.listFriendExpenseShareRecords(friend.id, { page: first(query?.expensePage) }),
      repository.listRepaymentRecords({ friendId: friend.id, page: first(query?.repaymentPage) }),
    ]);
    balance = friendBalances[0] ?? { assignedAmount: 0, repaidAmount: 0, outstandingAmount: 0 };
    shareStatus = nextShareStatus;
    eligibleReceipts = nextEligibleReceipts;
    selectedReceiptIds = nextSelectedReceiptIds;
    expenseSharePage = nextExpenseSharePage;
    repaymentPage = nextRepaymentPage;
  } catch (error) {
    if (error instanceof LedgerNotFoundError) notFound();
    throw error;
  }

  const archived = friend.archivedAt !== null;
  const historyHref = recordHref(`/app/friends/${friend.id}`, query ?? {}, { saved: undefined });
  return (
    <section className="app-page friend-record" id="top">
      <div className="editorial-grid editorial-shell friend-record__layout">
        <div className="friend-record__intro">
          <div className="friend-record__title">
            <p className="technical-label">Friend · editable record</p>
            <h1>{friend.name}</h1>
          </div>
          <div className="friend-record__actions">
            <Link className="action-link action-link--quiet" href={`/app/repayments?create=1&friendId=${friend.id}`}>Record repayment</Link>
            {balance.outstandingAmount > 0 ? <Link className="action-link action-link--quiet" href={`/app/repayments?create=1&friendId=${friend.id}&amount=${balance.outstandingAmount}&strategy=oldest`}>Settle {formatRupiah(balance.outstandingAmount)}</Link> : null}
            <Link className="friend-record__back" href="/app/friends">← Back to friends</Link>
          </div>
        </div>
        {query?.saved === "1" ? <RecordConfirmation queryKey="saved" message="Friend changes saved." /> : null}
        <section className="friend-record__summary" aria-label="Friend summary">
          <section className={`friend-record__balance${balance.assignedAmount === 0 ? " friend-record__balance--empty" : balance.outstandingAmount === 0 ? " friend-record__balance--settled" : ""}`} aria-labelledby="friend-balance-heading">
            <h2 id="friend-balance-heading">Balance</h2>
            <div className="friend-record__balance-primary">
              {balance.assignedAmount === 0 ? <strong>No balance yet</strong> : balance.outstandingAmount === 0 ? <strong>Settled</strong> : <><span className="technical-label">Still owes</span><strong>{formatRupiah(balance.outstandingAmount)}</strong></>}
            </div>
            <dl>
              <div><dt>Assigned</dt><dd>{formatRupiah(balance.assignedAmount)}</dd></div>
              <div><dt>Applied</dt><dd>{formatRupiah(balance.repaidAmount)}</dd></div>
              {balance.outstandingAmount === 0 ? <div><dt>Still owes</dt><dd>{formatRupiah(balance.outstandingAmount)}</dd></div> : null}
            </dl>
          </section>
          <div className="friend-record__meta" aria-label="Friend metadata">
            <div><span className="technical-label">Record state</span><strong>{archived ? "ARCHIVED" : "ACTIVE"}</strong></div>
            <div><span className="technical-label">Created</span><LocalDateTime iso={friend.createdAt.toISOString()} mode="date" /></div>
          </div>
        </section>
        <div className="friend-record__workspace">
          <div className="friend-record__form">
            <p className="technical-label">EDIT RECORD</p>
            <FriendForm
              action={updateFriendAction.bind(null, friend.id)}
              mode="edit"
              initialValues={{ name: friend.name, phoneNumber: friend.phoneNumber ?? "", notes: friend.notes ?? "" }}
            />
            <FriendArchiveForm action={(archived ? restoreFriendAction : archiveFriendAction).bind(null, friend.id)} archived={archived} undoAction={undoFriendArchiveAction} />
          </div>
          <FriendShareLink
            status={{ status: shareStatus.status, expiresAt: shareStatus.expiresAt?.toISOString() ?? null }}
            phoneNumber={friend.phoneNumber}
            createAction={createDebtorShareLinkAction.bind(null, friend.id)}
            revokeAction={revokeDebtorShareLinkAction.bind(null, friend.id)}
            updateSelectionAction={updateDebtorShareReceiptSelectionAction.bind(null, friend.id)}
            eligibleReceipts={eligibleReceipts}
            selectedReceiptIds={selectedReceiptIds}
          />
        </div>
        <section className="record-history ledger-section" id="friend-expense-shares" aria-labelledby="friend-expense-shares-heading">
          <div className="ledger-section__heading"><div><p className="technical-label">SHARE HISTORY</p><h2 id="friend-expense-shares-heading">Expense shares</h2></div><span className="technical-label">{expenseSharePage.totalItems} entries</span></div>
          {expenseSharePage.items.length > 0 ? <div className="record-history__rows">{expenseSharePage.items.map((share) => <article className="record-history__row record-history__row--share" key={share.id}>
            <div className="record-history__primary"><span className="technical-label">EXPENSE SHARE</span><h3><Link href={`/app/expenses/${share.expenseId}`}>{share.expenseDescription}</Link></h3><p>{share.outingTitle} · <LocalDateTime iso={share.outingOccurredAt.toISOString()} mode="date" /></p></div>
            <div className="record-history__values"><span><span className="technical-label">Assigned</span><strong>{formatRupiah(share.amountOwed)}</strong></span><span><span className="technical-label">Applied</span><strong>{formatRupiah(share.appliedAmount)}</strong></span><span><span className="technical-label">Remaining</span><strong>{formatRupiah(share.remainingAmount)}</strong></span></div>
            <span className={`record-history__state${share.settled ? " record-history__state--settled" : ""}`}>{share.settled ? "SETTLED" : "OPEN"}</span>
            <div className="record-history__links"><Link className="record-history__link" href={`/app/expenses/${share.expenseId}`}>Open expense <span aria-hidden="true">→</span></Link>{!share.settled && share.id ? <Link className="record-history__link" href={`/app/repayments?create=1&friendId=${friend.id}&expenseShareId=${share.id}`}>Record repayment <span aria-hidden="true">→</span></Link> : null}</div>
          </article>)}</div> : <div className="ledger-empty"><h3>No expense shares recorded for this friend yet.</h3></div>}
          <RecordPagination page={expenseSharePage.page} pageSize={expenseSharePage.pageSize} totalItems={expenseSharePage.totalItems} totalPages={expenseSharePage.totalPages} href={historyHref} anchor="friend-expense-shares" pageParam="expensePage" />
        </section>
        <section className="record-history ledger-section" id="friend-repayments" aria-labelledby="friend-repayments-heading">
          <div className="ledger-section__heading"><div><p className="technical-label">REPAYMENT HISTORY</p><h2 id="friend-repayments-heading">Repayments</h2></div><span className="technical-label">{repaymentPage.totalItems} entries</span></div>
          {repaymentPage.items.length > 0 ? <div className="record-history__rows">{repaymentPage.items.map((repayment) => <article className="record-history__row record-history__row--repayment" key={repayment.id}>
            <div className="record-history__primary"><span className="technical-label">REPAYMENT</span><h3><Link href={`/app/repayments/${repayment.id}`}><LocalDateTime iso={repayment.paidAt.toISOString()} mode="date" /></Link></h3></div>
            <div className="record-history__values"><span><span className="technical-label">Received</span><strong>{formatRupiah(repayment.amount)}</strong></span><span><span className="technical-label">Method</span><strong>{repayment.paymentMethod ?? "—"}</strong></span><span><span className="technical-label">Allocation</span><strong>{formatRupiah(repayment.allocatedAmount)} applied · {formatRupiah(repayment.unallocatedAmount)} unallocated</strong></span></div>
            <Link className="record-history__link" href={`/app/repayments/${repayment.id}`}>Open repayment <span aria-hidden="true">→</span></Link>
          </article>)}</div> : <div className="ledger-empty"><h3>No repayments recorded for this friend yet.</h3></div>}
          <RecordPagination page={repaymentPage.page} pageSize={repaymentPage.pageSize} totalItems={repaymentPage.totalItems} totalPages={repaymentPage.totalPages} href={historyHref} anchor="friend-repayments" pageParam="repaymentPage" />
        </section>
      </div>
    </section>
  );
}
