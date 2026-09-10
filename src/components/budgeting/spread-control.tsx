import type { BudgetTransactionView } from "@/domain/budgeting/types";
import { BudgetSpreadForm } from "./budget-forms";
import { spreadBudgetTransactionAction } from "@/app/app/personal/budget/actions";

export function SpreadControl({ transaction }: { transaction: BudgetTransactionView }) {
  if (transaction.spreadLocked && transaction.spreadCount) return <small className="budget-spread-status">Spread across {transaction.spreadCount} periods · {transaction.pendingImpactCount ?? 0} pending</small>;
  if (!transaction.spreadCanChange) return null;
  return <details className="budget-category-change budget-spread-control">
    <summary className="action-link action-link--quiet" aria-label={`Spread across periods for ${transaction.description}`}>{transaction.spreadCount ? `Spread across ${transaction.spreadCount} periods` : "Spread across periods"}</summary>
    <BudgetSpreadForm action={spreadBudgetTransactionAction} transactionId={transaction.id} amount={transaction.amount} initialCount={String(transaction.spreadCount ?? 1)} saveLabel={`Save spread for ${transaction.description}`} />
  </details>;
}
