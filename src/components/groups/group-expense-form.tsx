"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import type { GroupExpenseActionState, GroupExpenseFormValues, GroupParticipantEligibility } from "@/domain/group-contracts";
import { formatRupiah, parseRupiah } from "@/domain/rupiah";

type GroupExpenseAction = (previousState: GroupExpenseActionState, formData: FormData) => Promise<GroupExpenseActionState>;
type ShareDraft = { participantId: string; amount: string };

function participantLabel(participant: Pick<GroupParticipantEligibility, "displayName" | "label" | "status">) {
  return `${participant.displayName}${participant.label ? ` · ${participant.label}` : ""}${participant.status === "external" ? " · External" : ""}`;
}

function localValueFromUtc(utc: string) {
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button className="action-link action-link--primary" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Adding expense…" : "Add expense"}</button>;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return <p className="group-expense-form__field-error" id={id}>{message || "\u00a0"}</p>;
}

export function GroupExpenseForm({ action, participants, defaultPayerId, initialOccurredAtUtc }: { action: GroupExpenseAction; participants: GroupParticipantEligibility[]; defaultPayerId: string; initialOccurredAtUtc: string }) {
  const payerOptions = participants.filter((participant) => participant.canPay);
  const shareOptions = participants.filter((participant) => participant.canParticipate);
  const initialValues: GroupExpenseFormValues = { description: "", totalAmount: "", occurredAtLocal: "", timezoneOffsetMinutes: "", payerParticipantId: defaultPayerId, shares: [] };
  const [state, formAction] = useActionState(action, { fieldErrors: {}, formError: "", values: initialValues });
  const [description, setDescription] = useState(state.values.description);
  const [totalAmount, setTotalAmount] = useState(state.values.totalAmount);
  const [payerParticipantId, setPayerParticipantId] = useState(state.values.payerParticipantId || defaultPayerId);
  const [shares, setShares] = useState<ShareDraft[]>(state.values.shares);
  const [addParticipantId, setAddParticipantId] = useState("");
  const [localError, setLocalError] = useState("");
  const previousState = useRef(state);
  const formRef = useRef<HTMLFormElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const occurredInput = formRef.current?.elements.namedItem("occurredAtLocal");
    const timezoneInput = formRef.current?.elements.namedItem("timezoneOffsetMinutes");
    if (occurredInput instanceof HTMLInputElement && !occurredInput.value && initialOccurredAtUtc) occurredInput.value = localValueFromUtc(initialOccurredAtUtc);
    if (timezoneInput instanceof HTMLInputElement && !timezoneInput.value) timezoneInput.value = new Date().getTimezoneOffset().toString();
  }, [initialOccurredAtUtc]);

  useEffect(() => {
    if (previousState.current === state) return;
    previousState.current = state;
    setDescription(state.values.description);
    setTotalAmount(state.values.totalAmount);
    setPayerParticipantId(state.values.payerParticipantId || defaultPayerId);
    setShares(state.values.shares);
    const occurredInput = formRef.current?.elements.namedItem("occurredAtLocal");
    const timezoneInput = formRef.current?.elements.namedItem("timezoneOffsetMinutes");
    if (occurredInput instanceof HTMLInputElement) occurredInput.value = state.values.occurredAtLocal;
    if (timezoneInput instanceof HTMLInputElement) timezoneInput.value = state.values.timezoneOffsetMinutes;
  }, [defaultPayerId, state]);

  const total = parseRupiah(totalAmount) ?? 0;
  const assigned = shares.reduce((sum, share) => sum + (parseRupiah(share.amount) ?? 0), 0);
  const remaining = total - assigned;
  const available = shareOptions.filter((participant) => !shares.some((share) => share.participantId === participant.id));

  function addShare() {
    if (!addParticipantId) return;
    setShares((current) => [...current, { participantId: addParticipantId, amount: "" }]);
    setAddParticipantId("");
    setLocalError("");
  }

  function splitEvenly() {
    if (!total || !shares.length) {
      setLocalError("Enter a total and add participants before splitting evenly.");
      return;
    }
    const base = Math.floor(total / shares.length);
    const remainder = total % shares.length;
    setShares((current) => current.map((share, index) => ({ ...share, amount: String(base + (index < remainder ? 1 : 0)) })));
    setLocalError("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    const timezoneInput = event.currentTarget.elements.namedItem("timezoneOffsetMinutes");
    const offset = timezoneInput instanceof HTMLInputElement && timezoneInput.value ? timezoneInput.value : new Date().getTimezoneOffset().toString();
    if (timezoneInput instanceof HTMLInputElement) timezoneInput.value = offset;
    if (!total || assigned !== total || !shares.length) {
      event.preventDefault();
      setLocalError(!shares.length ? "Add at least one participant share." : assigned > total ? `Over-allocated by ${formatRupiah(assigned - total)}.` : `Allocate ${formatRupiah(total - assigned)} more.`);
    }
  }

  return <form ref={formRef} className="group-expense-form" action={formAction} onSubmit={submit} noValidate>
    <div className="group-expense-form__field">
      <label htmlFor="group-expense-description">Description</label>
      <input id="group-expense-description" name="description" value={description} onChange={(event) => setDescription(event.target.value)} autoComplete="off" aria-invalid={Boolean(state.fieldErrors.description)} aria-describedby="group-expense-description-error" />
      <FieldError id="group-expense-description-error" message={state.fieldErrors.description} />
    </div>
    <div className="group-expense-form__field">
      <label htmlFor="group-expense-total">Total amount in rupiah</label>
      <input id="group-expense-total" name="totalAmount" type="text" inputMode="numeric" value={totalAmount} onChange={(event) => { setTotalAmount(event.target.value); setLocalError(""); }} aria-invalid={Boolean(state.fieldErrors.totalAmount)} aria-describedby="group-expense-total-help group-expense-total-error" autoComplete="off" />
      <p className="group-expense-form__help" id="group-expense-total-help">Whole rupiah only. Examples: 100000 or 100.000.</p>
      <FieldError id="group-expense-total-error" message={state.fieldErrors.totalAmount} />
    </div>
    <div className="group-expense-form__field">
      <label htmlFor="group-expense-occurred-at">Occurred date and time</label>
      <input id="group-expense-occurred-at" name="occurredAtLocal" type="datetime-local" defaultValue={state.values.occurredAtLocal} aria-invalid={Boolean(state.fieldErrors.occurredAtLocal)} aria-describedby="group-expense-occurred-at-error" />
      <input type="hidden" name="timezoneOffsetMinutes" defaultValue={state.values.timezoneOffsetMinutes} />
      <FieldError id="group-expense-occurred-at-error" message={state.fieldErrors.occurredAtLocal} />
    </div>
    <div className="group-expense-form__field">
      <label htmlFor="group-expense-payer">Paid by</label>
      <select id="group-expense-payer" name="payerParticipantId" value={payerParticipantId} onChange={(event) => setPayerParticipantId(event.target.value)} aria-invalid={Boolean(state.fieldErrors.payerParticipantId)} aria-describedby="group-expense-payer-help group-expense-payer-error">
        {payerOptions.map((participant) => <option key={participant.id} value={participant.id}>{participantLabel(participant)}</option>)}
      </select>
      <p className="group-expense-form__help" id="group-expense-payer-help">Choosing another member records their payment claim. They must confirm before debt is created.</p>
      <FieldError id="group-expense-payer-error" message={state.fieldErrors.payerParticipantId} />
    </div>
    <fieldset className="group-expense-form__shares" aria-describedby="group-expense-shares-help group-expense-shares-error">
      <legend>Shares</legend>
      <p className="group-expense-form__help" id="group-expense-shares-help">Active members and external participants may receive a whole-rupiah share. The payer may also have a share.</p>
      {shares.length ? <div className="group-expense-form__share-list">{shares.map((share) => {
        const participant = shareOptions.find((option) => option.id === share.participantId);
        return <div className="group-expense-form__share-row" key={share.participantId}>
          <select name="participantId" value={share.participantId} onChange={(event) => setShares((current) => current.map((item) => item.participantId === share.participantId ? { ...item, participantId: event.target.value } : item))} aria-label={`Share participant ${participant?.displayName ?? ""}`}>
            {shareOptions.filter((option) => option.id === share.participantId || !shares.some((item) => item.participantId === option.id)).map((option) => <option key={option.id} value={option.id}>{participantLabel(option)}</option>)}
          </select>
          <input name="shareAmount" type="text" inputMode="numeric" value={share.amount} onChange={(event) => setShares((current) => current.map((item) => item.participantId === share.participantId ? { ...item, amount: event.target.value } : item))} aria-label={`Share amount for ${participant?.displayName ?? "participant"}`} autoComplete="off" />
          <button className="text-link" type="button" onClick={() => setShares((current) => current.filter((item) => item.participantId !== share.participantId))}>Remove</button>
        </div>;
      })}</div> : <p className="group-expense-form__empty">No participants added yet.</p>}
      <div className="group-expense-form__add-share"><select value={addParticipantId} onChange={(event) => setAddParticipantId(event.target.value)} aria-label="Participant to add"><option value="">Add participant</option>{available.map((participant) => <option key={participant.id} value={participant.id}>{participantLabel(participant)}</option>)}</select><button className="action-link action-link--quiet" type="button" onClick={addShare} disabled={!addParticipantId}>Add share</button></div>
      <div className="group-expense-form__totals" aria-live="polite"><span><span className="technical-label">Assigned</span><strong>{formatRupiah(assigned)}</strong></span><span><span className="technical-label">{remaining >= 0 ? "Remaining" : "Over"}</span><strong>{formatRupiah(Math.abs(remaining))}</strong></span><button className="text-link" type="button" onClick={splitEvenly} disabled={!shares.length}>Split evenly</button></div>
      <FieldError id="group-expense-shares-error" message={state.fieldErrors.shares || localError} />
    </fieldset>
    <p className="group-expense-form__message" role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
    <div className="group-expense-form__actions"><SubmitButton /></div>
  </form>;
}
