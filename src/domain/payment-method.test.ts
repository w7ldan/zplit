import { describe, expect, it } from "vitest";
import { PAYMENT_METHOD_OPTIONS, PAYMENT_METHOD_OTHER, parsePaymentMethodFields, paymentMethodFormState } from "./payment-method";

describe("payment methods", () => {
  it("keeps the canonical choices centralized", () => {
    for (const option of PAYMENT_METHOD_OPTIONS) {
      expect(parsePaymentMethodFields(option, "")).toMatchObject({ value: option, form: { choice: option, other: "" } });
      expect(paymentMethodFormState(option)).toEqual({ choice: option, other: "" });
    }
    expect(parsePaymentMethodFields("", "")).toMatchObject({ value: "", form: { choice: "", other: "" } });
  });

  it("requires and preserves Other custom values", () => {
    expect(parsePaymentMethodFields(PAYMENT_METHOD_OTHER, " ")).toMatchObject({ error: "Enter a custom payment method.", form: { choice: PAYMENT_METHOD_OTHER, other: "" } });
    expect(parsePaymentMethodFields(PAYMENT_METHOD_OTHER, "  Wallet  ")).toEqual({ value: "Wallet", form: { choice: PAYMENT_METHOD_OTHER, other: "Wallet" } });
  });

  it("reopens legacy arbitrary values as Other without rewriting them", () => {
    expect(paymentMethodFormState("Legacy wallet")).toEqual({ choice: PAYMENT_METHOD_OTHER, other: "Legacy wallet" });
  });
});
