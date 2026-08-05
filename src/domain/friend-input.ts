import { COUNTRY_CALLING_CODES, OTHER_COUNTRY_CODE, type FriendPhoneFormValues, splitFriendPhone } from "./country-calling-codes";

export type FriendInputValues = {
  name: string;
  phoneNumber: string;
  notes: string;
  countryCode?: string;
  otherCountryCode?: string;
  legacyPhoneNumber?: string;
  phoneFieldsChanged?: boolean;
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

function readValue(input: unknown, key: string) {
  const value = input !== null && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" ? value.trim() : "";
}

function normalizePhone(values: FriendPhoneFormValues, touched: boolean) {
  if (!touched && values.legacyPhoneNumber) return { phoneNumber: values.legacyPhoneNumber };
  if (!values.phoneNumber) return { phoneNumber: null };
  if (!/^[\d\s().-]+$/.test(values.phoneNumber) || values.phoneNumber.replace(/\D/g, "").startsWith("0")) {
    return { error: values.phoneNumber.replace(/\D/g, "").startsWith("0") ? "Omit the domestic leading zero." : "Phone number contains invalid characters." };
  }

  const nationalDigits = values.phoneNumber.replace(/\D/g, "");
  const callingCode = values.countryCode === OTHER_COUNTRY_CODE ? values.otherCountryCode : values.countryCode;
  if (!callingCode) return { error: "Country code is required." };
  if (values.countryCode !== OTHER_COUNTRY_CODE && !COUNTRY_CALLING_CODES.some((country) => country.value === callingCode)) {
    return { error: "Select a valid country code." };
  }
  if (values.countryCode === OTHER_COUNTRY_CODE && !/^\+\d{1,3}$/.test(callingCode)) {
    return { error: "Enter a valid calling code beginning with +." };
  }

  const totalDigits = callingCode.replace(/\D/g, "").length + nationalDigits.length;
  if (totalDigits < 8 || totalDigits > 15) return { error: "Phone number must contain 8–15 digits including the country code." };
  return { phoneNumber: `+${callingCode.replace(/\D/g, "")}${nationalDigits}` };
}

export function friendPhoneFormValues(values: Partial<FriendInputValues>): FriendPhoneFormValues {
  if (typeof values.countryCode === "string") {
    return {
      countryCode: values.countryCode,
      otherCountryCode: values.otherCountryCode ?? "",
      phoneNumber: values.phoneNumber ?? "",
      legacyPhoneNumber: values.legacyPhoneNumber ?? "",
    };
  }
  return splitFriendPhone(values.phoneNumber);
}

export function validateFriendInput(input: unknown): FriendValidationResult {
  const phoneNumber = readValue(input, "phoneNumber");
  const legacyPhoneNumber = readValue(input, "legacyPhoneNumber");
  const hasCountryCode = input !== null && typeof input === "object" && Object.prototype.hasOwnProperty.call(input, "countryCode");
  const values: FriendInputValues = {
    name: readValue(input, "name"),
    phoneNumber,
    notes: readValue(input, "notes"),
    countryCode: hasCountryCode ? readValue(input, "countryCode") : "+62",
    otherCountryCode: readValue(input, "otherCountryCode"),
    legacyPhoneNumber,
    phoneFieldsChanged: readValue(input, "phoneFieldsChanged") === "1",
  };
  const errors: FriendFieldErrors = {};

  if (!values.name) errors.name = "Name is required.";
  else if (values.name.length > 120) errors.name = "Name must be 120 characters or fewer.";
  if (values.phoneNumber.length > 32) errors.phoneNumber = "Phone number must be 32 characters or fewer.";
  if (values.notes.length > 2000) errors.notes = "Notes must be 2000 characters or fewer.";

  const normalized = errors.phoneNumber ? { phoneNumber: null } : normalizePhone({
    countryCode: values.countryCode ?? "+62",
    otherCountryCode: values.otherCountryCode ?? "",
    phoneNumber: values.phoneNumber,
    legacyPhoneNumber: values.legacyPhoneNumber ?? "",
  }, Boolean(values.phoneFieldsChanged));
  if ("error" in normalized) errors.phoneNumber = normalized.error;
  if (Object.keys(errors).length > 0) return { ok: false, errors, values };

  const normalizedPhoneNumber: string | null = "phoneNumber" in normalized ? normalized.phoneNumber ?? null : null;
  return {
    ok: true,
    values,
    value: { name: values.name, phoneNumber: normalizedPhoneNumber, notes: values.notes || null },
  };
}
