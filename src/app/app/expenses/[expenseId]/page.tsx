import Link from "next/link";
import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { ExpenseShareEditor } from "@/components/expenses/expense-share-editor";
import { ExpenseReceipts } from "@/components/expenses/expense-receipts";
import { formatRupiah } from "@/domain/rupiah";
import { deletionImpactRevision, LedgerNotFoundError } from "@/domain/ledger-repository";
import { getAuthenticatedLedger } from "@/server/authenticated-ledger";
import { listExpenseReceipts } from "@/server/expense-receipts";
import { replaceExpenseSharesAction, searchExpenseFriendOptions, searchOutingOptions, updateExpenseAction } from "../actions";
import { RecordConfirmation } from "@/components/app/record-confirmation";
import { DeleteRecordForm } from "@/components/app/delete-record-form";
import { deleteExpenseAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Expense details" };

export default async function ExpenseRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ expenseId: string }>;
  searchParams?: Promise<{
    created?: string | string[];
    updated?: string | string[];
    splitSaved?: string | string[];
  }>;
}) {
  const session = await requireSession();
  const { expenseId } = await params;
  const query = await searchParams;
  const database = getDatabase();
  const { ledger: repository } = await getAuthenticatedLedger(session);
  let expense;
  try {
    expense = await repository.getExpense(expenseId);
  } catch (error) {
    if (error instanceof LedgerNotFoundError) notFound();
    throw error;
  }
  const deletionImpact = await repository.getExpenseDeletionImpact(expenseId);
  const currentImpactRevision = deletionImpactRevision(deletionImpact);
  const [outingRows, friendOptionRows, shares, charges, receipts, previousSplit] = await Promise.all([
    repository.searchOutings({ selectedId: expense.outingId }),
    repository.searchFriends({ activeOnly: true }),
    repository.listExpenseShares(expense.id),
    repository.listExpenseCharges(expense.id),
    listExpenseReceipts(database, session.user.id, expense.id),
    repository.getPreviousExpenseSplit(expense.id),
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
  const assignedAmount = shares.reduce((total, share) => total + share.amountOwed, 0);
  const splitMessage = shares.length === 0
    ? "Split saved · No friend shares assigned"
    : `Split saved · ${formatRupiah(assignedAmount)} assigned to ${shares.length} friend${shares.length === 1 ? "" : "s"}`;
  const friendOptions = friendOptionRows
    .filter((friend) => !friend.archived && !shareByFriend.has(friend.id))
    .slice(0, 20)
    .map((friend) => ({ id: friend.id, label: friend.name }));
  const outings = outingRows.map((outing) => ({ id: outing.id, label: outing.title }));

  return (
    <section className="app-page expense-record" id="top">
      <div className="editorial-grid editorial-shell expense-record__layout">
        <div className="expense-record__intro">
          <p className="technical-label">Expense · assign shares</p>
          <h1>{expense.description}</h1>
          <Link className="expense-record__back" href="/app/expenses">← Back to expenses</Link>
        </div>
        {query?.created === "1" ? (
          <RecordConfirmation
            queryKey="created"
            message={`Expense saved · ${formatRupiah(expense.amount)}`}
            focusTargetId="friend-shares"
          />
        ) : query?.updated === "1" ? (
          <RecordConfirmation
            queryKey="updated"
            message={`Expense updated · ${formatRupiah(expense.amount)}`}
            focusTargetId="expense-details"
          />
        ) : query?.splitSaved === "1" ? (
          <RecordConfirmation
            queryKey="splitSaved"
            message={splitMessage}
            focusTargetId="friend-shares"
          />
        ) : null}
        <div className="expense-record__tasks">
          <div className="expense-record__primary-task">
            <div className="expense-record__shares" id="friend-shares" tabIndex={-1}>
              <ExpenseShareEditor
                action={replaceExpenseSharesAction.bind(null, expense.id)}
                expenseAmount={expense.amount}
                friends={friends}
                charges={charges.map((charge) => ({
                  name: charge.name,
                  percentageBasisPoints: charge.percentageBasisPoints,
                  scope: charge.scope,
                  friendIds: charge.friendIds,
                }))}
                friendOptions={friendOptions}
                searchFriends={searchExpenseFriendOptions}
                previousSplit={previousSplit ? {
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
                } : null}
              />
            </div>
            <ExpenseReceipts
              expenseId={expense.id}
              initialReceipts={receipts.map((receipt) => ({
                ...receipt,
                createdAt: receipt.createdAt.toISOString(),
              }))}
            />
          </div>
          <aside className="expense-record__sidebar">
            <div className="expense-record__controls">
              <div className="expense-record__meta" aria-label="Expense metadata">
                <div>
                  <span className="technical-label">Amount</span>
                  <strong>{formatRupiah(expense.amount)}</strong>
                </div>
                <div>
                  <span className="technical-label">Outing</span>
                  <span>{expense.outingTitle}</span>
                </div>
                <div>
                  <span className="technical-label">Outing date</span>
                  <LocalDateTime iso={expense.outingOccurredAt.toISOString()} />
                </div>
                <div>
                  <span className="technical-label">Created</span>
                  <LocalDateTime iso={expense.createdAt.toISOString()} mode="date" />
                </div>
              </div>
              <div className="expense-record__form">
                <p className="technical-label" id="expense-details" tabIndex={-1}>EDIT RECORD</p>
                <ExpenseForm
                  action={updateExpenseAction.bind(null, expense.id)}
                  outings={outings}
                  searchOutings={searchOutingOptions}
                  mode="edit"
                  initialValues={{ description: expense.description, amountRupiah: expense.amount.toString(), outingId: expense.outingId }}
                />
              </div>
              <DeleteRecordForm
                action={deleteExpenseAction.bind(null, expense.id)}
                recordType="expense"
                impact={deletionImpact}
                impactRevision={currentImpactRevision}
              />
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
