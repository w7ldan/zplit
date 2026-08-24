import type { Database } from "../db/client";
import { LedgerRepositoryError } from "./ledger/errors";
import type { OpenExpenseSharesByFriend, RepaymentFriendContext } from "./ledger/types";
export type * from "./ledger/types";
export type { LedgerErrorCode } from "./ledger/errors";
export {
  deletionImpactRevision,
  ExpenseShareAllocationInvariantError,
  ExpenseShareInvariantError,
  ExpenseDeletionInvariantError,
  LedgerDeletionConfirmationRequiredError,
  LedgerNotFoundError,
  LedgerRepositoryError,
  OutingDeletionInvariantError,
  RepaymentAllocationAmountInvariantError,
  RepaymentAllocationShareInvariantError,
  RepaymentAmountInvariantError,
  RepaymentFriendInvariantError,
  RepaymentDeletionInvariantError,
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

export function createLedgerRepository(database: Database, ownerUserId: string) {
  const owner = ownerUserId.trim();
  if (!owner) throw new LedgerRepositoryError("INVALID_OWNER", "A ledger owner is required");
  const allocationRepository = createRepaymentAllocationRepository(database, owner);

  const friendsReads = createFriendsReadRepository(database, owner);
  const { getFriend, ...friendReads } = friendsReads;
  const tripsReads = createTripsReadRepository(database, owner);
  const outingsReads = createOutingsReadRepository(database, owner);
  const searchReads = createLedgerSearchRepository(database, owner);
  const historyReads = createLedgerHistoryRepository(database, owner);
  const summaryReads = createLedgerSummaryRepository(database, owner);
  const { getFriendBalances, ...summaryReadMethods } = summaryReads;
  const statementsReads = createLedgerStatementRepository(database, owner);
  const expenseReads = createExpenseReadRepository(database, owner);
  const {
    expenseSelection,
    listExpenseChargesFor,
    listExpenseSharesFor,
    listOpenExpenseSharesByFriend,
    ...expenseReadMethods
  } = expenseReads;
  const repaymentReadMethods = createRepaymentReadRepository(database, owner, allocationRepository);

  const expenseMutations = createExpenseMutationRepository(database, owner, {
    expenseSelection,
    listExpenseChargesFor,
    listExpenseSharesFor,
  }, allocationRepository);
  const { lockExpenseDependents, ...expenseMutationMethods } = expenseMutations;
  const outingsMutations = createOutingsMutationRepository(database, owner, { lockExpenseDependents });
  const friendsMutationMethods = createFriendsMutationRepository(database, owner);
  const tripsMutationMethods = createTripsMutationRepository(database, owner);
  const repaymentMutationMethods = createRepaymentMutationRepository(database, owner, allocationRepository);

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
  };
}
