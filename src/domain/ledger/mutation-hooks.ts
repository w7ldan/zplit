import type { Database } from "../../db/client";
import type { ExpenseBudgetParticipation } from "../budgeting/participation";

export type LedgerTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type PersonalBudgetMutationHooks = {
  reconcileExpense: (transaction: LedgerTransaction, expenseId: string, participation?: ExpenseBudgetParticipation) => Promise<void>;
  reconcileRepayment: (transaction: LedgerTransaction, repaymentId: string) => Promise<void>;
  reconcileRepayments: (transaction: LedgerTransaction, repaymentIds: string[]) => Promise<void>;
  reconcileRepaymentsForExpense: (transaction: LedgerTransaction, expenseId: string) => Promise<void>;
  reconcileOuting: (transaction: LedgerTransaction, outingId: string) => Promise<void>;
  voidExpense: (transaction: LedgerTransaction, expenseId: string) => Promise<void>;
  voidExpenses: (transaction: LedgerTransaction, expenseIds: string[]) => Promise<void>;
  voidRepayment: (transaction: LedgerTransaction, repaymentId: string) => Promise<void>;
};
