"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ExpenseShareActionState } from "@/app/app/expenses/actions";
import { parseRupiah, formatRupiah } from "@/domain/rupiah";

export type ExpenseShareEditorFriend = {
  id: string;
  name: string;
  archivedAt: Date | null;
  amountOwed?: number;
};

type ExpenseShareAction = (
  previousState: ExpenseShareActionState,
  formData: FormData,
) => Promise<ExpenseShareActionState>;

type ExpenseShareEditorProps = {
  action: ExpenseShareAction;
  expenseAmount: number;
  friends: ExpenseShareEditorFriend[];
};

const emptyActionState: ExpenseShareActionState = { fieldErrors: {}, formError: "", values: [] };

function initialAmounts(friends: ExpenseShareEditorFriend[]) {
  return Object.fromEntries(friends.map((friend) => [friend.id, friend.amountOwed?.toString() ?? ""]));
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

export function ExpenseShareEditor({ action, expenseAmount, friends }: ExpenseShareEditorProps) {
  const [state, formAction] = useActionState(action, { ...emptyActionState, values: friends.map((friend) => ({ friendId: friend.id, amountRupiah: friend.amountOwed?.toString() ?? "" })) });
  const [draftAmounts, setDraftAmounts] = useState<Record<string, string> | null>(null);
  const amounts = draftAmounts ?? initialAmounts(friends);

  if (friends.length === 0) {
    return (
      <div className="expense-share-editor expense-share-editor--empty">
        <p className="technical-label">FRIEND SHARES</p>
        <p>Add an active friend before assigning a share.</p>
        <Link className="action-link" href="/app/friends">Go to friends <span aria-hidden="true">→</span></Link>
      </div>
    );
  }

  const totalOwed = friends.reduce((total, friend) => {
    const amount = parseRupiah(amounts[friend.id] ?? "");
    return total + (amount ?? 0);
  }, 0);
  const overAllocated = totalOwed > expenseAmount;
  const ownerPortion = Math.max(expenseAmount - totalOwed, 0);
  const allocationProgress = expenseAmount > 0 ? Math.min(Math.max(totalOwed / expenseAmount, 0), 1) : 0;

  return (
    <div className="expense-share-editor">
      <p className="technical-label">FRIEND SHARES</p>
      <h2>Assign the split</h2>
      <div className="expense-share-editor__totals" aria-live="polite">
        <div><span className="technical-label">Expense total</span><strong>{formatRupiah(expenseAmount)}</strong></div>
        <div><span className="technical-label">Total owed by friends</span><strong>{formatRupiah(totalOwed)}</strong></div>
        <div><span className="technical-label">Owner portion</span><strong>{formatRupiah(ownerPortion)}</strong></div>
      </div>
      <div className={`allocation-bar${overAllocated ? " allocation-bar--error" : ""}`} aria-label="Expense allocation" role="progressbar" aria-valuemin={0} aria-valuemax={expenseAmount} aria-valuenow={Math.min(totalOwed, expenseAmount)}>
        <span className="allocation-bar__track"><span className="allocation-bar__fill" style={{ transform: `scaleX(${allocationProgress})` }} /></span>
        <span>{overAllocated ? `Over-allocated by ${formatRupiah(totalOwed - expenseAmount)}.` : `${formatRupiah(ownerPortion)} remains your portion.`}</span>
      </div>
      <form className="expense-share-editor__form" action={formAction} noValidate>
        <p className="expense-share-editor__help">Enter a whole-rupiah amount. A blank field removes or omits that friend.</p>
        {friends.map((friend) => {
          const fieldErrorId = `expense-share-${friend.id}-error`;
          const helpId = `expense-share-${friend.id}-help`;
          const archived = friend.archivedAt !== null;
          return (
            <div className="expense-share-editor__field" key={friend.id}>
              <input type="hidden" name="friendId" value={friend.id} />
              <label htmlFor={`expense-share-${friend.id}`}>
                <span>{friend.name}</span>
                {archived ? <span className="technical-label">ARCHIVED</span> : null}
              </label>
              <input
                id={`expense-share-${friend.id}`}
                name="amountRupiah"
                type="text"
                inputMode="numeric"
                value={amounts[friend.id] ?? ""}
                onChange={(event) => setDraftAmounts((current) => ({ ...(current ?? amounts), [friend.id]: event.target.value }))}
                aria-invalid={Boolean(state.fieldErrors[friend.id])}
                aria-describedby={`${helpId} ${fieldErrorId}`}
                autoComplete="off"
              />
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
