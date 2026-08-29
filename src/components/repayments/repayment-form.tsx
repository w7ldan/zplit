"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { RepaymentActionState, RepaymentFriendContext } from "@/app/app/repayments/actions";
import type { RepaymentInputValues } from "@/domain/repayment-input";
import type { OpenExpenseShare } from "@/domain/ledger-repository";
import type { RepaymentAllocationStrategy } from "@/domain/repayment-allocation-strategy";
import {
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_METHOD_OTHER,
  canonicalPaymentMethod,
  paymentMethodFormState,
  recentPaymentMethodValues,
  type PaymentMethodChoice,
} from "@/domain/payment-method";
import { formatRupiah } from "@/domain/rupiah";
import { SearchableCombobox, type SearchableOption, type SearchableOptionAction } from "@/components/records/searchable-combobox";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { useRepaymentAllocationDraft } from "./use-repayment-allocation-draft";

type RepaymentAction = (previousState: RepaymentActionState, formData: FormData) => Promise<RepaymentActionState>;

type RepaymentFormProps = {
  action: RepaymentAction;
  friends: SearchableOption[];
  searchFriends: SearchableOptionAction;
  recentPaymentMethods?: string[];
  initialValues?: RepaymentInputValues;
  initialPaidAtUtc?: string;
  mode?: "create" | "edit";
  friendLocked?: boolean;
  initialAllocationIds?: string[];
  initialAllocationStrategy?: RepaymentAllocationStrategy;
  initialFriendContext?: RepaymentFriendContext;
  loadFriendContext?: (friendId: string, includeOpenExpenseShares?: boolean, tripId?: string) => Promise<RepaymentFriendContext>;
  tripContext?: { id: string; name: string };
  tripContextId?: string;
  outstandingByFriend?: Record<string, number>;
  openExpenseSharesByFriend?: Record<string, OpenExpenseShare[]>;
};

const emptyValues: RepaymentInputValues = {
  friendId: "",
  amountRupiah: "",
  paidAtLocal: "",
  timezoneOffsetMinutes: "",
  paymentMethod: "",
  notes: "",
};
const emptyOpenExpenseSharesByFriend: Record<string, OpenExpenseShare[]> = {};
const emptyActionState: RepaymentActionState = { fieldErrors: {}, formError: "", values: emptyValues, allocations: [] };

function localValueFromUtc(utc: string) {
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <button
      className="action-link action-link--primary repayment-form__submit"
      type="submit"
      disabled={pending}
      aria-busy={pending}
    >
      {pending
        ? mode === "create"
          ? "Recording repayment…"
          : "Saving repayment…"
        : mode === "create"
          ? "Record repayment"
          : "Save changes"}
    </button>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return (
    <p className="repayment-form__field-error" id={id}>
      {message || "\u00a0"}
    </p>
  );
}

function PaymentMethodFields({
  choice,
  other,
  recentMethods = [],
  error,
  onChoiceChange,
  onOtherChange,
}: {
  choice: PaymentMethodChoice;
  other: string;
  recentMethods?: string[];
  error?: string;
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
  return (
    <>
      <label htmlFor="repayment-payment-method">Payment method</label>
      <select
        id="repayment-payment-method"
        name="paymentMethodChoice"
        value={choice}
        onChange={(event) => {
          const custom = recentByValue.get(event.target.value);
          if (custom && !canonicalPaymentMethod(custom)) {
            onChoiceChange(PAYMENT_METHOD_OTHER);
            onOtherChange(custom);
          } else onChoiceChange(event.target.value as PaymentMethodChoice);
        }}
        aria-invalid={Boolean(error)}
        aria-describedby="repayment-payment-method-error"
      >
        <option value="">Not specified</option>
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
          id="repayment-payment-method-other"
          name="paymentMethodOther"
          type="text"
          maxLength={40}
          value={other}
          onChange={(event) => onOtherChange(event.target.value)}
          placeholder="Custom payment method"
          aria-label="Custom payment method"
          aria-invalid={Boolean(error)}
          aria-describedby="repayment-payment-method-error"
          autoComplete="off"
        />
      ) : null}
      <FieldError id="repayment-payment-method-error" message={error} />
    </>
  );
}

type RepaymentAllocationDraft = ReturnType<typeof useRepaymentAllocationDraft>;

