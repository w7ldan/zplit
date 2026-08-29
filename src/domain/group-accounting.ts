import { normalizeUuid } from "./record-retrieval";
import { MAX_RUPIAH, parseRupiah } from "./rupiah";

export type GroupExpenseState = "pending" | "confirmed" | "rejected" | "voided";

export type GroupSettlementBalanceFact = {
  senderParticipantId: string;
  recipientParticipantId: string;
  amount: number;
  state: "pending" | "confirmed";
};

export type GroupExpenseLifecycleEventType = "created" | "payer_confirmed" | "payer_rejected" | "voided";

export const GROUP_EXPENSE_STATE_CHANGED_EVENT = "group.expense.state.changed";

export type GroupExpenseShareInput = {
  participantId: string;
  amount: number;
};

export type GroupExpenseInput = {
  description: string;
  occurredAt: Date;
  totalAmount: number;
  payerParticipantId: string;
  shares: GroupExpenseShareInput[];
};

export type GroupObligationInput = {
  sourceShareId?: string;
  debtorParticipantId: string;
  creditorParticipantId: string;
  originalAmount: number;
};

export type GroupBalance = {
  debtorParticipantId: string;
  creditorParticipantId: string;
  amount: number;
};

export class GroupAccountingInputError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_amount" | "invalid_date" | "duplicate_share" | "share_total_mismatch", readonly amountField?: "total" | "share") {
    super(code);
    this.name = "GroupAccountingInputError";
  }
}

function inputRecord(input: unknown) {
  return input !== null && typeof input === "object" ? input as Record<string, unknown> : {};
}

function requiredUuid(value: unknown, code: GroupAccountingInputError["code"] = "invalid_input") {
  const normalized = normalizeUuid(value);
  if (!normalized) throw new GroupAccountingInputError(code);
  return normalized;
}

function requiredAmount(value: unknown, amountField?: "total" | "share") {
  const amount = typeof value === "number" ? value : parseRupiah(value);
  if (amount === null || !Number.isSafeInteger(amount) || amount < 1 || amount > MAX_RUPIAH) throw new GroupAccountingInputError("invalid_amount", amountField);
  return amount;
}

function requiredDate(value: unknown) {
  const date = value instanceof Date ? new Date(value.getTime()) : typeof value === "string" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) throw new GroupAccountingInputError("invalid_date");
  return date;
}

export function normalizeGroupExpenseInput(input: unknown): GroupExpenseInput {
  const record = inputRecord(input);
  const description = typeof record.description === "string" ? record.description.trim() : "";
  if (!description || description.length > 200) throw new GroupAccountingInputError("invalid_input");
  if (!Array.isArray(record.shares) || record.shares.length === 0) throw new GroupAccountingInputError("invalid_input");
  const shares = record.shares.map((share) => {
    const row = inputRecord(share);
    return { participantId: requiredUuid(row.participantId), amount: requiredAmount(row.amount, "share") };
  });
  const participantIds = new Set<string>();
  for (const share of shares) {
    if (participantIds.has(share.participantId)) throw new GroupAccountingInputError("duplicate_share");
    participantIds.add(share.participantId);
  }
  const totalAmount = requiredAmount(record.totalAmount, "total");
  const shareTotal = shares.reduce((total, share) => total + BigInt(share.amount), BigInt(0));
  if (shareTotal !== BigInt(totalAmount)) throw new GroupAccountingInputError("share_total_mismatch");
  return {
    description,
    occurredAt: requiredDate(record.occurredAt),
    totalAmount,
    payerParticipantId: requiredUuid(record.payerParticipantId),
    shares,
  };
}

export function buildGroupObligations(payerParticipantId: string, shares: Array<GroupExpenseShareInput & { id?: string }>): GroupObligationInput[] {
  const payer = requiredUuid(payerParticipantId);
  return shares.flatMap((share) => {
    const debtor = requiredUuid(share.participantId);
    return debtor === payer ? [] : [{ sourceShareId: share.id, debtorParticipantId: debtor, creditorParticipantId: payer, originalAmount: requiredAmount(share.amount) }];
  });
}

export function calculateGroupBalances(
  obligations: Array<Pick<GroupObligationInput, "debtorParticipantId" | "creditorParticipantId" | "originalAmount">>,
  settlements: GroupSettlementBalanceFact[],
): GroupBalance[] {
  const balances = new Map<string, { first: string; second: string; amount: bigint }>();
  const add = (debtor: string, creditor: string, amount: number) => {
    const [first, second] = [debtor, creditor].sort();
    const key = `${first}:${second}`;
    const signedAmount = debtor === first ? BigInt(amount) : -BigInt(amount);
    const current = balances.get(key) ?? { first, second, amount: BigInt(0) };
    current.amount += signedAmount;
    balances.set(key, current);
  };

  for (const obligation of obligations) add(obligation.debtorParticipantId, obligation.creditorParticipantId, obligation.originalAmount);
  for (const settlement of settlements) {
    if (settlement.state === "confirmed") add(settlement.recipientParticipantId, settlement.senderParticipantId, settlement.amount);
  }

  return [...balances.values()].flatMap(({ first, second, amount }) => {
    if (amount === BigInt(0)) return [];
    const positive = amount > BigInt(0);
    const value = positive ? amount : -amount;
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Group balance exceeds safe integer range");
    return [{ debtorParticipantId: positive ? first : second, creditorParticipantId: positive ? second : first, amount: Number(value) }];
  });
}
