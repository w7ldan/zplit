export type LedgerHistoryType = "all" | "expense" | "repayment";
export type LedgerHistoryEventType = Exclude<LedgerHistoryType, "all">;

export type LedgerHistoryExpenseShare = {
  id: string;
  friendId: string;
  amountOwed: number;
  allocatedAmount: number;
};

export type LedgerHistoryExpenseRecord = {
  id: string;
  description: string;
  outingTitle: string;
  outingOccurredAt: Date | string;
  amount: number;
  shares: readonly LedgerHistoryExpenseShare[];
};

export type LedgerHistoryRepaymentAllocation = {
  expenseShareId: string;
  amount: number;
  friendId?: string;
  shareAmountOwed?: number;
  shareAllocatedAmount?: number;
};

export type LedgerHistoryRepaymentRecord = {
  id: string;
  friendId: string;
  friendName: string;
  paidAt: Date | string;
  amount: number;
  allocations: readonly LedgerHistoryRepaymentAllocation[];
};

export type LedgerHistoryExpense = {
  type: "expense";
  id: string;
  description: string;
  outingTitle: string;
  outingOccurredAt: Date;
  totalAmount: number;
  assignedAmount: number;
  ownerPortionAmount: number;
};

export type LedgerHistoryRepayment = {
  type: "repayment";
  id: string;
  friendId: string;
  friendName: string;
  paidAt: Date;
  totalAmount: number;
  allocatedAmount: number;
  unallocatedAmount: number;
};

export type LedgerHistoryEvent = LedgerHistoryExpense | LedgerHistoryRepayment;

export type LedgerHistoryCursor = {
  effectiveAt: Date;
  eventType: LedgerHistoryEventType;
  recordId: string;
};

export type LedgerHistoryResult = {
  items: LedgerHistoryEvent[];
  nextCursor: string | null;
};

export class LedgerHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerHistoryError";
  }
}

export class LedgerHistoryCursorError extends LedgerHistoryError {
  constructor() {
    super("Ledger history cursor is invalid.");
    this.name = "LedgerHistoryCursorError";
  }
}

export class LedgerHistoryIntegrityError extends LedgerHistoryError {
  constructor(message: string) {
    super(message);
    this.name = "LedgerHistoryIntegrityError";
  }
}

function amount(value: unknown, label: string, { positive = false } = {}): number {
  const numeric = value as number;
  if (!Number.isSafeInteger(numeric) || numeric < 0 || (positive && numeric === 0)) {
    throw new LedgerHistoryIntegrityError(`${label} is not a safe whole-rupiah amount.`);
  }
  return numeric;
}

function add(left: number, right: number, label: string) {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0 || result > Number.MAX_SAFE_INTEGER) {
    throw new LedgerHistoryIntegrityError(`${label} is not a safe whole-rupiah amount.`);
  }
  return result;
}

function subtract(left: number, right: number, label: string) {
  const result = left - right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new LedgerHistoryIntegrityError(`${label} is negative or unsafe.`);
  }
  return result;
}

function id(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new LedgerHistoryIntegrityError(`${label} has an invalid ID.`);
  return value;
}

function date(value: unknown, label: string) {
  const result = value instanceof Date ? new Date(value.getTime()) : typeof value === "string" ? new Date(value) : null;
  if (!result || Number.isNaN(result.getTime())) throw new LedgerHistoryIntegrityError(`${label} has an invalid date.`);
  return result;
}

function text(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new LedgerHistoryIntegrityError(`${label} is invalid.`);
  return value;
}

