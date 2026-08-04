export type LedgerExportFriend = {
  id: string;
  name: string;
  archivedAt: Date | string | null;
};

export type LedgerExportExpense = {
  id: string;
  description: string;
  amount: number;
  outingTitle: string;
  outingOccurredAt: Date | string;
};

export type LedgerExportExpenseShare = {
  id: string;
  expenseId: string;
  friendId: string;
  amountOwed: number;
};

export type LedgerExportRepayment = {
  id: string;
  friendId: string;
  amount: number;
  paidAt: Date | string;
  paymentMethod: string | null;
};

export type LedgerExportAllocation = {
  repaymentId: string;
  expenseShareId: string;
  amount: number;
};

export type LedgerExportSnapshot = {
  friends: LedgerExportFriend[];
  expenses: LedgerExportExpense[];
  expenseShares: LedgerExportExpenseShare[];
  repayments: LedgerExportRepayment[];
  repaymentAllocations: LedgerExportAllocation[];
};

export class LedgerExportIntegrityError extends Error {
  readonly code = "LEDGER_EXPORT_INTEGRITY_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "LedgerExportIntegrityError";
  }
}

type PreparedSnapshot = {
  snapshot: LedgerExportSnapshot;
  friendsById: Map<string, LedgerExportFriend>;
  expensesById: Map<string, LedgerExportExpense>;
  sharesById: Map<string, LedgerExportExpenseShare>;
  repaymentsById: Map<string, LedgerExportRepayment>;
  allocatedByShare: Map<string, number>;
  allocatedByRepayment: Map<string, number>;
};

function invalid(message: string): never {
  throw new LedgerExportIntegrityError(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid(`${label} is invalid.`);
  return value as Record<string, unknown>;
}

function records(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) return invalid(`${label} are invalid.`);
  return value;
}

function id(value: unknown, label: string) {
  if (typeof value !== "string" || !value) return invalid(`${label} has an invalid ID.`);
  return value;
}

function text(value: unknown, label: string) {
  if (typeof value !== "string") return invalid(`${label} is invalid.`);
  return value;
}

function amount(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return invalid(`${label} is not a safe non-negative whole-rupiah amount.`);
  }
  return value;
}

function date(value: unknown, label: string) {
  if (!(value instanceof Date) && typeof value !== "string") return invalid(`${label} is invalid.`);
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) return invalid(`${label} is invalid.`);
  return result;
}

function add(left: number, right: number, label: string) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) return invalid(`${label} is not a safe whole-rupiah amount.`);
  return result;
}

function indexById<T extends { id: string }>(items: T[], label: string) {
  const result = new Map<string, T>();
  for (const item of items) {
    if (result.has(item.id)) invalid(`${label} IDs must be unique.`);
    result.set(item.id, item);
  }
  return result;
}

