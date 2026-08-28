import { parseLocalDateTime } from "./outing-input";
import { parsePaymentMethodFields, type PaymentMethodFormState } from "./payment-method";
import { MAX_RUPIAH, parseRupiah } from "./rupiah";

export type RepaymentInputValues = {
  friendId: string;
  amountRupiah: string;
  paidAtLocal: string;
  timezoneOffsetMinutes: string;
  paymentMethod: string;
  notes: string;
};

export type RepaymentInput = {
  friendId: string;
  amount: number;
  paidAt: Date;
  paymentMethod: string | null;
  notes: string | null;
};

export type RepaymentField = keyof RepaymentInputValues;
export type RepaymentFieldErrors = Partial<Record<RepaymentField, string>>;

export type RepaymentValidationResult =
  | { ok: true; value: RepaymentInput; values: RepaymentInputValues }
  | { ok: false; errors: RepaymentFieldErrors; values: RepaymentInputValues };

function readValue(input: unknown, key: RepaymentField) {
  const value = input !== null && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" ? value.trim() : "";
}

function paymentMethodValue(input: unknown): { value: string; form?: PaymentMethodFormState; error?: string } {
  const record = input !== null && typeof input === "object" ? input as Record<string, unknown> : {};
  if ("paymentMethodChoice" in record || "paymentMethodOther" in record) return parsePaymentMethodFields(record.paymentMethodChoice, record.paymentMethodOther);
  return { value: readValue(input, "paymentMethod"), form: undefined };
}

function isCanonicalUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

function validateFriendId(value: string, errors: RepaymentFieldErrors) {
  if (!value) errors.friendId = "Friend is required.";
  else if (!isCanonicalUuid(value)) errors.friendId = "Select a valid friend.";
}

function validateAmount(value: string, errors: RepaymentFieldErrors) {
  const amount = parseRupiah(value);
  if (!value) errors.amountRupiah = "Amount is required.";
  else if (amount === null) {
    const numericText = /^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(value) ? value.replaceAll(".", "") : "";
    const numericAmount = numericText ? Number(numericText) : null;
    if (numericAmount === 0) errors.amountRupiah = "Amount must be greater than zero.";
    else if (numericAmount !== null && numericAmount > MAX_RUPIAH) errors.amountRupiah = "Amount is too large.";
    else errors.amountRupiah = "Enter whole rupiah, such as 84000 or 84.000.";
  }
  return amount;
}

function validatePaidAt(values: RepaymentInputValues, errors: RepaymentFieldErrors) {
  if (!values.paidAtLocal) errors.paidAtLocal = "Date and time is required.";
  if (!values.timezoneOffsetMinutes) errors.timezoneOffsetMinutes = "Timezone offset is required.";

  const offsetPattern = /^-?\d+$/;
  const timezoneOffset = Number(values.timezoneOffsetMinutes);
  if (values.timezoneOffsetMinutes && !offsetPattern.test(values.timezoneOffsetMinutes)) {
    errors.timezoneOffsetMinutes = "Timezone offset must be a whole number.";
  } else if (values.timezoneOffsetMinutes && (!Number.isInteger(timezoneOffset) || timezoneOffset < -840 || timezoneOffset > 840)) {
    errors.timezoneOffsetMinutes = "Timezone offset must be between -840 and 840 minutes.";
  }

  const paidAt = errors.paidAtLocal || errors.timezoneOffsetMinutes
    ? null
    : parseLocalDateTime(values.paidAtLocal, timezoneOffset);
  if (values.paidAtLocal && !paidAt) errors.paidAtLocal = "Enter a valid date and time.";
  return paidAt;
}

function validateOptionalFields(values: RepaymentInputValues, paymentMethod: ReturnType<typeof paymentMethodValue>, errors: RepaymentFieldErrors) {
  if (paymentMethod.error) errors.paymentMethod = paymentMethod.error;
  else if (values.paymentMethod.length > 40) errors.paymentMethod = "Payment method must be 40 characters or fewer.";
  if (values.notes.length > 4000) errors.notes = "Notes must be 4000 characters or fewer.";
}

export function validateRepaymentInput(input: unknown): RepaymentValidationResult {
  const paymentMethod = paymentMethodValue(input);
  const values: RepaymentInputValues = {
    friendId: readValue(input, "friendId").toLowerCase(),
    amountRupiah: readValue(input, "amountRupiah"),
    paidAtLocal: readValue(input, "paidAtLocal"),
    timezoneOffsetMinutes: readValue(input, "timezoneOffsetMinutes"),
    paymentMethod: paymentMethod.value,
    notes: readValue(input, "notes"),
  };
  const errors: RepaymentFieldErrors = {};

  validateFriendId(values.friendId, errors);
  const amount = validateAmount(values.amountRupiah, errors);
  const paidAt = validatePaidAt(values, errors);
  validateOptionalFields(values, paymentMethod, errors);

  if (Object.keys(errors).length > 0 || amount === null || !paidAt) return { ok: false, errors, values };

  return {
    ok: true,
    values,
    value: {
      friendId: values.friendId,
      amount,
      paidAt,
      paymentMethod: values.paymentMethod || null,
      notes: values.notes || null,
    },
  };
}