function RepaymentAllocationSection({
  draft,
  state,
  disclosureRef,
}: {
  draft: RepaymentAllocationDraft;
  state: RepaymentActionState;
  disclosureRef: React.RefObject<HTMLDetailsElement | null>;
}) {
  const {
    addAllocation,
    allocationDisclosureOpen,
    allocationOptions,
    allocationRows,
    allocationStrategy,
    loadingFriendContext,
    removeAllocation,
    searchOutstandingExpenses,
    selectedAllocationIdSet,
    selectedAllocationIds,
    selectedAllocationRows,
    selectedFriendId,
    selectedShares,
    setAllocationStrategy,
    updateAllocationAmount,
  } = draft;
  return (
    <details
      ref={disclosureRef}
      open={allocationDisclosureOpen || undefined}
      className="repayment-form__disclosure"
    >
      <summary>Allocate now</summary>
      <section
        className="repayment-form__allocations"
        aria-labelledby="repayment-allocations-heading"
      >
        <h2 id="repayment-allocations-heading">Apply to outstanding expenses</h2>
        <p className="repayment-form__help">
          Optional. Leave these blank to allocate the repayment later.
        </p>
        <div className="repayment-form__field">
          <label htmlFor="repayment-allocation-strategy">
            Allocation strategy
          </label>
          <select
            id="repayment-allocation-strategy"
            value={allocationStrategy}
            onChange={(event) =>
              setAllocationStrategy(
                event.target.value as RepaymentAllocationStrategy,
              )
            }
          >
            <option value="manual">Manual</option>
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
          </select>
        </div>
        <div className="repayment-form__allocation-add">
          <label id="repayment-add-expense-label" htmlFor="repayment-add-expense">
            Add outstanding expense
          </label>
          <SearchableCombobox
            key={
              "repayment-add-expense-" +
              selectedFriendId +
              "-" +
              selectedAllocationIds.join("-")
            }
            id="repayment-add-expense"
            value=""
            options={allocationOptions}
            search={searchOutstandingExpenses}
            disabled={loadingFriendContext}
            placeholder="Choose outstanding expense"
            searchLabel="Search outstanding expenses"
            labelId="repayment-add-expense-label"
            onValueChange={(option) => {
              if (
                loadingFriendContext ||
                selectedAllocationIdSet.has(option.id) ||
                !selectedShares.some((share) => share.id === option.id)
              ) return;
              addAllocation(option.id);
            }}
          />
        </div>
        <noscript>
          <div className="repayment-form__allocation-fallback">
            <label htmlFor="repayment-add-expense-fallback">
              Outstanding expense
            </label>
            <select
              id="repayment-add-expense-fallback"
              name="expenseShareId"
              defaultValue=""
            >
              <option value="">No expense selected</option>
              {selectedShares.slice(0, 20).map((share) => (
                <option key={share.id} value={share.id}>
                  {share.expenseDescription} · {share.outingTitle} · {formatRupiah(share.remainingAmount)} remaining
                </option>
              ))}
            </select>
            <label htmlFor="repayment-add-expense-amount-fallback">
              Allocation amount
            </label>
            <input
              id="repayment-add-expense-amount-fallback"
              name="amountRupiah"
              type="text"
              inputMode="numeric"
              placeholder="Optional"
            />
          </div>
        </noscript>
        {selectedAllocationRows.map((share) => (
          <div className="repayment-form__allocation" key={share.id}>
            <div className="repayment-form__allocation-details">
              <strong>{share.expenseDescription}</strong>
              <span>
                {share.outingTitle} · <LocalDateTime iso={share.outingOccurredAt.toISOString()} mode="date" />
              </span>
              <span>
                Original share {formatRupiah(share.amountOwed)} · Previously repaid {formatRupiah(share.repaidAmount)} · Remaining {formatRupiah(share.remainingAmount)}
              </span>
            </div>
            <input type="hidden" name="expenseShareId" value={share.id} readOnly />
            <label htmlFor={"repayment-allocation-" + share.id}>
              Allocation for {share.expenseDescription}
            </label>
            <input
              id={"repayment-allocation-" + share.id}
              name="amountRupiah"
              type="text"
              inputMode="numeric"
              placeholder="Optional"
              value={
                allocationRows.find(
                  (allocation) => allocation.expenseShareId === share.id,
                )?.amountRupiah ?? ""
              }
              onChange={(event) =>
                updateAllocationAmount(share.id, event.target.value)
              }
              aria-invalid={Boolean(state.allocationFieldErrors?.[share.id])}
            />
            {state.allocationFieldErrors?.[share.id] ? (
              <p className="repayment-form__field-error">
                {state.allocationFieldErrors[share.id]}
              </p>
            ) : null}
            <button
              className="action-link action-link--quiet repayment-form__allocation-remove"
              type="button"
              onClick={() => removeAllocation(share.id)}
            >
              Remove
            </button>
          </div>
        ))}
        {selectedShares.length === 0 && !loadingFriendContext ? (
          <p className="repayment-form__help">
            No outstanding expense shares for this friend.
          </p>
        ) : null}
      </section>
    </details>
  );
}

