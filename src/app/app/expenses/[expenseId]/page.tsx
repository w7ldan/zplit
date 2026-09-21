import Link from "next/link";
import { notFound } from "next/navigation";
import { zplitVNextFont } from "@/app/fonts";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { LocalDateTime, SourceCalendarDate } from "@/components/editorial/local-date-time";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { ExpenseShareEditor } from "@/components/expenses/expense-share-editor";
import { ExpenseReceipts } from "@/components/expenses/expense-receipts";
import { BudgetParticipationBlock } from "@/components/budgeting/budget-participation-block";
import { formatRupiah } from "@/domain/rupiah";
import { AnimatedMoney } from "@/components/vnext/animated-money";
import { deletionImpactRevision, LedgerNotFoundError } from "@/domain/ledger-repository";
import { getAuthenticatedLedger } from "@/server/authenticated-ledger";
import { listBudgetCategoryOptions } from "@/server/budgeting/categories";
import { getPersonalExpenseBudgetState } from "@/server/budgeting/sources-personal";
import { listExpenseReceipts } from "@/server/expense-receipts";
import { changeExpenseBudgetCategoryAction, replaceExpenseSharesAction, searchExpenseFriendOptions, searchOutingOptions, setExpenseBudgetParticipationAction, updateExpenseAction } from "../actions";
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
    budgetSaved?: string | string[];
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
  const budgetState = await getPersonalExpenseBudgetState(database, session.user.id, expense.ledgerScopeId, expense.id);
  const budgetCategories = budgetState.status !== "unprocessed" ? await listBudgetCategoryOptions(database, session.user.id) : [];
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
    <section className={`app-page page-content zplit-vnext personal-vnext expense-record ${zplitVNextFont.variable}`} id="top">
      <div className="editorial-grid editorial-shell expense-record__layout personal-vnext__detail-layout">
        <header className="expense-record__intro personal-vnext__detail-intro personal-vnext__motion-reveal" data-motion="enter">
          <div className="expense-record__identity personal-vnext__detail-identity">
            <p className="technical-label">Expense · assign shares</p>
            <h1>{expense.description}</h1>
          </div>
          <Link className="expense-record__back vnext-link" href="/app/expenses">Expenses</Link>
        </header>
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
        ) : query?.budgetSaved === "1" ? (
          <RecordConfirmation
            queryKey="budgetSaved"
            message="Budget category saved."
            focusTargetId="expense-details"
          />
        ) : null}
        <div className="expense-record__tasks">
          <section className="expense-record__primary-task" aria-label="Expense shares and receipts">
            <section className="expense-record__split-workspace" id="friend-shares" tabIndex={-1} aria-label="Friend shares">
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
            </section>
            <ExpenseReceipts
              expenseId={expense.id}
              initialReceipts={receipts.map((receipt) => ({
                ...receipt,
                createdAt: receipt.createdAt.toISOString(),
              }))}
            />
          </section>
          <aside className="expense-record__sidebar" aria-label="Expense inspector">
            <section className="expense-record__summary vnext-surface vnext-surface--warm personal-vnext__controls personal-vnext__motion-stagger" aria-label="Expense summary" data-motion="enter">
              <div className="expense-record__meta personal-vnext__metadata">
                <div>
                  <span className="technical-label">Amount</span>
                  <strong><AnimatedMoney amount={expense.amount} animate label="Expense amount" tone="primary" /></strong>
                </div>
                <div>
                  <span className="technical-label">Outing</span>
                  <span>{expense.outingTitle}</span>
                </div>
                <div>
                  <span className="technical-label">Outing date</span>
                  <SourceCalendarDate canonicalDate={expense.outingOccurredOn} timestamp={expense.outingOccurredAt.toISOString()} />
                </div>
                <div>
                  <span className="technical-label">Created</span>
                  <LocalDateTime iso={expense.createdAt.toISOString()} mode="date" />
                </div>
              </div>
              {budgetState.status !== "unprocessed" ? (
                <section className="personal-vnext__budget-section personal-vnext__motion-item" aria-label="Budget participation">
                  <BudgetParticipationBlock
                    participation={budgetState}
                    categories={budgetCategories}
                    description={expense.description}
                    action={changeExpenseBudgetCategoryAction.bind(null, expense.id)}
                    includeAction={setExpenseBudgetParticipationAction.bind(null, expense.id)}
                    excludeAction={setExpenseBudgetParticipationAction.bind(null, expense.id)}
                  />
                </section>
              ) : null}
            </section>
            <section className="expense-record__edit-surface vnext-surface" aria-labelledby="expense-details">
              <p className="technical-label" id="expense-details" tabIndex={-1}>EDIT RECORD</p>
              <ExpenseForm
                action={updateExpenseAction.bind(null, expense.id)}
                outings={outings}
                searchOutings={searchOutingOptions}
                mode="edit"
                initialValues={{ description: expense.description, amountRupiah: expense.amount.toString(), outingId: expense.outingId }}
              />
            </section>
            <section className="expense-record__delete-section vnext-surface vnext-surface--warm">
              <DeleteRecordForm
                action={deleteExpenseAction.bind(null, expense.id)}
                recordType="expense"
                impact={deletionImpact}
                impactRevision={currentImpactRevision}
              />
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}
