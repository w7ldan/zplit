"use client";

import Link from "next/link";
import { useActionState, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ExpenseShareActionState } from "@/app/app/expenses/actions";
import { SearchableCombobox, type SearchableOption, type SearchableOptionAction } from "@/components/records/searchable-combobox";
import { calculateShareBreakdown, formatPercentageBasisPoints, parsePercentageBasisPoints, type ExpenseShareChargeValues } from "@/domain/expense-share-input";
import { MAX_RUPIAH, parseRupiah, formatRupiah } from "@/domain/rupiah";

export type ExpenseShareEditorFriend = {
  id: string;
  name: string;
  archivedAt: Date | null;
  baseAmount?: number;
  amountOwed?: number;
  expenseShareId?: string;
  remainingAmount?: number;
  settled?: boolean;
};

export type ExpenseShareEditorCharge = Omit<ExpenseShareChargeValues, "percentage"> & { percentageBasisPoints: number };

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

function initialValues(friends: ExpenseShareEditorFriend[]) {
  return friends.map((friend) => ({ friendId: friend.id, amountRupiah: (friend.baseAmount ?? friend.amountOwed)?.toString() ?? "" }));
}

function initialAmounts(friends: ExpenseShareEditorFriend[]) {
  return Object.fromEntries(initialValues(friends).map((value) => [value.friendId, value.amountRupiah]));
}

function initialCharges(charges: ExpenseShareEditorCharge[]): ExpenseShareChargeValues[] {
  return charges.map(({ name, percentageBasisPoints, scope, friendIds }) => ({ name, percentage: formatPercentageBasisPoints(percentageBasisPoints), scope, friendIds: [...friendIds] }));
}

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

function chargeInputValues(charges: ExpenseShareChargeValues[]) {
  return charges.flatMap((charge) => {
    const percentageBasisPoints = parsePercentageBasisPoints(charge.percentage);
    return percentageBasisPoints === null ? [] : [{ name: charge.name, percentageBasisPoints, scope: charge.scope, friendIds: charge.friendIds }];
  });
}

type ExpenseShareUndo =
  | { kind: "friend"; friend: ExpenseShareEditorFriend; amountRupiah: string; index: number; targetedCharges: Array<{ index: number; name: string; percentage: string; scope: ExpenseShareChargeValues["scope"] }> }
  | { kind: "charge"; charge: ExpenseShareChargeValues; index: number };