function RepaymentDetailsFields({
  state,
  mode,
  detailsRef,
  detailsOpen,
  paymentMethodChoice,
  paymentMethodOther,
  recentPaymentMethods,
  onChoiceChange,
  onOtherChange,
}: {
  state: RepaymentActionState;
  mode: "create" | "edit";
  detailsRef: React.RefObject<HTMLDetailsElement | null>;
  detailsOpen: boolean;
  paymentMethodChoice: PaymentMethodChoice;
  paymentMethodOther: string;
  recentPaymentMethods: string[];
  onChoiceChange: (choice: PaymentMethodChoice) => void;
  onOtherChange: (other: string) => void;
}) {
  const fields = (
    <>
      <div className="repayment-form__field">
        <PaymentMethodFields
          choice={paymentMethodChoice}
          other={paymentMethodOther}
          recentMethods={recentPaymentMethods}
          error={state.fieldErrors.paymentMethod}
          onChoiceChange={onChoiceChange}
          onOtherChange={onOtherChange}
        />
      </div>
      <div className="repayment-form__field">
        <label htmlFor="repayment-notes">Notes</label>
        <textarea
          key={state.values.notes}
          id="repayment-notes"
          name="notes"
          maxLength={4000}
          defaultValue={state.values.notes}
          aria-invalid={Boolean(state.fieldErrors.notes)}
          aria-describedby="repayment-notes-error"
          rows={5}
        />
        <FieldError
          id="repayment-notes-error"
          message={state.fieldErrors.notes}
        />
      </div>
    </>
  );
  return mode === "create" ? (
    <details
      ref={detailsRef}
      open={detailsOpen || undefined}
      className="repayment-form__disclosure"
    >
      <summary>Optional details</summary>
      {fields}
    </details>
  ) : (
    fields
  );
}

