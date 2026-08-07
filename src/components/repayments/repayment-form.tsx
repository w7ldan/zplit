"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { RepaymentActionState, RepaymentFriendContext } from "@/app/app/repayments/actions";
import type { RepaymentInputValues } from "@/domain/repayment-input";
import type { OpenExpenseShare } from "@/domain/ledger-repository";
import { formatRupiah } from "@/domain/rupiah";
import { SearchableCombobox, type SearchableOption, type SearchableOptionAction } from "@/components/records/searchable-combobox";
import { LocalDateTime } from "@/components/editorial/local-date-time";

type RepaymentAction = (previousState: RepaymentActionState, formData: FormData) => Promise<RepaymentActionState>;

type RepaymentFormProps = {
  action: RepaymentAction;
  friends: SearchableOption[];
  searchFriends: SearchableOptionAction;
  initialValues?: RepaymentInputValues;
  initialPaidAtUtc?: string;
  mode?: "create" | "edit";
  friendLocked?: boolean;
  initialFriendContext?: RepaymentFriendContext;
  loadFriendContext?: (friendId: string, includeOpenExpenseShares?: boolean) => Promise<RepaymentFriendContext>;
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

export function RepaymentForm({ action, friends: friendOptions, searchFriends, initialValues = emptyValues, initialPaidAtUtc, mode = "create", friendLocked = false, initialFriendContext, loadFriendContext, outstandingByFriend = {}, openExpenseSharesByFriend = {} }: RepaymentFormProps) {
  const [state, formAction] = useActionState(action, { ...emptyActionState, values: initialValues });
  const [selectedFriendId, setSelectedFriendId] = useState(initialValues.friendId || friendOptions[0]?.id || "");
  const [selectedFriend, setSelectedFriend] = useState<SearchableOption | undefined>(() => friendOptions.find((friend) => friend.id === initialValues.friendId) ?? friendOptions[0]);
  const [friendContext, setFriendContext] = useState(initialFriendContext);
  const [loadingFriendContext, setLoadingFriendContext] = useState(false);
  const contextRequestRef = useRef(0);
  const [draftAllocations, setDraftAllocations] = useState<Record<string, string>>(() => Object.fromEntries((state.allocations ?? []).map((allocation) => [allocation.expenseShareId, allocation.amountRupiah])));
  const formRef = useRef<HTMLFormElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const timezoneOffsetRef = useRef<HTMLInputElement>(null);
  const allocationDisclosureRef = useRef<HTMLDetailsElement>(null);
  const detailsDisclosureRef = useRef<HTMLDetailsElement>(null);
  const previousActionStateRef = useRef(state);
  const friendActionStateRef = useRef(state);
  const initializedRef = useRef(false);
  const selectedShares = friendContext?.option.id === selectedFriendId ? friendContext.openExpenseShares : openExpenseSharesByFriend[selectedFriendId] ?? [];
  const selectedContext = friendContext?.option.id === selectedFriendId ? friendContext : undefined;
  const friendOptionsWithSelection = selectedFriend && !friendOptions.some((friend) => friend.id === selectedFriend.id) ? [...friendOptions, selectedFriend] : friendOptions;
  const allocationDisclosureOpen = (state.allocations ?? []).some((allocation) => allocation.amountRupiah.trim() !== "") || Object.keys(state.allocationFieldErrors ?? {}).length > 0;
  const detailsDisclosureOpen = Boolean(state.values.paymentMethod || state.values.notes || state.fieldErrors.paymentMethod || state.fieldErrors.notes);

  const refreshFriendContext = useCallback(async (friendId: string) => {
    if (!loadFriendContext) return;
    const request = ++contextRequestRef.current;
    try {
      const context = await loadFriendContext(friendId, mode === "create");
      if (request === contextRequestRef.current) setFriendContext(context);
    } finally {
      if (request === contextRequestRef.current) setLoadingFriendContext(false);
    }
  }, [loadFriendContext, mode]);

  useEffect(() => {
    if (state === friendActionStateRef.current || !state.values.friendId) return;
    friendActionStateRef.current = state;
    // The action result is the source of truth after validation.
    setSelectedFriendId(state.values.friendId);
    if (loadFriendContext) void refreshFriendContext(state.values.friendId);
  }, [loadFriendContext, refreshFriendContext, state]);

  useEffect(() => {
    if (timezoneOffsetRef.current) timezoneOffsetRef.current.value = new Date().getTimezoneOffset().toString();
    if (!initializedRef.current && initialPaidAtUtc && (mode === "edit" || !initialValues.paidAtLocal)) {
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
      <div className="repayment-form__field">
        <label id="repayment-friend-label" htmlFor="repayment-friend">Friend</label>
        <SearchableCombobox id="repayment-friend" name="friendId" value={selectedFriendId} options={friendOptionsWithSelection} search={searchFriends} required={!friendLocked} disabled={friendLocked} ariaInvalid={Boolean(state.fieldErrors.friendId)} ariaDescribedBy="repayment-friend-error" labelId="repayment-friend-label" onValueChange={(friend) => { setSelectedFriendId(friend.id); setSelectedFriend(friend); setDraftAllocations({}); if (loadFriendContext) { setLoadingFriendContext(true); void refreshFriendContext(friend.id); } }} />
        <p className="repayment-form__outstanding" aria-live="polite">Outstanding for {friendOptionsWithSelection.find((friend) => friend.id === selectedFriendId)?.label ?? "this friend"}: {formatRupiah(friendContext?.option.id === selectedFriendId ? friendContext.outstandingAmount : outstandingByFriend[selectedFriendId] ?? 0)}</p>
        {friendLocked ? <p className="repayment-form__help">The friend is fixed while this repayment has allocations.</p> : null}
        <FieldError id="repayment-friend-error" message={state.fieldErrors.friendId} />
      </div>
      <div className="repayment-form__field">
        <label htmlFor="repayment-amount">Amount in rupiah</label>
        <div className="repayment-form__amount-row">
          <input ref={amountRef} key={state.values.amountRupiah} id="repayment-amount" name="amountRupiah" type="text" inputMode="numeric" required defaultValue={state.values.amountRupiah} aria-invalid={Boolean(state.fieldErrors.amountRupiah)} aria-describedby="repayment-amount-help repayment-amount-error" autoComplete="off" />
          {mode === "create" && !loadingFriendContext && selectedContext && selectedContext.outstandingAmount > 0 ? <button className="action-link action-link--quiet repayment-form__full-outstanding" type="button" onClick={() => { if (!selectedContext) return; if (amountRef.current) amountRef.current.value = selectedContext.outstandingAmount.toString(); amountRef.current?.focus(); }}>Use full outstanding</button> : null}
        </div>
        <p className="repayment-form__help" id="repayment-amount-help">Whole rupiah only. Examples: 84000 or 84.000.</p>
        <FieldError id="repayment-amount-error" message={state.fieldErrors.amountRupiah} />
      </div>
      <div className="repayment-form__field">
        <label htmlFor="repayment-paid-at">Payment date and time</label>
        <input key={state.values.paidAtLocal} id="repayment-paid-at" name="paidAtLocal" type="datetime-local" required defaultValue={state.values.paidAtLocal} aria-invalid={Boolean(state.fieldErrors.paidAtLocal)} aria-describedby="repayment-paid-at-error" />
        <FieldError id="repayment-paid-at-error" message={state.fieldErrors.paidAtLocal} />
      </div>
      <input key={state.values.timezoneOffsetMinutes} ref={timezoneOffsetRef} type="hidden" name="timezoneOffsetMinutes" defaultValue={state.values.timezoneOffsetMinutes} />
      {mode === "create" ? <>
        <details ref={allocationDisclosureRef} open={allocationDisclosureOpen || undefined} className="repayment-form__disclosure">
          <summary>Allocate now</summary>
          <section className="repayment-form__allocations" aria-labelledby="repayment-allocations-heading">
            <h2 id="repayment-allocations-heading">Apply to outstanding expenses</h2>
            <p className="repayment-form__help">Optional. Leave these blank to allocate the repayment later.</p>
            {selectedShares.length > 0 ? selectedShares.map((share) => (
              <div className="repayment-form__allocation" key={share.id}>
                <div className="repayment-form__allocation-details">
                  <strong>{share.expenseDescription}</strong>
                  <span>{share.outingTitle} · <LocalDateTime iso={share.outingOccurredAt.toISOString()} mode="date" /></span>
                  <span>Original share {formatRupiah(share.amountOwed)} · Previously repaid {formatRupiah(share.repaidAmount)} · Remaining {formatRupiah(share.remainingAmount)}</span>
                </div>
                <input type="hidden" name="expenseShareId" value={share.id} readOnly />
                <label htmlFor={`repayment-allocation-${share.id}`}>Allocation for {share.expenseDescription}</label>
                <input id={`repayment-allocation-${share.id}`} name="amountRupiah" type="text" inputMode="numeric" placeholder="Optional" value={draftAllocations[share.id] ?? ""} onChange={(event) => setDraftAllocations((current) => ({ ...current, [share.id]: event.target.value }))} aria-invalid={Boolean(state.allocationFieldErrors?.[share.id])} />
                {state.allocationFieldErrors?.[share.id] ? <p className="repayment-form__field-error">{state.allocationFieldErrors[share.id]}</p> : null}
              </div>
            )) : <p className="repayment-form__help">No outstanding expense shares for this friend.</p>}
          </section>
        </details>
        <details ref={detailsDisclosureRef} open={detailsDisclosureOpen || undefined} className="repayment-form__disclosure">
          <summary>Optional details</summary>
          <div className="repayment-form__field">
            <label htmlFor="repayment-payment-method">Payment method</label>
            <input key={state.values.paymentMethod} id="repayment-payment-method" name="paymentMethod" maxLength={40} defaultValue={state.values.paymentMethod} aria-invalid={Boolean(state.fieldErrors.paymentMethod)} aria-describedby="repayment-payment-method-error" autoComplete="off" />
            <FieldError id="repayment-payment-method-error" message={state.fieldErrors.paymentMethod} />
          </div>
          <div className="repayment-form__field">
            <label htmlFor="repayment-notes">Notes</label>
            <textarea key={state.values.notes} id="repayment-notes" name="notes" maxLength={4000} defaultValue={state.values.notes} aria-invalid={Boolean(state.fieldErrors.notes)} aria-describedby="repayment-notes-error" rows={5} />
            <FieldError id="repayment-notes-error" message={state.fieldErrors.notes} />
          </div>
        </details>
      </> : <>
        <div className="repayment-form__field">
          <label htmlFor="repayment-payment-method">Payment method</label>
          <input key={state.values.paymentMethod} id="repayment-payment-method" name="paymentMethod" maxLength={40} aria-invalid={Boolean(state.fieldErrors.paymentMethod)} defaultValue={state.values.paymentMethod} aria-describedby="repayment-payment-method-error" autoComplete="off" />
          <FieldError id="repayment-payment-method-error" message={state.fieldErrors.paymentMethod} />
        </div>
        <div className="repayment-form__field">
          <label htmlFor="repayment-notes">Notes</label>
          <textarea key={state.values.notes} id="repayment-notes" name="notes" maxLength={4000} defaultValue={state.values.notes} aria-invalid={Boolean(state.fieldErrors.notes)} aria-describedby="repayment-notes-error" rows={5} />
          <FieldError id="repayment-notes-error" message={state.fieldErrors.notes} />
        </div>
      </>}
      <p className="repayment-form__message" role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
      <SubmitButton mode={mode} />
    </form>
  );
}
