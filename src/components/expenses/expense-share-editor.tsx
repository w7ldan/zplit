"use client";

import Link from "next/link";
import { useActionState, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ExpenseShareActionState } from "@/app/app/expenses/actions";
import { SearchableCombobox, type SearchableOption, type SearchableOptionAction } from "@/components/records/searchable-combobox";
import { formatPercentageBasisPoints } from "@/domain/expense-share-input";
import { formatRupiah } from "@/domain/rupiah";
import { useUnsavedChangesGuard } from "@/components/navigation/unsaved-changes";
import { createExpenseSplitDraft, serializeExpenseSplit, type ExpenseSplitChargeDefinition, type ExpenseSplitFriend } from "./expense-split-draft";
import { useExpenseSplitDraft } from "./use-expense-split-draft";

export type ExpenseShareEditorFriend = ExpenseSplitFriend;
export type ExpenseShareEditorCharge = ExpenseSplitChargeDefinition;

type ExpenseShareAction = (
  previousState: ExpenseShareActionState,
  formData: FormData,
) => Promise<ExpenseShareActionState>;

type ExpenseShareEditorProps = {
  action: ExpenseShareAction;
  expenseAmount: number;
  friends: ExpenseShareEditorFriend[];
  charges?: ExpenseShareEditorCharge[];
  friendOptions?: SearchableOption[];
  searchFriends?: SearchableOptionAction;
  previousSplit?: { friends: ExpenseShareEditorFriend[]; charges: ExpenseShareEditorCharge[] } | null;
};

const emptyActionState: ExpenseShareActionState = { fieldErrors: {}, formError: "", values: [], charges: [] };
const emptySearch: SearchableOptionAction = async () => [];

export function ChangedValue({ value, children }: { value: number; children: ReactNode }) {
  const previousValue = useRef(value);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (previousValue.current === value) return;
    previousValue.current = value;
    setRevision((current) => current + 1);
  }, [value]);

  return <span className="changed-value" data-changed-revision={revision}><span key={revision} className={revision > 0 ? "changed-value__visual changed-value--changed" : "changed-value__visual"}>{children}</span></span>;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="action-link action-link--primary expense-share-editor__submit" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "Saving split…" : "Save split"}
    </button>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return <p className="expense-share-editor__field-error" id={id} role={message ? "alert" : undefined}>{message || "\u00a0"}</p>;
}

