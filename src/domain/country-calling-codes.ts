export const COUNTRY_CALLING_CODES = [
  { value: "+62", label: "Indonesia", code: "+62" },
  { value: "+1", label: "United States / Canada", code: "+1" },
  { value: "+44", label: "United Kingdom", code: "+44" },
  { value: "+60", label: "Malaysia", code: "+60" },
  { value: "+61", label: "Australia", code: "+61" },
  { value: "+63", label: "Philippines", code: "+63" },
  { value: "+64", label: "New Zealand", code: "+64" },
  { value: "+65", label: "Singapore", code: "+65" },
  { value: "+66", label: "Thailand", code: "+66" },
  { value: "+81", label: "Japan", code: "+81" },
  { value: "+82", label: "South Korea", code: "+82" },
  { value: "+84", label: "Vietnam", code: "+84" },
  { value: "+86", label: "China", code: "+86" },
  { value: "+91", label: "India", code: "+91" },
] as const;

export const OTHER_COUNTRY_CODE = "other";

export type FriendPhoneFormValues = {
  countryCode: string;
  otherCountryCode: string;
  phoneNumber: string;
  legacyPhoneNumber: string;
};

export function splitFriendPhone(phoneNumber: string | null | undefined): FriendPhoneFormValues {
  const value = phoneNumber?.trim() ?? "";
  const digits = value.replaceAll("+", "");
  if (!value) return { countryCode: "+62", otherCountryCode: "", phoneNumber: "", legacyPhoneNumber: "" };
  if (/^\+\d{8,15}$/.test(value)) {
    const configured = [...COUNTRY_CALLING_CODES].sort((left, right) => right.code.length - left.code.length).find((country) => digits.startsWith(country.code.slice(1)));
    if (configured) {
      return { countryCode: configured.value, otherCountryCode: "", phoneNumber: digits.slice(configured.code.length - 1), legacyPhoneNumber: "" };
    }
    return { countryCode: OTHER_COUNTRY_CODE, otherCountryCode: `+${digits.slice(0, 3)}`, phoneNumber: digits.slice(3), legacyPhoneNumber: "" };
  }
  return { countryCode: OTHER_COUNTRY_CODE, otherCountryCode: "", phoneNumber: value, legacyPhoneNumber: value };
}
