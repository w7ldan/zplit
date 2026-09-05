import Link from "next/link";
import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { getAuthenticatedOrganizationLedger } from "@/server/authenticated-ledger";
import {
  LedgerNotFoundError,
  deletionImpactRevision,
} from "@/domain/ledger-repository";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { ExpenseShareEditor } from "@/components/expenses/expense-share-editor";
import { ExpenseReceipts } from "@/components/expenses/expense-receipts";
import { DeleteRecordForm } from "@/components/app/delete-record-form";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { formatRupiah } from "@/domain/rupiah";
import { listExpenseReceipts } from "@/server/expense-receipts";
import {
  deleteExpenseAction,
  replaceExpenseSharesAction,
  searchExpenseFriendOptions,
  searchOutingOptions,
  updateExpenseAction,
} from "../../ledger-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organization expense details" };

export default async function OrganizationExpensePage({
  params,
}: {
  params: Promise<{ organizationId: string; expenseId: string }>;
}) {
  const { organizationId, expenseId } = await params;
  const base = `/app/organizations/${organizationId}`;
  const access = await getAuthenticatedOrganizationLedger(
    organizationId,
    "ledger.view",
  );
  let expense;
  try {
    expense = await access.ledger.getExpense(expenseId);
  } catch (error) {
    if (error instanceof LedgerNotFoundError) notFound();
    throw error;
  }
  const [
    outingRows,
    friendRows,
    shares,
    charges,
    receipts,
    previousSplit,
    impact,
  ] = await Promise.all([
    access.ledger.searchOutings({ selectedId: expense.outingId }),
    access.ledger.searchFriends({ activeOnly: true }),
    access.ledger.listExpenseShares(expense.id),
    access.ledger.listExpenseCharges(expense.id),
    listExpenseReceipts(
      getDatabase(),
      { ledgerScopeId: access.ledgerScopeId },
      expense.id,
    ),
    access.ledger.getPreviousExpenseSplit(expense.id),
    access.ledger.getExpenseDeletionImpact(expense.id),
  ]);
  const shareByFriend = new Map(shares.map((share) => [share.friendId, share]));
  const friends = shares.map((share) => ({
    id: share.friendId,
    name: share.friendName,
    archivedAt: share.friendArchivedAt,
    baseAmount: share.baseAmount,
    amountOwed: share.amountOwed,
    expenseShareId: share.id,
    remainingAmount: share.remainingAmount,
    settled: share.settled,
  }));
  const friendOptions = friendRows
    .filter((friend) => !friend.archived && !shareByFriend.has(friend.id))
    .slice(0, 20)
    .map((friend) => ({ id: friend.id, label: friend.name }));
  const outings = outingRows.map((outing) => ({
    id: outing.id,
    label: outing.title,
  }));
  const canEdit = access.can("expenses.edit") && !access.archivedAt;
  return (
    <section className="app-page expense-record" id="top">
      <div className="editorial-grid editorial-shell expense-record__layout">
        <div className="expense-record__intro">
          <p className="technical-label">
            Organization Expense · assign shares
          </p>
          <h1>{expense.description}</h1>
          <Link className="expense-record__back" href={`${base}/expenses`}>
            ← Back to expenses
          </Link>
        </div>
        <div className="expense-record__tasks">
          <div className="expense-record__primary-task">
            <div
              className="expense-record__shares"
              id="friend-shares"
              tabIndex={-1}
            >
              {canEdit ? (
                <ExpenseShareEditor
                  action={replaceExpenseSharesAction.bind(
                    null,
                    organizationId,
                    expense.id,
                  )}
                  expenseAmount={expense.amount}
                  friends={friends}
                  charges={charges.map((charge) => ({
                    name: charge.name,
                    percentageBasisPoints: charge.percentageBasisPoints,
                    scope: charge.scope,
                    friendIds: charge.friendIds,
                  }))}
                  friendOptions={friendOptions}
                  searchFriends={searchExpenseFriendOptions.bind(
                    null,
                    organizationId,
                  )}
                  basePath={base}
                  previousSplit={
                    previousSplit
                      ? {
                          friends: previousSplit.friends.map((friend) => ({
                            id: friend.friendId,
                            name: friend.friendName,
                            archivedAt: friend.friendArchivedAt,
                            baseAmount: friend.baseAmount,
                          })),
                          charges: previousSplit.charges.map((charge) => ({
                            name: charge.name,
                            percentageBasisPoints: charge.percentageBasisPoints,
                            scope: charge.scope,
                            friendIds: charge.friendIds,
                          })),
                        }
                      : null
                  }
                />
              ) : (
                <p className="app-page__lede">
                  Expense shares are read-only for your current Organization
                  access.
                </p>
              )}
            </div>
            <ExpenseReceipts
              expenseId={expense.id}
              initialReceipts={receipts.map((receipt) => ({
                ...receipt,
                createdAt: receipt.createdAt.toISOString(),
              }))}
              basePath={`${base}/expenses`}
              canEdit={canEdit}
            />
          </div>
          <aside className="expense-record__sidebar">
            <div className="expense-record__controls">
              <div className="expense-record__meta">
                <div>
                  <span className="technical-label">Amount</span>
                  <strong>{formatRupiah(expense.amount)}</strong>
                </div>
                <div>
                  <span className="technical-label">Outing</span>
                  <span>{expense.outingTitle}</span>
                </div>
                <div>
                  <span className="technical-label">Date</span>
                  <LocalDateTime iso={expense.outingOccurredAt.toISOString()} />
                </div>
              </div>
              {canEdit ? (
                <div className="expense-record__form">
                  <p className="technical-label">EDIT RECORD</p>
                  <ExpenseForm
                    action={updateExpenseAction.bind(
                      null,
                      organizationId,
                      expense.id,
                    )}
                    outings={outings}
                    searchOutings={searchOutingOptions.bind(
                      null,
                      organizationId,
                    )}
                    mode="edit"
                    initialValues={{
                      description: expense.description,
                      amountRupiah: expense.amount.toString(),
                      outingId: expense.outingId,
                    }}
                  />
                </div>
              ) : null}
              {access.can("expenses.delete") ? (
                <DeleteRecordForm
                  action={deleteExpenseAction.bind(
                    null,
                    organizationId,
                    expense.id,
                  )}
                  recordType="expense"
                  impact={impact}
                  impactRevision={deletionImpactRevision(impact)}
                />
              ) : null}
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
