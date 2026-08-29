"use client";

import {
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_METHOD_OTHER,
  canonicalPaymentMethod,
  recentPaymentMethodValues,
  type PaymentMethodChoice,
} from "@/domain/payment-method";

export function PaymentMethodFields({
  choice,
  other,
  recentMethods = [],
  error,
  idPrefix = "repayment-payment-method",
  errorClassName = "repayment-form__field-error",
  required = false,
  onChoiceChange,
  onOtherChange,
}: {
  choice: PaymentMethodChoice;
  other: string;
  recentMethods?: string[];
  error?: string;
  idPrefix?: string;
  errorClassName?: string;
  required?: boolean;
  onChoiceChange: (choice: PaymentMethodChoice) => void;
  onOtherChange: (other: string) => void;
}) {
  const recent = recentPaymentMethodValues(recentMethods).map((value, index) => ({
    value,
    canonical: canonicalPaymentMethod(value),
    customValue: `recent-custom-${index}`,
  }));
  const recentByValue = new Map(recent.map((method) => [method.customValue, method.value]));
  const recentCanonical = new Set(recent.flatMap((method) => method.canonical ? [method.canonical] : []));
  const errorId = `${idPrefix}-error`;

  return (
    <>
      <label htmlFor={idPrefix}>Payment method</label>
      <select
        id={idPrefix}
        name="paymentMethodChoice"
        value={choice}
        required={required}
        onChange={(event) => {
          const custom = recentByValue.get(event.target.value);
          if (custom && !canonicalPaymentMethod(custom)) {
            onChoiceChange(PAYMENT_METHOD_OTHER);
            onOtherChange(custom);
          } else {
            onChoiceChange(event.target.value as PaymentMethodChoice);
          }
        }}
        aria-invalid={Boolean(error)}
        aria-describedby={errorId}
      >
        <option value="">{required ? "Choose a payment method" : "Not specified"}</option>
        {choice === "" && recent.length > 0 ? (
          <optgroup label="Recent">
            {recent.map((method) => (
              <option
                key={method.customValue}
                value={method.canonical ?? method.customValue}
              >
                {method.canonical ?? method.value}
              </option>
            ))}
          </optgroup>
        ) : null}
        {PAYMENT_METHOD_OPTIONS
          .filter((option) => choice !== "" || !recentCanonical.has(option))
          .map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        <option value={PAYMENT_METHOD_OTHER}>{PAYMENT_METHOD_OTHER}</option>
      </select>
      {choice === PAYMENT_METHOD_OTHER ? (
        <input
          id={`${idPrefix}-other`}
          name="paymentMethodOther"
          type="text"
          maxLength={40}
          value={other}
          onChange={(event) => onOtherChange(event.target.value)}
          placeholder="Custom payment method"
          aria-label="Custom payment method"
          aria-invalid={Boolean(error)}
          aria-describedby={errorId}
          autoComplete="off"
        />
      ) : null}
      <p className={errorClassName} id={errorId}>
        {error || "\u00a0"}
      </p>
    </>
  );
}
