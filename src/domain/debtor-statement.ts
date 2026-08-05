export type DebtorStatementShare = {
  id: string;
  friendId: string;
  expenseId?: string;
  expenseDescription: string;
  outingTitle: string;
  outingOccurredAt: Date;
  amountOwed: number;
};

export type DebtorStatementPublicReceipt = {
  expenseId: string;
  publicId: string;
  mediaType: string;
};

export type DebtorStatementRepayment = {
  id: string;
  friendId: string;
  amount: number;
};

export type DebtorStatementAllocation = {
  repaymentId: string;
  expenseShareId: string;
  amount: number;
};

export type DebtorStatementInput = {
  friend: { id: string; name: string };
  shares: DebtorStatementShare[];
  repayments: DebtorStatementRepayment[];
  allocations: DebtorStatementAllocation[];
  publicReceipts?: DebtorStatementPublicReceipt[];
  asOf?: Date;
};

export type DebtorStatementItem = {
  expenseDescription: string;
  outingTitle: string;
  outingOccurredAt: Date;
  assignedAmount: number;
  repaidAmount: number;
  remainingAmount: number;
  state: "open" | "settled";
  sharedReceipts?: Array<{ publicId: string; label: "Receipt image"; mediaType: string }>;
};

export type DebtorStatement = {
  friendName: string;
  generatedAt: Date;
  assignedAmount: number;
  repaidAmount: number;
  outstandingAmount: number;
  items: DebtorStatementItem[];
};

export class DebtorStatementIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DebtorStatementIntegrityError";
  }
}

function amount(value: number, label: string, allowZero = true) {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw new DebtorStatementIntegrityError(`${label} is invalid.`);
  }
}

function add(total: number, value: number, label: string) {
  const next = total + value;
  if (!Number.isSafeInteger(next)) throw new DebtorStatementIntegrityError(`${label} is unsafe.`);
  return next;
}

function date(value: Date, label: string) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new DebtorStatementIntegrityError(`${label} is invalid.`);
  }
}

export function buildDebtorStatement(input: DebtorStatementInput): DebtorStatement {
  if (!input.friend.id || typeof input.friend.name !== "string") {
    throw new DebtorStatementIntegrityError("Friend is invalid.");
  }
  const generatedAt = input.asOf ? new Date(input.asOf) : new Date();
  date(generatedAt, "Statement time");

  const shares = new Map<string, DebtorStatementShare>();
  for (const share of input.shares) {
    if (shares.has(share.id) || share.friendId !== input.friend.id) {
      throw new DebtorStatementIntegrityError(`Expense share ${share.id} is invalid.`);
    }
    amount(share.amountOwed, `Expense share ${share.id}`, false);
    date(share.outingOccurredAt, `Outing for expense share ${share.id}`);
    shares.set(share.id, share);
  }

  const receiptsByExpense = new Map<string, DebtorStatementPublicReceipt[]>();
  for (const receipt of input.publicReceipts ?? []) {
    if (!receipt.expenseId || !receipt.publicId || !receipt.mediaType || ![...shares.values()].some((share) => share.expenseId === receipt.expenseId)) {
      throw new DebtorStatementIntegrityError("Public receipt is invalid.");
    }
    const receipts = receiptsByExpense.get(receipt.expenseId) ?? [];
    receipts.push(receipt);
    receiptsByExpense.set(receipt.expenseId, receipts);
  }

  const repayments = new Map<string, DebtorStatementRepayment>();
  for (const repayment of input.repayments) {
    if (repayments.has(repayment.id) || repayment.friendId !== input.friend.id) {
      throw new DebtorStatementIntegrityError(`Repayment ${repayment.id} is invalid.`);
    }
    amount(repayment.amount, `Repayment ${repayment.id}`);
    repayments.set(repayment.id, repayment);
  }

  const repaidByShare = new Map<string, number>();
  const allocatedByRepayment = new Map<string, number>();
  const seenAllocations = new Set<string>();
  for (const allocation of input.allocations) {
    const share = shares.get(allocation.expenseShareId);
    const repayment = repayments.get(allocation.repaymentId);
    if (!share || !repayment) throw new DebtorStatementIntegrityError("Allocation references an unknown record.");
    amount(allocation.amount, `Allocation ${allocation.repaymentId}/${allocation.expenseShareId}`, false);
    const allocationKey = `${allocation.repaymentId}:${allocation.expenseShareId}`;
    if (seenAllocations.has(allocationKey)) throw new DebtorStatementIntegrityError("Duplicate repayment allocation.");
    seenAllocations.add(allocationKey);

    const shareTotal = add(repaidByShare.get(share.id) ?? 0, allocation.amount, `Expense share ${share.id} allocation`);
    if (shareTotal > share.amountOwed) throw new DebtorStatementIntegrityError(`Allocations exceed expense share ${share.id}.`);
    repaidByShare.set(share.id, shareTotal);

    const repaymentTotal = add(allocatedByRepayment.get(repayment.id) ?? 0, allocation.amount, `Repayment ${repayment.id} allocation`);
    if (repaymentTotal > repayment.amount) throw new DebtorStatementIntegrityError(`Allocations exceed repayment ${repayment.id}.`);
    allocatedByRepayment.set(repayment.id, repaymentTotal);
  }

  let assignedAmount = 0;
  let repaidAmount = 0;
  const items = [...shares.values()].map((share) => {
    assignedAmount = add(assignedAmount, share.amountOwed, "Assigned amount");
    const repaid = repaidByShare.get(share.id) ?? 0;
    repaidAmount = add(repaidAmount, repaid, "Repaid amount");
    const remaining = share.amountOwed - repaid;
    const sharedReceipts = share.expenseId ? receiptsByExpense.get(share.expenseId) : undefined;
    return {
      expenseDescription: share.expenseDescription,
      outingTitle: share.outingTitle,
      outingOccurredAt: new Date(share.outingOccurredAt),
      assignedAmount: share.amountOwed,
      repaidAmount: repaid,
      remainingAmount: remaining,
      state: remaining === 0 ? "settled" as const : "open" as const,
      ...(sharedReceipts?.length ? {
        sharedReceipts: sharedReceipts.map((receipt) => ({ publicId: receipt.publicId, label: "Receipt image" as const, mediaType: receipt.mediaType })),
      } : {}),
    };
  });

  items.sort((a, b) => {
    if (a.state !== b.state) return a.state === "open" ? -1 : 1;
    const dateOrder = b.outingOccurredAt.getTime() - a.outingOccurredAt.getTime();
    if (dateOrder !== 0) return dateOrder;
    const descriptionOrder = a.expenseDescription.localeCompare(b.expenseDescription);
    return descriptionOrder;
  });

  return {
    friendName: input.friend.name,
    generatedAt,
    assignedAmount,
    repaidAmount,
    outstandingAmount: assignedAmount - repaidAmount,
    items,
  };
}
