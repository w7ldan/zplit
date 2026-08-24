export const REPAYMENT_DESTINATION_TYPES = ["bank_account", "e_wallet", "other"] as const;
export type RepaymentDestinationType = (typeof REPAYMENT_DESTINATION_TYPES)[number];

export const REPAYMENT_DESTINATION_LIMITS = {
  name: 120,
  identifier: 255,
  accountName: 120,
  note: 1000,
} as const;

export type RepaymentDestinationInput = {
  type: RepaymentDestinationType;
  name: string;
  identifier: string;
  accountName: string | null;
  note: string | null;
  shareOnBalanceLinks: boolean;
};

export type RepaymentDestinationFormValues = {
  type: string;
  name: string;
  identifier: string;
  accountName: string;
  note: string;
  shareOnBalanceLinks: boolean;
};

export type RepaymentDestinationField = keyof RepaymentDestinationFormValues;
export type RepaymentDestinationFieldErrors = Partial<Record<RepaymentDestinationField, string>>;

export type RepaymentDestinationValidationResult =
  | { ok: true; value: RepaymentDestinationInput; values: RepaymentDestinationFormValues }
  | { ok: false; errors: RepaymentDestinationFieldErrors; values: RepaymentDestinationFormValues };

export type PublicRepaymentDestination = {
  type: RepaymentDestinationType;
  name: string;
  identifier: string;
  accountName: string | null;
  note: string | null;
};

function readValue(input: unknown, key: string) {
  const value = input !== null && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" ? value.trim() : "";
}

function readBoolean(input: unknown, key: string) {
  const value = input !== null && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined;
  return value === true || value === "true" || value === "on" || value === "1";
}

export function destinationTypeLabel(type: RepaymentDestinationType) {
  return type === "bank_account" ? "BANK ACCOUNT" : type === "e_wallet" ? "E-WALLET" : "OTHER";
}

export function identifierLabel(type: string) {
  return type === "bank_account" ? "Account number" : type === "e_wallet" ? "Phone / account number" : "Repayment details";
}

export function parseRepaymentDestination(input: unknown): RepaymentDestinationValidationResult {
  const values: RepaymentDestinationFormValues = {
    type: readValue(input, "type").toLowerCase(),
    name: readValue(input, "name"),
    identifier: readValue(input, "identifier"),
    accountName: readValue(input, "accountName"),
    note: readValue(input, "note"),
    shareOnBalanceLinks: readBoolean(input, "shareOnBalanceLinks"),
  };
  const errors: RepaymentDestinationFieldErrors = {};

  if (!REPAYMENT_DESTINATION_TYPES.includes(values.type as RepaymentDestinationType)) errors.type = "Select a valid destination type.";
  if (!values.name) errors.name = "Name is required.";
  else if (values.name.length > REPAYMENT_DESTINATION_LIMITS.name) errors.name = `Name must be ${REPAYMENT_DESTINATION_LIMITS.name} characters or fewer.`;
  if (!values.identifier) errors.identifier = "Identifier or details are required.";
  else if (values.identifier.length > REPAYMENT_DESTINATION_LIMITS.identifier) errors.identifier = `Identifier or details must be ${REPAYMENT_DESTINATION_LIMITS.identifier} characters or fewer.`;
  if (values.accountName.length > REPAYMENT_DESTINATION_LIMITS.accountName) errors.accountName = `Account holder must be ${REPAYMENT_DESTINATION_LIMITS.accountName} characters or fewer.`;
  if (values.note.length > REPAYMENT_DESTINATION_LIMITS.note) errors.note = `Note must be ${REPAYMENT_DESTINATION_LIMITS.note} characters or fewer.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors, values };
  return {
    ok: true,
    values,
    value: {
      type: values.type as RepaymentDestinationType,
      name: values.name,
      identifier: values.identifier,
      accountName: values.accountName || null,
      note: values.note || null,
      shareOnBalanceLinks: values.shareOnBalanceLinks,
    },
  };
}

export function toPublicRepaymentDestination(destination: Pick<RepaymentDestinationInput, "type" | "name" | "identifier" | "accountName" | "note">): PublicRepaymentDestination {
  return {
    type: destination.type,
    name: destination.name,
    identifier: destination.identifier,
    accountName: destination.accountName,
    note: destination.note,
  };
}