function RepaymentBasicFields({
  state,
  searchFriends,
  friendLocked,
  selectedFriendId,
  friendOptionsWithSelection,
  handleFriendChange,
  outstandingAmount,
  tripContext,
  tripContextId,
  amountRef,
  handleAmountChange,
  loadingFriendContext,
  selectedContext,
  timezoneOffsetRef,
  mode,
}: {
  state: RepaymentActionState;
  searchFriends: SearchableOptionAction;
  friendLocked: boolean;
  selectedFriendId: string;
  friendOptionsWithSelection: SearchableOption[];
  handleFriendChange: (option: SearchableOption) => void;
  outstandingAmount: number;
  tripContext: { id: string; name: string } | undefined;
  tripContextId: string | undefined;
  amountRef: React.RefObject<HTMLInputElement | null>;
  handleAmountChange: (value: string) => void;
  loadingFriendContext: boolean;
  selectedContext: { outstandingAmount: number } | undefined;
  timezoneOffsetRef: React.RefObject<HTMLInputElement | null>;
  mode: "create" | "edit";
}) {
  return (
    <>
      <div className="repayment-form__field">
        <label id="repayment-friend-label" htmlFor="repayment-friend">
          Friend
        </label>
        <SearchableCombobox
          id="repayment-friend"
          name="friendId"
          value={selectedFriendId}
          options={friendOptionsWithSelection}
          search={searchFriends}
          required={!friendLocked}
          disabled={friendLocked}
          placeholder="Choose friend"
          searchLabel="Search friends"
          ariaInvalid={Boolean(state.fieldErrors.friendId)}
          ariaDescribedBy="repayment-friend-error"
          labelId="repayment-friend-label"
          onValueChange={handleFriendChange}
        />
        <p className="repayment-form__outstanding" aria-live="polite">
          Outstanding for {friendOptionsWithSelection.find((friend) => friend.id === selectedFriendId)?.label ?? "this friend"}: {formatRupiah(outstandingAmount)}
        </p>
        {tripContext ? (
          <p className="repayment-form__context" aria-live="polite">
            Recording repayment for {friendOptionsWithSelection.find((friend) => friend.id === selectedFriendId)?.label ?? "this friend"} · {tripContext.name}
            <br />
            <span>
              Allocating within {tripContext.name}. Amounts above its remaining balance stay unallocated.
            </span>
          </p>
        ) : null}
        {friendLocked ? (
          <p className="repayment-form__help">
            The friend is fixed while this repayment has allocations.
          </p>
        ) : null}
        <FieldError
          id="repayment-friend-error"
          message={state.fieldErrors.friendId}
        />
      </div>
      {tripContextId ? (
        <input
          type="hidden"
          name="tripId"
          value={tripContextId}
          readOnly
        />
      ) : null}
      <div className="repayment-form__field">
        <label htmlFor="repayment-amount">Amount in rupiah</label>
        <div className="repayment-form__amount-row">
          <input
            ref={amountRef}
            key={state.values.amountRupiah}
            id="repayment-amount"
            name="amountRupiah"
            type="text"
            inputMode="numeric"
            required
            defaultValue={state.values.amountRupiah}
            onChange={(event) => handleAmountChange(event.target.value)}
            aria-invalid={Boolean(state.fieldErrors.amountRupiah)}
            aria-describedby="repayment-amount-help repayment-amount-error"
            autoComplete="off"
          />
          {mode === "create" &&
          !loadingFriendContext &&
          selectedContext &&
          selectedContext.outstandingAmount > 0 ? (
            <button
              className="action-link action-link--quiet repayment-form__full-outstanding"
              type="button"
              onClick={() => {
                if (!selectedContext) return;
                handleAmountChange(selectedContext.outstandingAmount.toString());
                amountRef.current?.focus();
              }}
            >
              Use full outstanding
            </button>
          ) : null}
        </div>
        <p className="repayment-form__help" id="repayment-amount-help">
          Whole rupiah only. Examples: 84000 or 84.000.
        </p>
        <FieldError
          id="repayment-amount-error"
          message={state.fieldErrors.amountRupiah}
        />
      </div>
      <div className="repayment-form__field">
        <label htmlFor="repayment-paid-at">Payment date and time</label>
        <input
          key={state.values.paidAtLocal}
          id="repayment-paid-at"
          name="paidAtLocal"
          type="datetime-local"
          required
          defaultValue={state.values.paidAtLocal}
          aria-invalid={Boolean(state.fieldErrors.paidAtLocal)}
          aria-describedby="repayment-paid-at-error"
        />
        <FieldError
          id="repayment-paid-at-error"
          message={state.fieldErrors.paidAtLocal}
        />
      </div>
      <input
        key={state.values.timezoneOffsetMinutes}
        ref={timezoneOffsetRef}
        type="hidden"
        name="timezoneOffsetMinutes"
        defaultValue={state.values.timezoneOffsetMinutes}
      />
    </>
  );
}