function prepareSnapshot(input: LedgerExportSnapshot): PreparedSnapshot {
  const source = record(input, "Export snapshot");
  const friends = records(source.friends, "Friends").map((value, index) => {
    const row = record(value, `Friend ${index}`);
    return {
      id: id(row.id, `Friend ${index}`),
      name: text(row.name, `Friend ${index} name`),
      archivedAt: row.archivedAt === null ? null : date(row.archivedAt, `Friend ${index} archived time`),
    };
  });
  const expenses = records(source.expenses, "Expenses").map((value, index) => {
    const row = record(value, `Expense ${index}`);
    return {
      id: id(row.id, `Expense ${index}`),
      description: text(row.description, `Expense ${index} description`),
      amount: amount(row.amount, `Expense ${index} amount`),
      outingTitle: text(row.outingTitle, `Expense ${index} outing title`),
      outingOccurredAt: date(row.outingOccurredAt, `Expense ${index} outing time`),
    };
  });
  const expenseShares = records(source.expenseShares, "Expense shares").map((value, index) => {
    const row = record(value, `Expense share ${index}`);
    return {
      id: id(row.id, `Expense share ${index}`),
      expenseId: id(row.expenseId, `Expense share ${index} expense`),
      friendId: id(row.friendId, `Expense share ${index} friend`),
      amountOwed: amount(row.amountOwed, `Expense share ${index} amount`),
    };
  });
  const repayments = records(source.repayments, "Repayments").map((value, index) => {
    const row = record(value, `Repayment ${index}`);
    return {
      id: id(row.id, `Repayment ${index}`),
      friendId: id(row.friendId, `Repayment ${index} friend`),
      amount: amount(row.amount, `Repayment ${index} amount`),
      paidAt: date(row.paidAt, `Repayment ${index} paid time`),
      paymentMethod: row.paymentMethod === null ? null : text(row.paymentMethod, `Repayment ${index} payment method`),
    };
  });
  const repaymentAllocations = records(source.repaymentAllocations, "Repayment allocations").map((value, index) => {
    const row = record(value, `Repayment allocation ${index}`);
    return {
      repaymentId: id(row.repaymentId, `Repayment allocation ${index} repayment`),
      expenseShareId: id(row.expenseShareId, `Repayment allocation ${index} share`),
      amount: amount(row.amount, `Repayment allocation ${index} amount`),
    };
  });

  const snapshot = { friends, expenses, expenseShares, repayments, repaymentAllocations };
  const friendsById = indexById(friends, "Friend");
  const expensesById = indexById(expenses, "Expense");
  const sharesById = indexById(expenseShares, "Expense share");
  const repaymentsById = indexById(repayments, "Repayment");
  const assignedByExpense = new Map<string, number>();

  for (const share of expenseShares) {
    if (!expensesById.has(share.expenseId) || !friendsById.has(share.friendId)) {
      invalid(`Expense share ${share.id} references an unknown expense or friend.`);
    }
    const assigned = add(assignedByExpense.get(share.expenseId) ?? 0, share.amountOwed, `Expense ${share.expenseId} assigned amount`);
    if (assigned > expensesById.get(share.expenseId)!.amount) invalid(`Expense shares exceed expense ${share.expenseId}.`);
    assignedByExpense.set(share.expenseId, assigned);
  }

  for (const repayment of repayments) {
    if (!friendsById.has(repayment.friendId)) invalid(`Repayment ${repayment.id} references an unknown friend.`);
  }

  const allocatedByShare = new Map<string, number>();
  const allocatedByRepayment = new Map<string, number>();
  const allocationPairs = new Set<string>();
  for (const allocation of repaymentAllocations) {
    const share = sharesById.get(allocation.expenseShareId);
    const repayment = repaymentsById.get(allocation.repaymentId);
    if (!share || !repayment) invalid("Repayment allocation references an unknown share or repayment.");
    if (share.friendId !== repayment.friendId) invalid("Repayment allocations cannot cross friends.");
    const pair = `${allocation.repaymentId}:${allocation.expenseShareId}`;
    if (allocationPairs.has(pair)) invalid("Repayment allocation pairs must be unique.");
    allocationPairs.add(pair);

    const shareTotal = add(allocatedByShare.get(share.id) ?? 0, allocation.amount, `Expense share ${share.id} allocated amount`);
    if (shareTotal > share.amountOwed) invalid(`Allocations exceed expense share ${share.id}.`);
    allocatedByShare.set(share.id, shareTotal);

    const repaymentTotal = add(allocatedByRepayment.get(repayment.id) ?? 0, allocation.amount, `Repayment ${repayment.id} allocated amount`);
    if (repaymentTotal > repayment.amount) invalid(`Allocations exceed repayment ${repayment.id}.`);
    allocatedByRepayment.set(repayment.id, repaymentTotal);
  }

  return { snapshot, friendsById, expensesById, sharesById, repaymentsById, allocatedByShare, allocatedByRepayment };
}

export function validateLedgerExportSnapshot(input: LedgerExportSnapshot) {
  prepareSnapshot(input);
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function csvField(value: string, textual: boolean) {
  const safeValue = textual && /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safeValue) ? `"${safeValue.replaceAll('"', '""')}"` : safeValue;
}

function csvRow(values: Array<string | number>) {
  return values.map((value) => csvField(String(value), typeof value === "string")).join(",");
}

function buildCsv(headers: string[], rows: Array<Array<string | number>>) {
  return `\uFEFF${[headers, ...rows].map(csvRow).join("\r\n")}\r\n`;
}

function iso(value: Date | string) {
  return new Date(value).toISOString();
}

