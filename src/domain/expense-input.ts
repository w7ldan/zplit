export type ExpenseInputValues = {
  description: string;
  amountRupiah: string;
  occurredAtLocal: string;
  timezoneOffsetMinutes: string;
  outingId: string;
};

export type ExpenseInput = {
  description: string;
  amount: number;
  occurredAt: Date;
  outingId: string | null;
};

export type ExpenseField = keyof ExpenseInputValues;
export type ExpenseFieldErrors = Partial<Record<ExpenseField, string>>;

export type ExpenseValidationResult =
  | { ok: true; value: ExpenseInput; values: ExpenseInputValues }
  | { ok: false; errors: ExpenseFieldErrors; values: ExpenseInputValues };

export function parseLocalDateTime(value: string, timezoneOffsetMinutes: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59) return null;

  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, 0, 0);
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute
  ) return null;

  return new Date(local.getTime() + timezoneOffsetMinutes * 60_000);
}

function readValue(input: unknown, key: ExpenseField) {
  const value = input !== null && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" ? value.trim() : "";
}

function parseAmount(value: string) {
  if (/^\d+$/.test(value)) return Number(value);
  if (/^\d{1,3}(\.\d{3})+$/.test(value)) return Number(value.replaceAll(".", ""));
  return null;
}

function isCanonicalUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function validateExpenseInput(input: unknown): ExpenseValidationResult {
  const values: ExpenseInputValues = {
    description: readValue(input, "description"),
    amountRupiah: readValue(input, "amountRupiah"),
    occurredAtLocal: readValue(input, "occurredAtLocal"),
    timezoneOffsetMinutes: readValue(input, "timezoneOffsetMinutes"),
    outingId: readValue(input, "outingId"),
  };
  const errors: ExpenseFieldErrors = {};

  if (!values.description) errors.description = "Description is required.";
  else if (values.description.length > 200) errors.description = "Description must be 200 characters or fewer.";

  const amount = parseAmount(values.amountRupiah);
  if (!values.amountRupiah) errors.amountRupiah = "Amount is required.";
  else if (amount === null) errors.amountRupiah = "Enter whole rupiah, such as 84000 or 84.000.";
  else if (amount <= 0) errors.amountRupiah = "Amount must be greater than zero.";
  else if (amount > 2_147_483_647) errors.amountRupiah = "Amount is too large.";

  if (!values.occurredAtLocal) errors.occurredAtLocal = "Date and time is required.";
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

  const occurredAt =
    !errors.occurredAtLocal &&
    !errors.timezoneOffsetMinutes &&
    parseLocalDateTime(values.occurredAtLocal, timezoneOffset);
  if (values.occurredAtLocal && !occurredAt) errors.occurredAtLocal = "Enter a valid date and time.";

  const outingId = values.outingId ? values.outingId.toLowerCase() : null;
  if (outingId && !isCanonicalUuid(outingId)) errors.outingId = "Select a valid outing.";

  if (Object.keys(errors).length > 0 || amount === null || !occurredAt || amount <= 0 || amount > 2_147_483_647) {
    return { ok: false, errors, values };
  }

  return {
    ok: true,
    values,
    value: {
      description: values.description,
      amount,
      occurredAt,
      outingId,
    },
  };
}
