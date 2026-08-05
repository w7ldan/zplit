"use client";

import type { InferSelectModel } from "drizzle-orm";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { RepaymentActionState } from "@/app/app/repayments/actions";
import type { friends } from "@/db/schema";
import type { RepaymentInputValues } from "@/domain/repayment-input";
import type { OpenExpenseShare } from "@/domain/ledger-repository";
import { formatRupiah } from "@/domain/rupiah";

type RepaymentAction = (previousState: RepaymentActionState, formData: FormData) => Promise<RepaymentActionState>;

type RepaymentFormProps = {
  action: RepaymentAction;
  friends: Array<InferSelectModel<typeof friends>>;
  initialValues?: RepaymentInputValues;
  initialPaidAtUtc?: string;
  mode?: "create" | "edit";
  friendLocked?: boolean;
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
    <button className="action-link action-link--primary repayment-form__submit" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? (mode === "create" ? "Recording repayment…" : "Saving repayment…") : mode === "create" ? "Record repayment" : "Save changes"}
    </button>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return <p className="repayment-form__field-error" id={id}>{message || "\u00a0"}</p>;
}

export function RepaymentForm({ action, friends: friendOptions, initialValues = emptyValues, initialPaidAtUtc, mode = "create", friendLocked = false, outstandingByFriend = {}, openExpenseSharesByFriend = {} }: RepaymentFormProps) {
  const [state, formAction] = useActionState(action, { ...emptyActionState, values: initialValues });
  const [selectedFriendId, setSelectedFriendId] = useState(initialValues.friendId || friendOptions[0]?.id || "");
  const [draftAllocations, setDraftAllocations] = useState<Record<string, string>>(() => Object.fromEntries((state.allocations ?? []).map((allocation) => [allocation.expenseShareId, allocation.amountRupiah])));
  const formRef = useRef<HTMLFormElement>(null);
  const timezoneOffsetRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);
  const selectedShares = openExpenseSharesByFriend[selectedFriendId] ?? [];

  useEffect(() => {
    if (timezoneOffsetRef.current) timezoneOffsetRef.current.value = new Date().getTimezoneOffset().toString();
    if (!initializedRef.current && initialPaidAtUtc && !initialValues.paidAtLocal) {
      initializedRef.current = true;
      const localValue = localValueFromUtc(initialPaidAtUtc);
      const paidAtInput = formRef.current?.elements.namedItem("paidAtLocal");
      if (paidAtInput instanceof HTMLInputElement && localValue) paidAtInput.value = localValue;
    }
  }, [initialPaidAtUtc, initialValues.paidAtLocal]);

  function setCurrentTimezoneOffset() {
    if (timezoneOffsetRef.current) timezoneOffsetRef.current.value = new Date().getTimezoneOffset().toString();
  }

  return (
    <form
      ref={formRef}
      key={`${state.values.friendId}\u0000${state.values.amountRupiah}\u0000${state.values.paidAtLocal}\u0000${state.values.timezoneOffsetMinutes}\u0000${state.values.paymentMethod}\u0000${state.values.notes}`}
      className="repayment-form"
      action={formAction}
      noValidate
      onSubmit={setCurrentTimezoneOffset}
    >
      <div className="repayment-form__field">
        <label htmlFor="repayment-friend">Friend</label>
        {friendLocked ? <input type="hidden" name="friendId" value={state.values.friendId} /> : null}
        <select id="repayment-friend" name={friendLocked ? undefined : "friendId"} required disabled={friendLocked} defaultValue={state.values.friendId || friendOptions[0]?.id || ""} onChange={(event) => { setSelectedFriendId(event.target.value); setDraftAllocations({}); }} aria-invalid={Boolean(state.fieldErrors.friendId)} aria-describedby="repayment-friend-error">
          {friendOptions.map((friend) => <option key={friend.id} value={friend.id}>{friend.name}{friend.archivedAt ? " (ARCHIVED)" : ""}</option>)}
        </select>
        <p className="repayment-form__outstanding" aria-live="polite">Outstanding for {friendOptions.find((friend) => friend.id === selectedFriendId)?.name ?? "this friend"}: {formatRupiah(outstandingByFriend[selectedFriendId] ?? 0)}</p>
        {friendLocked ? <p className="repayment-form__help">The friend is fixed while this repayment has allocations.</p> : null}
        <FieldError id="repayment-friend-error" message={state.fieldErrors.friendId} />
      </div>
      <div className="repayment-form__field">
        <label htmlFor="repayment-amount">Amount in rupiah</label>
        <input id="repayment-amount" name="amountRupiah" type="text" inputMode="numeric" required defaultValue={state.values.amountRupiah} aria-invalid={Boolean(state.fieldErrors.amountRupiah)} aria-describedby="repayment-amount-help repayment-amount-error" autoComplete="off" />
        <p className="repayment-form__help" id="repayment-amount-help">Whole rupiah only. Examples: 84000 or 84.000.</p>
        <FieldError id="repayment-amount-error" message={state.fieldErrors.amountRupiah} />
      </div>
      <div className="repayment-form__field">
        <label htmlFor="repayment-paid-at">Payment date and time</label>
        <input id="repayment-paid-at" name="paidAtLocal" type="datetime-local" required defaultValue={state.values.paidAtLocal} aria-invalid={Boolean(state.fieldErrors.paidAtLocal)} aria-describedby="repayment-paid-at-error" />
        <FieldError id="repayment-paid-at-error" message={state.fieldErrors.paidAtLocal} />
      </div>
      <input ref={timezoneOffsetRef} type="hidden" name="timezoneOffsetMinutes" defaultValue={state.values.timezoneOffsetMinutes} />
      <div className="repayment-form__field">
        <label htmlFor="repayment-payment-method">Payment method</label>
        <input id="repayment-payment-method" name="paymentMethod" maxLength={40} defaultValue={state.values.paymentMethod} aria-invalid={Boolean(state.fieldErrors.paymentMethod)} aria-describedby="repayment-payment-method-error" autoComplete="off" />
        <FieldError id="repayment-payment-method-error" message={state.fieldErrors.paymentMethod} />
      </div>
      <div className="repayment-form__field">
        <label htmlFor="repayment-notes">Notes</label>
        <textarea id="repayment-notes" name="notes" maxLength={4000} defaultValue={state.values.notes} aria-invalid={Boolean(state.fieldErrors.notes)} aria-describedby="repayment-notes-error" rows={5} />
        <FieldError id="repayment-notes-error" message={state.fieldErrors.notes} />
      </div>
      <section className="repayment-form__allocations" aria-labelledby="repayment-allocations-heading">
        <h2 id="repayment-allocations-heading">Apply to outstanding expenses</h2>
        <p className="repayment-form__help">Optional. Leave these blank to allocate the repayment later.</p>
        {selectedShares.length > 0 ? selectedShares.map((share) => (
          <div className="repayment-form__allocation" key={share.id}>
            <div className="repayment-form__allocation-details">
              <strong>{share.expenseDescription}</strong>
              <span>{share.outingTitle} · {formatDate(share.outingOccurredAt)}</span>
              <span>Original share {formatRupiah(share.amountOwed)} · Previously repaid {formatRupiah(share.repaidAmount)} · Remaining {formatRupiah(share.remainingAmount)}</span>
            </div>
            <input type="hidden" name="expenseShareId" value={share.id} readOnly />
            <label htmlFor={`repayment-allocation-${share.id}`}>Allocation for {share.expenseDescription}</label>
            <input id={`repayment-allocation-${share.id}`} name="amountRupiah" type="text" inputMode="numeric" placeholder="Optional" value={draftAllocations[share.id] ?? ""} onChange={(event) => setDraftAllocations((current) => ({ ...current, [share.id]: event.target.value }))} aria-invalid={Boolean(state.allocationFieldErrors?.[share.id])} />
            {state.allocationFieldErrors?.[share.id] ? <p className="repayment-form__field-error">{state.allocationFieldErrors[share.id]}</p> : null}
          </div>
        )) : <p className="repayment-form__help">No outstanding expense shares for this friend.</p>}
      </section>
      <p className="repayment-form__message" role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
      <SubmitButton mode={mode} />
    </form>
  );
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}