export function ExpenseShareEditor({ action, expenseAmount, friends: initialFriends, charges: initialChargeDefinitions = [], friendOptions: initialFriendOptions = [], searchFriends = emptySearch, previousSplit, basePath = "/app" }: ExpenseShareEditorProps & { basePath?: string }) {
  const submissionReleaseRef = useRef<(() => void) | null>(null);
  const submitAction = useCallback(async (previousState: ExpenseShareActionState, formData: FormData) => {
    const nextState = await action(previousState, formData);
    submissionReleaseRef.current?.();
    submissionReleaseRef.current = null;
    return nextState;
  }, [action]);
  const [initialDraft] = useState(() => createExpenseSplitDraft(initialFriends, initialChargeDefinitions));
  const initialSerializedDraft = useMemo(() => serializeExpenseSplit(initialDraft), [initialDraft]);
  const [state, formAction] = useActionState(submitAction, { ...emptyActionState, values: initialSerializedDraft.values, charges: initialSerializedDraft.charges });
  const [chargesOpen, setChargesOpen] = useState(initialChargeDefinitions.length > 0);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [confirmPreviousSplit, setConfirmPreviousSplit] = useState(false);
  const amountRefs = useRef(new Map<string, HTMLInputElement>());
  const {
    selectedFriends,
    draftAmounts,
    draftCharges,
    selectedIds,
    undoRemoval,
    previousSplitMessage,
    isDirty,
    breakdowns,
    totalOwed,
    ownerPortion,
    overAllocated,
    allocationProgress,
    serializedDraft,
    addFriend: addFriendToDraft,
    addFriends: addFriendsToDraft,
    updateFriendAmount,
    removeFriend,
    splitEvenly,
    applyPreviousSplit: applyPreviousSplitDraft,
    addCharge,
    updateCharge,
    removeCharge,
    undoLastRemoval,
  } = useExpenseSplitDraft({ initialDraft, initialFriendOptions, actionState: state, expenseAmount, previousSplit });
  const friendOptions = useMemo(() => initialFriendOptions.filter((option) => !option.archived && !selectedIds.has(option.id)).slice(0, 20), [initialFriendOptions, selectedIds]);
  const search = useCallback((query: string, selectedId?: string) => searchFriends(query, selectedId).then((options) => options.filter((option) => !option.archived && !selectedIds.has(option.id)).slice(0, 20)), [searchFriends, selectedIds]);

  const guard = useUnsavedChangesGuard(isDirty);

  useEffect(() => () => {
    submissionReleaseRef.current?.();
    submissionReleaseRef.current = null;
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (!guard || submissionReleaseRef.current) return;
    const release = guard.beginSubmission();
    if (!release) {
      event.preventDefault();
      return;
    }
    submissionReleaseRef.current = release;
  }

  useEffect(() => {
    if (pendingFocusId) amountRefs.current.get(pendingFocusId)?.focus();
  }, [pendingFocusId, selectedFriends]);

  function addFriend(option: SearchableOption) {
    const friendId = addFriendToDraft(option);
    if (friendId) setPendingFocusId(friendId);
  }

  function addFriends(options: SearchableOption[]) {
    const friendId = addFriendsToDraft(options);
    if (friendId) setPendingFocusId(friendId);
  }

  function applyPreviousSplit() {
    const friendId = applyPreviousSplitDraft();
    setConfirmPreviousSplit(false);
    if (friendId) setPendingFocusId(friendId);
  }

  function usePreviousSplit() {
    if (selectedFriends.length > 0 || draftCharges.length > 0) {
      setConfirmPreviousSplit(true);
      return;
    }
    applyPreviousSplit();
  }

  if (selectedFriends.length === 0 && friendOptions.length === 0 && !undoRemoval) {
    return (
      <div className="expense-share-editor expense-share-editor--empty">
        <p className="technical-label">FRIEND SHARES</p>
        <p>Add an active friend before assigning a share.</p>
        <Link className="action-link" href={`${basePath}/friends`}>Go to friends <span aria-hidden="true">→</span></Link>
      </div>
    );
  }

  return (
    <div className="expense-share-editor">
      <p className="technical-label">FRIEND SHARES</p>
      <h2>Assign the split</h2>
      <div className="expense-share-editor__summary">
        <div className="expense-share-editor__totals" aria-live="polite">
          <div><span className="technical-label">Expense total</span><strong>{formatRupiah(expenseAmount)}</strong></div>
          <div><span className="technical-label">Assigned to friends</span><strong><ChangedValue value={totalOwed}>{formatRupiah(totalOwed)}</ChangedValue></strong></div>
          <div><span className="technical-label">Your portion</span><strong><ChangedValue value={ownerPortion}>{formatRupiah(ownerPortion)}</ChangedValue></strong></div>
        </div>
        <div className={`allocation-bar${overAllocated ? " allocation-bar--error" : ""}`} aria-label="Expense allocation" role="progressbar" aria-valuemin={0} aria-valuemax={expenseAmount} aria-valuenow={Math.min(totalOwed, expenseAmount)}>
          <span className="allocation-bar__track"><span className="allocation-bar__fill" style={{ transform: `scaleX(${allocationProgress})` }} /></span>
          <span>{overAllocated ? `Over-allocated by ${formatRupiah(totalOwed - expenseAmount)}.` : `${formatRupiah(ownerPortion)} is your portion. Assigned shares become friend balances.`}</span>
        </div>
      </div>
      <form className="expense-share-editor__form" action={formAction} onSubmit={handleSubmit} noValidate>
        <div className="expense-share-editor__add">
          <div>
            <label id="expense-share-add-label" htmlFor="expense-share-add">Add friend</label>
            {selectedFriends.length > 0 ? <button className="text-link" type="button" onClick={splitEvenly}>Split evenly with me</button> : null}
          </div>
          {previousSplit ? <div className="expense-share-editor__previous">
            {!confirmPreviousSplit ? <button className="text-link" type="button" onClick={usePreviousSplit}>Use previous split</button> : <div className="expense-share-editor__previous-confirm">
              <span>Replace current draft?</span>
              <button className="text-link" type="button" onClick={applyPreviousSplit}>Replace draft</button>
              <button className="text-link" type="button" onClick={() => setConfirmPreviousSplit(false)}>Cancel</button>
            </div>}
          </div> : null}
          <SearchableCombobox
            key={[...selectedIds].join(",")}
            id="expense-share-add"
            value=""
            options={friendOptions}
            search={search}
            labelId="expense-share-add-label"
            placeholder="Choose active friend"
            searchLabel="Search active friends"
            onValueChange={addFriend}
            multiSelect
            onValuesChange={addFriends}
          />
        </div>
        {previousSplitMessage ? <p className="expense-share-editor__help" role="status">{previousSplitMessage}</p> : null}
        {undoRemoval ? <p className="expense-share-editor__undo" role="status" aria-live="polite">
          <span>{undoRemoval.kind === "friend" ? `${undoRemoval.friend.name} removed` : `${undoRemoval.charge.name || "Charge"} removed`} ·</span>
          <button className="text-link" type="button" onClick={undoLastRemoval}>Undo</button>
        </p> : null}
        <noscript>
          <p className="expense-share-editor__help">Without JavaScript, add one active friend per save. Existing charges are preserved.</p>
          <label htmlFor="expense-share-native-friend">Friend to add</label>
          <select id="expense-share-native-friend" name="additionalFriendId" defaultValue="">
            <option value="">No additional friend</option>
            {friendOptions.map((friend) => <option key={friend.id} value={friend.id}>{friend.label}</option>)}
          </select>
          <label htmlFor="expense-share-native-amount">Amount for friend to add</label>
          <input id="expense-share-native-amount" name="additionalAmountRupiah" type="text" inputMode="numeric" autoComplete="off" />
        </noscript>
        <details className="expense-share-editor__charges" open={chargesOpen} onToggle={(event) => setChargesOpen(event.currentTarget.open)}>
          <summary>{draftCharges.length > 0 ? `Charges · ${draftCharges.length}` : "Charges (optional)"}</summary>
          <div className="expense-share-editor__section-heading">
            <span className="technical-label">Optional charge tools</span>
            <button className="text-link" type="button" onClick={addCharge}>Add charge</button>
          </div>
          {draftCharges.map((charge, index) => {
            const errorId = `expense-share-charge-${index}-error`;
            const nameId = `expense-share-charge-name-${index}`;
            const rateId = `expense-share-charge-rate-${index}`;
            const scopeId = `expense-share-charge-scope-${index}`;
            const targetsLabelId = `expense-share-charge-targets-${index}`;
            return (
              <div className="expense-share-editor__charge" key={index}>
                <div className="expense-share-editor__charge-heading">
                  <span>Charge {index + 1}</span>
                  <button className="text-link" type="button" onClick={() => removeCharge(index)}>Remove</button>
                </div>
                <div className="expense-share-editor__charge-fields">
                  <div className="expense-share-editor__charge-field">
                    <label htmlFor={nameId}>Name</label>
                    <input id={nameId} type="text" value={charge.name} onChange={(event) => updateCharge(index, { name: event.target.value })} aria-describedby={errorId} />
                  </div>
                  <div className="expense-share-editor__charge-field">
                    <label htmlFor={rateId}>Rate</label>
                    <div className="expense-share-editor__percentage-input"><input id={rateId} type="text" inputMode="decimal" value={charge.percentage} placeholder="7.5" onChange={(event) => updateCharge(index, { percentage: event.target.value })} aria-describedby={errorId} /><span aria-hidden="true">%</span></div>
                  </div>
                  <div className="expense-share-editor__charge-field">
                    <label htmlFor={scopeId}>Applies to</label>
                    <select id={scopeId} value={charge.scope} onChange={(event) => updateCharge(index, { scope: event.target.value as "all" | "selected", friendIds: event.target.value === "all" ? [] : charge.friendIds })} aria-describedby={errorId}>
                      <option value="all">All friends</option>
                      <option value="selected">Selected friends</option>
                    </select>
                  </div>
                </div>
                {charge.scope === "selected" ? <>
                  <p className="expense-share-editor__targets-label" id={targetsLabelId}>Apply to</p>
                  <div className="expense-share-editor__targets" aria-label={`Friends for charge ${index + 1}`} aria-labelledby={targetsLabelId}>
                    {selectedFriends.map((friend) => <label key={friend.id}><input type="checkbox" checked={charge.friendIds.includes(friend.id)} onChange={(event) => updateCharge(index, { friendIds: event.target.checked ? [...charge.friendIds, friend.id] : charge.friendIds.filter((id) => id !== friend.id) })} /> {friend.name}</label>)}
                  </div>
                </> : null}
                <FieldError id={errorId} message={state.fieldErrors[`charge-${index}`]} />
              </div>
            );
          })}
          <input type="hidden" name="charges" value={serializedDraft.chargesJson} readOnly />
        </details>
        <p className="expense-share-editor__help">Enter a whole-rupiah base amount. Charges are calculated from that base. Use Remove to omit a friend from the split.</p>
        {selectedFriends.map((friend) => {
          const fieldErrorId = `expense-share-${friend.id}-error`;
          const helpId = `expense-share-${friend.id}-help`;
          const archived = friend.archivedAt !== null;
          const breakdown = breakdowns.find((value) => value.friendId === friend.id)!;
          return (
            <div className="expense-share-editor__field" key={friend.id}>
              <input type="hidden" name="friendId" value={friend.id} />
              <div className="expense-share-editor__field-heading">
                <label htmlFor={`expense-share-${friend.id}`}>
                  <span className="expense-share-editor__friend-name">{friend.name}</span>
                  {archived ? <span className="technical-label">ARCHIVED</span> : null}
                </label>
                <button className="text-link" type="button" onClick={() => removeFriend(friend.id)} aria-label={`Remove ${friend.name}`}>Remove</button>
              </div>
              {friend.expenseShareId && (friend.remainingAmount ?? 0) > 0 ? <Link className="text-link" href={`${basePath}/repayments?create=1&friendId=${encodeURIComponent(friend.id)}&expenseShareId=${encodeURIComponent(friend.expenseShareId)}`}>Record repayment</Link> : null}
              <input
                ref={(element) => { if (element) amountRefs.current.set(friend.id, element); else amountRefs.current.delete(friend.id); }}
                id={`expense-share-${friend.id}`}
                name="amountRupiah"
                type="text"
                inputMode="numeric"
                value={draftAmounts[friend.id] ?? ""}
                onChange={(event) => updateFriendAmount(friend.id, event.target.value)}
                aria-invalid={Boolean(state.fieldErrors[friend.id])}
                aria-describedby={`${helpId} ${fieldErrorId}`}
                autoComplete="off"
              />
              {breakdown.charges.length > 0 ? <div className="expense-share-editor__breakdown">
                <span>Base {formatRupiah(breakdown.baseAmount)}</span>
                <ul>{breakdown.charges.map((charge) => <li key={`${charge.name}-${charge.percentageBasisPoints}`}>{charge.name} {formatPercentageBasisPoints(charge.percentageBasisPoints)}% · {formatRupiah(charge.amount)}</li>)}</ul>
                <strong>Final {formatRupiah(breakdown.finalAmount)}</strong>
              </div> : null}
              <p className="expense-share-editor__help" id={helpId}>Blank removes this friend from the split.</p>
              <FieldError id={fieldErrorId} message={state.fieldErrors[friend.id]} />
            </div>
          );
        })}
        <p className="expense-share-editor__message" role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
        <SubmitButton />
      </form>
    </div>
  );
}
