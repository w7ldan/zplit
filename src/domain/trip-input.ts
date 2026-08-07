export type TripInputValues = {
  name: string;
  startsOn: string;
  endsOn: string;
  notes: string;
};

export type TripInput = {
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  notes: string | null;
};

export type TripField = keyof TripInputValues;
export type TripFieldErrors = Partial<Record<TripField, string>>;

export type TripValidationResult =
  | { ok: true; value: TripInput; values: TripInputValues }
  | { ok: false; errors: TripFieldErrors; values: TripInputValues };

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function readValue(input: unknown, key: TripField) {
  const value = input !== null && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" ? value.trim() : "";
}

function validCalendarDate(value: string) {
  const match = datePattern.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validateTripInput(input: unknown): TripValidationResult {
  const values = {
    name: readValue(input, "name"),
    startsOn: readValue(input, "startsOn"),
    endsOn: readValue(input, "endsOn"),
    notes: readValue(input, "notes"),
  } satisfies TripInputValues;
  const errors: TripFieldErrors = {};

  if (!values.name) errors.name = "Name is required.";
  else if (values.name.length > 160) errors.name = "Name must be 160 characters or fewer.";
  if (values.startsOn && !validCalendarDate(values.startsOn)) errors.startsOn = "Enter a valid start date.";
  if (values.endsOn && !validCalendarDate(values.endsOn)) errors.endsOn = "Enter a valid end date.";
  if (!errors.startsOn && !errors.endsOn && values.startsOn && values.endsOn && values.endsOn < values.startsOn) {
    errors.endsOn = "End date must be on or after the start date.";
  }
  if (values.notes.length > 4000) errors.notes = "Notes must be 4000 characters or fewer.";
  if (Object.keys(errors).length > 0) return { ok: false, errors, values };

  return {
    ok: true,
    values,
    value: {
      name: values.name,
      startsOn: values.startsOn || null,
      endsOn: values.endsOn || null,
      notes: values.notes || null,
    },
  };
}