export function ExpenseShareEditor({ action, expenseAmount, friends: initialFriends, charges: initialChargeDefinitions = [], friendOptions: initialFriendOptions = [], searchFriends = emptySearch, previousSplit }: ExpenseShareEditorProps) {
  const [state, formAction] = useActionState(action, { ...emptyActionState, values: initialValues(initialFriends), charges: initialCharges(initialChargeDefinitions) });
  const [selectedFriends, setSelectedFriends] = useState(initialFriends);
  const [draftAmounts, setDraftAmounts] = useState(() => initialAmounts(initialFriends));
  const [draftCharges, setDraftCharges] = useState<ExpenseShareChargeValues[]>(() => initialCharges(initialChargeDefinitions));
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [confirmPreviousSplit, setConfirmPreviousSplit] = useState(false);
  const [previousSplitMessage, setPreviousSplitMessage] = useState("");
  const [undoRemoval, setUndoRemoval] = useState<ExpenseShareUndo | null>(null);
  const previousStateRef = useRef(state);
  const amountRefs = useRef(new Map<string, HTMLInputElement>());
  const friendLookupRef = useRef(new Map<string, ExpenseShareEditorFriend>([
    ...initialFriends.map((friend) => [friend.id, friend] as const),
    ...initialFriendOptions.map((option) => [option.id, { id: option.id, name: option.label, archivedAt: null }] as const),
  ]));
  const selectedIds = useMemo(() => new Set(selectedFriends.map((friend) => friend.id)), [selectedFriends]);
  const friendOptions = useMemo(() => initialFriendOptions.filter((option) => !option.archived && !selectedIds.has(option.id)).slice(0, 20), [initialFriendOptions, selectedIds]);
  const search = useCallback((query: string, selectedId?: string) => searchFriends(query, selectedId).then((options) => options.filter((option) => !option.archived && !selectedIds.has(option.id)).slice(0, 20)), [searchFriends, selectedIds]);
  const validCharges = useMemo(() => chargeInputValues(draftCharges), [draftCharges]);

  useEffect(() => {
    if (previousStateRef.current === state) return;
    previousStateRef.current = state;
    const nextFriends = state.values.map((value) => friendLookupRef.current.get(value.friendId) ?? { id: value.friendId, name: value.friendId, archivedAt: null });
    setSelectedFriends(nextFriends);
    setDraftAmounts(Object.fromEntries(state.values.map((value) => [value.friendId, value.amountRupiah])));
    setDraftCharges(state.charges ?? []);
    if (!state.formError && Object.keys(state.fieldErrors).length === 0) setUndoRemoval(null);
  }, [state]);

  useEffect(() => {
    if (pendingFocusId) amountRefs.current.get(pendingFocusId)?.focus();
  }, [pendingFocusId, selectedFriends]);

  function addFriend(option: SearchableOption) {
    if (option.archived || selectedIds.has(option.id)) return;
    const friend = { id: option.id, name: option.label, archivedAt: null };
    friendLookupRef.current.set(friend.id, friend);
    setSelectedFriends((current) => [...current, friend]);
    setDraftAmounts((current) => ({ ...current, [friend.id]: "" }));
    setPendingFocusId(friend.id);
  }

  function addFriends(options: SearchableOption[]) {
    const additions = options.filter((option) => !option.archived && !selectedIds.has(option.id));
    if (additions.length === 0) return;
    const friends = additions.map((option) => ({ id: option.id, name: option.label, archivedAt: null }));
    friends.forEach((friend) => friendLookupRef.current.set(friend.id, friend));
    setSelectedFriends((current) => [...current, ...friends]);
    setDraftAmounts((current) => ({ ...current, ...Object.fromEntries(friends.map((friend) => [friend.id, ""])) }));
    setPendingFocusId(friends[0]!.id);
  }

  function applyPreviousSplit() {
    if (!previousSplit) return;
    const copiedFriends = previousSplit.friends.filter((friend, index, all) => friend.archivedAt === null && all.findIndex((candidate) => candidate.id === friend.id) === index);
    if (copiedFriends.length === 0) {
      setPreviousSplitMessage("No active friends from the previous split are available.");
      setConfirmPreviousSplit(false);
      return;
    }
    const copiedIds = new Set(copiedFriends.map((friend) => friend.id));
    const copiedCharges = previousSplit.charges.flatMap((charge) => {
      const friendIds = charge.scope === "all" ? [] : [...new Set(charge.friendIds.filter((friendId) => copiedIds.has(friendId)))];
      return charge.scope === "selected" && friendIds.length === 0 ? [] : [{ name: charge.name, percentage: formatPercentageBasisPoints(charge.percentageBasisPoints), scope: charge.scope, friendIds }];
    });
    copiedFriends.forEach((friend) => friendLookupRef.current.set(friend.id, friend));
    setSelectedFriends(copiedFriends);
    setDraftAmounts(Object.fromEntries(copiedFriends.map((friend) => [friend.id, String(friend.baseAmount)])));
    setDraftCharges(copiedCharges);
    setPendingFocusId(copiedFriends[0]!.id);
    setConfirmPreviousSplit(false);
    setPreviousSplitMessage("");
  }

  function usePreviousSplit() {
    if (selectedFriends.length > 0 || draftCharges.length > 0) {
      setConfirmPreviousSplit(true);
      return;
    }
    applyPreviousSplit();
  }

  function removeFriend(friendId: string) {
    const friendIndex = selectedFriends.findIndex((friend) => friend.id === friendId);
    const friend = selectedFriends[friendIndex];
    if (!friend) return;
    setUndoRemoval({
      kind: "friend",
      friend,
      amountRupiah: draftAmounts[friendId] ?? "",
      index: friendIndex,
      targetedCharges: draftCharges.flatMap((charge, index) => charge.scope === "selected" && charge.friendIds.includes(friendId) ? [{ index, name: charge.name, percentage: charge.percentage, scope: charge.scope }] : []),
    });
    setSelectedFriends((current) => current.filter((friend) => friend.id !== friendId));
    setDraftAmounts((current) => {
      const next = { ...current };
      delete next[friendId];
      return next;
    });
    setDraftCharges((current) => current.map((charge) => ({ ...charge, friendIds: charge.friendIds.filter((id) => id !== friendId) })));
  }

  function splitEvenly() {
    if (selectedFriends.length === 0) return;
    const baseAmount = Math.floor(expenseAmount / (selectedFriends.length + 1));
    setDraftAmounts(Object.fromEntries(selectedFriends.map((friend) => [friend.id, String(baseAmount)])));
  }

  function addCharge() {
    setDraftCharges((current) => [...current, { name: "", percentage: "", scope: "all", friendIds: [] }]);
  }

  function updateCharge(index: number, update: Partial<ExpenseShareChargeValues>) {
    setDraftCharges((current) => current.map((charge, chargeIndex) => chargeIndex === index ? { ...charge, ...update } : charge));
  }

  function removeCharge(index: number) {
    const charge = draftCharges[index];
    if (!charge) return;
    setUndoRemoval({ kind: "charge", charge: { ...charge, friendIds: [...charge.friendIds] }, index });
    setDraftCharges((current) => current.filter((_, chargeIndex) => chargeIndex !== index));
  }

  function undoLastRemoval() {
    const operation = undoRemoval;
    if (!operation) return;
    setUndoRemoval(null);
    if (operation.kind === "charge") {
      setDraftCharges((current) => {
        if (current.some((charge) => charge.name === operation.charge.name && charge.percentage === operation.charge.percentage && charge.scope === operation.charge.scope && charge.friendIds.join(",") === operation.charge.friendIds.join(","))) return current;
        const next = [...current];
        next.splice(Math.min(operation.index, next.length), 0, { ...operation.charge, friendIds: [...operation.charge.friendIds] });
        return next;
      });
      return;
    }

    if (selectedFriends.some((friend) => friend.id === operation.friend.id) || !friendLookupRef.current.has(operation.friend.id)) return;
    setSelectedFriends((current) => current.some((friend) => friend.id === operation.friend.id) ? current : [...current.slice(0, operation.index), operation.friend, ...current.slice(operation.index)]);
    setDraftAmounts((current) => current[operation.friend.id] !== undefined ? current : { ...current, [operation.friend.id]: operation.amountRupiah });
    setDraftCharges((current) => current.map((charge, index) => {
      const targeted = operation.targetedCharges.find((previous) => previous.index === index || (previous.name === charge.name && previous.percentage === charge.percentage && previous.scope === charge.scope));
      if (!targeted || charge.scope !== "selected" || charge.friendIds.includes(operation.friend.id)) return charge;
      return { ...charge, friendIds: [...charge.friendIds, operation.friend.id] };
    }));
  }

  if (selectedFriends.length === 0 && friendOptions.length === 0 && !undoRemoval) {
    return (
      <div className="expense-share-editor expense-share-editor--empty">
        <p className="technical-label">FRIEND SHARES</p>
        <p>Add an active friend before assigning a share.</p>
        <Link className="action-link" href="/app/friends">Go to friends <span aria-hidden="true">→</span></Link>
      </div>
    );
  }

  const breakdowns = selectedFriends.map((friend) => {
    const baseAmount = parseRupiah(draftAmounts[friend.id] ?? "") ?? 0;
    try {
      return { friendId: friend.id, ...calculateShareBreakdown(baseAmount, validCharges, friend.id) };
    } catch {
      return { friendId: friend.id, baseAmount, charges: [], finalAmount: MAX_RUPIAH + 1 };
    }
  });
  const totalOwed = breakdowns.reduce((total, breakdown) => total + breakdown.finalAmount, 0);
  const overAllocated = totalOwed > expenseAmount;
  const ownerPortion = Math.max(expenseAmount - totalOwed, 0);
  const allocationProgress = expenseAmount > 0 ? Math.min(Math.max(totalOwed / expenseAmount, 0), 1) : 0;

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
      <form className="expense-share-editor__form" action={formAction} noValidate>
        <div className="expense-share-editor__add">
          <div>
            <label id="expense-share-add-label" htmlFor="expense-share-add">Add friend</label>
            {selectedFriends.length > 0 ? <button className="text-link" type="button" onClick={splitEvenly}>Split evenly (incl. you)</button> : null}
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
        <section className="expense-share-editor__charges" aria-labelledby="expense-share-charges-heading">
          <div className="expense-share-editor__section-heading">
            <h3 id="expense-share-charges-heading">Charges</h3>
            <button className="text-link" type="button" onClick={addCharge}>Add charge</button>
          </div>
          {draftCharges.map((charge, index) => {
            const errorId = `expense-share-charge-${index}-error`;
            return (
              <div className="expense-share-editor__charge" key={index}>
                <div className="expense-share-editor__charge-heading">
                  <label htmlFor={`expense-share-charge-name-${index}`}>Charge {index + 1}</label>
                  <button className="text-link" type="button" onClick={() => removeCharge(index)}>Remove</button>
                </div>
                <div className="expense-share-editor__charge-fields">
                  <input id={`expense-share-charge-name-${index}`} type="text" value={charge.name} placeholder="Name" onChange={(event) => updateCharge(index, { name: event.target.value })} aria-describedby={errorId} />
                  <div className="expense-share-editor__percentage-input"><input aria-label={`Charge ${index + 1} percentage`} type="text" inputMode="decimal" value={charge.percentage} placeholder="%" onChange={(event) => updateCharge(index, { percentage: event.target.value })} /><span aria-hidden="true">%</span></div>
                  <select aria-label={`Charge ${index + 1} scope`} value={charge.scope} onChange={(event) => updateCharge(index, { scope: event.target.value as "all" | "selected", friendIds: event.target.value === "all" ? [] : charge.friendIds })}>
                    <option value="all">All friends</option>
                    <option value="selected">Selected friends</option>
                  </select>
                </div>
                {charge.scope === "selected" ? <div className="expense-share-editor__targets" aria-label={`Friends for charge ${index + 1}`}>
                  {selectedFriends.map((friend) => <label key={friend.id}><input type="checkbox" checked={charge.friendIds.includes(friend.id)} onChange={(event) => updateCharge(index, { friendIds: event.target.checked ? [...charge.friendIds, friend.id] : charge.friendIds.filter((id) => id !== friend.id) })} /> {friend.name}</label>)}
                </div> : null}
                <FieldError id={errorId} message={state.fieldErrors[`charge-${index}`]} />
              </div>
            );
          })}
          <input type="hidden" name="charges" value={JSON.stringify(draftCharges)} readOnly />
        </section>
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
              {friend.expenseShareId && (friend.remainingAmount ?? 0) > 0 ? <Link className="text-link" href={`/app/repayments?create=1&friendId=${encodeURIComponent(friend.id)}&expenseShareId=${encodeURIComponent(friend.expenseShareId)}`}>Record repayment</Link> : null}
              <input
                ref={(element) => { if (element) amountRefs.current.set(friend.id, element); else amountRefs.current.delete(friend.id); }}
                id={`expense-share-${friend.id}`}
                name="amountRupiah"
                type="text"
                inputMode="numeric"
                value={draftAmounts[friend.id] ?? ""}
                onChange={(event) => setDraftAmounts((current) => ({ ...current, [friend.id]: event.target.value }))}
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
