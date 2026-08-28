export type LedgerFriendRecord = {
  id: string;
  name: string;
  archivedAt: Date | null;
};

export type LedgerExpenseRecord = {
  id: string;
  amount: number;
};

export type LedgerExpenseShareRecord = {
  id: string;
  expenseId: string;
  friendId: string;
  amountOwed: number;
};

export type LedgerRepaymentRecord = {
  id: string;
  friendId: string;
  amount: number;
};

export type LedgerRepaymentAllocationRecord = {
  repaymentId: string;
  expenseShareId: string;
  amount: number;
};

export type LedgerSummaryInput = {
  friends: LedgerFriendRecord[];
  expenses: LedgerExpenseRecord[];
  expenseShares: LedgerExpenseShareRecord[];
  repayments: LedgerRepaymentRecord[];
  repaymentAllocations: LedgerRepaymentAllocationRecord[];
};

export type FriendBalance = {
  friendId: string;
  name: string;
  archived: boolean;
  assignedAmount: number;
  repaidAmount: number;
  outstandingAmount: number;
};

export type LedgerSummary = {
  totalExpenseAmount: number;
  totalAssignedAmount: number;
  totalRepaidAmount: number;
  totalReceivedAmount: number;
  totalUnallocatedRepaymentAmount: number;
  totalOutstandingAmount: number;
  ownerPortionAmount: number;
  friendBalances: FriendBalance[];
};

export class LedgerIntegrityError extends Error {
  readonly code = "LEDGER_INTEGRITY_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "LedgerIntegrityError";
  }
}

function assertId(id: string, label: string) {
  if (typeof id !== "string" || !id) {
    throw new LedgerIntegrityError(`${label} has an invalid ID.`);
  }
}

function assertAmount(amount: number, label: string) {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new LedgerIntegrityError(`${label} is not a safe non-negative whole-rupiah amount.`);
  }
}

function add(left: number, right: number, label: string) {
  assertAmount(left, label);
  assertAmount(right, label);
  const result = left + right;
  assertAmount(result, label);
  return result;
}

function subtract(left: number, right: number, label: string) {
  assertAmount(left, label);
  assertAmount(right, label);
  const result = left - right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new LedgerIntegrityError(`${label} is negative or not a safe integer.`);
  }
  return result;
}

function indexById<T extends { id: string }>(records: T[], label: string) {
  const indexed = new Map<string, T>();
  for (const record of records) {
    assertId(record.id, `${label} record`);
    if (indexed.has(record.id)) throw new LedgerIntegrityError(`${label} IDs must be unique.`);
    indexed.set(record.id, record);
  }
  return indexed;
}

function addToMap(map: Map<string, number>, key: string, amount: number, label: string) {
  map.set(key, add(map.get(key) ?? 0, amount, label));
}

function totalExpenses(expenses: LedgerExpenseRecord[]) {
  let totalExpenseAmount = 0;
  for (const expense of expenses) {
    assertAmount(expense.amount, `Expense ${expense.id} amount`);
    totalExpenseAmount = add(totalExpenseAmount, expense.amount, "Total expense amount");
  }
  return totalExpenseAmount;
}

function totalReceived(repayments: LedgerRepaymentRecord[], friends: Map<string, LedgerFriendRecord>) {
  let totalReceivedAmount = 0;
  for (const repayment of repayments) {
    assertAmount(repayment.amount, `Repayment ${repayment.id} amount`);
    if (!friends.has(repayment.friendId)) throw new LedgerIntegrityError(`Repayment ${repayment.id} references an unknown friend.`);
    totalReceivedAmount = add(totalReceivedAmount, repayment.amount, "Total received amount");
  }
  return totalReceivedAmount;
}

function assignedAmounts(
  shares: LedgerExpenseShareRecord[],
  expenses: Map<string, LedgerExpenseRecord>,
  friends: Map<string, LedgerFriendRecord>,
) {
  let totalAssignedAmount = 0;
  const assignedByExpense = new Map<string, number>();
  const assignedByFriend = new Map<string, number>();
  for (const share of shares) {
    assertAmount(share.amountOwed, `Expense share ${share.id} amount`);
    const expense = expenses.get(share.expenseId);
    const friend = friends.get(share.friendId);
    if (!expense || !friend) throw new LedgerIntegrityError(`Expense share ${share.id} references an unknown expense or friend.`);

    addToMap(assignedByExpense, share.expenseId, share.amountOwed, `Assigned amount for expense ${share.expenseId}`);
    if ((assignedByExpense.get(share.expenseId) ?? 0) > expense.amount) {
      throw new LedgerIntegrityError(`Expense shares exceed expense ${share.expenseId}.`);
    }
    addToMap(assignedByFriend, share.friendId, share.amountOwed, `Assigned amount for friend ${share.friendId}`);
    totalAssignedAmount = add(totalAssignedAmount, share.amountOwed, "Total assigned amount");
  }
  return { totalAssignedAmount, assignedByExpense, assignedByFriend };
}

