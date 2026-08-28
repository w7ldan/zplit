import { normalizeUuid } from "./record-retrieval";
import { MAX_RUPIAH, parseRupiah } from "./rupiah";

export type GroupExpenseState = "pending" | "confirmed";

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
