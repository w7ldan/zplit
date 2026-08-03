import { MAX_RUPIAH, parseRupiah } from "./rupiah";

export type ExpenseInputValues = {
  description: string;
  amountRupiah: string;
  outingId: string;
};

export type ExpenseInput = {
  description: string;
  amount: number;
  outingId: string;
};

export type ExpenseField = keyof ExpenseInputValues;
export type ExpenseFieldErrors = Partial<Record<ExpenseField, string>>;

export type ExpenseValidationResult =
  | { ok: true; value: ExpenseInput; values: ExpenseInputValues }
  | { ok: false; errors: ExpenseFieldErrors; values: ExpenseInputValues };

function readValue(input: unknown, key: ExpenseField) {
  const value = input !== null && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" ? value.trim() : "";
}

function isCanonicalUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function validateExpenseInput(input: unknown): ExpenseValidationResult {
  const values: ExpenseInputValues = {
    description: readValue(input, "description"),
    amountRupiah: readValue(input, "amountRupiah"),
    outingId: readValue(input, "outingId"),
  };
  const errors: ExpenseFieldErrors = {};

  if (!values.description) errors.description = "Description is required.";
  else if (values.description.length > 200) errors.description = "Description must be 200 characters or fewer.";

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

  const outingId = values.outingId.toLowerCase();
  if (!outingId) errors.outingId = "Outing is required.";
  else if (!isCanonicalUuid(outingId)) errors.outingId = "Select a valid outing.";

  if (Object.keys(errors).length > 0 || amount === null) {
    return { ok: false, errors, values };
  }

  return {
    ok: true,
    values,
    value: {
      description: values.description,
      amount,
      outingId,
    },
  };
}
