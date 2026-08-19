export const PAYMENT_METHOD_OPTIONS = ["Bank transfer", "GoPay", "ShopeePay", "Cash"] as const;
export const PAYMENT_METHOD_OTHER = "Other" as const;

export type PaymentMethodOption = (typeof PAYMENT_METHOD_OPTIONS)[number];
export type PaymentMethodChoice = "" | PaymentMethodOption | typeof PAYMENT_METHOD_OTHER;
export type PaymentMethodFormState = { choice: PaymentMethodChoice; other: string };

export function paymentMethodFormState(value: string | null | undefined): PaymentMethodFormState {
  const normalized = value?.trim() ?? "";
  if (!normalized) return { choice: "", other: "" };
  if ((PAYMENT_METHOD_OPTIONS as readonly string[]).includes(normalized)) return { choice: normalized as PaymentMethodOption, other: "" };
  return { choice: PAYMENT_METHOD_OTHER, other: normalized };
}

export function parsePaymentMethodFields(choice: unknown, other: unknown) {
  const selected = typeof choice === "string" ? choice.trim() : "";
  const custom = typeof other === "string" ? other.trim() : "";
  if (!selected) return { value: "", form: { choice: "" as const, other: "" } };
  if (selected === PAYMENT_METHOD_OTHER) return custom ? { value: custom, form: { choice: PAYMENT_METHOD_OTHER, other: custom } } : { value: "", form: { choice: PAYMENT_METHOD_OTHER, other: "" }, error: "Enter a custom payment method." };
  if ((PAYMENT_METHOD_OPTIONS as readonly string[]).includes(selected)) return { value: selected, form: { choice: selected as PaymentMethodOption, other: "" } };
  return { value: "", form: { choice: "" as const, other: "" }, error: "Select a valid payment method." };
}
