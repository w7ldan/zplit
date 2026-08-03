import { parseLocalDateTime } from "./expense-input";

export type OutingInputValues = {
  title: string;
  occurredAtLocal: string;
  timezoneOffsetMinutes: string;
  notes: string;
};

export type OutingInput = {
  title: string;
  occurredAt: Date;
  notes: string | null;
};

export type OutingField = keyof OutingInputValues;
export type OutingFieldErrors = Partial<Record<OutingField, string>>;

export type OutingValidationResult =
  | { ok: true; value: OutingInput; values: OutingInputValues }
  | { ok: false; errors: OutingFieldErrors; values: OutingInputValues };

function readValue(input: unknown, key: OutingField) {
  const value = input !== null && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" ? value.trim() : "";
}

export function validateOutingInput(input: unknown): OutingValidationResult {
  const values: OutingInputValues = {
    title: readValue(input, "title"),
    occurredAtLocal: readValue(input, "occurredAtLocal"),
    timezoneOffsetMinutes: readValue(input, "timezoneOffsetMinutes"),
    notes: readValue(input, "notes"),
  };
  const errors: OutingFieldErrors = {};

  if (!values.title) errors.title = "Title is required.";
  else if (values.title.length > 160) errors.title = "Title must be 160 characters or fewer.";

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

  if (values.notes.length > 4000) errors.notes = "Notes must be 4000 characters or fewer.";
  if (Object.keys(errors).length > 0 || !occurredAt) return { ok: false, errors, values };

  return {
    ok: true,
    values,
    value: {
      title: values.title,
      occurredAt,
      notes: values.notes || null,
    },
  };
}
