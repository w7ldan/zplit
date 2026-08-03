export type FriendInputValues = {
  name: string;
  phoneNumber: string;
  notes: string;
};

export type FriendInput = {
  name: string;
  phoneNumber: string | null;
  notes: string | null;
};

export type FriendField = keyof FriendInputValues;

export type FriendFieldErrors = Partial<Record<FriendField, string>>;

export type FriendValidationResult =
  | { ok: true; value: FriendInput; values: FriendInputValues }
  | { ok: false; errors: FriendFieldErrors; values: FriendInputValues };

function readValue(input: unknown, key: FriendField) {
  const value = input !== null && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" ? value.trim() : "";
}

export function validateFriendInput(input: unknown): FriendValidationResult {
  const values: FriendInputValues = {
    name: readValue(input, "name"),
    phoneNumber: readValue(input, "phoneNumber"),
    notes: readValue(input, "notes"),
  };
  const errors: FriendFieldErrors = {};

  if (!values.name) errors.name = "Name is required.";
  else if (values.name.length > 120) errors.name = "Name must be 120 characters or fewer.";

  if (values.phoneNumber.length > 32) errors.phoneNumber = "Phone number must be 32 characters or fewer.";
  if (values.notes.length > 2000) errors.notes = "Notes must be 2000 characters or fewer.";

  if (Object.keys(errors).length > 0) return { ok: false, errors, values };

  return {
    ok: true,
    values,
    value: {
      name: values.name,
      phoneNumber: values.phoneNumber || null,
      notes: values.notes || null,
    },
  };
}
