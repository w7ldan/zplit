import type { Database } from "../db/client";
import { LedgerRepositoryError } from "./ledger/errors";
import type { OpenExpenseSharesByFriend, RepaymentFriendContext } from "./ledger/types";
export type * from "./ledger/types";
export type { LedgerErrorCode } from "./ledger/errors";
export {
  deletionImpactRevision,
  ExpenseShareAllocationInvariantError,
  ExpenseShareInvariantError,
  LedgerDeletionConfirmationRequiredError,
  LedgerNotFoundError,
  LedgerRepositoryError,
  RepaymentAllocationAmountInvariantError,
  RepaymentAllocationShareInvariantError,
  RepaymentAmountInvariantError,
  RepaymentFriendInvariantError,
} from "./ledger/errors";
import { createFriendsReadRepository } from "./ledger/friends";
import { createTripsReadRepository } from "./ledger/trips";
import { createOutingsReadRepository } from "./ledger/outings";
import { createLedgerSearchRepository } from "./ledger/search";
import { createLedgerHistoryRepository } from "./ledger/history";
import { createLedgerSummaryRepository } from "./ledger/summary";
import { createLedgerStatementRepository } from "./ledger/statements";
import { createRepaymentAllocationRepository } from "./ledger/allocations";
import { createExpenseReadRepository } from "./ledger/expenses";
import { createRepaymentReadRepository } from "./ledger/repayments";
import {
  assertFriendId,
} from "./ledger/validation";

import { createFriendsMutationRepository } from "./ledger/friends";
import { createTripsMutationRepository } from "./ledger/trips";
import { createOutingsMutationRepository } from "./ledger/outings";
import { createExpenseMutationRepository } from "./ledger/expenses";
import { createRepaymentMutationRepository } from "./ledger/repayments";
import { createRepaymentDestinationRepository } from "./ledger/repayment-destinations";

type LedgerMutationGuard = (database: Database) => Promise<void>;

export function createLedgerRepository(database: Database, ledgerScopeId: string, options: { mutationGuard?: LedgerMutationGuard } = {}) {
  const scope = ledgerScopeId.trim();
  if (!scope) throw new LedgerRepositoryError("INVALID_OWNER", "A ledger scope is required");
  const { mutationGuard } = options;
  const allocationRepository = createRepaymentAllocationRepository(database, scope);

  const friendsReads = createFriendsReadRepository(database, scope);
  const { getFriend, ...friendReads } = friendsReads;
  const tripsReads = createTripsReadRepository(database, scope);
  const outingsReads = createOutingsReadRepository(database, scope);
  const searchReads = createLedgerSearchRepository(database, scope);
  const historyReads = createLedgerHistoryRepository(database, scope);
  const summaryReads = createLedgerSummaryRepository(database, scope);
  const { getFriendBalances, ...summaryReadMethods } = summaryReads;
  const statementsReads = createLedgerStatementRepository(database, scope);
  const expenseReads = createExpenseReadRepository(database, scope);
  const {
    expenseSelection,
    listExpenseChargesFor,
    listExpenseSharesFor,
    listOpenExpenseSharesByFriend,
    ...expenseReadMethods
  } = expenseReads;
  const repaymentReadMethods = createRepaymentReadRepository(database, scope, allocationRepository);

  const expenseMutations = createExpenseMutationRepository(database, scope, {
    expenseSelection,
    listExpenseChargesFor,
    listExpenseSharesFor,
  }, allocationRepository, mutationGuard);
  const { lockExpenseDependents, ...expenseMutationMethods } = expenseMutations;
  const outingsMutations = createOutingsMutationRepository(database, scope, { lockExpenseDependents }, mutationGuard);
  const friendsMutationMethods = createFriendsMutationRepository(database, scope, mutationGuard);
  const tripsMutationMethods = createTripsMutationRepository(database, scope, mutationGuard);
  const repaymentMutationMethods = createRepaymentMutationRepository(database, scope, allocationRepository);
  const repaymentDestinationMethods = createRepaymentDestinationRepository(database, scope, mutationGuard);

  async function getRepaymentFriendContext(friendId: string, includeOpenExpenseShares = false, tripId?: string): Promise<RepaymentFriendContext> {
    assertFriendId(friendId);
    const [friend, balances, shares] = await Promise.all([
      getFriend(friendId),
      getFriendBalances([friendId]),
      includeOpenExpenseShares ? listOpenExpenseSharesByFriend(friendId, tripId) : Promise.resolve({} as OpenExpenseSharesByFriend),
    ]);
    const openExpenseShares = shares[friendId] ?? [];
    return {
      option: { id: friend.id, name: friend.name, archived: friend.archivedAt !== null },
      outstandingAmount: tripId ? openExpenseShares.reduce((total, share) => total + share.remainingAmount, 0) : balances[0]?.outstandingAmount ?? 0,
      openExpenseShares,
    };
  }

  return {
    ...friendReads,
    getFriend,
    ...friendsMutationMethods,
    ...tripsReads,
    ...tripsMutationMethods,
    ...outingsReads,
    ...outingsMutations,
    ...searchReads,
    ...historyReads,
    ...summaryReadMethods,
    ...statementsReads,
    getFriendBalances,
    ...expenseReadMethods,
    listOpenExpenseSharesByFriend,
    ...expenseMutationMethods,
    getRepaymentFriendContext,
    ...repaymentReadMethods,
    ...repaymentMutationMethods,
    ...repaymentDestinationMethods,
  };
}