export function RepaymentForm({
  action,
  friends: friendOptions,
  searchFriends,
  recentPaymentMethods = [],
  initialValues = emptyValues,
  initialPaidAtUtc,
  mode = "create",
  friendLocked = false,
  initialAllocationIds = [],
  initialAllocationStrategy = "manual",
  initialFriendContext,
  loadFriendContext,
  tripContext,
  tripContextId,
  outstandingByFriend = {},
  openExpenseSharesByFriend = emptyOpenExpenseSharesByFriend,
}: RepaymentFormProps) {
  const [state, formAction] = useActionState(action, {
    ...emptyActionState,
    values: initialValues,
  });
  const initialPaymentMethod = paymentMethodFormState(initialValues.paymentMethod);
  const [paymentMethodChoice, setPaymentMethodChoice] = useState<PaymentMethodChoice>(initialPaymentMethod.choice);
  const [paymentMethodOther, setPaymentMethodOther] = useState(initialPaymentMethod.other);
  const formRef = useRef<HTMLFormElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const timezoneOffsetRef = useRef<HTMLInputElement>(null);
  const allocationDisclosureRef = useRef<HTMLDetailsElement>(null);
  const detailsDisclosureRef = useRef<HTMLDetailsElement>(null);
  const previousActionStateRef = useRef(state);
  const initializedRef = useRef(false);
  const allocation = useRepaymentAllocationDraft({
    actionState: state,
    amountRef,
    friendOptions,
    initialAllocationIds,
    initialAllocationStrategy,
    initialFriendContext,
    initialValues,
    loadFriendContext,
    mode,
    openExpenseSharesByFriend,
    outstandingByFriend,
    tripContextId,
  });
  const {
    allocationDisclosureOpen,
    friendOptionsWithSelection,
    handleAmountChange,
    handleFriendChange,
    loadingFriendContext,
    outstandingAmount,
    selectedContext,
    selectedFriendId,
  } = allocation;
  const detailsDisclosureOpen = Boolean(
    state.values.paymentMethod ||
    state.values.notes ||
    state.fieldErrors.paymentMethod ||
    state.fieldErrors.notes,
  );

  useEffect(() => {
    if (state === previousActionStateRef.current) return;
    const paymentMethod = state.paymentMethodForm ?? paymentMethodFormState(state.values.paymentMethod);
    setPaymentMethodChoice(paymentMethod.choice);
    setPaymentMethodOther(paymentMethod.other);
  }, [state]);

  useEffect(() => {
    if (timezoneOffsetRef.current) timezoneOffsetRef.current.value = new Date().getTimezoneOffset().toString();
    if (
      !initializedRef.current &&
      initialPaidAtUtc &&
      (mode === "edit" || !initialValues.paidAtLocal)
    ) {
      initializedRef.current = true;
      const localValue = localValueFromUtc(initialPaidAtUtc);
      const paidAtInput = formRef.current?.elements.namedItem("paidAtLocal");
      if (paidAtInput instanceof HTMLInputElement && localValue) paidAtInput.value = localValue;
    }
  }, [initialPaidAtUtc, initialValues.paidAtLocal, mode]);

  useEffect(() => {
    if (state === previousActionStateRef.current) return;
    previousActionStateRef.current = state;
    if (allocationDisclosureOpen) allocationDisclosureRef.current?.setAttribute("open", "");
    if (detailsDisclosureOpen) detailsDisclosureRef.current?.setAttribute("open", "");
  }, [allocationDisclosureOpen, detailsDisclosureOpen, state]);

  function setCurrentTimezoneOffset() {
    if (timezoneOffsetRef.current) timezoneOffsetRef.current.value = new Date().getTimezoneOffset().toString();
  }

  return (
    <form
      ref={formRef}
      className="repayment-form"
      action={formAction}
      noValidate
      onSubmit={setCurrentTimezoneOffset}
    >
      <RepaymentBasicFields
        state={state}
        searchFriends={searchFriends}
        friendLocked={friendLocked}
        selectedFriendId={selectedFriendId}
        friendOptionsWithSelection={friendOptionsWithSelection}
        handleFriendChange={handleFriendChange}
        outstandingAmount={outstandingAmount}
        tripContext={tripContext}
        tripContextId={tripContextId}
        amountRef={amountRef}
        handleAmountChange={handleAmountChange}
        loadingFriendContext={loadingFriendContext}
        selectedContext={selectedContext}
        timezoneOffsetRef={timezoneOffsetRef}
        mode={mode}
      />
      {mode === "create" ? (
        <RepaymentAllocationSection
          draft={allocation}
          state={state}
          disclosureRef={allocationDisclosureRef}
        />
      ) : null}
      <RepaymentDetailsFields
        state={state}
        mode={mode}
        detailsRef={detailsDisclosureRef}
        detailsOpen={detailsDisclosureOpen}
        paymentMethodChoice={paymentMethodChoice}
        paymentMethodOther={paymentMethodOther}
        recentPaymentMethods={recentPaymentMethods}
        onChoiceChange={setPaymentMethodChoice}
        onOtherChange={setPaymentMethodOther}
      />
      <p
        className="repayment-form__message"
        role={state.formError ? "alert" : undefined}
        aria-live="polite"
      >
        {state.formError || "\u00a0"}
      </p>
      <SubmitButton mode={mode} />
    </form>
  );
}