function balanceRows(prepared: PreparedSnapshot) {
  const assignedByFriend = new Map<string, number>();
  const repaidByFriend = new Map<string, number>();
  for (const share of prepared.snapshot.expenseShares) {
    assignedByFriend.set(share.friendId, add(assignedByFriend.get(share.friendId) ?? 0, share.amountOwed, `Friend ${share.friendId} assigned amount`));
  }
  for (const allocation of prepared.snapshot.repaymentAllocations) {
    const share = prepared.sharesById.get(allocation.expenseShareId)!;
    repaidByFriend.set(share.friendId, add(repaidByFriend.get(share.friendId) ?? 0, allocation.amount, `Friend ${share.friendId} repaid amount`));
  }
  return prepared.snapshot.friends.map((friend) => {
    const assigned = assignedByFriend.get(friend.id) ?? 0;
    const repaid = repaidByFriend.get(friend.id) ?? 0;
    if (repaid > assigned) invalid(`Repaid amount exceeds assigned amount for friend ${friend.id}.`);
    return [friend.name, friend.archivedAt === null ? "active" : "archived", assigned, repaid, assigned - repaid] as Array<string | number>;
  });
}

export function buildBalancesCsv(snapshot: LedgerExportSnapshot) {
  const prepared = prepareSnapshot(snapshot);
  return buildCsv(
    ["friend_name", "friend_state", "assigned_rupiah", "repaid_rupiah", "outstanding_rupiah"],
    balanceRows(prepared),
  );
}

export function buildExpenseSharesCsv(snapshot: LedgerExportSnapshot) {
  const prepared = prepareSnapshot(snapshot);
  const rows = prepared.snapshot.expenseShares
    .map((share) => {
      const expense = prepared.expensesById.get(share.expenseId)!;
      const friend = prepared.friendsById.get(share.friendId)!;
      const repaid = prepared.allocatedByShare.get(share.id) ?? 0;
      return {
        sortTime: new Date(expense.outingOccurredAt).getTime(),
        description: expense.description,
        friendName: friend.name,
        id: share.id,
        row: [iso(expense.outingOccurredAt), expense.outingTitle, expense.description, expense.amount, friend.name, share.amountOwed, repaid, share.amountOwed - repaid, repaid === share.amountOwed ? "settled" : "open"] as Array<string | number>,
      };
    })
    .sort((left, right) => right.sortTime - left.sortTime || compareText(left.description, right.description) || compareText(left.friendName, right.friendName) || compareText(left.id, right.id))
    .map(({ row }) => row);
  return buildCsv(
    ["outing_occurred_at_utc", "outing_title", "expense_description", "expense_total_rupiah", "friend_name", "share_rupiah", "repaid_rupiah", "outstanding_rupiah", "state"],
    rows,
  );
}

export function buildRepaymentsCsv(snapshot: LedgerExportSnapshot) {
  const prepared = prepareSnapshot(snapshot);
  const rows = prepared.snapshot.repayments
    .map((repayment) => {
      const friend = prepared.friendsById.get(repayment.friendId)!;
      const allocated = prepared.allocatedByRepayment.get(repayment.id) ?? 0;
      return {
        sortTime: new Date(repayment.paidAt).getTime(),
        friendName: friend.name,
        id: repayment.id,
        row: [iso(repayment.paidAt), friend.name, repayment.amount, allocated, repayment.amount - allocated, repayment.paymentMethod ?? ""] as Array<string | number>,
      };
    })
    .sort((left, right) => right.sortTime - left.sortTime || compareText(left.friendName, right.friendName) || compareText(left.id, right.id))
    .map(({ row }) => row);
  return buildCsv(
    ["paid_at_utc", "friend_name", "received_rupiah", "allocated_rupiah", "unallocated_rupiah", "payment_method"],
    rows,
  );
}

export type LedgerExportKind = "balances.csv" | "expense-shares.csv" | "repayments.csv";

export function buildLedgerExportCsv(kind: LedgerExportKind, snapshot: LedgerExportSnapshot) {
  if (kind === "balances.csv") return buildBalancesCsv(snapshot);
  if (kind === "expense-shares.csv") return buildExpenseSharesCsv(snapshot);
  return buildRepaymentsCsv(snapshot);
}
