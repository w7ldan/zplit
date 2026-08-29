"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import type {
  GroupSettlementActionState,
  GroupSettlementRecipientOption,
} from "@/domain/group-contracts";
import { formatRupiah, parseRupiah } from "@/domain/rupiah";
import { PaymentMethodFields } from "@/components/records/payment-method-fields";

type SettlementAction = (
  previousState: GroupSettlementActionState,
  formData: FormData,
) => Promise<GroupSettlementActionState>;

const emptyState = (recipientParticipantId: string): GroupSettlementActionState => ({
  fieldErrors: {},
  formError: "",
  values: {
    recipientParticipantId,
    amountRupiah: "",
    paymentMethodChoice: "",
    paymentMethodOther: "",
  },
});

function FieldError({ id, message }: { id: string; message?: string }) {
  return (
    <p className="group-settlement-form__field-error" id={id}>
      {message || "\u00a0"}
    </p>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="action-link action-link--primary"
      type="submit"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? "Recording payment…" : "Record payment"}
    </button>
  );
}

export function GroupSettlementForm({
  action,
  senderName,
  recipients,
}: {
  action: SettlementAction;
  senderName: string;
  recipients: GroupSettlementRecipientOption[];
}) {
  const [state, formAction] = useActionState(
    action,
    emptyState(recipients[0]?.id ?? ""),
  );
  const [recipientParticipantId, setRecipientParticipantId] = useState(
    state.values.recipientParticipantId,
  );
  const [amountRupiah, setAmountRupiah] = useState(state.values.amountRupiah);
  const [paymentMethodChoice, setPaymentMethodChoice] = useState(
    state.values.paymentMethodChoice,
  );
  const [paymentMethodOther, setPaymentMethodOther] = useState(
    state.values.paymentMethodOther,
  );
  const [proofFilename, setProofFilename] = useState("");
  const [localError, setLocalError] = useState("");
  const proofInput = useRef<HTMLInputElement>(null);
  const previousState = useRef(state);
  const selectedRecipient = recipients.find(
    (recipient) => recipient.id === recipientParticipantId,
  );
  const currentDebt = selectedRecipient?.currentDebt ?? 0;

  useEffect(() => {
    if (previousState.current === state) return;
    previousState.current = state;
    setRecipientParticipantId(state.values.recipientParticipantId);
    setAmountRupiah(state.values.amountRupiah);
    setPaymentMethodChoice(state.values.paymentMethodChoice);
    setPaymentMethodOther(state.values.paymentMethodOther);
  }, [state]);

  function submit(event: FormEvent<HTMLFormElement>) {
    const amount = parseRupiah(amountRupiah);
    const error = !recipientParticipantId
      ? "Choose a registered Group member."
      : amount === null || amount < 1
        ? "Enter a positive whole-rupiah amount."
        : currentDebt < 1
          ? "There is no current debt to settle with this member."
          : amount > currentDebt
            ? `The amount cannot exceed the current debt of ${formatRupiah(currentDebt)}.`
            : !paymentMethodChoice
              ? "Choose a payment method."
              : paymentMethodChoice === "Other" && !paymentMethodOther.trim()
                ? "Enter a custom payment method."
                : "";
    if (!error) {
      setLocalError("");
      return;
    }
    event.preventDefault();
    setLocalError(error);
  }

  return (
    <form
      className="group-settlement-form"
      action={formAction}
      onSubmit={submit}
      noValidate
    >
      <p className="group-settlement-form__context">
        You are recording this payment as <strong>{senderName}</strong>. The recipient must confirm it before it changes the Group balance.
      </p>
      <div className="group-settlement-form__field">
        <label htmlFor="group-settlement-recipient">Paid to</label>
        {recipients.length ? (
          <select
            id="group-settlement-recipient"
            name="recipientParticipantId"
            value={recipientParticipantId}
            onChange={(event) => {
              setRecipientParticipantId(event.target.value);
              setLocalError("");
            }}
            required
            aria-invalid={Boolean(state.fieldErrors.recipientParticipantId)}
            aria-describedby="group-settlement-recipient-help group-settlement-recipient-error"
          >
            {recipients.map((recipient) => (
              <option key={recipient.id} value={recipient.id}>
                {recipient.displayName}{recipient.label ? ` · ${recipient.label}` : ""}
              </option>
            ))}
          </select>
        ) : (
          <p className="group-settlement-form__empty">
            No active registered member currently has a settleable debt.
          </p>
        )}
        <p className="group-settlement-form__help" id="group-settlement-recipient-help">
          External and former participants cannot receive a new payment settlement.
        </p>
        <FieldError
          id="group-settlement-recipient-error"
          message={state.fieldErrors.recipientParticipantId}
        />
      </div>
      <div className="group-settlement-form__balance" aria-live="polite">
        <span>Current debt from you</span>
        <strong>{formatRupiah(currentDebt)}</strong>
        <p>Pending payments do not reduce this amount until the recipient confirms.</p>
      </div>
      <div className="group-settlement-form__field">
        <label htmlFor="group-settlement-amount">Amount in rupiah</label>
        <div className="group-settlement-form__amount-row">
          <input
            id="group-settlement-amount"
            name="amountRupiah"
            type="text"
            inputMode="numeric"
            value={amountRupiah}
            onChange={(event) => {
              setAmountRupiah(event.target.value);
              setLocalError("");
            }}
            required
            aria-invalid={Boolean(state.fieldErrors.amountRupiah)}
            aria-describedby="group-settlement-amount-help group-settlement-amount-error"
            autoComplete="off"
          />
          {currentDebt > 0 ? (
            <button
              className="action-link action-link--quiet"
              type="button"
              onClick={() => {
                setAmountRupiah(String(currentDebt));
                setLocalError("");
              }}
            >
              Use full current debt
            </button>
          ) : null}
        </div>
        <p className="group-settlement-form__help" id="group-settlement-amount-help">
          Whole rupiah only. The backend checks the current debt again when you submit.
        </p>
        <FieldError
          id="group-settlement-amount-error"
          message={state.fieldErrors.amountRupiah}
        />
      </div>
      <div className="group-settlement-form__field">
        <PaymentMethodFields
          idPrefix="group-settlement-payment-method"
          choice={paymentMethodChoice}
          other={paymentMethodOther}
          required
          error={state.fieldErrors.paymentMethodChoice}
          errorClassName="group-settlement-form__field-error"
          onChoiceChange={(choice) => {
            setPaymentMethodChoice(choice);
            setLocalError("");
          }}
          onOtherChange={setPaymentMethodOther}
        />
      </div>
      <div className="group-settlement-form__field">
        <label htmlFor="group-settlement-proof">Optional payment proof</label>
        <div className="expense-receipts__file-picker">
          <label
            className="action-link action-link--quiet"
            htmlFor="group-settlement-proof"
          >
            {proofFilename ? "Change" : "Choose payment proof image"}
          </label>
          {proofFilename ? (
            <>
              <span className="expense-receipts__filename">{proofFilename}</span>
              <button
                className="text-link"
                type="button"
                onClick={() => {
                  if (proofInput.current) proofInput.current.value = "";
                  setProofFilename("");
                }}
              >
                Clear
              </button>
            </>
          ) : null}
        </div>
        <input
          ref={proofInput}
          className="expense-receipts__file-input"
          id="group-settlement-proof"
          name="proof"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-describedby="group-settlement-proof-help group-settlement-proof-error"
          onChange={(event) => {
            setProofFilename(event.currentTarget.files?.[0]?.name ?? "");
            setLocalError("");
          }}
        />
        <p className="group-settlement-form__help" id="group-settlement-proof-help">
          JPEG, PNG, or WebP, up to 5 MiB. Proof is evidence only and does not confirm payment.
        </p>
        <FieldError
          id="group-settlement-proof-error"
          message={state.fieldErrors.proof}
        />
      </div>
      <p
        className="group-settlement-form__message"
        role={localError || state.formError ? "alert" : undefined}
        aria-live="polite"
      >
        {localError || state.formError || "\u00a0"}
      </p>
      <SubmitButton />
    </form>
  );
}
