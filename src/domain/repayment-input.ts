import { parseLocalDateTime } from "./outing-input";
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

function isCanonicalUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

export function validateRepaymentInput(input: unknown): RepaymentValidationResult {
  const values: RepaymentInputValues = {
    friendId: readValue(input, "friendId").toLowerCase(),
    amountRupiah: readValue(input, "amountRupiah"),
    paidAtLocal: readValue(input, "paidAtLocal"),
    timezoneOffsetMinutes: readValue(input, "timezoneOffsetMinutes"),
    paymentMethod: readValue(input, "paymentMethod"),
    notes: readValue(input, "notes"),
  };
  const errors: RepaymentFieldErrors = {};

  if (!values.friendId) errors.friendId = "Friend is required.";
  else if (!isCanonicalUuid(values.friendId)) errors.friendId = "Select a valid friend.";

  const amount = parseRupiah(values.amountRupiah);
  if (!values.amountRupiah) errors.amountRupiah = "Amount is required.";
  else if (amount === null) {
    const numericText = /^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(values.amountRupiah)
      ? values.amountRupiah.replaceAll(".", "")
      : "";
    const numericAmount = numericText ? Number(numericText) : null;
    if (numericAmount === 0) errors.amountRupiah = "Amount must be greater than zero.";
    else if (numericAmount !== null && numericAmount > MAX_RUPIAH) errors.amountRupiah = "Amount is too large.";
    else errors.amountRupiah = "Enter whole rupiah, such as 84000 or 84.000.";
  }

  if (!values.paidAtLocal) errors.paidAtLocal = "Date and time is required.";
  if (!values.timezoneOffsetMinutes) errors.timezoneOffsetMinutes = "Timezone offset is required.";

  const offsetPattern = /^-?\d+$/;
  const timezoneOffset = Number(values.timezoneOffsetMinutes);
  if (values.timezoneOffsetMinutes && !offsetPattern.test(values.timezoneOffsetMinutes)) {
    errors.timezoneOffsetMinutes = "Timezone offset must be a whole number.";
  } else if (
    values.timezoneOffsetMinutes &&
    (!Number.isInteger(timezoneOffset) || timezoneOffset < -840 || timezoneOffset > 840)
  ) {
    errors.timezoneOffsetMinutes = "Timezone offset must be between -840 and 840 minutes.";
  }

  const paidAt =
    !errors.paidAtLocal &&
    !errors.timezoneOffsetMinutes &&
    parseLocalDateTime(values.paidAtLocal, timezoneOffset);
  if (values.paidAtLocal && !paidAt) errors.paidAtLocal = "Enter a valid date and time.";

  if (values.paymentMethod.length > 40) errors.paymentMethod = "Payment method must be 40 characters or fewer.";
  if (values.notes.length > 4000) errors.notes = "Notes must be 4000 characters or fewer.";

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