function repaymentAmounts(
  allocations: LedgerRepaymentAllocationRecord[],
  repayments: Map<string, LedgerRepaymentRecord>,
  shares: Map<string, LedgerExpenseShareRecord>,
) {
  let totalRepaidAmount = 0;
  const allocatedByShare = new Map<string, number>();
  const allocatedByRepayment = new Map<string, number>();
  const repaidByFriend = new Map<string, number>();
  const allocationKeys = new Set<string>();
  for (const allocation of allocations) {
    assertAmount(allocation.amount, "Repayment allocation amount");
    const repayment = repayments.get(allocation.repaymentId);
    const share = shares.get(allocation.expenseShareId);
    if (!repayment || !share) {
      throw new LedgerIntegrityError("Repayment allocation references an unknown share or repayment.");
    }
    const allocationKey = `${allocation.repaymentId}:${allocation.expenseShareId}`;
    if (allocationKeys.has(allocationKey)) throw new LedgerIntegrityError("Repayment allocation pairs must be unique.");
    allocationKeys.add(allocationKey);
    if (repayment.friendId !== share.friendId) {
      throw new LedgerIntegrityError(`Repayment ${repayment.id} and expense share ${share.id} belong to different friends.`);
    }

    addToMap(allocatedByShare, share.id, allocation.amount, `Allocated amount for share ${share.id}`);
    addToMap(allocatedByRepayment, repayment.id, allocation.amount, `Allocated amount for repayment ${repayment.id}`);
    addToMap(repaidByFriend, share.friendId, allocation.amount, `Repaid amount for friend ${share.friendId}`);
    totalRepaidAmount = add(totalRepaidAmount, allocation.amount, "Total repaid amount");
  }
  return { totalRepaidAmount, allocatedByShare, allocatedByRepayment, repaidByFriend };
}

function assertAllocationLimits(
  shares: LedgerExpenseShareRecord[],
  repayments: LedgerRepaymentRecord[],
  allocatedByShare: Map<string, number>,
  allocatedByRepayment: Map<string, number>,
) {
  for (const share of shares) {
    const repaid = allocatedByShare.get(share.id) ?? 0;
    if (repaid > share.amountOwed) throw new LedgerIntegrityError(`Allocations exceed expense share ${share.id}.`);
  }
  for (const repayment of repayments) {
    const allocated = allocatedByRepayment.get(repayment.id) ?? 0;
    if (allocated > repayment.amount) throw new LedgerIntegrityError(`Allocations exceed repayment ${repayment.id}.`);
  }
}

function ownerPortion(expenses: LedgerExpenseRecord[], assignedByExpense: Map<string, number>) {
  let ownerPortionAmount = 0;
  for (const expense of expenses) {
    ownerPortionAmount = add(
      ownerPortionAmount,
      subtract(expense.amount, assignedByExpense.get(expense.id) ?? 0, `Owner portion for expense ${expense.id}`),
      "Owner portion amount",
    );
  }
  return ownerPortionAmount;
}

function friendBalances(assignedByFriend: Map<string, number>, repaidByFriend: Map<string, number>, friends: Map<string, LedgerFriendRecord>) {
  return [...assignedByFriend.entries()].map(([friendId, assignedAmount]) => {
    const friend = friends.get(friendId);
    if (!friend) throw new LedgerIntegrityError(`Assigned friend ${friendId} is missing.`);
    const repaidAmount = repaidByFriend.get(friendId) ?? 0;
    return {
      friendId,
      name: friend.name,
      archived: friend.archivedAt !== null,
      assignedAmount,
      repaidAmount,
      outstandingAmount: subtract(assignedAmount, repaidAmount, `Outstanding amount for friend ${friendId}`),
    };
  }).sort((left, right) =>
    right.outstandingAmount - left.outstandingAmount ||
    (left.name < right.name ? -1 : left.name > right.name ? 1 : left.friendId < right.friendId ? -1 : left.friendId > right.friendId ? 1 : 0),
  );
}

export function buildLedgerSummary(input: LedgerSummaryInput): LedgerSummary {
  const friends = indexById(input.friends, "Friend");
  const expenses = indexById(input.expenses, "Expense");
  const shares = indexById(input.expenseShares, "Expense share");
  const repayments = indexById(input.repayments, "Repayment");
  const totalExpenseAmount = totalExpenses(input.expenses);
  const totalReceivedAmount = totalReceived(input.repayments, friends);
  const assigned = assignedAmounts(input.expenseShares, expenses, friends);
  const repaid = repaymentAmounts(input.repaymentAllocations, repayments, shares);
  assertAllocationLimits(input.expenseShares, input.repayments, repaid.allocatedByShare, repaid.allocatedByRepayment);
  const ownerPortionAmount = ownerPortion(input.expenses, assigned.assignedByExpense);

  return {
    totalExpenseAmount,
    totalAssignedAmount: assigned.totalAssignedAmount,
    totalRepaidAmount: repaid.totalRepaidAmount,
    totalReceivedAmount,
    totalUnallocatedRepaymentAmount: subtract(totalReceivedAmount, repaid.totalRepaidAmount, "Total unallocated repayment amount"),
    totalOutstandingAmount: subtract(assigned.totalAssignedAmount, repaid.totalRepaidAmount, "Total outstanding amount"),
    ownerPortionAmount,
    friendBalances: friendBalances(assigned.assignedByFriend, repaid.repaidByFriend, friends),
  };
}
