import Link from "next/link";
import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { ExpenseShareEditor } from "@/components/expenses/expense-share-editor";
import { formatRupiah } from "@/domain/rupiah";
import { createLedgerRepository, LedgerNotFoundError } from "@/domain/ledger-repository";
import { replaceExpenseSharesAction, updateExpenseAction } from "../actions";
import { RecordConfirmation } from "@/components/app/record-confirmation";

export const dynamic = "force-dynamic";

export default async function ExpenseRecordPage({ params, searchParams }: { params: Promise<{ expenseId: string }>; searchParams?: Promise<{ created?: string | string[]; saved?: string | string[] }> }) {
  const session = await requireSession();
  const { expenseId } = await params;
  const query = await searchParams;
  const repository = createLedgerRepository(getDatabase(), session.user.id);
  let expense;
  try {
    expense = await repository.getExpense(expenseId);
  } catch (error) {
    if (error instanceof LedgerNotFoundError) notFound();
    throw error;
  }
  const outings = await repository.listOutings();
  const [activeFriends, shares] = await Promise.all([repository.listFriends(), repository.listExpenseShares(expense.id)]);
  const shareByFriend = new Map(shares.map((share) => [share.friendId, share]));
  const friends = [
    ...activeFriends.map((friend) => ({
      id: friend.id,
      name: friend.name,
      archivedAt: friend.archivedAt,
      amountOwed: shareByFriend.get(friend.id)?.amountOwed,
    })),
    ...shares
      .filter((share) => share.friendArchivedAt !== null && !activeFriends.some((friend) => friend.id === share.friendId))
      .map((share) => ({ id: share.friendId, name: share.friendName, archivedAt: share.friendArchivedAt, amountOwed: share.amountOwed })),
  ];

  return (
    <section className="app-page expense-record" id="top">
      <div className="editorial-grid editorial-shell expense-record__layout">
        <div className="expense-record__intro">
          <p className="technical-label">Expense · assign shares</p>
          <h1>{expense.description}</h1>
          <Link className="expense-record__back" href="/app/expenses">← Back to expenses</Link>
        </div>
        {query?.created === "1" ? <RecordConfirmation queryKey="created" message="Expense recorded. Assign shares below." /> : query?.saved === "1" ? <RecordConfirmation queryKey="saved" message="Expense changes saved." /> : null}
        <div className="expense-record__meta" aria-label="Expense metadata">
          <div><span className="technical-label">Amount</span><strong>{formatRupiah(expense.amount)}</strong></div>
          <div><span className="technical-label">Outing</span><span>{expense.outingTitle}</span></div>
          <div><span className="technical-label">Outing date</span><LocalDateTime iso={expense.outingOccurredAt.toISOString()} /></div>
          <div><span className="technical-label">Created</span><LocalDateTime iso={expense.createdAt.toISOString()} mode="date" /></div>
        </div>
        <div className="expense-record__form">
          <p className="technical-label">EDIT RECORD</p>
          <ExpenseForm
            action={updateExpenseAction.bind(null, expense.id)}
            outings={outings}
            mode="edit"
            initialValues={{ description: expense.description, amountRupiah: expense.amount.toString(), outingId: expense.outingId }}
          />
        </div>
        <div className="expense-record__shares">
          <ExpenseShareEditor
            action={replaceExpenseSharesAction.bind(null, expense.id)}
            expenseAmount={expense.amount}
            friends={friends}
          />
        </div>
      </div>
    </section>
  );
}
