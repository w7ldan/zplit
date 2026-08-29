import { parsePaymentMethodFields } from "./payment-method";
import { normalizeUuid } from "./record-retrieval";
import { MAX_RUPIAH, parseRupiah } from "./rupiah";

export type GroupSettlementState = "pending" | "confirmed";

export const GROUP_SETTLEMENT_CHANGED_EVENT = "group.settlement.changed";

export type GroupSettlementInput = {
  senderParticipantId: string;
  recipientParticipantId: string;
  amount: number;
  paymentMethod: string;
};

export class GroupSettlementInputError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_amount" | "invalid_payment_method" | "same_participant") {
    super(code);
    this.name = "GroupSettlementInputError";
  }
}

function inputRecord(input: unknown) {
  return input !== null && typeof input === "object" ? input as Record<string, unknown> : {};
}

function requiredParticipant(value: unknown) {
  const id = normalizeUuid(value);
  if (!id) throw new GroupSettlementInputError("invalid_input");
  return id;
}

function requiredAmount(value: unknown) {
  const amount = typeof value === "number" ? value : parseRupiah(value);
  if (amount === null || !Number.isSafeInteger(amount) || amount < 1 || amount > MAX_RUPIAH) throw new GroupSettlementInputError("invalid_amount");
  return amount;
}

function paymentMethodValue(input: Record<string, unknown>) {
  if ("paymentMethodChoice" in input || "paymentMethodOther" in input) {
    const parsed = parsePaymentMethodFields(input.paymentMethodChoice, input.paymentMethodOther);
    if (parsed.error) throw new GroupSettlementInputError("invalid_payment_method");
    return parsed.value;
  }
  return typeof input.paymentMethod === "string" ? input.paymentMethod.trim() : "";
}

export function normalizeGroupSettlementInput(input: unknown): GroupSettlementInput {
  const record = inputRecord(input);
  const senderParticipantId = requiredParticipant(record.senderParticipantId);
  const recipientParticipantId = requiredParticipant(record.recipientParticipantId);
  if (senderParticipantId === recipientParticipantId) throw new GroupSettlementInputError("same_participant");
  const amount = requiredAmount(record.amount ?? record.amountRupiah);
  const paymentMethod = paymentMethodValue(record);
  if (!paymentMethod || paymentMethod.length > 40) throw new GroupSettlementInputError("invalid_payment_method");
  return { senderParticipantId, recipientParticipantId, amount, paymentMethod };
}