function exactKeys(value: object, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function canonicalCursorPayload(cursor: LedgerHistoryCursor) {
  if (!(cursor.effectiveAt instanceof Date) || Number.isNaN(cursor.effectiveAt.getTime())) throw new LedgerHistoryCursorError();
  if (!date(cursor.effectiveAt, "Cursor time").toISOString().endsWith("Z")) throw new LedgerHistoryCursorError();
  if (cursor.eventType !== "expense" && cursor.eventType !== "repayment") throw new LedgerHistoryCursorError();
  if (typeof cursor.recordId !== "string" || !cursor.recordId.trim()) throw new LedgerHistoryCursorError();
  return { effectiveAt: cursor.effectiveAt.toISOString(), eventType: cursor.eventType, recordId: cursor.recordId };
}

export function encodeLedgerHistoryCursor(cursor: LedgerHistoryCursor) {
  const payload = canonicalCursorPayload(cursor);
  return `lh1.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

export function parseLedgerHistoryCursor(value: unknown): LedgerHistoryCursor {
  if (typeof value !== "string" || !/^lh1\.[A-Za-z0-9_-]+$/.test(value)) throw new LedgerHistoryCursorError();
  try {
    const encoded = value.slice(4);
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(decoded);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      !exactKeys(parsed, ["effectiveAt", "eventType", "recordId"]) ||
      typeof (parsed as Record<string, unknown>).effectiveAt !== "string" ||
      typeof (parsed as Record<string, unknown>).eventType !== "string" ||
      typeof (parsed as Record<string, unknown>).recordId !== "string"
    ) throw new LedgerHistoryCursorError();
    const effectiveAt = new Date((parsed as Record<string, string>).effectiveAt);
    const cursor = {
      effectiveAt,
      eventType: (parsed as Record<string, string>).eventType as LedgerHistoryEventType,
      recordId: (parsed as Record<string, string>).recordId,
    };
    if (effectiveAt.toISOString() !== (parsed as Record<string, string>).effectiveAt) throw new LedgerHistoryCursorError();
    if (encodeLedgerHistoryCursor(cursor) !== value) throw new LedgerHistoryCursorError();
    return cursor;
  } catch (error) {
    if (error instanceof LedgerHistoryCursorError) throw error;
    throw new LedgerHistoryCursorError();
  }
}

function effectiveAt(event: LedgerHistoryEvent) {
  return event.type === "expense" ? event.outingOccurredAt : event.paidAt;
}

export function compareLedgerHistoryEvents(left: LedgerHistoryEvent, right: LedgerHistoryEvent) {
  const timeDifference = effectiveAt(right).getTime() - effectiveAt(left).getTime();
  if (timeDifference !== 0) return timeDifference;
  if (left.type !== right.type) return left.type === "expense" ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function validateAndBuildExpenses(records: readonly LedgerHistoryExpenseRecord[]) {
  const expenses = new Map<string, LedgerHistoryExpense>();
  const shares = new Map<string, { friendId: string; amountOwed: number; allocatedAmount: number }>();
  for (const record of records) {
    const recordId = id(record.id, "Expense");
    if (expenses.has(recordId)) throw new LedgerHistoryIntegrityError("Expense IDs must be unique.");
    const totalAmount = amount(record.amount, `Expense ${recordId} amount`, { positive: true });
    const outingOccurredAt = date(record.outingOccurredAt, `Expense ${recordId} outing time`);
    let assignedAmount = 0;
    const seenShares = new Set<string>();
    if (!Array.isArray(record.shares)) throw new LedgerHistoryIntegrityError(`Expense ${recordId} shares are invalid.`);
    for (const share of record.shares) {
      const shareId = id(share.id, "Expense share");
      if (shares.has(shareId) || seenShares.has(shareId)) throw new LedgerHistoryIntegrityError("Expense share IDs must be unique.");
      seenShares.add(shareId);
      const amountOwed = amount(share.amountOwed, `Expense share ${shareId} amount`, { positive: true });
      const allocatedAmount = amount(share.allocatedAmount, `Expense share ${shareId} allocation`);
      if (allocatedAmount > amountOwed) throw new LedgerHistoryIntegrityError(`Allocations exceed expense share ${shareId}.`);
      const friendId = id(share.friendId, "Expense share friend");
      shares.set(shareId, { friendId, amountOwed, allocatedAmount });
      assignedAmount = add(assignedAmount, amountOwed, `Assigned amount for expense ${recordId}`);
    }
    if (assignedAmount > totalAmount) throw new LedgerHistoryIntegrityError(`Expense shares exceed expense ${recordId}.`);
    expenses.set(recordId, {
      type: "expense",
      id: recordId,
      description: text(record.description, `Expense ${recordId} description`),
      outingTitle: text(record.outingTitle, `Expense ${recordId} outing title`),
      outingOccurredAt,
      totalAmount,
      assignedAmount,
      ownerPortionAmount: subtract(totalAmount, assignedAmount, `Owner portion for expense ${recordId}`),
    });
  }
  return { expenses, shares };
}

function validateAndBuildRepayments(records: readonly LedgerHistoryRepaymentRecord[], shares: Map<string, { friendId: string; amountOwed: number; allocatedAmount: number }>, strictAllocations: boolean) {
  const repayments = new Map<string, LedgerHistoryRepayment>();
  const allocatedByShare = new Map<string, number>();
  for (const record of records) {
    const recordId = id(record.id, "Repayment");
    if (repayments.has(recordId)) throw new LedgerHistoryIntegrityError("Repayment IDs must be unique.");
    const totalAmount = amount(record.amount, `Repayment ${recordId} amount`, { positive: true });
    const paidAt = date(record.paidAt, `Repayment ${recordId} paid time`);
    const friendId = id(record.friendId, `Repayment ${recordId} friend`);
    let allocatedAmount = 0;
    const seenAllocations = new Set<string>();
    if (!Array.isArray(record.allocations)) throw new LedgerHistoryIntegrityError(`Repayment ${recordId} allocations are invalid.`);
    for (const allocation of record.allocations) {
      const shareId = id(allocation.expenseShareId, "Repayment allocation share");
      if (seenAllocations.has(shareId)) throw new LedgerHistoryIntegrityError("Repayment allocation pairs must be unique.");
      seenAllocations.add(shareId);
      const share = shares.get(shareId);
      if (!share) {
        if (allocation.friendId === undefined || allocation.shareAmountOwed === undefined || allocation.shareAllocatedAmount === undefined) {
          throw new LedgerHistoryIntegrityError(`Repayment allocation references unknown expense share ${shareId}.`);
        }
        const friendIdFromAllocation = id(allocation.friendId, `Expense share ${shareId} friend`);
        const amountOwedFromAllocation = amount(allocation.shareAmountOwed, `Expense share ${shareId} amount`, { positive: true });
        const allocatedAmountFromAllocation = amount(allocation.shareAllocatedAmount, `Expense share ${shareId} allocation`);
        if (allocatedAmountFromAllocation > amountOwedFromAllocation) throw new LedgerHistoryIntegrityError(`Allocations exceed expense share ${shareId}.`);
        shares.set(shareId, { friendId: friendIdFromAllocation, amountOwed: amountOwedFromAllocation, allocatedAmount: allocatedAmountFromAllocation });
      }
      const resolvedShare = shares.get(shareId)!;
      if (resolvedShare.friendId !== friendId) throw new LedgerHistoryIntegrityError(`Repayment ${recordId} and expense share ${shareId} belong to different friends.`);
      const allocationAmount = amount(allocation.amount, "Repayment allocation amount", { positive: true });
      if (allocationAmount > resolvedShare.amountOwed) throw new LedgerHistoryIntegrityError(`Allocations exceed expense share ${shareId}.`);
      allocatedAmount = add(allocatedAmount, allocationAmount, `Allocated amount for repayment ${recordId}`);
      allocatedByShare.set(shareId, add(allocatedByShare.get(shareId) ?? 0, allocationAmount, `Allocated amount for share ${shareId}`));
    }
    if (allocatedAmount > totalAmount) throw new LedgerHistoryIntegrityError(`Allocations exceed repayment ${recordId}.`);
    repayments.set(recordId, {
      type: "repayment",
      id: recordId,
      friendId,
      friendName: text(record.friendName, `Repayment ${recordId} friend name`),
      paidAt,
      totalAmount,
      allocatedAmount,
      unallocatedAmount: subtract(totalAmount, allocatedAmount, `Unallocated amount for repayment ${recordId}`),
    });
  }
  for (const [shareId, share] of shares) {
    const allocatedInPage = allocatedByShare.get(shareId) ?? 0;
    if (strictAllocations ? share.allocatedAmount !== allocatedInPage : allocatedInPage > share.allocatedAmount) {
      throw new LedgerHistoryIntegrityError(`Expense share ${shareId} has inconsistent repayment allocations.`);
    }
  }
  return repayments;
}

export function buildLedgerHistory(
  input: { expenses: readonly LedgerHistoryExpenseRecord[]; repayments: readonly LedgerHistoryRepaymentRecord[] },
  options: { cursor?: string; type?: LedgerHistoryType; limit?: number; allocationsComplete?: boolean } = {},
): LedgerHistoryResult {
  const { expenses, shares } = validateAndBuildExpenses(input.expenses);
  const repayments = validateAndBuildRepayments(input.repayments, shares, options.allocationsComplete !== false);
  const type = options.type ?? "all";
  if (!["all", "expense", "repayment"].includes(type)) throw new LedgerHistoryError("Ledger history type is invalid.");
  const requestedLimit = typeof options.limit === "number" && Number.isFinite(options.limit) ? Math.trunc(options.limit) : 30;
  const limit = Math.min(50, Math.max(1, requestedLimit));
  const cursor = options.cursor === undefined ? undefined : parseLedgerHistoryCursor(options.cursor);
  const events = [...expenses.values(), ...repayments.values()]
    .filter((event) => type === "all" || event.type === type)
    .sort(compareLedgerHistoryEvents)
    .filter((event) => {
      if (!cursor) return true;
      const position = { effectiveAt: effectiveAt(event), eventType: event.type, recordId: event.id };
      return compareLedgerHistoryPositions(position, cursor) > 0;
    });
  const page = events.slice(0, limit + 1);
  const hasNext = page.length > limit;
  const items = page.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasNext && last ? encodeLedgerHistoryCursor({ effectiveAt: effectiveAt(last), eventType: last.type, recordId: last.id }) : null,
  };
}

function compareLedgerHistoryPositions(left: { effectiveAt: Date; eventType: LedgerHistoryEventType; recordId: string }, right: LedgerHistoryCursor) {
  const timeDifference = right.effectiveAt.getTime() - left.effectiveAt.getTime();
  if (timeDifference !== 0) return timeDifference;
  if (left.eventType !== right.eventType) return left.eventType === "expense" ? -1 : 1;
  return left.recordId < right.recordId ? -1 : left.recordId > right.recordId ? 1 : 0;
}
